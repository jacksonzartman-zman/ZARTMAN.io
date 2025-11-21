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

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();

    const fileEntry = formData.get("file");
    if (!(fileEntry instanceof File)) {
      logUploadDebug("Rejecting request: missing file in form-data payload");
      return NextResponse.json(
        { success: false, message: "Missing file in request." },
        { status: 400 },
      );
    }

    const file = fileEntry;
    const name = getFormValue(formData.get("name"));
    const email = getFormValue(formData.get("email"));
    const company = getFormValue(formData.get("company"));
    const requestNotes = getFormValue(formData.get("notes"));
    const extension = getFileExtension(file.name);
    const isStlUpload = extension === "stl";
    const baseLogContext: UploadLogContext = {
      fileName: file.name,
      fileSize: file.size,
      providedType: file.type || "",
      extension,
      isStlUpload,
    };

    logUploadDebug("Received upload request", {
      ...baseLogContext,
      bucket: CAD_BUCKET,
    });

    if (!name || !email) {
      logUploadDebug("Rejecting upload: missing contact info", {
        ...baseLogContext,
        namePresent: Boolean(name),
        emailPresent: Boolean(email),
      });
      return NextResponse.json(
        {
          success: false,
          message: "Name and email are required to submit a quote request.",
        },
        { status: 400 },
      );
    }

    if (!isAllowedCadFileName(file.name)) {
      logUploadDebug("Rejecting upload: unsupported extension", {
        ...baseLogContext,
        allowedExtensions: CAD_EXTENSIONS.join(", "),
      });
      return NextResponse.json(
        {
          success: false,
          message: `Unsupported file type .${extension || "unknown"}. Allowed extensions: ${CAD_EXTENSIONS.join(
            ", ",
          )}.`,
        },
        { status: 400 },
      );
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      logUploadDebug("Rejecting upload: exceeds size limit", {
        ...baseLogContext,
        maxBytes: MAX_FILE_SIZE_BYTES,
      });
      return NextResponse.json(
        {
          success: false,
          message: `File exceeds maximum size of ${Math.floor(
            MAX_FILE_SIZE_BYTES / (1024 * 1024),
          )} MB.`,
        },
        { status: 413 },
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    if (buffer.byteLength === 0) {
      logUploadDebug("Rejecting upload: empty file buffer", baseLogContext);
      return NextResponse.json(
        { success: false, message: "The uploaded file is empty." },
        { status: 400 },
      );
    }

    const mimeType = detectMimeType(file, extension);
    const safeFileName = sanitizeFileName(file.name);
    const storageKey = buildStorageKey(safeFileName);
    const storagePath = `${CAD_BUCKET}/${storageKey}`;
    const supabase = supabaseServer;
    const uploadLogContext: UploadLogContext = {
      ...baseLogContext,
      mimeType,
      bucket: CAD_BUCKET,
      storageKey,
      storagePath,
    };

    logUploadDebug("Uploading file to Supabase storage", uploadLogContext);

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
        ...uploadLogContext,
        error: {
          message: storageError.message,
          name: storageError.name,
          statusCode: storageStatusCode,
        },
      });
      return NextResponse.json(
        {
          success: false,
          message: `Storage upload failed: ${
            storageError.message || "unknown error"
          }`,
        },
        { status: 500 },
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
        ...uploadLogContext,
        error: serializeSupabaseError(customerError),
      });
    } else if (customer?.id) {
      customerId = customer.id as string;
    }

    logUploadDebug("Inserting upload metadata row", {
      ...uploadLogContext,
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
        ...uploadLogContext,
        error: serializeSupabaseError(uploadError),
      });
      return NextResponse.json(
        {
          success: false,
          message: `Database insert failed: ${
            serializeSupabaseError(uploadError) || "unknown reason"
          }`,
        },
        { status: 500 },
      );
    }

    logUploadDebug("Upload finished successfully", {
      ...uploadLogContext,
      uploadId: uploadRow.id,
      customerId: uploadRow.customer_id,
    });

    const quoteId =
      (uploadRow as { quote_id?: string | null }).quote_id ?? null;

    return NextResponse.json({
      success: true,
      message: "Upload complete. We’ll review your CAD shortly.",
      uploadId: uploadRow.id,
      quoteId,
    });
  } catch (err: any) {
    logUploadError("Unexpected upload handler error", {
      error: err?.message ?? String(err),
    });
    return NextResponse.json(
      {
        success: false,
        message:
          typeof err?.message === "string"
            ? err.message
            : "Unexpected server error.",
      },
      { status: 500 },
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
    console.error("[upload-debug]", message, sanitizeContext(context));
    return;
  }
  console.error("[upload-debug]", message);
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
