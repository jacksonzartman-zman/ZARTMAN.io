import { supabaseServer } from "@/lib/supabaseServer";
import type { QuoteFileItem } from "@/app/admin/quotes/[id]/QuoteFilesCard";
import { serializeSupabaseError, isMissingTableOrColumnError } from "@/server/admin/logging";
import type { QuoteFileMeta, QuoteFileSource } from "./types";
import { classifyCadFileType } from "@/lib/cadRendering";
import { signPreviewToken } from "@/server/cadPreviewToken";

type FileStorageRow = {
  storage_path: string | null;
  // Legacy column name (some deployments).
  bucket_id?: string | null;
  // Canonical column name (preferred).
  storage_bucket_id?: string | null;
  // Some deployments used `file_path` instead of `storage_path`.
  file_path?: string | null;
  filename: string | null;
  mime: string | null;
};

export type UploadFileReference = {
  // Canonical storage identity (preferred when present).
  storage_bucket_id?: string | null;
  storage_path?: string | null;
  // Legacy upload columns.
  bucket_id?: string | null;
  file_path?: string | null;
  file_name: string | null;
  mime_type?: string | null;
};

type CadFileCandidate = {
  storagePath: string;
  bucketId?: string | null;
  fileName?: string | null;
  mime?: string | null;
  source?: {
    table: "files" | "uploads";
    bucketField: "storage_bucket_id" | "bucket_id" | null;
    pathField: "storage_path" | "file_path";
  };
};

type CadPreviewResult = {
  signedUrl: string | null;
  fileName?: string | null;
  cadKind?: "step" | "stl" | "obj" | "glb" | null;
  storageSource?: { bucket: string; path: string; token?: string | null } | null;
  reason?: string;
};

function canonicalizeCadBucket(input: unknown): string {
  const raw = typeof input === "string" ? input.trim() : "";
  if (!raw) return "";
  if (raw === "cad-uploads") return "cad_uploads";
  if (raw === "cad_uploads") return "cad_uploads";
  if (raw === "cad-previews") return "cad_previews";
  if (raw === "cad_previews") return "cad_previews";
  return raw;
}

function shortLogId(): string {
  try {
    // eslint-disable-next-line no-restricted-globals
    const bytes = typeof crypto !== "undefined" && "getRandomValues" in crypto ? crypto.getRandomValues(new Uint8Array(5)) : null;
    if (bytes) {
      return Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    }
  } catch {
    // ignore
  }
  return Math.random().toString(16).slice(2, 10);
}

