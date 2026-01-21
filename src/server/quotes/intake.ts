import { randomBytes } from "node:crypto";
import type { User } from "@supabase/supabase-js";
import {
  CAD_FILE_TYPE_DESCRIPTION,
  MAX_UPLOAD_SIZE_BYTES,
  bytesToMegabytes,
  isAllowedCadFileName,
} from "@/lib/cadFileTypes";
import { DEFAULT_QUOTE_STATUS } from "@/server/quotes/status";
import { supabaseServer } from "@/lib/supabaseServer";
import {
  serializeSupabaseError,
  isMissingTableOrColumnError,
} from "@/server/admin/logging";
import { notifyAdminOnQuoteSubmitted } from "@/server/quotes/notifications";
import { emitQuoteEvent } from "@/server/quotes/events";
import {
  buildUploadTargetForQuote,
  type UploadTarget,
  registerUploadedObjectsForExistingUpload,
} from "@/server/quotes/uploadFiles";
import { applyCustomerEmailDefaultToNewQuote } from "@/server/quotes/customerEmailDefaults";
import { getCustomerEmailOptInStatus, isCustomerEmailBridgeEnabled } from "@/server/quotes/customerEmailPrefs";
import { sendCustomerInviteEmail } from "@/server/quotes/emailInvites";
import { markInviteSent, wasInviteSent } from "@/server/quotes/emailInviteMarkers";
import { warnOnce } from "@/server/db/schemaErrors";

const CANONICAL_CAD_BUCKET = "cad_uploads";

function canonicalizeCadBucketId(input: unknown): string {
  const raw = typeof input === "string" ? input.trim() : "";
  if (!raw) return "";
  if (raw === "cad-uploads") return "cad_uploads";
  if (raw === "cad_uploads") return "cad_uploads";
  if (raw === "cad") return "cad_uploads";
  return raw;
}

const CAD_BUCKET = (() => {
  const configured =
    process.env.SUPABASE_CAD_BUCKET ||
    process.env.NEXT_PUBLIC_CAD_BUCKET ||
    process.env.NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET ||
    "";
  const normalized = canonicalizeCadBucketId(configured) || CANONICAL_CAD_BUCKET;
  if (normalized !== CANONICAL_CAD_BUCKET) {
    console.warn("[quote intake] overriding configured CAD bucket", {
      configuredBucket: configured || null,
      normalizedBucket: normalized,
      canonicalBucket: CANONICAL_CAD_BUCKET,
    });
  }
  return CANONICAL_CAD_BUCKET;
})();

const MIME_BY_EXTENSION: Record<string, string> = {
  stl: "model/stl",
  step: "application/step",
  stp: "application/step",
  iges: "model/iges",
  igs: "model/iges",
  sldprt: "application/sldprt",
  sldasm: "application/sldasm",
  zip: "application/zip",
  pdf: "application/pdf",
};

const FILE_SIZE_LIMIT_LABEL = `${bytesToMegabytes(MAX_UPLOAD_SIZE_BYTES)} MB`;
const MAX_FILES_PER_RFQ = 20;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;

export type QuoteIntakeFieldKey =
  | "file"
  | "firstName"
  | "lastName"
  | "email"
  | "manufacturingProcess"
  | "quantity"
  | "shippingPostalCode"
  | "exportRestriction"
  | "itarAcknowledged"
  | "termsAccepted";

export type QuoteIntakeFieldErrors = Partial<Record<QuoteIntakeFieldKey, string>>;

export type QuoteIntakePayload = {
  files: File[];
  firstName: string;
  lastName: string;
  email: string;
  company: string;
  phone: string;
  manufacturingProcess: string;
  quantity: string;
  targetDate: string;
  shippingPostalCode: string;
  exportRestriction: string;
  rfqReason: string;
  notes: string;
  itarAcknowledged: boolean;
  termsAccepted: boolean;
};

type StoredCadFile = {
  originalName: string;
  sanitizedFileName: string;
  storageKey: string;
  storagePath: string;
  mimeType: string;
  sizeBytes: number;
  bucket: string;
  buffer?: Buffer; // retained only for ZIP enumeration
};

export type QuoteIntakePersistResult =
  | {
      ok: true;
      uploadId: string;
      quoteId: string | null;
      metadataRecorded: boolean;
    }
  | {
      ok: false;
      error: string;
      fieldErrors?: QuoteIntakeFieldErrors;
      reason?: string;
    };

export type QuoteIntakeDirectUploadPersistResult =
  | {
      ok: true;
      uploadId: string;
      quoteId: string;
      targets: UploadTarget[];
    }
  | {
      ok: false;
      error: string;
      fieldErrors?: QuoteIntakeFieldErrors;
      reason?: string;
    };

type QuoteIntakeFileMeta = {
  fileName: string;
  sizeBytes: number;
  mimeType: string | null;
};

