import { supabaseServer } from "@/lib/supabaseServer";
import type { QuoteFileItem } from "@/app/admin/quotes/[id]/QuoteFilesCard";
import { serializeSupabaseError, isMissingTableOrColumnError } from "@/server/admin/logging";
import type { QuoteFileMeta, QuoteFileSource } from "./types";
import { classifyCadFileType } from "@/lib/cadRendering";
import { signPreviewToken } from "@/server/cadPreviewToken";

type FileStorageRow = {
  storage_path: string | null;
  bucket_id: string | null;
  filename: string | null;
  mime: string | null;
};

export type UploadFileReference = {
  file_path: string | null;
  file_name: string | null;
  mime_type?: string | null;
};

type CadFileCandidate = {
  storagePath: string;
  bucketId?: string | null;
  fileName?: string | null;
  mime?: string | null;
};

type CadPreviewResult = {
  signedUrl: string | null;
  fileName?: string | null;
  cadKind?: "step" | "stl" | "obj" | "glb" | null;
  storageSource?: { bucket: string; path: string; token?: string | null } | null;
  reason?: string;
};

const DEFAULT_CAD_BUCKET =
  process.env.SUPABASE_CAD_BUCKET ||
  process.env.NEXT_PUBLIC_CAD_BUCKET ||
  process.env.NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET ||
  "cad";

const CAD_SIGNED_URL_TTL_SECONDS = 60 * 60;

export type QuoteFilePreviewOptions = {
  includeFilesTable?: boolean;
  uploadFileOverride?: UploadFileReference | null;
  onFilesError?: (error: unknown) => void;
  /**
   * When provided, server will sign a short-lived preview token for `/api/cad-preview`
   * so non-admin portal users can render Storage-backed previews.
   */
  viewerUserId?: string | null;
};