const DEFAULT_CAD_BUCKET = canonicalizeCadBucket(
  process.env.SUPABASE_CAD_BUCKET ||
    process.env.NEXT_PUBLIC_CAD_BUCKET ||
    process.env.NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET ||
    "cad_uploads",
);

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
        // Prefer canonical storage fields; fall back to legacy schema if needed.
        const queryNew = () =>
          supabaseServer
            .from("files")
            .select("storage_path,storage_bucket_id,filename,mime")
            .eq("quote_id", quote.id)
            .order("created_at", { ascending: true });
        const queryLegacy = () =>
          supabaseServer
            .from("files")
            .select("storage_path,bucket_id,filename,mime")
            .eq("quote_id", quote.id)
            .order("created_at", { ascending: true });

        const first = await queryNew();
        let data = first.data as FileStorageRow[] | null;
        let filesError = first.error;

        if (filesError && isMissingTableOrColumnError(filesError)) {
          const retry = await queryLegacy();
          data = retry.data as FileStorageRow[] | null;
          filesError = retry.error;
        }

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

  const normalized = normalizeBucketAndPath({
    bucket: candidate.bucketId ?? null,
    path: candidate.storagePath,
  });

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
  const signedBucket = canonicalizeCadBucket(normalized.bucket) || normalized.bucket;
  const signedPath = normalized.path;
  if (viewerUserId) {
    const shortId = shortLogId();
    const source = candidate.source ?? null;
    const used: "storage_bucket_id/storage_path" | "bucket_id/file_path" =
      source?.bucketField === "storage_bucket_id" || source?.pathField === "storage_path"
        ? "storage_bucket_id/storage_path"
        : "bucket_id/file_path";
    console.info("[portal-preview-sign]", {
      shortId,
      bucket: signedBucket,
      path: signedPath,
      used,
    });
  }
  const token = viewerUserId
    ? signPreviewToken({
        userId: viewerUserId,
        bucket: signedBucket,
        path: signedPath,
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
      bucket: signedBucket,
      path: signedPath,
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
    const canonicalPathValue = typeof file?.storage_path === "string" ? file.storage_path : null;
    const legacyPathValue = typeof (file as any)?.file_path === "string" ? ((file as any).file_path as string) : null;
    const storagePath = canonicalPathValue ?? legacyPathValue;
    if (!storagePath) return;

    // Prefer canonical storage fields when present; fall back to legacy.
    const hasCanonicalBucket = typeof file?.storage_bucket_id === "string" && file.storage_bucket_id.trim().length > 0;
    const hasLegacyBucket = typeof file?.bucket_id === "string" && file.bucket_id.trim().length > 0;
    const bucketId =
      hasCanonicalBucket && typeof file?.storage_path === "string" && file.storage_path
        ? file.storage_bucket_id
        : hasLegacyBucket
          ? file.bucket_id
          : (file.storage_bucket_id ?? file.bucket_id) ?? null;

    candidates.push({
      storagePath,
      bucketId: bucketId ?? null,
      fileName: file.filename,
      mime: file.mime,
      source: {
        table: "files",
        bucketField: hasCanonicalBucket ? "storage_bucket_id" : hasLegacyBucket ? "bucket_id" : null,
        pathField: canonicalPathValue ? "storage_path" : "file_path",
      },
    });
  });

  const uploadStoragePath =
    (typeof upload?.storage_path === "string" ? upload.storage_path : null) ??
    (typeof upload?.file_path === "string" ? upload.file_path : null);
  const uploadBucketId =
    (typeof upload?.storage_bucket_id === "string" ? upload.storage_bucket_id : null) ??
    (typeof upload?.bucket_id === "string" ? upload.bucket_id : null) ??
    null;

  if (uploadStoragePath) {
    const uploadHasCanonicalPath = typeof upload?.storage_path === "string" && upload.storage_path.trim().length > 0;
    const uploadHasCanonicalBucket = typeof upload?.storage_bucket_id === "string" && upload.storage_bucket_id.trim().length > 0;
    const uploadHasLegacyBucket = typeof upload?.bucket_id === "string" && upload.bucket_id.trim().length > 0;
    candidates.push({
      storagePath: uploadStoragePath,
      bucketId: uploadBucketId,
      fileName: upload?.file_name ?? null,
      source: {
        table: "uploads",
        bucketField: uploadHasCanonicalBucket ? "storage_bucket_id" : uploadHasLegacyBucket ? "bucket_id" : null,
        pathField: uploadHasCanonicalPath ? "storage_path" : "file_path",
      },
    });
  }

  return candidates;
}

function normalizeBucketAndPath(input: {
  bucket?: string | null;
  path?: string | null;
}): { bucket: string; path: string } | null {
  const rawBucket = typeof input.bucket === "string" ? input.bucket.trim() : "";
  const rawPath = typeof input.path === "string" ? input.path.trim() : "";
  if (!rawPath) return null;

  let bucket = rawBucket ? canonicalizeCadBucket(rawBucket) : null;
  let path = rawPath.replace(/^\/+/, "");
  // Collapse accidental double slashes inside paths.
  path = path.replace(/\/{2,}/g, "/");
  if (!path) return null;

  // If the path is already in `<bucket>/<objectKey>` form, infer bucket.
  // Only accept a small allowlist to avoid signing tokens for arbitrary buckets.
  if (!bucket) {
    const firstSegment = path.split("/")[0] ?? "";
    const allowedBuckets = new Set([
      DEFAULT_CAD_BUCKET,
      "cad_uploads",
      "cad-uploads",
      "cad_previews",
      "cad-previews",
      "cad",
    ]);
    if (firstSegment && allowedBuckets.has(firstSegment)) {
      bucket = canonicalizeCadBucket(firstSegment) || firstSegment;
      path = path.slice(firstSegment.length + 1);
    }
  }

  if (!bucket) bucket = DEFAULT_CAD_BUCKET;
  bucket = canonicalizeCadBucket(bucket) || bucket;
  // Hard guard: never return legacy hyphenated CAD buckets.
  if (bucket === "cad-uploads") bucket = "cad_uploads";
  if (bucket === "cad-previews") bucket = "cad_previews";

  const legacyPrefix =
    bucket === "cad_uploads" ? "cad-uploads" : bucket === "cad_previews" ? "cad-previews" : null;

  // Normalize away any accidental duplicated bucket prefixes (including repeated ones).
  while (path.startsWith(`${bucket}/`) || (legacyPrefix ? path.startsWith(`${legacyPrefix}/`) : false)) {
    const prefix = path.startsWith(`${bucket}/`) ? bucket : legacyPrefix!;
    path = path.slice(prefix.length + 1);
  }

  path = path.replace(/^\/+/, "");
  if (!path) return null;

  return { bucket, path };
}

export function extractFileNameFromPath(path: string): string | undefined {
  if (!path) return undefined;
  const segments = path.split("/");
  return segments[segments.length - 1] || undefined;
}