export async function persistQuoteIntakeDirectUpload(params: {
  payload: Omit<QuoteIntakePayload, "files"> & { files: QuoteIntakeFileMeta[] };
  user: User;
  options?: { contactEmailOverride?: string | null };
}): Promise<QuoteIntakeDirectUploadPersistResult> {
  const { user } = params;
  const sessionEmail = normalizeEmailInput(user.email ?? null);
  const formEmail = normalizeEmailInput(params.payload.email);
  const contactEmail =
    normalizeEmailInput(params.options?.contactEmailOverride ?? null) ??
    formEmail ??
    sessionEmail;

  if (!contactEmail) {
    return {
      ok: false,
      error: "A valid email address is required.",
      fieldErrors: { email: "Enter a valid email address." },
      reason: "missing-email",
    };
  }

  const filesMeta = Array.isArray(params.payload.files)
    ? params.payload.files.filter(Boolean)
    : [];
  if (filesMeta.length === 0) {
    return {
      ok: false,
      error: "Attach at least one CAD file before submitting.",
      fieldErrors: { file: "Attach at least one CAD file before submitting." },
      reason: "file-missing",
    };
  }

  const pseudoFiles = filesMeta.map(
    (f) =>
      ({
        name: f.fileName,
        size: f.sizeBytes,
        type: f.mimeType ?? "",
      }) as unknown as File,
  );

  const payloadForValidation: QuoteIntakePayload = {
    ...(params.payload as Omit<QuoteIntakePayload, "files">),
    files: pseudoFiles,
  };
  const fieldErrors = validateQuoteIntakeFields(payloadForValidation);
  if (Object.keys(fieldErrors).length > 0) {
    return {
      ok: false,
      error: "Please fix the highlighted fields before submitting.",
      fieldErrors,
      reason: "field-validation",
    };
  }

  const contactName =
    buildContactName(params.payload.firstName, params.payload.lastName) ||
    sanitizeNullable(params.payload.company) ||
    contactEmail;

  const logContext = {
    userId: user.id,
    contactEmail,
    sessionEmail,
    primaryFileName: filesMeta[0]?.fileName ?? null,
    fileCount: filesMeta.length,
  };

  try {
    const customerId = await upsertCustomerRecord({
      contactEmail,
      contactName,
      company: sanitizeNullable(params.payload.company),
      user,
      sessionEmail,
    });

    const primary = filesMeta[0]!;
    const safePrimaryName = sanitizeFileName(
      primary.fileName,
      getFileExtension(primary.fileName),
    );
    const pendingStoragePath = buildStorageKey(safePrimaryName);

    const { data: uploadRow, error: uploadError } = await supabaseServer
      .from("uploads")
      .insert({
        file_name: primary.fileName,
        file_path: pendingStoragePath,
        mime_type: primary.mimeType,
        name: contactName,
        email: contactEmail,
        company: sanitizeNullable(params.payload.company),
        notes: sanitizeNullable(params.payload.notes),
        customer_id: customerId,
        status: DEFAULT_QUOTE_STATUS,
        first_name: sanitizeNullable(params.payload.firstName),
        last_name: sanitizeNullable(params.payload.lastName),
        phone: sanitizeNullable(params.payload.phone),
        manufacturing_process: sanitizeNullable(params.payload.manufacturingProcess),
        quantity: sanitizeNullable(params.payload.quantity),
        shipping_postal_code: sanitizeNullable(params.payload.shippingPostalCode),
        export_restriction: sanitizeNullable(params.payload.exportRestriction),
        rfq_reason: sanitizeNullable(params.payload.rfqReason),
        itar_acknowledged: params.payload.itarAcknowledged,
        terms_accepted: params.payload.termsAccepted,
      })
      .select("id")
      .single<{ id: string }>();

    if (uploadError || !uploadRow?.id) {
      console.error("[quote intake direct] upload insert failed", {
        ...logContext,
        error: serializeSupabaseError(uploadError),
      });
      return {
        ok: false,
        error: "We couldn’t save your upload metadata. Please retry.",
        reason: "db-insert-upload",
      };
    }

    const uploadId = uploadRow.id;

    const quoteInsert = await supabaseServer
      .from("quotes")
      .insert({
        upload_id: uploadId,
        customer_name: contactName,
        customer_email: contactEmail,
        company: sanitizeNullable(params.payload.company),
        file_name: primary.fileName,
        status: DEFAULT_QUOTE_STATUS,
        currency: "USD",
        price: null,
        customer_id: customerId,
        target_date: sanitizeNullable(params.payload.targetDate),
      })
      .select("id")
      .single<{ id: string }>();

    if (quoteInsert.error || !quoteInsert.data?.id) {
      console.error("[quote intake direct] quote insert failed", {
        ...logContext,
        uploadId,
        error: serializeSupabaseError(quoteInsert.error),
      });
      return {
        ok: false,
        error: "We couldn’t create your quote record. Please retry.",
        reason: "db-insert-quote",
      };
    }

    const quoteId = quoteInsert.data.id;

    // Phase 19.3.13: best-effort default email replies for new quotes.
    // Safe-by-default: helper does not probe when the bridge env flag is off.
    if (customerId) {
      try {
        await applyCustomerEmailDefaultToNewQuote({ quoteId, customerId });
      } catch {
        // Never block quote creation.
      }
    }

    // Phase 19.3.14: best-effort customer invite email on quote creation.
    void autoSendCustomerInviteAfterQuoteCreate({ quoteId, customerId });

    const targets = filesMeta.map((f) =>
      buildUploadTargetForQuote({
        quoteId,
        fileName: f.fileName,
        sizeBytes: f.sizeBytes,
        mimeType: f.mimeType,
      }),
    );

    const primaryTarget = targets[0];
    if (!primaryTarget) {
      return {
        ok: false,
        error: "We couldn’t allocate storage targets. Please retry.",
        reason: "targets-missing",
      };
    }

    const { error: uploadUpdateError } = await supabaseServer
      .from("uploads")
      .update({
        quote_id: quoteId,
        file_path: primaryTarget.storagePath,
        status: DEFAULT_QUOTE_STATUS,
      })
      .eq("id", uploadId);
    if (uploadUpdateError) {
      console.error("[quote intake direct] upload linkage failed", {
        ...logContext,
        quoteId,
        uploadId,
        error: serializeSupabaseError(uploadUpdateError),
      });
    }

    void emitQuoteEvent({
      quoteId,
      eventType: "submitted",
      actorRole: "customer",
      actorUserId: user.id,
      metadata: {
        upload_id: uploadId,
        contact_email: contactEmail,
        contact_name: contactName,
        company: sanitizeNullable(params.payload.company),
        primary_file_name: primary.fileName,
      },
    });

    void notifyAdminOnQuoteSubmitted({
      quoteId,
      contactName,
      contactEmail,
      company: sanitizeNullable(params.payload.company),
      fileName: primary.fileName,
    });

    return { ok: true, uploadId, quoteId, targets };
  } catch (error) {
    console.error("[quote intake direct] failed", {
      ...logContext,
      error: serializeSupabaseError(error),
    });
    return {
      ok: false,
      error: "Unexpected server error while submitting your RFQ.",
      reason: "unexpected-error",
    };
  }
}

