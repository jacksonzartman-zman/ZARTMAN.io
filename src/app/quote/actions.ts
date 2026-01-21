"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createAuthClient, requireUser } from "@/server/auth";
import { getCustomerByUserId } from "@/server/customers";
import { supabaseServer } from "@/lib/supabaseServer";
import {
  customerUpdateQuotePartFiles,
} from "@/server/customer/quoteParts";
import {
  persistQuoteIntake,
  persistQuoteIntakeDirectUpload,
  persistQuoteIntakeFromUploadedTargets,
  validateQuoteIntakeFields,
  type QuoteIntakeFieldErrors,
  type QuoteIntakePayload,
} from "@/server/quotes/intake";
import {
  QUOTE_INTAKE_FALLBACK_ERROR,
  QUOTE_INTAKE_SUCCESS_MESSAGE,
} from "@/lib/quote/messages";
import { MAX_UPLOAD_BYTES, formatMaxUploadSize } from "@/lib/uploads/uploadLimits";
import {
  registerUploadedObjectsForExistingUpload,
  type UploadTarget,
} from "@/server/quotes/uploadFiles";
import { signPreviewToken } from "@/server/cadPreviewToken";

export type QuoteIntakeActionState =
  | {
      ok: true;
      quoteId: string | null;
      uploadId: string;
      message: string;
    }
  | {
      ok: false;
      error: string;
      fieldErrors?: QuoteIntakeFieldErrors;
    };

export type QuoteIntakeDirectUploadTarget = {
  storagePath: string;
  bucketId: string;
  fileName: string;
  mimeType: string | null;
  sizeBytes: number;
  previewToken: string;
};

export type QuoteIntakeDirectPrepareState =
  | {
      ok: true;
      quoteId: string;
      uploadId: string;
      message: string;
      targets: QuoteIntakeDirectUploadTarget[];
    }
  | {
      ok: false;
      error: string;
      fieldErrors?: QuoteIntakeFieldErrors;
    };

export type QuoteIntakeDirectFinalizeState =
  | { ok: true; message: string; quoteId: string; uploadId: string }
  | { ok: false; error: string; quoteId?: string; uploadId?: string };

export type QuoteIntakeEphemeralFinalizeState =
  | { ok: true; message: string; quoteId: string; uploadId: string }
  | { ok: false; error: string; quoteId?: string; uploadId?: string };

export type QuoteIntakeEphemeralUploadTarget = {
  clientFileId: string;
  storagePath: string;
  bucketId: string;
  fileName: string;
  mimeType: string | null;
  sizeBytes: number;
  previewToken: string;
};

export type QuoteIntakeEphemeralPrepareState =
  | {
      ok: true;
      userId: string;
      sessionId: string;
      uploadBucketId: string;
      targets: QuoteIntakeEphemeralUploadTarget[];
    }
  | {
      ok: false;
      error: string;
      fieldErrors?: QuoteIntakeFieldErrors;
    };

export type CreatePartFromSuggestionState =
  | { ok: true; quoteId: string; quotePartId: string; suggestionKey: string }
  | { ok: false; error: string; suggestionKey: string };

type QuoteRowForSuggestion = {
  id: string;
  customer_id: string | null;
  customer_email: string | null;
};

function normalizePreviewTokenPath(bucketId: string, storagePath: string): string {
  const rawBucket = typeof bucketId === "string" ? bucketId.trim() : "";
  let key = typeof storagePath === "string" ? storagePath.trim() : "";
  if (!key) return "";
  key = key.replace(/^\/+/, "");
  if (rawBucket && key.startsWith(`${rawBucket}/`)) {
    key = key.slice(rawBucket.length + 1);
  } else if (rawBucket === "cad_uploads" && key.startsWith("cad-uploads/")) {
    key = key.slice("cad-uploads/".length);
  } else if (rawBucket === "cad_previews" && key.startsWith("cad-previews/")) {
    key = key.slice("cad-previews/".length);
  }
  return key.replace(/^\/+/, "");
}

