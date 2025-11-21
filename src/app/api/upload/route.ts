import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { supabaseServer } from "@/lib/supabaseServer";
import { CAD_EXTENSIONS, isAllowedCadFileName } from "@/lib/cadFileTypes";

export const runtime = "nodejs";

const CAD_BUCKET =
  process.env.SUPABASE_CAD_BUCKET ||
  process.env.NEXT_PUBLIC_CAD_BUCKET ||
  process.env.NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET ||
  "cad";

const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;

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

type UploadResponseExtras = {
  uploadId?: string;
  quoteId?: string | null;
} & Record<string, unknown>;

function buildSuccess(message: string, extra: UploadResponseExtras = {}) {
  return NextResponse.json(
    {
      success: true,
      message,
      ...extra,
    },
    { status: 200 },
  );
}

function buildError(
  message: string,
  status = 400,
  extra: Record<string, unknown> = {},
) {
  return NextResponse.json(
    {
      success: false,
      message,
      ...extra,
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
      return buildError("Missing file in request.", 400);
    }

    const file = fileEntry;
    logContext.fileName = file.name;
    logContext.fileSize = file.size;
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
      );
    }

    if (!isAllowedCadFileName(file.name)) {
      logUploadDebug("Rejecting upload: unsupported extension", {
        ...logContext,
        allowedExtensions: CAD_EXTENSIONS.join(", "),
      });
      return buildError(
        `Unsupported file type .${extension || "unknown"}. Allowed extensions: ${CAD_EXTENSIONS.join(
          ", ",
        )}.`,
        400,
      );
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      logUploadDebug("Rejecting upload: exceeds size limit", {
        ...logContext,
        maxBytes: MAX_FILE_SIZE_BYTES,
      });
      return buildError(
        `File exceeds maximum size of ${Math.floor(
          MAX_FILE_SIZE_BYTES / (1024 * 1024),
        )} MB.`,
        413,
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    if (buffer.byteLength === 0) {
      logUploadDebug("Rejecting upload: empty file buffer", logContext);
      return buildError("The uploaded file is empty.", 400);
    }

    const mimeType = detectMimeType(file, extension);
    logContext.mimeType = mimeType;

    const safeFileName = sanitizeFileName(file.name);
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
      .select("id, file_name, file_path, mime_type, customer_id")
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
      );
    }

    logUploadDebug("Upload finished successfully", {
      ...logContext,
      uploadId: uploadRow.id,
      customerId: uploadRow.customer_id,
    });

    const quoteId =
      "quote_id" in uploadRow
        ? ((uploadRow as { quote_id?: string | null }).quote_id ?? null)
        : null;

    return buildSuccess("Upload complete. We’ll review your CAD shortly.", {
      uploadId: uploadRow.id,
      quoteId,
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
    );
  }
}

function getFormValue(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value.trim() : "";
}

function sanitizeFileName(originalName: string): string {
  const fallback = "cad-file";
  if (typeof originalName !== "string" || originalName.trim().length === 0) {
    return `${fallback}.stl`;
  }
  const normalized = originalName
    .trim()
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return normalized.length > 0 ? normalized : `${fallback}.stl`;
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
  return parts.length > 1 ? parts.pop() ?? "" : "";
}

type UploadLogContext = {
  fileName?: string | null;
  fileSize?: number;
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