export type QuoteIntakeFromUploadedTargetsResult =
  | { ok: true; uploadId: string; quoteId: string }
  | {
      ok: false;
      error: string;
      fieldErrors?: QuoteIntakeFieldErrors;
      reason?: string;
      quoteId?: string;
      uploadId?: string;
    };

/**
 * Finalize an RFQ intake by creating DB records (quote + upload) and registering
 * already-uploaded Storage objects (no byte upload performed here).
 *
 * This is used by the "ephemeral intake upload" flow where the browser uploads
 * first (with proof), then we persist metadata once the user submits the RFQ.
 */
export async function persistQuoteIntakeFromUploadedTargets(params: {
  payload: Omit<QuoteIntakePayload, "files"> & { files: QuoteIntakeFileMeta[] };
  targets: UploadTarget[];
  user: User;
  options?: { contactEmailOverride?: string | null };
  idempotencyKey?: string | null;
}): Promise<QuoteIntakeFromUploadedTargetsResult> {
  const { user } = params;
  const sessionEmail = normalizeEmailInput(user.email ?? null);
  const formEmail = normalizeEmailInput(params.payload.email);
  const contactEmail =
    normalizeEmailInput(params.options?.contactEmailOverride ?? null) ??
    formEmail ??
    sessionEmail;

  if (!contactEmail) {
    return {
      ok: false,
      error: "A valid email address is required.",
      fieldErrors: { email: "Enter a valid email address." },
      reason: "missing-email",
    };
  }

  const filesMeta = Array.isArray(params.payload.files)
    ? params.payload.files.filter(Boolean)
    : [];
  const targets = Array.isArray(params.targets) ? params.targets.filter(Boolean) : [];

  if (filesMeta.length === 0) {
    return {
      ok: false,
      error: "Attach at least one CAD file before submitting.",
      fieldErrors: { file: "Attach at least one CAD file before submitting." },
      reason: "file-missing",
    };
  }
  if (targets.length === 0 || targets.length !== filesMeta.length) {
    return {
      ok: false,
      error: "Upload targets are missing. Please retry the upload.",
      reason: "targets-missing",
    };
  }

  const pseudoFiles = filesMeta.map(
    (f) =>
      ({
        name: f.fileName,
        size: f.sizeBytes,
        type: f.mimeType ?? "",
      }) as unknown as File,
  );

  const payloadForValidation: QuoteIntakePayload = {
    ...(params.payload as Omit<QuoteIntakePayload, "files">),
    files: pseudoFiles,
  };
  const fieldErrors = validateQuoteIntakeFields(payloadForValidation);
  if (Object.keys(fieldErrors).length > 0) {
    return {
      ok: false,
      error: "Please fix the highlighted fields before submitting.",
      fieldErrors,
      reason: "field-validation",
    };
  }

  const contactName =
    buildContactName(params.payload.firstName, params.payload.lastName) ||
    sanitizeNullable(params.payload.company) ||
    contactEmail;

  let idempotencyKey = normalizeIdempotencyKey(params.idempotencyKey);

  const logContext = {
    userId: user.id,
    contactEmail,
    sessionEmail,
    primaryFileName: filesMeta[0]?.fileName ?? null,
    fileCount: filesMeta.length,
    idempotencyKey: idempotencyKey ?? null,
  };

  try {
    const customerId = await upsertCustomerRecord({
      contactEmail,
      contactName,
      company: sanitizeNullable(params.payload.company),
      user,
      sessionEmail,
    });

    const primary = filesMeta[0]!;
    const primaryTarget = targets[0]!;

    let uploadId: string | null = null;
    let quoteId: string | null = null;

    const loadExistingUpload = async (): Promise<{
      id: string;
      quote_id: string | null;
    } | null> => {
      if (!idempotencyKey) return null;
      try {
        const { data, error } = await supabaseServer
          .from("uploads")
          .select("id,quote_id")
          .eq("intake_idempotency_key", idempotencyKey)
          .maybeSingle<{ id: string; quote_id: string | null }>();
        if (error) {
          if (isMissingTableOrColumnError(error)) {
            idempotencyKey = null;
            return null;
          }
          console.warn("[quote intake finalize] idempotency lookup failed", {
            ...logContext,
            error: serializeSupabaseError(error),
          });
          return null;
        }
        return data?.id ? data : null;
      } catch (error) {
        if (isMissingTableOrColumnError(error)) {
          idempotencyKey = null;
          return null;
        }
        console.warn("[quote intake finalize] idempotency lookup crashed", {
          ...logContext,
          error: serializeSupabaseError(error),
        });
        return null;
      }
    };

    const loadQuoteIdForUpload = async (existingUploadId: string): Promise<string | null> => {
      const normalizedUploadId = normalizeReferenceId(existingUploadId);
      if (!normalizedUploadId) return null;
      try {
        const { data, error } = await supabaseServer
          .from("quotes")
          .select("id")
          .eq("upload_id", normalizedUploadId)
          .maybeSingle<{ id: string }>();
        if (error) {
          console.warn("[quote intake finalize] quote lookup failed", {
            ...logContext,
            uploadId: normalizedUploadId,
            error: serializeSupabaseError(error),
          });
          return null;
        }
        return normalizeReferenceId(data?.id ?? null) || null;
      } catch (error) {
        console.warn("[quote intake finalize] quote lookup crashed", {
          ...logContext,
          uploadId: normalizedUploadId,
          error: serializeSupabaseError(error),
        });
        return null;
      }
    };

    const registerExisting = async (existingUploadId: string, existingQuoteId: string) => {
      const registerResult = await registerUploadedObjectsForExistingUpload({
        quoteId: existingQuoteId,
        uploadId: existingUploadId,
        targets,
        supabase: supabaseServer,
      });
      if (!registerResult.ok) {
        return {
          ok: false as const,
          error: buildRegisterFilesErrorMessage(existingQuoteId, existingUploadId),
          reason: "register-files",
          quoteId: existingQuoteId,
          uploadId: existingUploadId,
        };
      }
      return { ok: true as const, uploadId: existingUploadId, quoteId: existingQuoteId };
    };

    const existingUpload = await loadExistingUpload();
    if (existingUpload?.id) {
      uploadId = normalizeReferenceId(existingUpload.id);
      quoteId = normalizeReferenceId(existingUpload.quote_id);
      if (uploadId && !quoteId) {
        quoteId = await loadQuoteIdForUpload(uploadId);
        if (quoteId) {
          const { error: updateError } = await supabaseServer
            .from("uploads")
            .update({ quote_id: quoteId })
            .eq("id", uploadId);
          if (updateError) {
            console.warn("[quote intake finalize] idempotency upload update failed", {
              ...logContext,
              uploadId,
              quoteId,
              error: serializeSupabaseError(updateError),
            });
          }
        }
      }

      if (uploadId && quoteId) {
        return registerExisting(uploadId, quoteId);
      }
    }

    const buildUploadPayload = () => {
      const payload: Record<string, unknown> = {
        file_name: primary.fileName,
        file_path: primaryTarget.storagePath,
        mime_type: primary.mimeType,
        name: contactName,
        email: contactEmail,
        company: sanitizeNullable(params.payload.company),
        notes: sanitizeNullable(params.payload.notes),
        customer_id: customerId,
        status: DEFAULT_QUOTE_STATUS,
        first_name: sanitizeNullable(params.payload.firstName),
        last_name: sanitizeNullable(params.payload.lastName),
        phone: sanitizeNullable(params.payload.phone),
        manufacturing_process: sanitizeNullable(params.payload.manufacturingProcess),
        quantity: sanitizeNullable(params.payload.quantity),
        shipping_postal_code: sanitizeNullable(params.payload.shippingPostalCode),
        export_restriction: sanitizeNullable(params.payload.exportRestriction),
        rfq_reason: sanitizeNullable(params.payload.rfqReason),
        itar_acknowledged: params.payload.itarAcknowledged,
        terms_accepted: params.payload.termsAccepted,
      };
      if (idempotencyKey) {
        payload.intake_idempotency_key = idempotencyKey;
      }
      return payload;
    };

    if (!uploadId) {
      let uploadPayload = buildUploadPayload();
      let uploadResult = await supabaseServer
        .from("uploads")
        .insert(uploadPayload)
        .select("id")
        .single<{ id: string }>();

      if (uploadResult.error && idempotencyKey && isMissingTableOrColumnError(uploadResult.error)) {
        idempotencyKey = null;
        uploadPayload = buildUploadPayload();
        uploadResult = await supabaseServer
          .from("uploads")
          .insert(uploadPayload)
          .select("id")
          .single<{ id: string }>();
      }

      if (uploadResult.error || !uploadResult.data?.id) {
        if (uploadResult.error && idempotencyKey && isUniqueViolation(uploadResult.error)) {
          const retryExisting = await loadExistingUpload();
          if (retryExisting?.id) {
            uploadId = normalizeReferenceId(retryExisting.id);
            quoteId = normalizeReferenceId(retryExisting.quote_id);
            if (uploadId && !quoteId) {
              quoteId = await loadQuoteIdForUpload(uploadId);
            }
            if (uploadId && quoteId) {
              return registerExisting(uploadId, quoteId);
            }
          }
        }

        console.error("[quote intake finalize] upload insert failed", {
          ...logContext,
          error: serializeSupabaseError(uploadResult.error),
        });
        return {
          ok: false,
          error: "We couldn’t save your upload metadata. Please retry.",
          reason: "db-insert-upload",
          uploadId: uploadId ?? undefined,
        };
      }

      uploadId = uploadResult.data.id;
    }

    if (!uploadId) {
      return {
        ok: false,
        error: "We couldn’t save your upload metadata. Please retry.",
        reason: "db-insert-upload",
      };
    }

    const ensuredUploadId = uploadId;

    const quoteInsert = await supabaseServer
      .from("quotes")
      .insert({
        upload_id: ensuredUploadId,
        customer_name: contactName,
        customer_email: contactEmail,
        company: sanitizeNullable(params.payload.company),
        file_name: primary.fileName,
        status: DEFAULT_QUOTE_STATUS,
        currency: "USD",
        price: null,
        customer_id: customerId,
        target_date: sanitizeNullable(params.payload.targetDate),
      })
      .select("id")
      .single<{ id: string }>();

    if (quoteInsert.error || !quoteInsert.data?.id) {
      console.error("[quote intake finalize] quote insert failed", {
        ...logContext,
        uploadId: ensuredUploadId,
        error: serializeSupabaseError(quoteInsert.error),
      });
      return {
        ok: false,
        error: appendSupportReference(
          "We couldn’t create your quote record. Please retry.",
          { uploadId },
        ),
        reason: "db-insert-quote",
        uploadId: ensuredUploadId,
      };
    }

    quoteId = quoteInsert.data.id;

    // Phase 19.3.13: best-effort default email replies for new quotes.
    // Safe-by-default: helper does not probe when the bridge env flag is off.
    if (customerId) {
      try {
        await applyCustomerEmailDefaultToNewQuote({ quoteId, customerId });
      } catch {
        // Never block quote creation.
      }
    }

    // Phase 19.3.14: best-effort customer invite email on quote creation.
    void autoSendCustomerInviteAfterQuoteCreate({ quoteId, customerId });

    const { error: uploadUpdateError } = await supabaseServer
      .from("uploads")
      .update({ quote_id: quoteId, status: DEFAULT_QUOTE_STATUS })
      .eq("id", ensuredUploadId);
    if (uploadUpdateError) {
      console.error("[quote intake finalize] upload linkage failed", {
        ...logContext,
        quoteId,
        uploadId: ensuredUploadId,
        error: serializeSupabaseError(uploadUpdateError),
      });
    }

    const registerResult = await registerUploadedObjectsForExistingUpload({
      quoteId,
      uploadId: ensuredUploadId,
      targets,
      supabase: supabaseServer,
    });
    if (!registerResult.ok) {
      return {
        ok: false,
        error: buildRegisterFilesErrorMessage(quoteId, ensuredUploadId),
        reason: "register-files",
        quoteId,
        uploadId: ensuredUploadId,
      };
    }

    void emitQuoteEvent({
      quoteId,
      eventType: "submitted",
      actorRole: "customer",
      actorUserId: user.id,
      metadata: {
        upload_id: ensuredUploadId,
        contact_email: contactEmail,
        contact_name: contactName,
        company: sanitizeNullable(params.payload.company),
        primary_file_name: primary.fileName,
      },
    });

    void notifyAdminOnQuoteSubmitted({
      quoteId,
      contactName,
      contactEmail,
      company: sanitizeNullable(params.payload.company),
      fileName: primary.fileName,
    });

    return { ok: true, uploadId: ensuredUploadId, quoteId };
  } catch (error) {
    console.error("[quote intake finalize] failed", {
      ...logContext,
      error: serializeSupabaseError(error),
    });
    return {
      ok: false,
      error: "Unexpected server error while submitting your RFQ.",
      reason: "unexpected-error",
    };
  }
}