function safeSignPreviewToken(args: {
  userId: string;
  bucketId: string;
  storagePath: string;
  exp: number;
  quoteId?: string | null;
  uploadId?: string | null;
}): string {
  const normalizedPath = normalizePreviewTokenPath(args.bucketId, args.storagePath);
  if (!normalizedPath) {
    console.warn("[quote intake] preview token path missing", {
      quoteId: args.quoteId ?? null,
      uploadId: args.uploadId ?? null,
      bucket: args.bucketId,
      path: args.storagePath,
    });
    return "";
  }
  try {
    return signPreviewToken({
      userId: args.userId,
      bucket: args.bucketId,
      path: normalizedPath,
      exp: args.exp,
    });
  } catch (error) {
    console.warn("[quote intake] preview token sign failed", {
      quoteId: args.quoteId ?? null,
      uploadId: args.uploadId ?? null,
      bucket: args.bucketId,
      path: normalizedPath,
      objectKey: `${args.bucketId}/${normalizedPath}`,
      error: error instanceof Error ? error.message : String(error),
    });
    return "";
  }
}

export async function submitQuoteIntakeAction(
  _prevState: QuoteIntakeActionState,
  formData: FormData,
): Promise<QuoteIntakeActionState> {
  let sessionUserId: string | null = null;
  let attemptedQuoteId: string | null = null;

  try {
    console.log("[quote intake] action invoked");
    const user = await requireUser({
      message: "Sign in to submit search requests.",
    });
    sessionUserId = user.id;

    const parsed = parseQuoteIntakeFormData(formData);
    if ("error" in parsed) {
      return parsed;
    }

    const files = parsed.payload.files ?? [];
    const tooLarge = files.filter((f) => f.size > MAX_UPLOAD_BYTES);
    if (tooLarge.length > 0) {
      const message = `Each file must be smaller than ${formatMaxUploadSize()}. Try splitting large ZIPs or compressing drawings.`;
      return buildFailureState(message, { file: message } as QuoteIntakeFieldErrors);
    }

    const fieldErrors = validateQuoteIntakeFields(parsed.payload);
    const fieldErrorKeys = Object.keys(fieldErrors);
    const fileCount = Array.isArray(files) ? files.length : 0;
    const hasFiles = fileCount > 0;
    console.log("[quote intake] parsed payload", {
      hasFiles,
      fileCount,
      email: parsed.payload.email || null,
      fieldErrorCount: fieldErrorKeys.length,
    });
    if (fieldErrorKeys.length > 0) {
      return buildFailureState(
        "Please fix the highlighted fields before submitting.",
        fieldErrors,
      );
    }

    const result = await persistQuoteIntake(parsed.payload, user);
    if (!result.ok) {
      console.warn("[quote intake] persist failed", {
        userId: sessionUserId,
        quoteId: attemptedQuoteId,
        reason: result.error ?? "unknown-error",
        fieldErrors: result.fieldErrors ?? null,
      });
      return buildFailureState(
        result.error ||
          "We couldn’t process your search request. Please try again or contact support.",
        result.fieldErrors,
      );
    }

    attemptedQuoteId = result.quoteId ?? null;

    if (!result.uploadId) {
      console.error("[quote intake] missing upload id in success result", {
        userId: sessionUserId,
        quoteId: attemptedQuoteId,
      });
      return buildFailureState(QUOTE_INTAKE_FALLBACK_ERROR);
    }

    revalidatePath("/admin");
    revalidatePath("/admin/quotes");
    revalidatePath("/admin/uploads");
    revalidatePath(`/admin/uploads/${result.uploadId}`);
    if (result.quoteId) {
      revalidatePath(`/admin/quotes/${result.quoteId}`);
    }

    return {
      ok: true,
      quoteId: result.quoteId,
      uploadId: result.uploadId,
      message: QUOTE_INTAKE_SUCCESS_MESSAGE,
    };
  } catch (error) {
    if (isNextRedirectError(error)) {
      throw error;
    }
    console.error("[quote intake] action failed", {
      userId: sessionUserId,
      quoteId: attemptedQuoteId,
      reason: "unexpected-error",
      error: serializeUnknownError(error),
    });
    return buildFailureState(QUOTE_INTAKE_FALLBACK_ERROR);
  }
}

