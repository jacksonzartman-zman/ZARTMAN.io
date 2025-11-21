import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { supabaseServer } from "@/lib/supabaseServer";
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

export async function POST(req: NextRequest) {
  const logContext: UploadLogContext = {};

  try {
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

    const name = getFormValue(formData.get("name"));
    const email = getFormValue(formData.get("email"));
    const company = getFormValue(formData.get("company"));
    const requestNotes = getFormValue(formData.get("notes"));
    const extension = getFileExtension(file.name);
    const isStlUpload = extension === "stl";
    logContext.extension = extension;
    logContext.isStlUpload = isStlUpload;

    logUploadDebug("Received upload request", {
      ...logContext,
      bucket: CAD_BUCKET,
    });

    if (!name || !email) {
      logUploadDebug("Rejecting upload: missing contact info", {
        ...logContext,
        namePresent: Boolean(name),
        emailPresent: Boolean(email),
      });
      return buildError(
        "Name and email are required to submit a quote request.",
        400,
        {
          step: "validate-contact",
          missingFields: {
            name: !name,
            email: !email,
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
    const { data: customer, error: customerError } = await supabase
      .from("customers")
      .upsert(
        {
          name,
          email,
          company: company || null,
        },
        {
          onConflict: "email",
        },
      )
      .select("id")
      .single();

    if (customerError) {
      logUploadError("Customer upsert failed", {
        ...logContext,
        error: serializeSupabaseError(customerError),
      });
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
        name,
        email,
        company: company || null,
        notes: requestNotes || null,
        customer_id: customerId,
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

    const quoteId =
      "quote_id" in uploadRow
        ? ((uploadRow as { quote_id?: string | null }).quote_id ?? null)
        : null;

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
        logUploadError("File metadata insert failed", {
          ...logContext,
          error: serializeSupabaseError(fileMetadataError),
        });
      } else {
        metadataRecorded = true;
      }
    } catch (metadataError) {
      logUploadError("Unexpected metadata insert error", {
        ...logContext,
        error: serializeSupabaseError(metadataError),
      });
    }

    logUploadDebug("Upload finished successfully", {
      ...logContext,
      uploadId: uploadRow.id,
      customerId: uploadRow.customer_id,
      metadataRecorded,
    });

    return buildSuccess("Upload complete. We’ll review your CAD shortly.", {
      uploadId: uploadRow.id,
      quoteId,
      file: normalizedFile,
      metadataRecorded,
    });
  } catch (err: unknown) {
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
  namePresent?: boolean;
  emailPresent?: boolean;
  allowedExtensions?: string;
  maxBytes?: number;
  metadataRecorded?: boolean;
  error?: unknown;
  errorMessage?: string;
  stack?: string;
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
