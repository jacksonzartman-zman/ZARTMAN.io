import { supabaseServer } from "@/lib/supabaseServer";
import type { QuoteFileItem } from "@/app/admin/quotes/[id]/QuoteFilesCard";
import { serializeSupabaseError, isMissingTableOrColumnError } from "@/server/admin/logging";
import type { QuoteFileMeta, QuoteFileSource } from "./types";
import { classifyCadFileType } from "@/lib/cadRendering";
import { signPreviewToken } from "@/server/cadPreviewToken";

type FileStorageRow = {
  id?: string | null;
  quote_id?: string | null;
  storage_path: string | null;
  // Legacy column name (some deployments).
  bucket_id?: string | null;
  // Canonical column name (preferred).
  storage_bucket_id?: string | null;
  // Some deployments used `file_path` instead of `storage_path`.
  file_path?: string | null;
  filename: string | null;
  mime: string | null;
  created_at?: string | null;
};

export type UploadFileReference = {
  // Deprecated: legacy upload references are intentionally ignored for portal previews.
  // Kept exported because other modules may still import this type.
  storage_bucket_id?: string | null;
  storage_path?: string | null;
  bucket_id?: string | null;
  file_path?: string | null;
  file_name: string | null;
  mime_type?: string | null;
  id?: string | null;
};