export function validateQuoteIntakeFields(
  payload: QuoteIntakePayload,
): QuoteIntakeFieldErrors {
  const errors: QuoteIntakeFieldErrors = {};
  const trimmedFirst = payload.firstName.trim();
  const trimmedLast = payload.lastName.trim();
  const trimmedEmail = payload.email.trim();
  const trimmedQuantity = payload.quantity.trim();
  const postal = payload.shippingPostalCode;

  if (!payload.files || payload.files.length === 0) {
    errors.file = "Attach at least one CAD file before submitting.";
  } else if (payload.files.length > MAX_FILES_PER_RFQ) {
    errors.file = `Attach up to ${MAX_FILES_PER_RFQ} CAD files per RFQ.`;
  } else {
    for (const file of payload.files) {
      if (!file) continue;
      const fileError = validateCadFile(file);
      if (fileError) {
        errors.file = `${file.name}: ${fileError}`;
        break;
      }
    }
  }

  if (!trimmedFirst) {
    errors.firstName = "First name is required.";
  }
  if (!trimmedLast) {
    errors.lastName = "Last name is required.";
  }
  if (!trimmedEmail) {
    errors.email = "Business email is required.";
  } else if (!EMAIL_REGEX.test(trimmedEmail)) {
    errors.email = "Enter a valid email address.";
  }
  if (!payload.manufacturingProcess) {
    errors.manufacturingProcess = "Select a manufacturing process.";
  }
  if (!trimmedQuantity) {
    errors.quantity = "Share the quantity or volumes you need.";
  }
  if (postal && !postal.trim()) {
    errors.shippingPostalCode = "Enter a postal code or leave this blank.";
  }
  if (!payload.exportRestriction) {
    errors.exportRestriction = "Select the export restriction.";
  }
  if (!payload.itarAcknowledged) {
    errors.itarAcknowledged =
      "Please confirm these parts are not subject to ITAR.";
  }
  if (!payload.termsAccepted) {
    errors.termsAccepted = "Please accept the terms before submitting.";
  }

  return errors;
}