type QuoteIntakeFileMeta = {
  fileName: string;
  sizeBytes: number;
  mimeType: string | null;
};

type QuoteIntakeEphemeralFileMeta = QuoteIntakeFileMeta & {
  clientFileId: string;
};

function parseFilesMeta(formData: FormData): QuoteIntakeFileMeta[] {
  const json = formData.get("filesMeta");
  if (typeof json !== "string" || json.trim().length === 0) {
    return [];
  }
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((row) => {
        if (!row || typeof row !== "object") return null;
        const fileName =
          "fileName" in row && typeof (row as any).fileName === "string"
            ? String((row as any).fileName)
            : "";
        const sizeBytes =
          "sizeBytes" in row && typeof (row as any).sizeBytes === "number"
            ? Number((row as any).sizeBytes)
            : NaN;
        const mimeType =
          "mimeType" in row && typeof (row as any).mimeType === "string"
            ? String((row as any).mimeType)
            : null;
        const trimmed = fileName.trim();
        if (!trimmed) return null;
        if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) return null;
        return { fileName: trimmed, sizeBytes, mimeType };
      })
      .filter((v): v is QuoteIntakeFileMeta => Boolean(v));
  } catch {
    return [];
  }
}

function parseEphemeralFilesMeta(formData: FormData): QuoteIntakeEphemeralFileMeta[] {
  const json = formData.get("filesMeta");
  if (typeof json !== "string" || json.trim().length === 0) {
    return [];
  }
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((row) => {
        if (!row || typeof row !== "object") return null;
        const clientFileId =
          "clientFileId" in row && typeof (row as any).clientFileId === "string"
            ? String((row as any).clientFileId)
            : "";
        const fileName =
          "fileName" in row && typeof (row as any).fileName === "string"
            ? String((row as any).fileName)
            : "";
        const sizeBytes =
          "sizeBytes" in row && typeof (row as any).sizeBytes === "number"
            ? Number((row as any).sizeBytes)
            : NaN;
        const mimeType =
          "mimeType" in row && typeof (row as any).mimeType === "string"
            ? String((row as any).mimeType)
            : null;

        const trimmedId = clientFileId.trim();
        const trimmedName = fileName.trim();
        if (!trimmedId) return null;
        if (!trimmedName) return null;
        if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) return null;
        return { clientFileId: trimmedId, fileName: trimmedName, sizeBytes, mimeType };
      })
      .filter((v): v is QuoteIntakeEphemeralFileMeta => Boolean(v));
  } catch {
    return [];
  }
}

function normalizeSessionId(value: unknown): string | null {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return null;
  // keep it conservative: only allow url-safe-ish ids
  if (!/^[a-zA-Z0-9_-]{8,128}$/.test(raw)) return null;
  return raw;
}

