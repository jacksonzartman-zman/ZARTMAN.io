import { supabaseServer } from "@/lib/supabaseServer";

export type StepPreviewInfo = {
  quoteUploadFileId: string;
  bucket: string;
  path: string;
};

const PREVIEW_BUCKET = "cad_previews";
const MAX_PREVIEW_BYTES = 50 * 1024 * 1024; // 50MB
const DEFAULT_CAD_BUCKET =
  process.env.SUPABASE_CAD_BUCKET ||
  process.env.NEXT_PUBLIC_CAD_BUCKET ||
  process.env.NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET ||
  "cad_uploads";

function normalizeId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizePath(value: unknown): string {
  const raw = typeof value === "string" ? value.trim() : "";
  return raw.replace(/^\/+/, "");
}

function normalizeStorageReference(
  storagePath: string,
  bucketId?: string | null,
): { bucket: string; path: string } | null {
  if (!storagePath) return null;
  let path = normalizePath(storagePath);
  if (!path) return null;

  let bucket = normalizeId(bucketId) || null;
  if (!bucket && path.startsWith(`${DEFAULT_CAD_BUCKET}/`)) {
    bucket = DEFAULT_CAD_BUCKET;
    path = path.slice(DEFAULT_CAD_BUCKET.length + 1);
  }
  if (!bucket) bucket = DEFAULT_CAD_BUCKET;
  if (path.startsWith(`${bucket}/`)) {
    path = path.slice(bucket.length + 1);
  }
  if (!path) return null;
  return { bucket, path };
}

export async function ensureStepPreviewForFile(
  quoteUploadFileId: string,
): Promise<StepPreviewInfo | null> {
  const id = normalizeId(quoteUploadFileId);
  if (!id) return null;

  const requestId = `step-preview-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 10)}`;

  try {
    // Resolve quote_upload_files row (schema: id, upload_id, filename, extension, is_from_archive, path).
    const { data: row, error: rowError } = await supabaseServer
      .from("quote_upload_files")
      .select("id,upload_id,filename,extension,is_from_archive,path")
      .eq("id", id)
      .maybeSingle<{
        id: string;
        upload_id: string;
        filename: string | null;
        extension: string | null;
        is_from_archive: boolean;
        path: string;
      }>();

    if (rowError || !row?.id || !row?.upload_id) {
      console.error("[step-preview] ensure failed", { quoteUploadFileId: id, requestId, reason: "missing_storage_path" });
      return null;
    }

    // ZIP members do not have a direct Storage object identity in this schema.
    // (We store the container upload object, plus per-member metadata.)
    if (row.is_from_archive) {
      console.warn("[step-preview] skip archive member (no direct storage identity)", {
        quoteUploadFileId: id,
        requestId,
        uploadId: row.upload_id,
        path: row.path,
      });
      return null;
    }

    // Resolve storage object identity from uploads.file_path (this is the actual uploaded object).
    const { data: uploadRow, error: uploadError } = await supabaseServer
      .from("uploads")
      .select("id,file_path")
      .eq("id", row.upload_id)
      .maybeSingle<{ id: string; file_path: string | null }>();
    if (uploadError || !uploadRow?.file_path) {
      console.error("[step-preview] ensure failed", {
        quoteUploadFileId: id,
        requestId,
        reason: "upload_missing_file_path",
        uploadId: row.upload_id,
      });
      return null;
    }

    // uploads.file_path is sometimes stored as "bucket/key" and sometimes just "key".
    const normalized = normalizeStorageReference(uploadRow.file_path, null);
    if (!normalized) {
      console.error("[step-preview] ensure failed", {
        quoteUploadFileId: id,
        requestId,
        reason: "invalid_storage_ref",
        uploadId: row.upload_id,
        filePath: uploadRow.file_path,
      });
      return null;
    }

    const { buildStepStlPreviewPath } = await import("@/server/cad/stepToStl");
    const previewPath = buildStepStlPreviewPath({
      sourceBucket: normalized.bucket,
      sourcePath: normalized.path,
      sourceFileName: row.filename ?? null,
    });

    // Cache hit: if preview exists, we’re done.
    const { data: cached, error: cachedError } = await supabaseServer.storage
      .from(PREVIEW_BUCKET)
      .download(previewPath);
    if (!cachedError && cached) {
      return { quoteUploadFileId: id, bucket: PREVIEW_BUCKET, path: previewPath };
    }

    // Download source STEP and convert in Node (same converter as intake previews).
    const { data: stepBlob, error: downloadError } = await supabaseServer.storage
      .from(normalized.bucket)
      .download(normalized.path);
    if (downloadError || !stepBlob) {
      console.error("[step-preview] ensure failed", {
        quoteUploadFileId: id,
        requestId,
        reason: "source_download_failed",
        bucket: normalized.bucket,
        path: normalized.path,
        downloadError,
      });
      return null;
    }
    if (typeof stepBlob.size === "number" && stepBlob.size > MAX_PREVIEW_BYTES) {
      console.error("[step-preview] ensure failed", {
        quoteUploadFileId: id,
        requestId,
        reason: "source_too_large",
        bytes: stepBlob.size,
      });
      return null;
    }

    const stepBytes = new Uint8Array(await stepBlob.arrayBuffer());
    const { convertStepToBinaryStl } = await import("@/server/cad/stepToStl");
    const converted = await convertStepToBinaryStl(stepBytes, { rid: requestId });
    if (!converted.stl || converted.stl.byteLength <= 0) {
      console.error("[step-preview] ensure failed", {
        quoteUploadFileId: id,
        requestId,
        reason: "conversion_failed",
        meshes: converted.meshes,
        triangles: converted.triangles,
      });
      return null;
    }

    // supabase-js upload body should be Node-safe (Uint8Array/ArrayBuffer), not a Blob/Buffer.
    const stlPayload = new Uint8Array(converted.stl.buffer, converted.stl.byteOffset, converted.stl.byteLength);
    const { error: uploadError } = await supabaseServer.storage
      .from(PREVIEW_BUCKET)
      .upload(previewPath, stlPayload, {
        contentType: "model/stl",
        upsert: true,
      });

    if (uploadError) {
      console.error("[step-preview] ensure upload failed", {
        quoteUploadFileId: id,
        requestId,
        previewPath,
        uploadError,
      });
      // Still allow caller to try to render from memory path next time; for now treat as unavailable.
      return null;
    }

    return { quoteUploadFileId: id, bucket: PREVIEW_BUCKET, path: previewPath };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error("[step-preview] ensure failed", { quoteUploadFileId: id, reason });
    return null;
  }
}