export async function persistQuoteIntake(
  payload: QuoteIntakePayload,
  user: User,
  options?: { contactEmailOverride?: string | null },
): Promise<QuoteIntakePersistResult> {
  const sessionEmail = normalizeEmailInput(user.email ?? null);
  const formEmail = normalizeEmailInput(payload.email);
  const contactEmail =
    normalizeEmailInput(options?.contactEmailOverride ?? null) ??
    formEmail ??
    sessionEmail;

  if (!contactEmail) {
    return {
      ok: false,
      error: "A valid email address is required.",
      fieldErrors: { email: "Enter a valid email address." },
      reason: "missing-email",
    };
  }

  const files = Array.isArray(payload.files) ? payload.files.filter(Boolean) : [];
  if (files.length === 0) {
    return {
      ok: false,
      error: "Attach at least one CAD file before submitting.",
      fieldErrors: { file: "Attach at least one CAD file before submitting." },
      reason: "file-missing",
    };
  }

  if (files.length > MAX_FILES_PER_RFQ) {
    return {
      ok: false,
      error: `You can upload up to ${MAX_FILES_PER_RFQ} CAD files per RFQ.`,
      fieldErrors: {
        file: `Attach up to ${MAX_FILES_PER_RFQ} CAD files per RFQ.`,
      },
      reason: "file-limit",
    };
  }

  for (const file of files) {
    const fileError = validateCadFile(file);
    if (fileError) {
      return {
        ok: false,
        error: fileError,
        fieldErrors: { file: `${file.name}: ${fileError}` },
        reason: "file-validation",
      };
    }
  }

  const contactName =
    buildContactName(payload.firstName, payload.lastName) ||
    sanitizeNullable(payload.company) ||
    contactEmail;
  const logContext = {
    userId: user.id,
    contactEmail,
    sessionEmail,
    primaryFileName: files[0]?.name ?? null,
    fileCount: files.length,
  };

  try {
    const storedFiles: StoredCadFile[] = [];

    for (const [index, file] of files.entries()) {
      const buffer = Buffer.from(await file.arrayBuffer());
      if (buffer.byteLength === 0) {
        return {
          ok: false,
          error: `The uploaded file "${file.name}" is empty. Please try again.`,
          fieldErrors: {
            file: `File "${file.name}" is empty. Please choose a different CAD file.`,
          },
          reason: "empty-file",
        };
      }

      const extension = getFileExtension(file.name);
      const mimeType = detectMimeType(file, extension);
      const safeFileName = sanitizeFileName(file.name, extension);
      const storageKey = buildStorageKey(safeFileName);
      // Object key inside the bucket. Canonical rows must store this exact key.
      const storagePath = storageKey;
      const isZip =
        extension === "zip" ||
        (typeof mimeType === "string" && mimeType.toLowerCase().includes("zip"));

      const { error: storageError } = await supabaseServer.storage
        .from(CAD_BUCKET)
        .upload(storageKey, buffer, {
          cacheControl: "3600",
          contentType: mimeType,
          upsert: false,
        });

      if (storageError) {
        console.error("[quote intake] storage failed", {
          ...logContext,
          failingFile: file.name,
          fileIndex: index,
          error: serializeSupabaseError(storageError),
        });
        return {
          ok: false,
          error: `Uploading "${file.name}" failed. Please retry.`,
          reason: "storage-upload",
        };
      }

      storedFiles.push({
        originalName: file.name,
        sanitizedFileName: safeFileName,
        storageKey,
        storagePath,
        mimeType,
        sizeBytes: file.size,
        bucket: CAD_BUCKET,
        buffer: isZip ? buffer : undefined,
      });
    }

    const primaryStoredFile = storedFiles[0];
    if (!primaryStoredFile) {
      return {
        ok: false,
        error: "We couldn’t process your files. Please retry.",
        reason: "storage-missing",
      };
    }

    const customerId = await upsertCustomerRecord({
      contactEmail,
      contactName,
      company: sanitizeNullable(payload.company),
      user,
      sessionEmail,
    });

    const uploadResult = await supabaseServer
      .from("uploads")
      .insert({
        file_name: primaryStoredFile.originalName,
        file_path: `${CAD_BUCKET}/${primaryStoredFile.storagePath}`,
        mime_type: primaryStoredFile.mimeType,
        name: contactName,
        email: contactEmail,
        company: sanitizeNullable(payload.company),
        notes: sanitizeNullable(payload.notes),
        customer_id: customerId,
        status: DEFAULT_QUOTE_STATUS,
        first_name: sanitizeNullable(payload.firstName),
        last_name: sanitizeNullable(payload.lastName),
        phone: sanitizeNullable(payload.phone),
        manufacturing_process: sanitizeNullable(payload.manufacturingProcess),
        quantity: sanitizeNullable(payload.quantity),
        shipping_postal_code: sanitizeNullable(payload.shippingPostalCode),
        export_restriction: sanitizeNullable(payload.exportRestriction),
        rfq_reason: sanitizeNullable(payload.rfqReason),
        itar_acknowledged: payload.itarAcknowledged,
        terms_accepted: payload.termsAccepted,
      })
      .select("id, customer_id")
      .single<{ id: string; customer_id: string | null }>();

    if (uploadResult.error || !uploadResult.data) {
      console.error("[quote intake] upload insert failed", {
        ...logContext,
        error: serializeSupabaseError(uploadResult.error),
      });
      return {
        ok: false,
        error: "We couldn’t save your upload metadata. Please retry.",
        reason: "db-insert-upload",
      };
    }

    const uploadId = uploadResult.data.id;

    const quoteInsert = await supabaseServer
      .from("quotes")
      .insert({
        upload_id: uploadId,
        customer_name: contactName,
        customer_email: contactEmail,
        company: sanitizeNullable(payload.company),
        file_name: primaryStoredFile.originalName,
        status: DEFAULT_QUOTE_STATUS,
        currency: "USD",
        price: null,
        customer_id: customerId,
        target_date: sanitizeNullable(payload.targetDate),
      })
      .select("id")
      .single<{ id: string }>();

    if (quoteInsert.error || !quoteInsert.data) {
      console.error("[quote intake] quote insert failed", {
        ...logContext,
        uploadId,
        error: serializeSupabaseError(quoteInsert.error),
      });
      return {
        ok: false,
        error: "We couldn’t create your quote record. Please retry.",
        reason: "db-insert-quote",
      };
    }

    const quoteId = quoteInsert.data.id;

    // Phase 19.3.13: best-effort default email replies for new quotes.
    // Safe-by-default: helper does not probe when the bridge env flag is off.
    if (customerId) {
      try {
        await applyCustomerEmailDefaultToNewQuote({ quoteId, customerId });
      } catch {
        // Never block quote creation.
      }
    }

    // Phase 19.3.14: best-effort customer invite email on quote creation.
    void autoSendCustomerInviteAfterQuoteCreate({ quoteId, customerId });

    void emitQuoteEvent({
      quoteId,
      eventType: "submitted",
      actorRole: "customer",
      actorUserId: user.id,
      metadata: {
        upload_id: uploadId,
        contact_email: contactEmail,
        contact_name: contactName,
        company: sanitizeNullable(payload.company),
        primary_file_name: primaryStoredFile.originalName,
      },
    });

    void notifyAdminOnQuoteSubmitted({
      quoteId,
      contactName,
      contactEmail,
      company: sanitizeNullable(payload.company),
      fileName: primaryStoredFile.originalName,
    });

    const { error: uploadLinkError } = await supabaseServer
      .from("uploads")
      .update({
        quote_id: quoteId,
        status: DEFAULT_QUOTE_STATUS,
      })
      .eq("id", uploadId);

    if (uploadLinkError) {
      console.error("[quote intake] upload linkage failed", {
        ...logContext,
        quoteId,
        uploadId,
        error: serializeSupabaseError(uploadLinkError),
      });
    }

    const targets: UploadTarget[] = storedFiles.map((file) => ({
      storagePath: file.storagePath,
      bucketId: file.bucket,
      originalFileName: file.originalName,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
    }));

    // Register uploaded objects using the canonical write model.
    const registerResult = await registerUploadedObjectsForExistingUpload({
      quoteId,
      uploadId,
      targets,
      supabase: supabaseServer,
    });

    const metadataRecorded = registerResult.ok;

    return {
      ok: true,
      uploadId,
      quoteId,
      metadataRecorded,
    };
  } catch (error) {
    console.error("[quote intake] failed", {
      ...logContext,
      error: serializeSupabaseError(error),
    });
    return {
      ok: false,
      error: "Unexpected server error while submitting your RFQ.",
      reason: "unexpected-error",
    };
  }
}

