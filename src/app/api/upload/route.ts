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
      return NextResponse.json(
        { success: false, message: "Missing file in request" },
        { status: 400 },
      );
    }

    const file = fileEntry;
    const name = getFormValue(formData.get("name"));
    const email = getFormValue(formData.get("email"));
    const company = getFormValue(formData.get("company"));
    const notes = getFormValue(formData.get("notes"));

    if (!name || !email) {
      return NextResponse.json(
        { success: false, message: "Name and email are required" },
        { status: 400 },
      );
    }

    if (!isAllowedCadFileName(file.name)) {
      return NextResponse.json(
        {
          success: false,
          message: `Unsupported file type. Allowed extensions: ${CAD_EXTENSIONS.join(
            ", ",
          )}.`,
        },
        { status: 400 },
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    if (buffer.byteLength === 0) {
      return NextResponse.json(
        { success: false, message: "The uploaded file is empty." },
        { status: 400 },
      );
    }

    const mimeType = detectMimeType(file);
    const safeFileName = sanitizeFileName(file.name);
    const storageKey = buildStorageKey(safeFileName);
    const storagePath = `${CAD_BUCKET}/${storageKey}`;

    const supabase = supabaseServer;

    const { error: storageError } = await supabase.storage
      .from(CAD_BUCKET)
      .upload(storageKey, buffer, {
        cacheControl: "3600",
        contentType: mimeType,
        upsert: false,
      });

    if (storageError) {
      console.error("Supabase storage upload failed", storageError);
      return NextResponse.json(
        {
          success: false,
          step: "storage-upload",
          message: "Failed to upload file to storage.",
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
      console.error("Customer upsert failed", customerError);
    } else if (customer?.id) {
      customerId = customer.id as string;
    }

    const { data: uploadRow, error: uploadError } = await supabase
      .from("uploads")
      .insert({
        file_name: file.name,
        file_path: storagePath,
        mime_type: mimeType,
        name,
        email,
        company: company || null,
        initial_request_notes: notes || null,
        customer_id: customerId,
      })
      .select("id, file_name, file_path, mime_type, customer_id")
      .single();

    if (uploadError || !uploadRow) {
      console.error("Upload metadata insert failed", uploadError);
      return NextResponse.json(
        {
          success: false,
          step: "metadata-insert",
          message: "Failed to save upload metadata.",
        },
        { status: 500 },
      );
    }

    return NextResponse.json({
      ok: true,
      success: true,
      message: "Upload complete",
      uploadId: uploadRow.id,
      customerId: uploadRow.customer_id,
      fileName: uploadRow.file_name,
      filePath: uploadRow.file_path,
      mimeType: uploadRow.mime_type,
      bucket: CAD_BUCKET,
      key: storageKey,
      storagePath,
      publicUrl: null,
    });
  } catch (err: any) {
    console.error("Upload handler error", err);
    return NextResponse.json(
      { success: false, message: err?.message ?? String(err) },
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

function detectMimeType(file: File): string {
  if (file.type && file.type.trim().length > 0) {
    return file.type;
  }
  const extension = getFileExtension(file.name);
  return MIME_BY_EXTENSION[extension] || "application/octet-stream";
}

function getFileExtension(fileName: string): string {
  if (typeof fileName !== "string") return "";
  const parts = fileName.toLowerCase().split(".");
  return parts.length > 1 ? parts.pop() ?? "" : "";
}