export async function getQuoteFilePreviews(
  quote: QuoteFileSource,
  options?: QuoteFilePreviewOptions,
): Promise<QuoteFileItem[]> {
  try {
    const includeFilesTable = options?.includeFilesTable !== false;
    let files: FileStorageRow[] = [];
    if (includeFilesTable) {
      try {
        const { data, error: filesError } = await supabaseServer
          .from("files")
          .select("storage_path,bucket_id,filename,mime")
          .eq("quote_id", quote.id)
          .order("created_at", { ascending: true });

        if (filesError) {
          const serializedError = serializeSupabaseError(filesError);
          // Some environments omit public.files; downgrade PGRST205/42703 to a warning and surface zero files instead of failing.
          if (isMissingTableOrColumnError(filesError)) {
            console.warn(
              "[admin uploads] files schema missing; treating as zero files",
              {
                quoteId: quote.id,
                error: serializedError,
              },
            );
          } else {
            console.error("Failed to load files for quote", {
              quoteId: quote.id,
              error: serializedError,
            });
          }

          if (options?.onFilesError) {
            options.onFilesError(filesError);
          }
        } else {
          files = data ?? [];
        }
      } catch (error) {
        const serializedError = serializeSupabaseError(error);
        console.error("Failed to load files for quote", {
          quoteId: quote.id,
          error: serializedError,
        });
        if (options?.onFilesError) {
          options.onFilesError(error);
        }
      }
    }

    let uploadFile: UploadFileReference | null = null;
    const uploadOverrideProvided = options
      ? Object.prototype.hasOwnProperty.call(options, "uploadFileOverride")
      : false;
    if (uploadOverrideProvided) {
      uploadFile = options?.uploadFileOverride ?? null;
    } else if (quote.upload_id) {
      const { data: uploadData, error: uploadError } = await supabaseServer
        .from("uploads")
        .select("file_path,file_name,mime_type")
        .eq("id", quote.upload_id)
        .maybeSingle<UploadFileReference>();

      if (uploadError) {
        console.error(
          "Failed to load upload for quote",
          quote.upload_id,
          uploadError,
        );
      } else {
        uploadFile = uploadData;
      }
    }

    const candidates = gatherCadCandidates(files ?? [], uploadFile);
    const previewCache = new Map<string, CadPreviewResult>();
    const declaredNames = extractFileNames(quote);
    const fallbackNames = candidates
      .map((candidate) => {
        return (
          candidate.fileName ??
          extractFileNameFromPath(candidate.storagePath) ??
          null
        );
      })
      .filter((value): value is string => Boolean(value?.trim()));
    const orderedNames =
      declaredNames.length > 0
        ? declaredNames
        : fallbackNames.length > 0
          ? fallbackNames
          : [];

    const entries: QuoteFileItem[] = [];
    const matchedCandidates = new Set<string>();

    for (let index = 0; index < orderedNames.length; index += 1) {
      const label = orderedNames[index] || `File ${index + 1}`;
      const candidate = matchCandidateByName(label, candidates);
      if (candidate) {
        matchedCandidates.add(candidate.storagePath);
      }

      const preview = candidate
        ? await getPreviewForCandidate(candidate, previewCache, options)
        : {
            signedUrl: null,
            fileName: label,
            reason: "Preview not available for this file yet.",
          };

      entries.push({
        id: candidate?.storagePath ?? `${index}-${label}`,
        label,
        fileName: preview.fileName ?? label,
        signedUrl: preview.signedUrl,
        cadKind: preview.cadKind ?? null,
        storageSource: preview.storageSource ?? null,
        fallbackMessage: preview.reason,
      });
    }

    const unmatchedCandidates = candidates.filter(
      (candidate) => !matchedCandidates.has(candidate.storagePath),
    );

    for (const [index, candidate] of unmatchedCandidates.entries()) {
      const fallbackLabel =
        candidate.fileName ??
        extractFileNameFromPath(candidate.storagePath) ??
        `File ${entries.length + 1}`;
      const preview = await getPreviewForCandidate(candidate, previewCache, options);
      entries.push({
        id: `${candidate.storagePath}-${index}`,
        label: fallbackLabel,
        fileName: preview.fileName ?? fallbackLabel,
        signedUrl: preview.signedUrl,
        cadKind: preview.cadKind ?? null,
        storageSource: preview.storageSource ?? null,
        fallbackMessage: preview.reason,
      });
    }

    return entries;
  } catch (error) {
    console.error("Unexpected CAD preview error", error);
    return [];
  }
}

function extractFileNames(
  row: Pick<QuoteFileSource, "file_name" | "file_names" | "upload_file_names">,
): string[] {
  const names: string[] = [];

  const forward = (value: unknown) => {
    if (typeof value === "string" && value.trim().length > 0) {
      names.push(value.trim());
    }
  };

  const maybeArrays = [row.file_names, row.upload_file_names];
  maybeArrays.forEach((maybeList) => {
    if (Array.isArray(maybeList)) {
      maybeList.forEach(forward);
    }
  });

  if (names.length === 0) {
    forward(row.file_name);
  }

  return names;
}

export function buildQuoteFilesFromRow(
  row: Pick<QuoteFileSource, "file_name" | "file_names" | "upload_file_names">,
): QuoteFileMeta[] {
  const names = extractFileNames(row);
  return names.map((filename) => ({ filename }));
}

