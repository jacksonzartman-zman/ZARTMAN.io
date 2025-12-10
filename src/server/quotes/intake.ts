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

const CAD_BUCKET =
  process.env.SUPABASE_CAD_BUCKET ||
  process.env.NEXT_PUBLIC_CAD_BUCKET ||
  process.env.NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET ||
  "cad";

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
  console.log("[quote intake] start", logContext);

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
      const storagePath = `${CAD_BUCKET}/${storageKey}`;

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
      });
    }

    console.log("[quote intake] server file summary", {
      payloadFileCount: files.length,
      storedFileCount: storedFiles.length,
      storedFileNames: storedFiles.map((file) => file.originalName),
    });

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
        file_path: primaryStoredFile.storagePath,
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
    console.log("[quote intake] upload created", { ...logContext, uploadId });

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
    console.log("[quote intake] quote created", { ...logContext, quoteId });

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

    let metadataRecorded = false;
    if (storedFiles.length > 0) {
      const rows = storedFiles.map((storedFile) => ({
        filename: storedFile.originalName,
        size_bytes: storedFile.sizeBytes,
        mime: storedFile.mimeType,
        storage_path: storedFile.storagePath,
        bucket_id: storedFile.bucket,
        quote_id: quoteId,
      }));
      // We support up to MAX_FILES_PER_RFQ files per RFQ; by inserting a row for
      // every stored file we preserve the full part list instead of silently
      // discarding entries beyond index 0.

      try {
        const { error: filesError } = await supabaseServer.from("files").insert(rows);

        if (filesError) {
          const serializedError = serializeSupabaseError(filesError);
          if (isMissingTableOrColumnError(filesError)) {
            console.warn("[quote intake] file metadata insert skipped", {
              ...logContext,
              quoteId,
              uploadId,
              error: serializedError,
            });
          } else {
            console.error("[quote intake] file metadata insert failed", {
              ...logContext,
              quoteId,
              uploadId,
              error: serializedError,
            });
            return {
              ok: false,
              error: "We couldn’t record your CAD files. Please retry.",
              reason: "db-insert-files",
            };
          }
        } else {
          metadataRecorded = true;
        }
      } catch (filesError) {
        const serializedError = serializeSupabaseError(filesError);
        console.error("[quote intake] file metadata insert crashed", {
          ...logContext,
          quoteId,
          uploadId,
          error: serializedError,
        });
        return {
          ok: false,
          error: "We couldn’t record your CAD files. Please retry.",
          reason: "db-insert-files",
        };
      }
    }

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