function buildRegisterFilesErrorMessage(quoteId: string, uploadId?: string | null): string {
  const reference = buildSupportReference({
    quoteId,
    uploadId,
  });
  if (!reference) {
    return "We couldn’t register your files. Please retry.";
  }
  return `We couldn’t register your files. Please retry or contact support with ${reference}.`;
}

function appendSupportReference(
  message: string,
  ids: { quoteId?: string | null; uploadId?: string | null },
): string {
  const normalizedQuoteId = normalizeReferenceId(ids.quoteId);
  const normalizedUploadId = normalizeReferenceId(ids.uploadId);
  if (!normalizedQuoteId && !normalizedUploadId) {
    return message;
  }
  const hasQuote = /quote id/i.test(message);
  const hasUpload = /upload id/i.test(message);
  const parts: string[] = [];
  if (normalizedQuoteId && !hasQuote) {
    parts.push(`Quote ID ${normalizedQuoteId}`);
  }
  if (normalizedUploadId && !hasUpload) {
    parts.push(`Upload ID ${normalizedUploadId}`);
  }
  if (parts.length === 0) {
    return message;
  }
  const trimmed = message.trim();
  const punctuated = trimmed.endsWith(".") ? trimmed : `${trimmed}.`;
  return `${punctuated} ${parts.join(" · ")}.`;
}