export async function prepareQuoteIntakeDirectUploadAction(
  formData: FormData,
): Promise<QuoteIntakeDirectPrepareState> {
  try {
    const user = await requireUser({
      message: "Sign in to submit search requests.",
    });

    const filesMeta = parseFilesMeta(formData);
    if (filesMeta.length === 0) {
      return {
        ok: false,
        error: "Attach at least one CAD file before submitting.",
        fieldErrors: { file: "Attach at least one CAD file before submitting." },
      };
    }

    const tooLarge = filesMeta.filter((f) => f.sizeBytes > MAX_UPLOAD_BYTES);
    if (tooLarge.length > 0) {
      const message = `Each file must be smaller than ${formatMaxUploadSize()}. Try splitting large ZIPs or compressing drawings.`;
      return { ok: false, error: message, fieldErrors: { file: message } };
    }

    const pseudoFiles = filesMeta.map(
      (f) =>
        ({
          name: f.fileName,
          size: f.sizeBytes,
          type: f.mimeType ?? "",
        }) as unknown as File,
    );

    const payload: QuoteIntakePayload = {
      files: pseudoFiles,
      firstName: getString(formData, "firstName"),
      lastName: getString(formData, "lastName"),
      email: getString(formData, "email"),
      company: getString(formData, "company"),
      phone: getString(formData, "phone"),
      manufacturingProcess: getString(formData, "manufacturingProcess"),
      quantity: getString(formData, "quantity"),
      shippingPostalCode: getString(formData, "shippingPostalCode"),
      exportRestriction: getString(formData, "exportRestriction"),
      rfqReason: getString(formData, "rfqReason"),
      notes: getString(formData, "notes"),
      targetDate: getString(formData, "targetDate"),
      itarAcknowledged: parseBoolean(formData.get("itarAcknowledged")),
      termsAccepted: parseBoolean(formData.get("termsAccepted")),
    };

    const fieldErrors = validateQuoteIntakeFields(payload);
    if (Object.keys(fieldErrors).length > 0) {
      return {
        ok: false,
        error: "Please fix the highlighted fields before submitting.",
        fieldErrors,
      };
    }

    const result = await persistQuoteIntakeDirectUpload({
      payload: {
        ...payload,
        files: filesMeta,
      },
      user,
    });

    if (!result.ok) {
      return {
        ok: false,
        error: result.error || QUOTE_INTAKE_FALLBACK_ERROR,
        fieldErrors: result.fieldErrors,
      };
    }

    const now = Math.floor(Date.now() / 1000);
    const exp = now + 15 * 60; // 15 minutes

    return {
      ok: true,
      quoteId: result.quoteId,
      uploadId: result.uploadId,
      message: "Upload targets prepared.",
      targets: result.targets.map((t) => ({
        storagePath: t.storagePath,
        bucketId: t.bucketId,
        fileName: t.originalFileName,
        mimeType: t.mimeType,
        sizeBytes: t.sizeBytes,
        previewToken: safeSignPreviewToken({
          userId: user.id,
          bucketId: t.bucketId,
          storagePath: t.storagePath,
          exp,
          quoteId: result.quoteId,
          uploadId: result.uploadId,
        }),
      })),
    };
  } catch (error) {
    if (isNextRedirectError(error)) {
      throw error;
    }
    console.error("[quote intake direct] prepare failed", {
      error: serializeUnknownError(error),
    });
    return { ok: false, error: QUOTE_INTAKE_FALLBACK_ERROR };
  }
}

export async function prepareQuoteIntakeEphemeralUploadAction(
  formData: FormData,
): Promise<QuoteIntakeEphemeralPrepareState> {
  try {
    const user = await requireUser({
      message: "Sign in to upload CAD files.",
    });

    const filesMeta = parseEphemeralFilesMeta(formData);
    if (filesMeta.length === 0) {
      return {
        ok: false,
        error: "Attach at least one CAD file to upload.",
        fieldErrors: { file: "Attach at least one CAD file to upload." },
      };
    }

    const sessionId =
      normalizeSessionId(formData.get("sessionId")) ??
      // server fallback, should be rare (client generates normally)
      randomBytes(12).toString("base64url");

    const bucketId = "cad_uploads";
    const configuredBucket =
      process.env.SUPABASE_CAD_BUCKET ||
      process.env.NEXT_PUBLIC_CAD_BUCKET ||
      process.env.NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET ||
      "";
    const trimmedConfigured = configuredBucket.trim();
    if (trimmedConfigured && trimmedConfigured !== bucketId) {
      console.warn("[quote intake ephemeral] overriding configured bucket for intake", {
        configuredBucket: trimmedConfigured,
        normalizedBucket: bucketId,
      });
    }

    const now = Math.floor(Date.now() / 1000);
    const exp = now + 15 * 60; // 15 minutes

    const timestamp = Date.now();
    const targets: QuoteIntakeEphemeralUploadTarget[] = filesMeta.map((f, idx) => {
      const safeName = f.fileName.replace(/[^a-zA-Z0-9._-]/g, "_") || "file";
      const storagePath = `uploads/intake/${user.id}/${sessionId}/${timestamp + idx}-${safeName}`;
      return {
        clientFileId: f.clientFileId,
        storagePath,
        bucketId,
        fileName: f.fileName,
        mimeType: f.mimeType,
        sizeBytes: f.sizeBytes,
        previewToken: safeSignPreviewToken({
          userId: user.id,
          bucketId,
          storagePath,
          exp,
          quoteId: null,
          uploadId: null,
        }),
      };
    });

    return {
      ok: true,
      userId: user.id,
      sessionId,
      uploadBucketId: bucketId,
      targets,
    };
  } catch (error) {
    if (isNextRedirectError(error)) {
      throw error;
    }
    console.error("[quote intake ephemeral] prepare failed", {
      error: serializeUnknownError(error),
    });
    return { ok: false, error: QUOTE_INTAKE_FALLBACK_ERROR };
  }
}

