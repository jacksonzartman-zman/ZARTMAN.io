import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { supabaseServer } from "@/lib/supabaseServer";
import { DEFAULT_UPLOAD_STATUS } from "@/app/admin/constants";
import { requireSession, UnauthorizedError } from "@/server/auth";
import {
  CAD_EXTENSIONS,
  CAD_FILE_TYPE_DESCRIPTION,
  MAX_UPLOAD_SIZE_BYTES,
  bytesToMegabytes,
  isAllowedCadFileName,
} from "@/lib/cadFileTypes";

export const runtime = "nodejs";

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

type UploadFileMetadata = {
  bucket: string;
  storageKey: string;
  storagePath: string;
  sizeBytes: number;
  mimeType: string;
  originalFileName: string;
  sanitizedFileName: string;
  extension?: string | null;
};

type UploadResponseExtras = {
  uploadId?: string;
  quoteId?: string | null;
  file?: UploadFileMetadata;
  metadataRecorded?: boolean;
  step?: string;
} & Record<string, unknown>;

function buildSuccess(message: string, extra: UploadResponseExtras = {}) {
  const { step, ...rest } = extra;
  return NextResponse.json(
    {
      success: true,
      message,
      step: step ?? "complete",
      ...rest,
    },
    { status: 200 },
  );
}

function buildError(
  message: string,
  status = 400,
  extra: Record<string, unknown> = {},
) {
  const { step, ...rest } = extra;
  return NextResponse.json(
    {
      success: false,
      message,
      step: step ?? "error",
      ...rest,
    },
    { status },
  );
}