function buildSupportReference(ids: { quoteId?: string | null; uploadId?: string | null }): string {
  const normalizedQuoteId = normalizeReferenceId(ids.quoteId);
  const normalizedUploadId = normalizeReferenceId(ids.uploadId);
  const parts: string[] = [];
  if (normalizedQuoteId) {
    parts.push(`Quote ID ${normalizedQuoteId}`);
  }
  if (normalizedUploadId) {
    parts.push(`Upload ID ${normalizedUploadId}`);
  }
  return parts.join(" · ");
}

function buildContactName(first: string, last: string) {
  return [first.trim(), last.trim()].filter(Boolean).join(" ").trim();
}

async function upsertCustomerRecord(args: {
  contactEmail: string;
  contactName: string;
  company: string | null;
  user: User;
  sessionEmail: string | null;
}): Promise<string | null> {
  const { contactEmail, contactName, company, user, sessionEmail } = args;
  const payload: Record<string, unknown> = {
    name: contactName,
    email: contactEmail,
    company,
  };

  if (sessionEmail && sessionEmail === contactEmail) {
    payload.user_id = user.id;
  }

  try {
    const { data, error } = await supabaseServer
      .from("customers")
      .upsert(payload, { onConflict: "email" })
      .select("id")
      .maybeSingle<{ id: string }>();

    if (error) {
      console.warn("[quote intake] customer upsert failed", {
        contactEmail,
        error: serializeSupabaseError(error),
      });
      return null;
    }

    return data?.id ?? null;
  } catch (error) {
    console.warn("[quote intake] customer upsert crashed", {
      contactEmail,
      error: serializeSupabaseError(error),
    });
    return null;
  }
}