async function getPreviewForCandidate(
  candidate: CadFileCandidate,
  cache: Map<string, CadPreviewResult>,
  options?: QuoteFilePreviewOptions,
): Promise<CadPreviewResult> {
  const cacheKey = `${candidate.bucketId ?? "default"}:${candidate.storagePath}`;
  if (cache.has(cacheKey)) {
    return cache.get(cacheKey)!;
  }

  let result: CadPreviewResult;

  const inferredFileName =
    candidate.fileName ??
    extractFileNameFromPath(candidate.storagePath) ??
    null;
  const cadType = classifyCadFileType({ filename: inferredFileName, extension: null });

  if (!cadType.ok) {
    result = {
      signedUrl: null,
      fileName: inferredFileName ?? undefined,
      cadKind: null,
      storageSource: null,
      reason:
        cadType.type === "unsupported"
          ? "Preview is not available for this file type yet."
          : "Preview is not available for this file.",
    };
    cache.set(cacheKey, result);
    return result;
  }

  const normalized = normalizeStorageReference(
    candidate.storagePath,
    candidate.bucketId,
  );

  if (!normalized) {
    result = {
      signedUrl: null,
      fileName: inferredFileName ?? undefined,
      cadKind: cadType.type,
      storageSource: null,
      reason: "Missing storage path for CAD file.",
    };
    cache.set(cacheKey, result);
    return result;
  }

  const viewerUserId =
    typeof options?.viewerUserId === "string" && options.viewerUserId.trim()
      ? options.viewerUserId.trim()
      : null;
  const exp = Math.floor(Date.now() / 1000) + CAD_SIGNED_URL_TTL_SECONDS;
  const token = viewerUserId
    ? signPreviewToken({
        userId: viewerUserId,
        bucket: normalized.bucket,
        path: normalized.path,
        exp,
      })
    : null;

  const qs = new URLSearchParams();
  if (token) {
    qs.set("token", token);
  } else {
    qs.set("bucket", normalized.bucket);
    qs.set("path", normalized.path);
  }
  qs.set("kind", cadType.type);
  qs.set("disposition", "inline");

  result = {
    signedUrl: `/api/cad-preview?${qs.toString()}`,
    fileName: inferredFileName ?? undefined,
    cadKind: cadType.type,
    storageSource: {
      bucket: normalized.bucket,
      path: normalized.path,
      token,
    },
  };

  cache.set(cacheKey, result);
  return result;
}

function matchCandidateByName(
  name: string,
  candidates: CadFileCandidate[],
): CadFileCandidate | undefined {
  const normalizedName = name?.toLowerCase().trim();
  if (!normalizedName) {
    return undefined;
  }

  return candidates.find((candidate) => {
    const candidateName = candidate.fileName?.toLowerCase().trim();
    if (candidateName && candidateName === normalizedName) {
      return true;
    }
    const pathName =
      extractFileNameFromPath(candidate.storagePath)?.toLowerCase().trim() ?? "";
    return pathName === normalizedName;
  });
}

function gatherCadCandidates(
  files: FileStorageRow[],
  upload: UploadFileReference | null,
): CadFileCandidate[] {
  const candidates: CadFileCandidate[] = [];

  files?.forEach((file) => {
    if (!file?.storage_path) return;
    candidates.push({
      storagePath: file.storage_path,
      bucketId: file.bucket_id,
      fileName: file.filename,
      mime: file.mime,
    });
  });

  if (upload?.file_path) {
    candidates.push({
      storagePath: upload.file_path,
      bucketId: null,
      fileName: upload.file_name,
    });
  }

  return candidates;
}

function normalizeStorageReference(
  storagePath: string,
  bucketId?: string | null,
): { bucket: string; path: string } | null {
  if (!storagePath) {
    return null;
  }

  let path = storagePath.trim().replace(/^\/+/, "");
  if (!path) {
    return null;
  }

  let bucket = bucketId?.trim() || null;

  if (!bucket && path.startsWith(`${DEFAULT_CAD_BUCKET}/`)) {
    bucket = DEFAULT_CAD_BUCKET;
    path = path.slice(DEFAULT_CAD_BUCKET.length + 1);
  }

  if (!bucket) {
    bucket = DEFAULT_CAD_BUCKET;
  }

  if (path.startsWith(`${bucket}/`)) {
    path = path.slice(bucket.length + 1);
  }

  if (!path) {
    return null;
  }

  return { bucket, path };
}

export function extractFileNameFromPath(path: string): string | undefined {
  if (!path) return undefined;
  const segments = path.split("/");
  return segments[segments.length - 1] || undefined;
}
