import { supabaseServer } from "@/lib/supabaseServer";

export type StepPreviewInfo = {
  quoteUploadFileId: string;
  bucket: string;
  path: string;
};

const PREVIEW_BUCKET = "cad_previews";
const PREVIEW_PREFIX = "step-stl";

function normalizeId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function ensureStepPreviewForFile(
  quoteUploadFileId: string,
): Promise<StepPreviewInfo | null> {
  const id = normalizeId(quoteUploadFileId);
  if (!id) return null;

  const path = `${PREVIEW_PREFIX}/${id}.stl`;

  try {
    // Check whether the preview already exists.
    const { data: listData, error: listError } = await supabaseServer.storage
      .from(PREVIEW_BUCKET)
      .list(PREVIEW_PREFIX, { limit: 10, search: `${id}.stl` });

    if (!listError && Array.isArray(listData)) {
      const exists = listData.some((f) => f?.name === `${id}.stl`);
      if (exists) {
        return { quoteUploadFileId: id, bucket: PREVIEW_BUCKET, path };
      }
    }

    const baseUrl =
      process.env.NEXT_PUBLIC_SUPABASE_URL ||
      process.env.SUPABASE_URL ||
      process.env.NEXT_PUBLIC_SUPABASE_FUNCTIONS_URL ||
      "";
    if (!baseUrl) {
      console.error("[step-preview] ensure failed", { quoteUploadFileId: id, reason: "missing_supabase_url" });
      return null;
    }

    const url = `${baseUrl.replace(/\/+$/, "")}/functions/v1/step-to-stl`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.SUPABASE_SERVICE_ROLE_KEY
          ? { Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` }
          : {}),
      },
      body: JSON.stringify({ quoteUploadFileId: id }),
    });

    const json = (await res.json().catch(() => null)) as
      | { ok?: unknown; quoteUploadFileId?: unknown; bucket?: unknown; path?: unknown; reason?: unknown }
      | null;

    if (!json || json.ok !== true) {
      console.error("[step-preview] ensure failed", {
        quoteUploadFileId: id,
        reason: typeof json?.reason === "string" ? json.reason : `edge_not_ok_${res.status}`,
      });
      return null;
    }

    const bucket = typeof json.bucket === "string" ? json.bucket.trim() : "";
    const previewPath = typeof json.path === "string" ? json.path.trim() : "";
    if (!bucket || !previewPath) {
      console.error("[step-preview] ensure failed", { quoteUploadFileId: id, reason: "edge_missing_bucket_or_path" });
      return null;
    }

    return { quoteUploadFileId: id, bucket, path: previewPath };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error("[step-preview] ensure failed", { quoteUploadFileId: id, reason });
    return null;
  }
}