export async function finalizeQuoteIntakeDirectUploadAction(
  formData: FormData,
): Promise<QuoteIntakeDirectFinalizeState> {
  try {
    await requireUser({
      message: "Sign in to submit search requests.",
    });

    const quoteId = String(formData.get("quoteId") ?? "").trim();
    const uploadId = String(formData.get("uploadId") ?? "").trim();
    const targetsJson = formData.get("targets");
    if (!quoteId || !uploadId || typeof targetsJson !== "string") {
      return { ok: false, error: "Missing upload references." };
    }

    const parsed = JSON.parse(targetsJson) as QuoteIntakeDirectUploadTarget[];
    const targets: UploadTarget[] = Array.isArray(parsed)
      ? parsed.map((t) => ({
          storagePath: t.storagePath,
          bucketId: t.bucketId,
          originalFileName: t.fileName,
          mimeType: t.mimeType,
          sizeBytes: t.sizeBytes,
        }))
      : [];

    if (targets.length === 0) {
      return { ok: false, error: "Missing upload targets." };
    }

    const result = await registerUploadedObjectsForExistingUpload({
      quoteId,
      uploadId,
      targets,
    });

    if (!result.ok) {
      const referenceParts = [
        quoteId ? `Quote ID ${quoteId}` : "",
        uploadId ? `Upload ID ${uploadId}` : "",
      ].filter(Boolean);
      const reference = referenceParts.length > 0 ? referenceParts.join(" · ") : "";
      const errorMessage = reference
        ? `We couldn’t register your files. Please retry or contact support with ${reference}.`
        : "We couldn’t register your files. Please retry or contact support.";
      return {
        ok: false,
        error: errorMessage,
        quoteId,
        uploadId,
      };
    }

    revalidatePath("/admin");
    revalidatePath("/admin/quotes");
    revalidatePath("/admin/uploads");
    revalidatePath(`/admin/uploads/${uploadId}`);
    revalidatePath(`/admin/quotes/${quoteId}`);
    revalidatePath(`/customer/quotes/${quoteId}`);
    revalidatePath(`/supplier/quotes/${quoteId}`);

    return { ok: true, message: QUOTE_INTAKE_SUCCESS_MESSAGE, quoteId, uploadId };
  } catch (error) {
    if (isNextRedirectError(error)) {
      throw error;
    }
    console.error("[quote intake direct] finalize failed", serializeUnknownError(error));
    return { ok: false, error: QUOTE_INTAKE_FALLBACK_ERROR };
  }
}