type CadFileCandidate = {
  quoteFileId?: string | null;
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

function canonicalizeCadBucket(input: unknown): string {
  const raw = typeof input === "string" ? input.trim() : "";
  if (!raw) return "";
  if (raw === "cad-uploads") return "cad_uploads";
  if (raw === "cad_uploads") return "cad_uploads";
  if (raw === "cad-previews") return "cad_previews";
  if (raw === "cad_previews") return "cad_previews";
  return raw;
}

function isAllowedCadBucket(bucket: string): bucket is "cad_uploads" | "cad_previews" {
  return bucket === "cad_uploads" || bucket === "cad_previews";
}

const CAD_SIGNED_URL_TTL_SECONDS = 60 * 60;

export type QuoteFilePreviewOptions = {
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
    const files = await loadCanonicalFilesForQuote(quote.id, { onError: options?.onFilesError });
    const candidates = gatherCadCandidates(files);
    const previewCache = new Map<string, CadPreviewResult>();

    const entries: QuoteFileItem[] = [];
    for (const candidate of candidates) {
      const label =
        candidate.fileName ??
        extractFileNameFromPath(candidate.storagePath) ??
        "File";
      const preview = await getPreviewForCandidate(candidate, previewCache, quote.id, options);
      entries.push({
        id: candidate.quoteFileId ?? `${candidate.storagePath}`,
        label,
        fileName: preview.fileName ?? label,
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

export function buildQuoteFilesFromRow(
  row: Pick<QuoteFileSource, "file_name" | "file_names" | "upload_file_names">,
): QuoteFileMeta[] {
  // NOTE: This returns *declared* filenames (from quote/upload metadata) and is suitable
  // for display-only contexts (admin lists, notifications, etc).
  //
  // Portal file access / preview must use canonical `files_valid` / `files` rows instead
  // (see `getQuoteFilePreviews`), so "ghost" filenames never become clickable file cards.
  const names = extractFileNames(row);
  return names.map((filename) => ({ filename }));
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

async function getPreviewForCandidate(
  candidate: CadFileCandidate,
  cache: Map<string, CadPreviewResult>,
  quoteId: string,
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
  const quoteFileId =
    typeof candidate.quoteFileId === "string" && candidate.quoteFileId.trim()
      ? candidate.quoteFileId.trim()
      : null;

  if (viewerUserId && !quoteFileId) {
    result = {
      signedUrl: null,
      fileName: inferredFileName ?? undefined,
      cadKind: cadType.type,
      storageSource: null,
      reason: "Preview is unavailable for this file.",
    };
    cache.set(cacheKey, result);
    return result;
  }

  const exp = Math.floor(Date.now() / 1000) + CAD_SIGNED_URL_TTL_SECONDS;
  const signedBucket = canonicalizeCadBucket(normalized.bucket) || normalized.bucket;
  let signedPath = normalized.path;
  const token = viewerUserId
    ? signPreviewToken({
        userId: viewerUserId,
        viewerContext: { userId: viewerUserId },
        exp,
        quoteId,
        quoteFileId,
        filename: inferredFileName ?? null,
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

function gatherCadCandidates(
  files: FileStorageRow[],
): CadFileCandidate[] {
  const candidates: CadFileCandidate[] = [];

  files?.forEach((file) => {
    const quoteFileId = typeof file?.id === "string" ? file.id.trim() : "";
    const canonicalPathValue = typeof file?.storage_path === "string" ? file.storage_path : null;
    const legacyPathValue = typeof (file as any)?.file_path === "string" ? ((file as any).file_path as string) : null;
    const storagePath = canonicalPathValue ?? legacyPathValue;
    if (!quoteFileId || !storagePath) return;

    // Prefer canonical storage fields when present; fall back to legacy.
    const hasCanonicalBucket = typeof file?.storage_bucket_id === "string" && file.storage_bucket_id.trim().length > 0;
    const hasLegacyBucket = typeof file?.bucket_id === "string" && file.bucket_id.trim().length > 0;
    const bucketId =
      hasCanonicalBucket && typeof file?.storage_path === "string" && file.storage_path
        ? file.storage_bucket_id
        : hasLegacyBucket
          ? file.bucket_id
          : (file.storage_bucket_id ?? file.bucket_id) ?? null;
    if (!bucketId || !bucketId.trim()) return;

    candidates.push({
      quoteFileId,
      storagePath,
      bucketId: bucketId ?? null,
      fileName: file.filename,
      mime: file.mime,
    });
  });

  return candidates;
}

function normalizeBucketAndPath(input: {
  bucket?: string | null;
  path?: string | null;
}): { bucket: string; path: string } | null {
  const rawBucket = typeof input.bucket === "string" ? input.bucket.trim() : "";
  const rawPath = typeof input.path === "string" ? input.path.trim() : "";
  if (!rawPath) return null;

  // Path normalization rules (minimal):
  // - strip leading slash
  // - collapse accidental double slashes
  // - do NOT infer / relocate into other prefixes
  let path = rawPath.replace(/^\/+/, "");
  path = path.replace(/\/{2,}/g, "/");
  if (!path) return null;

  // Bucket normalization rules:
  // - canonical-only: caller must provide a bucket (no guessing / defaults)
  // - allow underscore vs hyphen aliases only
  const bucket = rawBucket ? canonicalizeCadBucket(rawBucket) : "";
  if (!bucket || !isAllowedCadBucket(bucket)) return null;

  // Strip a duplicated bucket prefix only when it matches the resolved bucket.
  const legacyPrefix =
    bucket === "cad_uploads" ? "cad-uploads" : bucket === "cad_previews" ? "cad-previews" : null;
  if (path.startsWith(`${bucket}/`)) {
    path = path.slice(bucket.length + 1);
  } else if (legacyPrefix && path.startsWith(`${legacyPrefix}/`)) {
    path = path.slice(legacyPrefix.length + 1);
  }

  path = path.replace(/^\/+/, "");
  path = path.replace(/\/{2,}/g, "/");
  if (!path) return null;

  return { bucket, path };
}

export function extractFileNameFromPath(path: string): string | undefined {
  if (!path) return undefined;
  const segments = path.split("/");
  return segments[segments.length - 1] || undefined;
}

async function loadCanonicalFilesForQuote(
  quoteId: string,
  options?: { onError?: (error: unknown) => void },
): Promise<FileStorageRow[]> {
  const normalizedQuoteId = typeof quoteId === "string" ? quoteId.trim() : "";
  if (!normalizedQuoteId) return [];
  const logEnabled = process.env.LOG_CANONICAL_QUOTE_FILES === "1";

  const tryLoad = async (table: "files_valid" | "files"): Promise<FileStorageRow[] | null> => {
    try {
      const selectVariants = [
        // Canonical column names.
        "id,quote_id,filename,mime,created_at,storage_bucket_id,storage_path",
        "id,quote_id,filename,created_at,storage_bucket_id,storage_path",
        // Legacy bucket column name.
        "id,quote_id,filename,mime,created_at,bucket_id,storage_path",
        "id,quote_id,filename,created_at,bucket_id,storage_path",
        // Legacy path column name.
        "id,quote_id,filename,mime,created_at,storage_bucket_id,file_path",
        "id,quote_id,filename,created_at,storage_bucket_id,file_path",
        "id,quote_id,filename,mime,created_at,bucket_id,file_path",
        "id,quote_id,filename,created_at,bucket_id,file_path",
      ] as const;

      for (const columns of selectVariants) {
        const result = await supabaseServer
          .from(table)
          // NOTE: the supabase-js select-string type parser can't narrow a dynamic
          // select list, so we provide an explicit return type.
          .select(columns as any)
          .eq("quote_id", normalizedQuoteId)
          .order("created_at", { ascending: true })
          .returns<FileStorageRow[]>();

        if (result.error) {
          if (isMissingTableOrColumnError(result.error)) {
            // Try the next select shape (or conclude the table doesn't exist).
            continue;
          }

          console.error(`[quote files] failed to load ${table}`, {
            quoteId: normalizedQuoteId,
            error: serializeSupabaseError(result.error),
          });
          options?.onError?.(result.error);
          return [];
        }

        return result.data ?? [];
      }

      // If every variant failed with "missing schema", treat as table missing.
      return null;
    } catch (error) {
      if (isMissingTableOrColumnError(error)) {
        return null;
      }
      console.error(`[quote files] load ${table} crashed`, {
        quoteId: normalizedQuoteId,
        error: serializeSupabaseError(error),
      });
      options?.onError?.(error);
      return [];
    }
  };

  const fromValid = await tryLoad("files_valid");
  if (logEnabled) {
    console.log("[quote files] canonical load", {
      quoteId: normalizedQuoteId,
      client: "supabaseServer(service-role)",
      table: "files_valid",
      count: Array.isArray(fromValid) ? fromValid.length : null,
    });
  }
  if (Array.isArray(fromValid) && fromValid.length > 0) return fromValid;

  const fromFiles = await tryLoad("files");
  if (logEnabled) {
    console.log("[quote files] canonical load", {
      quoteId: normalizedQuoteId,
      client: "supabaseServer(service-role)",
      table: "files",
      count: Array.isArray(fromFiles) ? fromFiles.length : null,
    });
  }
  if (Array.isArray(fromFiles)) return fromFiles;

  return [];
}
