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
    // Resolve storage location from DB (quote_upload_files).
    const { data: row, error: rowError } = await supabaseServer
      .from("quote_upload_files")
      .select("id,storage_path,bucket_id,filename,extension")
      .eq("id", id)
      .maybeSingle<{
        id: string;
        storage_path: string | null;
        bucket_id: string | null;
        filename: string | null;
        extension: string | null;
      }>();

    if (rowError || !row?.storage_path) {
      console.error("[step-preview] ensure failed", { quoteUploadFileId: id, requestId, reason: "missing_storage_path" });
      return null;
    }

    const normalized = normalizeStorageReference(row.storage_path, row.bucket_id);
    if (!normalized) {
      console.error("[step-preview] ensure failed", { quoteUploadFileId: id, requestId, reason: "invalid_storage_ref" });
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
    const converted = await convertStepToBinaryStl(stepBytes);
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