export async function finalizeQuoteIntakeEphemeralUploadAction(
  formData: FormData,
): Promise<QuoteIntakeEphemeralFinalizeState> {
  try {
    const user = await requireUser({
      message: "Sign in to submit search requests.",
    });

    const targetsJson = formData.get("targets");
    if (typeof targetsJson !== "string" || targetsJson.trim().length === 0) {
      return { ok: false, error: "Missing upload targets." };
    }

    const parsed = JSON.parse(targetsJson) as Array<{
      storagePath?: unknown;
      bucketId?: unknown;
      fileName?: unknown;
      mimeType?: unknown;
      sizeBytes?: unknown;
    }>;

    const targets: UploadTarget[] = Array.isArray(parsed)
      ? parsed
          .map((t) => ({
            storagePath: typeof t.storagePath === "string" ? t.storagePath : "",
            bucketId: typeof t.bucketId === "string" ? t.bucketId : "",
            originalFileName: typeof t.fileName === "string" ? t.fileName : "",
            mimeType: typeof t.mimeType === "string" ? t.mimeType : null,
            sizeBytes: typeof t.sizeBytes === "number" ? t.sizeBytes : 0,
          }))
          .filter((t) => Boolean(t.storagePath && t.bucketId && t.originalFileName && t.sizeBytes > 0))
      : [];

    if (targets.length === 0) {
      return { ok: false, error: "Missing upload targets." };
    }

    const payload = {
      files: targets.map((t) => ({
        fileName: t.originalFileName,
        sizeBytes: t.sizeBytes,
        mimeType: t.mimeType ?? null,
      })),
      firstName: getString(formData, "firstName"),
      lastName: getString(formData, "lastName"),
      email: getString(formData, "email"),
      company: getString(formData, "company"),
      phone: getString(formData, "phone"),
      manufacturingProcess: getString(formData, "manufacturingProcess"),
      quantity: getString(formData, "quantity"),
      shippingPostalCode: getString(formData, "shippingPostalCode"),
      exportRestriction: getString(formData, "exportRestriction"),
      rfqReason: getString(formData, "rfqReason"),
      notes: getString(formData, "notes"),
      targetDate: getString(formData, "targetDate"),
      itarAcknowledged: parseBoolean(formData.get("itarAcknowledged")),
      termsAccepted: parseBoolean(formData.get("termsAccepted")),
    };

    const idempotencyKey = getString(formData, "idempotencyKey");

    const result = await persistQuoteIntakeFromUploadedTargets({
      payload,
      targets,
      user,
      idempotencyKey,
    });

    if (!result.ok) {
      return {
        ok: false,
        error: result.error || QUOTE_INTAKE_FALLBACK_ERROR,
        quoteId: result.quoteId,
        uploadId: result.uploadId,
      };
    }

    revalidatePath("/admin");
    revalidatePath("/admin/quotes");
    revalidatePath("/admin/uploads");
    revalidatePath(`/admin/uploads/${result.uploadId}`);
    revalidatePath(`/admin/quotes/${result.quoteId}`);
    revalidatePath(`/customer/quotes/${result.quoteId}`);
    revalidatePath(`/supplier/quotes/${result.quoteId}`);

    return {
      ok: true,
      message: QUOTE_INTAKE_SUCCESS_MESSAGE,
      quoteId: result.quoteId,
      uploadId: result.uploadId,
    };
  } catch (error) {
    if (isNextRedirectError(error)) {
      throw error;
    }
    console.error("[quote intake ephemeral] finalize failed", serializeUnknownError(error));
    return { ok: false, error: QUOTE_INTAKE_FALLBACK_ERROR };
  }
}

export async function createPartFromSuggestionAction(
  _prev: CreatePartFromSuggestionState,
  formData: FormData,
): Promise<CreatePartFromSuggestionState> {
  const suggestionKey = String(formData.get("suggestionKey") ?? "").trim();
  const quoteId = String(formData.get("quoteId") ?? "").trim();
  const label = String(formData.get("label") ?? "").trim();
  const partNumber = String(formData.get("partNumber") ?? "").trim() || null;
  const fileIds = String(formData.get("fileIds") ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);

  if (!suggestionKey) {
    return { ok: false, error: "Missing suggestion reference.", suggestionKey: "" };
  }

  if (!quoteId) {
    return { ok: false, error: "Missing quote reference.", suggestionKey };
  }

  if (!label) {
    return { ok: false, error: "Part name is required.", suggestionKey };
  }

  if (fileIds.length === 0) {
    return { ok: false, error: "Select at least one file for this part.", suggestionKey };
  }

  try {
    const user = await requireUser({
      message: "Sign in to add parts.",
    });

    const customer = await getCustomerByUserId(user.id);
    if (!customer) {
      return {
        ok: false,
        error: "Complete your customer profile before adding parts.",
        suggestionKey,
      };
    }

    const { data: quoteRow, error: quoteError } = await supabaseServer
      .from("quotes")
      .select("id,customer_id,customer_email")
      .eq("id", quoteId)
      .maybeSingle<QuoteRowForSuggestion>();

    if (quoteError || !quoteRow?.id) {
      return { ok: false, error: "Quote not found.", suggestionKey };
    }

    const quoteCustomerId =
      typeof quoteRow.customer_id === "string" ? quoteRow.customer_id.trim() : "";
    const quoteCustomerEmail =
      typeof quoteRow.customer_email === "string"
        ? quoteRow.customer_email.trim().toLowerCase()
        : "";
    const customerEmail =
      typeof customer.email === "string" ? customer.email.trim().toLowerCase() : "";

    if (!quoteCustomerId || quoteCustomerId !== customer.id) {
      if (!quoteCustomerEmail || !customerEmail || quoteCustomerEmail !== customerEmail) {
        return { ok: false, error: "You don’t have access to this quote.", suggestionKey };
      }
    }

    // Insert part and return id (needs id so we can attach files immediately).
    const supabase = createAuthClient();
    const { data: partRow, error: partError } = await supabase
      .from("quote_parts")
      .insert({ quote_id: quoteId, part_label: label, part_number: partNumber, notes: null })
      .select("id")
      .single<{ id: string }>();

    if (partError || !partRow?.id) {
      return { ok: false, error: "Could not create part. Please try again.", suggestionKey };
    }

    await customerUpdateQuotePartFiles({
      quoteId,
      quotePartId: partRow.id,
      addFileIds: fileIds,
      removeFileIds: [],
    });

    revalidatePath(`/customer/quotes/${quoteId}`);
    return { ok: true, quoteId, quotePartId: partRow.id, suggestionKey };
  } catch (error) {
    console.error("[suggested parts] create part failed", error);
    return { ok: false, error: "Could not add suggested part. Please try again.", suggestionKey };
  }
}