// Flow: customer submits /quote -> verify session -> upload CAD to storage ->
// upsert customer -> insert uploads row -> create quote + link upload ->
// record file metadata & return IDs for portals.
export async function POST(req: NextRequest) {
  const logContext: UploadLogContext = {};

  try {
    const session = await requireSession();
    const normalizedSessionEmail = normalizeEmailInput(session.user.email ?? null);
    if (!normalizedSessionEmail) {
      console.error("[quote] session missing email", {
        userId: session.user.id,
      });
      return buildError(
        "Your session is missing a verified email. Refresh or sign in again.",
        400,
        { step: "auth" },
      );
    }
    logContext.userId = session.user.id;
    logContext.sessionEmail = normalizedSessionEmail;

    const formData = await req.formData();

    const fileEntry = formData.get("file");
    if (!(fileEntry instanceof File)) {
      logUploadDebug("Rejecting request: missing file in form-data payload");
      return buildError("Missing file in request.", 400, {
        step: "validate-form",
      });
    }

      const file = fileEntry;
      logContext.fileName = file.name;
      logContext.fileSize = file.size;
      logContext.fileSizeLabel = formatFileSizeLabel(file.size);
      logContext.providedType = file.type || "";

      const rawName = getFormValue(formData.get("name"));
      const company = getFormValue(formData.get("company"));
      const requestNotes = getFormValue(formData.get("notes"));
      const firstName = getFormValue(formData.get("first_name"));
      const lastName = getFormValue(formData.get("last_name"));
      const phone = getFormValue(formData.get("phone"));
      const manufacturingProcess = getFormValue(
        formData.get("manufacturing_process"),
      );
      const quantity = getFormValue(formData.get("quantity"));
      const shippingPostalCode = getFormValue(
        formData.get("shipping_postal_code"),
      );
      const exportRestriction = getFormValue(
        formData.get("export_restriction"),
      );
      const rfqReason = getFormValue(formData.get("rfq_reason"));
      const itarAcknowledged = parseBooleanFlag(
        formData.get("itar_acknowledged"),
      );
      const termsAccepted = parseBooleanFlag(
        formData.get("terms_accepted"),
      );
      const contactName =
        rawName || [firstName, lastName].filter(Boolean).join(" ").trim();
    const contactEmail = normalizedSessionEmail;
    const extension = getFileExtension(file.name);
    const isStlUpload = extension === "stl";
    logContext.extension = extension;
    logContext.isStlUpload = isStlUpload;

    logUploadDebug("Received upload request", {
      ...logContext,
      bucket: CAD_BUCKET,
    });

      if (!contactName) {
      logUploadDebug("Rejecting upload: missing contact info", {
        ...logContext,
          namePresent: Boolean(contactName),
        sessionEmailPresent: Boolean(normalizedSessionEmail),
      });
      return buildError(
        "Name is required to submit a quote request.",
        400,
        {
          step: "validate-contact",
          missingFields: {
              name: !contactName,
            email: false,
          },
        },
      );
    }

    if (!isAllowedCadFileName(file.name)) {
      logUploadDebug("Rejecting upload: unsupported extension", {
        ...logContext,
        allowedExtensions: CAD_EXTENSIONS.join(", "),
      });
      return buildError(
        `Unsupported file type ".${extension || "unknown"}". Accepted formats: ${CAD_FILE_TYPE_DESCRIPTION}.`,
        400,
        {
          step: "validate-extension",
          allowedExtensions: CAD_EXTENSIONS,
          attemptedExtension: extension || null,
        },
      );
    }

    if (file.size > MAX_UPLOAD_SIZE_BYTES) {
      logUploadDebug("Rejecting upload: exceeds size limit", {
        ...logContext,
        maxBytes: MAX_UPLOAD_SIZE_BYTES,
      });
      return buildError(
        `File is ${formatFileSizeLabel(
          file.size,
        )}. Maximum allowed size is ${FILE_SIZE_LIMIT_LABEL}.`,
        413,
        {
          step: "validate-size",
          maxBytes: MAX_UPLOAD_SIZE_BYTES,
          fileBytes: file.size,
        },
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    if (buffer.byteLength === 0) {
      logUploadDebug("Rejecting upload: empty file buffer", logContext);
      return buildError("The uploaded file is empty.", 400, {
        step: "validate-buffer",
      });
    }

    const mimeType = detectMimeType(file, extension);
    logContext.mimeType = mimeType;

    const safeFileName = sanitizeFileName(file.name, extension);
    const storageKey = buildStorageKey(safeFileName);
    const storagePath = `${CAD_BUCKET}/${storageKey}`;
    const supabase = supabaseServer;
    logContext.bucket = CAD_BUCKET;
    logContext.storageKey = storageKey;
    logContext.storagePath = storagePath;

    if (isStlUpload) {
      logUploadDebug("Handling STL upload", {
        ...logContext,
      });
    }

    logUploadDebug("Uploading file to Supabase storage", logContext);

    const { error: storageError } = await supabase.storage
      .from(CAD_BUCKET)
      .upload(storageKey, buffer, {
        cacheControl: "3600",
        contentType: mimeType,
        upsert: false,
      });

    if (storageError) {
      const storageStatusCode = (
        storageError as { statusCode?: number | string }
      ).statusCode;
      logUploadError("Storage upload failed", {
        ...logContext,
        error: {
          message: storageError.message,
          name: storageError.name,
          statusCode: storageStatusCode,
        },
      });
      return buildError(
        `Storage upload failed: ${storageError.message || "unknown error"}`,
        500,
        {
          step: "storage-upload",
          storageStatusCode,
        },
      );
    }

    let customerId: string | null = null;
    const customerPayload = {
      name: contactName,
      email: normalizedSessionEmail,
      company: company || null,
      user_id: session.user.id,
    };
    const { data: customer, error: customerError } = await supabase
      .from("customers")
      .upsert(customerPayload, {
        onConflict: "email",
      })
      .select("id")
      .single();

    if (customerError) {
      const serializedError = serializeSupabaseError(customerError);
      const missingTable = isMissingTableError(customerError);
      const logFn = missingTable ? logUploadDebug : logUploadError;
      logFn(
        missingTable ? "Customer upsert skipped (table missing)" : "Customer upsert failed",
        {
          ...logContext,
          error: serializedError,
          missingTable,
        },
      );
    } else if (customer?.id) {
      customerId = customer.id as string;
    }

    logUploadDebug("Inserting upload metadata row", {
      ...logContext,
      customerId,
    });

    const { data: uploadRow, error: uploadError } = await supabase
      .from("uploads")
      .insert({
        file_name: file.name,
        file_path: storagePath,
        mime_type: mimeType,
          name: contactName,
        email: contactEmail,
        company: company || null,
        notes: requestNotes || null,
        customer_id: customerId,
        status: DEFAULT_UPLOAD_STATUS,
          first_name: firstName || null,
          last_name: lastName || null,
          phone: phone || null,
          manufacturing_process: manufacturingProcess || null,
          quantity: quantity || null,
          shipping_postal_code: shippingPostalCode || null,
          export_restriction: exportRestriction || null,
          rfq_reason: rfqReason || null,
          itar_acknowledged: itarAcknowledged,
          terms_accepted: termsAccepted,
      })
      .select("id, file_name, file_path, mime_type, customer_id, quote_id")
      .single();

    if (uploadError || !uploadRow) {
      logUploadError("Upload metadata insert failed", {
        ...logContext,
        error: serializeSupabaseError(uploadError),
      });
      return buildError(
        `Database insert failed: ${
          serializeSupabaseError(uploadError) || "unknown reason"
        }`,
        500,
        {
          step: "db-insert-upload",
        },
      );
    }

    let quoteId =
      "quote_id" in uploadRow
        ? ((uploadRow as { quote_id?: string | null }).quote_id ?? null)
        : null;

    if (!quoteId) {
      const quoteCustomerName =
        contactName ||
        buildSessionDisplayName(session.user) ||
        normalizedSessionEmail;
      const quoteInsertPayload = {
        upload_id: uploadRow.id,
        // Production quotes omit customer_id; link remains via email for now.
        customer_name: quoteCustomerName,
        customer_email: contactEmail,
        company: company || null,
        file_name: file.name,
        status: DEFAULT_UPLOAD_STATUS,
      };
      const payloadSummary = {
        fileCount: 1,
        targetDate: null,
        process: manufacturingProcess || null,
        material: null,
      };
      console.log("[quote] create requested", {
        userId: session.user.id,
        email: contactEmail,
        payloadSummary,
      });

      const { data: createdQuote, error: quoteInsertError } = await supabase
        .from("quotes")
        .insert(quoteInsertPayload)
        .select("id")
        .single<{ id: string }>();

      const quoteErrorMessage = serializeSupabaseError(quoteInsertError);
      console.log("[quote] create result", {
        userId: session.user.id,
        email: contactEmail,
        quoteId: createdQuote?.id ?? null,
        uploadId: uploadRow.id,
        error: quoteErrorMessage,
      });

      const quoteTableMissing = isMissingTableError(quoteInsertError);
      if (quoteInsertError || !createdQuote) {
        if (quoteTableMissing) {
          logUploadDebug("Quote insert skipped (table missing)", {
            ...logContext,
            uploadId: uploadRow.id,
            error: quoteErrorMessage,
          });
        } else {
          return buildError(
            "We couldn’t create your quote record. Please retry.",
            500,
            {
              step: "db-insert-quote",
            },
          );
        }
      } else {
        quoteId = createdQuote.id;
        logContext.quoteId = quoteId;

        const { error: uploadLinkError } = await supabase
          .from("uploads")
          .update({
            quote_id: quoteId,
            status: DEFAULT_UPLOAD_STATUS,
          })
          .eq("id", uploadRow.id);

        if (uploadLinkError) {
          logUploadError("Upload quote link failed", {
            ...logContext,
            error: serializeSupabaseError(uploadLinkError),
          });
        }
      }
    } else {
      logContext.quoteId = quoteId;
    }

    const normalizedFile: UploadFileMetadata = {
      bucket: CAD_BUCKET,
      storageKey,
      storagePath,
      sizeBytes: file.size,
      mimeType,
      originalFileName: file.name,
      sanitizedFileName: safeFileName,
      extension: extension || null,
    };

    let metadataRecorded = false;
    try {
      const { error: fileMetadataError } = await supabase.from("files").insert({
        filename: file.name,
        size_bytes: file.size,
        mime: mimeType,
        storage_path: storagePath,
        bucket_id: CAD_BUCKET,
        quote_id: quoteId,
      });

      if (fileMetadataError) {
        const missingTable = isMissingTableError(fileMetadataError);
        const logFn = missingTable ? logUploadDebug : logUploadError;
        logFn(
          missingTable
            ? "File metadata insert skipped (table missing)"
            : "File metadata insert failed",
          {
            ...logContext,
            error: serializeSupabaseError(fileMetadataError),
            missingTable,
          },
        );
      } else {
        metadataRecorded = true;
      }
    } catch (metadataError) {
      const missingTable = isMissingTableError(metadataError);
      const logFn = missingTable ? logUploadDebug : logUploadError;
      logFn(
        missingTable
          ? "File metadata insert skipped (table missing)"
          : "Unexpected metadata insert error",
        {
          ...logContext,
          error: serializeSupabaseError(metadataError),
          missingTable,
        },
      );
    }

    logUploadDebug("Upload finished successfully", {
      ...logContext,
      uploadId: uploadRow.id,
      customerId: uploadRow.customer_id,
      quoteId,
      metadataRecorded,
    });

    return buildSuccess("Upload complete. We’ll review your CAD shortly.", {
      uploadId: uploadRow.id,
      quoteId,
      file: normalizedFile,
      metadataRecorded,
    });
  } catch (err: unknown) {
    if (err instanceof UnauthorizedError) {
      return buildError(
        "Sign in to upload CAD files and sync them with your workspace.",
        401,
        {
          step: "auth",
        },
      );
    }
    const message =
      err instanceof Error ? err.message : typeof err === "string" ? err : null;
    const stack = err instanceof Error ? err.stack : undefined;
    logUploadError("unexpected upload handler error", {
      ...logContext,
      errorMessage: message ?? "Unknown error",
      stack,
    });
    return buildError(
      "Unexpected server error while uploading your CAD. Please retry or contact support.",
      500,
      {
        step: "unexpected-error",
      },
    );
  }
}

function getFormValue(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value.trim() : "";
}

function parseBooleanFlag(value: FormDataEntryValue | null): boolean {
  if (typeof value !== "string") {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  return (
    normalized === "true" ||
    normalized === "1" ||
    normalized === "yes" ||
    normalized === "on"
  );
}

function formatFileSizeLabel(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 MB";
  }
  return `${bytesToMegabytes(bytes)} MB`;
}

function sanitizeFileName(
  originalName: string,
  preferredExtension?: string,
): string {
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

function normalizeEmailInput(value?: string | null): string | null {
  if (!value) {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function buildSessionDisplayName(user: {
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
}): string | null {
  const metadata = (user.user_metadata ?? {}) as Record<string, unknown>;
  const company = getMetadataString(metadata, "company");
  if (company) {
    return company;
  }
  const fullName = getMetadataString(metadata, "full_name");
  if (fullName) {
    return fullName;
  }
  const email = typeof user.email === "string" ? user.email.trim() : "";
  return email.length > 0 ? email : null;
}

function getMetadataString(
  metadata: Record<string, unknown> | null | undefined,
  key: string,
): string | null {
  if (!metadata) {
    return null;
  }
  const value = metadata[key];
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

type UploadLogContext = {
  fileName?: string | null;
  fileSize?: number;
  fileSizeLabel?: string;
  providedType?: string;
  extension?: string;
  isStlUpload?: boolean;
  mimeType?: string;
  bucket?: string;
  storageKey?: string;
  storagePath?: string;
  customerId?: string | null;
  uploadId?: string;
  quoteId?: string | null;
  namePresent?: boolean;
  sessionEmailPresent?: boolean;
  allowedExtensions?: string;
  maxBytes?: number;
  metadataRecorded?: boolean;
  error?: unknown;
  errorMessage?: string;
  stack?: string;
  userId?: string;
  sessionEmail?: string | null;
};

function logUploadDebug(message: string, context?: UploadLogContext) {
  if (context) {
    console.log("[upload-debug]", message, sanitizeContext(context));
    return;
  }
  console.log("[upload-debug]", message);
}

function logUploadError(message: string, context?: UploadLogContext) {
  if (context) {
    console.error("[upload-error]", message, sanitizeContext(context));
    return;
  }
  console.error("[upload-error]", message);
}

function sanitizeContext(context: UploadLogContext) {
  const sanitized: Record<string, unknown> = {};
  Object.entries(context).forEach(([key, value]) => {
    if (typeof value === "undefined") return;
    sanitized[key] = value;
  });
  return sanitized;
}

function isMissingTableError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const code =
    "code" in error && typeof (error as { code?: unknown }).code === "string"
      ? (error as { code?: string }).code
      : null;
  return code === "PGRST205";
}

function serializeSupabaseError(error: unknown) {
  if (!error) return null;
  if (typeof error === "string") return error;
  if (
    typeof error === "object" &&
    "message" in error &&
    typeof (error as { message?: unknown }).message === "string"
  ) {
    const code =
      typeof (error as { code?: unknown }).code === "string"
        ? ((error as { code?: string }).code as string)
        : null;
    const message = (error as { message: string }).message;
    return code ? `${code}: ${message}` : message;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}