export function validateCadFile(file: File): string | null {
  if (!isAllowedCadFileName(file.name)) {
    return `Unsupported file type. Please upload ${CAD_FILE_TYPE_DESCRIPTION}.`;
  }

  if (file.size > MAX_UPLOAD_SIZE_BYTES) {
    return `File is ${formatReadableBytes(file.size)}. Limit is ${FILE_SIZE_LIMIT_LABEL}.`;
  }

  if (file.size === 0) {
    return "File is empty. Please choose a different CAD file.";
  }

  return null;
}

function formatReadableBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 MB";
  }
  return `${bytesToMegabytes(bytes)} MB`;
}

function sanitizeNullable(value?: string | null): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function buildStorageKey(fileName: string): string {
  const timestamp = Date.now();
  const random = randomBytes(6).toString("hex");
  return `uploads/${timestamp}-${random}-${fileName}`;
}

function detectMimeType(file: File, extension?: string): string {
  if (file.type && file.type.trim().length > 0) {
    return file.type;
  }
  const normalizedExtension = extension || getFileExtension(file.name);
  return MIME_BY_EXTENSION[normalizedExtension] || "application/octet-stream";
}

function getFileExtension(fileName: string): string {
  if (typeof fileName !== "string") return "";
  const parts = fileName.toLowerCase().split(".");
  return parts.length > 1 ? (parts.pop() ?? "") : "";
}

function sanitizeFileName(originalName: string, preferredExtension?: string) {
  const fallbackBase = "cad-file";
  const fallbackExtension =
    typeof preferredExtension === "string" && preferredExtension.length > 0
      ? preferredExtension
      : "stl";

  if (typeof originalName !== "string" || originalName.trim().length === 0) {
    return `${fallbackBase}.${fallbackExtension}`;
  }

  const normalized = originalName
    .trim()
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();

  if (!normalized) {
    return `${fallbackBase}.${fallbackExtension}`;
  }

  if (normalized.includes(".")) {
    return normalized;
  }

  return `${normalized}.${fallbackExtension}`;
}

export function normalizeEmailInput(value?: string | null): string | null {
  if (!value) {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function normalizeReferenceId(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : "";
}

function normalizeIdempotencyKey(value: unknown): string | null {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!raw) return null;
  if (!/^[a-f0-9]{16,128}$/.test(raw)) return null;
  return raw;
}

function isUniqueViolation(error: unknown): boolean {
  const serialized = serializeSupabaseError(error);
  return serialized.code === "23505";
}

async function autoSendCustomerInviteAfterQuoteCreate(args: {
  quoteId: string;
  customerId: string | null;
}): Promise<void> {
  const quoteId = typeof args.quoteId === "string" ? args.quoteId.trim() : "";
  const customerId = typeof args.customerId === "string" ? args.customerId.trim() : "";
  if (!quoteId || !customerId) return;

  // Per requirements: if env flag is off, do not probe DB at all.
  if (!isCustomerEmailBridgeEnabled()) return;

  try {
    // Only send when the customer default is enabled/active on this quote.
    const optIn = await getCustomerEmailOptInStatus({ quoteId, customerId });
    if (!optIn.ok || !optIn.optedIn) return;

    const already = await wasInviteSent({ quoteId, role: "customer" });
    if (already) return;

    const sent = await sendCustomerInviteEmail({ quoteId, customerId });
    if (sent.ok) {
      await markInviteSent({ quoteId, role: "customer" });
    }
  } catch (error) {
    // Fail-soft: never block quote creation.
    warnOnce("quote_intake:auto_invite_customer_crashed", "[quote intake] auto invite crashed; skipping", {
      error: String(error),
    });
  }
}