function buildFailureState(
  message: string,
  fieldErrors?: QuoteIntakeFieldErrors,
): QuoteIntakeActionState {
  return {
    ok: false,
    error: message,
    fieldErrors:
      fieldErrors && Object.keys(fieldErrors).length > 0 ? fieldErrors : undefined,
  };
}

function serializeUnknownError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }
  return { value: error };
}

function isNextRedirectError(error: unknown): error is { digest?: string } {
  if (!error || typeof error !== "object") {
    return false;
  }
  const digest = "digest" in error ? (error as { digest?: unknown }).digest : null;
  return typeof digest === "string" && digest.startsWith("NEXT_REDIRECT");
}

function parseQuoteIntakeFormData(
  formData: FormData,
):
  | { payload: QuoteIntakePayload }
  | { ok: false; error: string; fieldErrors: QuoteIntakeFieldErrors } {
  const files = collectFormDataFiles(formData);
  if (files.length === 0) {
    return {
      ok: false,
      error: "Attach at least one CAD file before submitting.",
      fieldErrors: { file: "Attach at least one CAD file before submitting." },
    };
  }

  const payload: QuoteIntakePayload = {
    files,
    firstName: getString(formData, "firstName"),
    lastName: getString(formData, "lastName"),
    email: getString(formData, "email"),
    company: getString(formData, "company"),
    phone: getString(formData, "phone"),
    manufacturingProcess: getString(formData, "manufacturingProcess"),
    quantity: getString(formData, "quantity"),
    shippingPostalCode: getString(formData, "shippingPostalCode"),
    exportRestriction: getString(formData, "exportRestriction"),
    rfqReason: getString(formData, "rfqReason"),
    notes: getString(formData, "notes"),
    targetDate: getString(formData, "targetDate"),
    itarAcknowledged: parseBoolean(formData.get("itarAcknowledged")),
    termsAccepted: parseBoolean(formData.get("termsAccepted")),
  };

  return { payload };
}

function collectFormDataFiles(formData: FormData): File[] {
  const collected: File[] = [];
  const appendIfFile = (value: FormDataEntryValue | null) => {
    if (value instanceof File) {
      collected.push(value);
    }
  };

  const multi = formData.getAll("files");
  if (multi && multi.length > 0) {
    multi.forEach((value) => appendIfFile(value));
  }

  if (collected.length === 0) {
    appendIfFile(formData.get("file"));
  }

  return collected;
}

function getString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function parseBoolean(value: FormDataEntryValue | null): boolean {
  if (typeof value !== "string") {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "on";
}
