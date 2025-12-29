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

    const functionName = "step-to-stl" as const;
    const { data, error: edgeError } = await supabaseServer.functions.invoke(functionName, {
      body: { quoteUploadFileId: id },
    });

    if (edgeError) {
      const anyErr = edgeError as any;
      const edgeStatus = typeof anyErr?.context?.status === "number" ? anyErr.context.status : null;
      const edgeBody = anyErr?.context?.body;
      const edgeBodyPreview =
        typeof edgeBody === "string"
          ? edgeBody.slice(0, 500)
          : edgeBody != null
            ? JSON.stringify(edgeBody).slice(0, 500)
            : null;
      console.error("[step-preview] ensure failed", {
        quoteUploadFileId: id,
        functionName,
        edgeStatus,
        edgeBodyPreview,
        edgeError,
      });
      return null;
    }

    const ok = Boolean((data as any)?.ok === true);
    if (!ok) {
      console.error("[step-preview] ensure failed", {
        quoteUploadFileId: id,
        functionName,
        reason: typeof (data as any)?.reason === "string" ? (data as any).reason : "edge_not_ok",
      });
      return null;
    }

    const bucketRaw = (data as any)?.previewBucket ?? (data as any)?.bucket;
    const pathRaw = (data as any)?.previewPath ?? (data as any)?.path;
    const bucket = typeof bucketRaw === "string" ? bucketRaw.trim() : "";
    const previewPath = typeof pathRaw === "string" ? pathRaw.trim() : "";
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

