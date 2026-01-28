import { NextResponse, type NextRequest } from "next/server";
import { randomBytes } from "node:crypto";
import { supabaseServer } from "@/lib/supabaseServer";
import { DEFAULT_QUOTE_STATUS } from "@/server/quotes/status";
import {
  CAD_FILE_TYPE_DESCRIPTION,
  isAllowedCadFileName,
} from "@/lib/cadFileTypes";
import { MAX_UPLOAD_BYTES, formatMaxUploadSize } from "@/lib/uploads/uploadLimits";
import { registerUploadedObjectsForExistingUpload } from "@/server/quotes/uploadFiles";

export const runtime = "nodejs";

type IntakeOk = { ok: true; quoteId: string; uploadId: string; intakeKey: string };
type IntakeErr = { ok: false; error: string };

const MAX_FILES_PER_RFQ = 20;
const FILE_SIZE_LIMIT_LABEL = formatMaxUploadSize();
const CAD_BUCKET = "cad_uploads";

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

function getFileExtension(fileName: string): string {
  if (typeof fileName !== "string") return "";
  const parts = fileName.toLowerCase().split(".");
  return parts.length > 1 ? (parts.pop() ?? "") : "";
}

function detectMimeType(file: File, extension?: string): string {
  if (file.type && file.type.trim().length > 0) {
    return file.type;
  }
  const normalizedExtension = extension || getFileExtension(file.name);
  return MIME_BY_EXTENSION[normalizedExtension] || "application/octet-stream";
}

function sanitizeFileName(originalName: string, preferredExtension?: string): string {
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

function buildIntakeKey(): string {
  return randomBytes(16).toString("hex");
}

function buildStorageKey(args: { quoteId: string; fileName: string }): string {
  const timestamp = Date.now();
  const random = randomBytes(6).toString("hex");
  return `uploads/intake/public/${args.quoteId}/${timestamp}-${random}-${args.fileName}`;
}

function errorResponse(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message } satisfies IntakeErr, { status });
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const fileEntries = formData.getAll("files").filter((v): v is File => v instanceof File);
    const files = fileEntries.length > 0 ? fileEntries : [];

    if (files.length === 0) {
      return errorResponse("Attach at least one CAD or ZIP file.");
    }
    if (files.length > MAX_FILES_PER_RFQ) {
      return errorResponse(`Upload up to ${MAX_FILES_PER_RFQ} files at once.`);
    }

    for (const file of files) {
      if (!isAllowedCadFileName(file.name)) {
        return errorResponse(`Unsupported file type. Please upload ${CAD_FILE_TYPE_DESCRIPTION}.`);
      }
      if (file.size > MAX_UPLOAD_BYTES) {
        return errorResponse(`Max allowed file size is ${FILE_SIZE_LIMIT_LABEL}.`);
      }
      if (file.size === 0) {
        return errorResponse(`“${file.name}” is empty. Please choose another file.`);
      }
    }

    let intakeKey = buildIntakeKey();

    // Create an upload row first so we have an immutable reference + key for public tracking.
    const primary = files[0]!;
    const primaryExtension = getFileExtension(primary.name);
    const primaryMimeType = detectMimeType(primary, primaryExtension);

    const uploadInsert = await supabaseServer()
      .from("uploads")
      .insert({
        file_name: primary.name,
        file_path: null,
        mime_type: primaryMimeType,
        status: DEFAULT_QUOTE_STATUS,
        name: "Anonymous",
        email: null,
        company: null,
        notes: null,
        first_name: null,
        last_name: null,
        phone: null,
        manufacturing_process: null,
        quantity: null,
        shipping_postal_code: null,
        export_restriction: "Not applicable / None",
        rfq_reason: null,
        itar_acknowledged: true,
        terms_accepted: true,
        intake_idempotency_key: intakeKey,
      })
      .select("id")
      .single<{ id: string }>();

    if (uploadInsert.error || !uploadInsert.data?.id) {
      // Retry once if the key collided (unique index).
      intakeKey = buildIntakeKey();
      const retry = await supabaseServer()
        .from("uploads")
        .insert({
          file_name: primary.name,
          file_path: null,
          mime_type: primaryMimeType,
          status: DEFAULT_QUOTE_STATUS,
          name: "Anonymous",
          email: null,
          company: null,
          notes: null,
          export_restriction: "Not applicable / None",
          itar_acknowledged: true,
          terms_accepted: true,
          intake_idempotency_key: intakeKey,
        })
        .select("id")
        .single<{ id: string }>();

      if (retry.error || !retry.data?.id) {
        console.error("[public intake] upload insert failed", uploadInsert.error, retry.error);
        return errorResponse("We couldn’t start your RFQ. Please try again.", 500);
      }

      uploadInsert.data = retry.data;
    }

    const uploadId = uploadInsert.data.id;

    const quoteInsert = await supabaseServer()
      .from("quotes")
      .insert({
        upload_id: uploadId,
        customer_name: "Anonymous",
        customer_email: null,
        company: null,
        file_name: primary.name,
        status: DEFAULT_QUOTE_STATUS,
        currency: "USD",
        price: null,
      })
      .select("id")
      .single<{ id: string }>();

    if (quoteInsert.error || !quoteInsert.data?.id) {
      console.error("[public intake] quote insert failed", quoteInsert.error);
      return errorResponse("We couldn’t start your RFQ. Please try again.", 500);
    }

    const quoteId = quoteInsert.data.id;

    // Upload all files to storage and register canonical file metadata.
    const targets: Array<{
      bucketId: string;
      storagePath: string;
      originalFileName: string;
      mimeType: string;
      sizeBytes: number;
    }> = [];

    for (const file of files) {
      const buffer = Buffer.from(await file.arrayBuffer());
      const extension = getFileExtension(file.name);
      const mimeType = detectMimeType(file, extension);
      const safeName = sanitizeFileName(file.name, extension);
      const storagePath = buildStorageKey({ quoteId, fileName: safeName });

      const { error: storageError } = await supabaseServer().storage.from(CAD_BUCKET).upload(
        storagePath,
        buffer,
        {
          cacheControl: "3600",
          contentType: mimeType,
          upsert: false,
        },
      );

      if (storageError) {
        console.error("[public intake] storage upload failed", {
          quoteId,
          uploadId,
          fileName: file.name,
          error: storageError,
        });
        return errorResponse("Upload failed. Please try again.", 500);
      }

      targets.push({
        bucketId: CAD_BUCKET,
        storagePath,
        originalFileName: file.name,
        mimeType,
        sizeBytes: file.size,
      });
    }

    const registerResult = await registerUploadedObjectsForExistingUpload({
      quoteId,
      uploadId,
      targets,
      supabase: supabaseServer(),
    });

    if (!registerResult.ok) {
      console.error("[public intake] register files failed", {
        quoteId,
        uploadId,
      });
      return errorResponse("We couldn’t start processing your files. Please try again.", 500);
    }

    const primaryTarget = targets[0];
    await supabaseServer()
      .from("uploads")
      .update({
        quote_id: quoteId,
        file_path: primaryTarget ? `${CAD_BUCKET}/${primaryTarget.storagePath}` : null,
        status: DEFAULT_QUOTE_STATUS,
      })
      .eq("id", uploadId);

    return NextResponse.json({ ok: true, quoteId, uploadId, intakeKey } satisfies IntakeOk, {
      status: 200,
    });
  } catch (error) {
    console.error("[public intake] crashed", error);
    return errorResponse("Unexpected server error. Please try again.", 500);
  }
}

