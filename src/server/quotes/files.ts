import { supabaseServer } from "@/lib/supabaseServer";
import type { QuoteFileItem } from "@/app/admin/quotes/[id]/QuoteFilesCard";
import { serializeSupabaseError, isMissingTableOrColumnError } from "@/server/admin/logging";
import type { QuoteFileMeta, QuoteFileSource } from "./types";
import { classifyCadFileType } from "@/lib/cadRendering";
import { signPreviewToken } from "@/server/cadPreviewToken";

type FileStorageRow = {
  id?: string | null;
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
  id?: string | null;
};

type CadFileCandidate = {
  quoteFileId?: string | null;
  storagePath: string;
  bucketId?: string | null;
  fileName?: string | null;
  mime?: string | null;
  source?: {
    table: "files" | "uploads";
    bucketField: "storage_bucket_id" | "bucket_id" | null;
    pathField: "storage_path" | "file_path";
    usedFieldNames: string[];
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

function isAllowedCadBucket(bucket: string): bucket is "cad_uploads" | "cad_previews" {
  return bucket === "cad_uploads" || bucket === "cad_previews";
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
        // IMPORTANT: Do not reference non-existent columns in select lists.
        // Use `*` and normalize in-code across schema variants.
        const result = await supabaseServer
          .from("files")
          .select("*")
          .eq("quote_id", quote.id)
          .order("created_at", { ascending: true });

        const data = result.data as FileStorageRow[] | null;
        const filesError = result.error;

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
      // IMPORTANT: Do not reference non-existent columns in select lists.
      // Use `*` and normalize in-code across schema variants.
      const first = await supabaseServer
        .from("uploads")
        .select("*")
        .eq("id", quote.upload_id)
        .maybeSingle<UploadFileReference>();

      const uploadData = first.data as UploadFileReference | null;
      const uploadError = first.error;

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
        ? await getPreviewForCandidate(candidate, previewCache, quote.id, options)
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
      const preview = await getPreviewForCandidate(candidate, previewCache, quote.id, options);
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
  const exp = Math.floor(Date.now() / 1000) + CAD_SIGNED_URL_TTL_SECONDS;
  const signedBucket = canonicalizeCadBucket(normalized.bucket) || normalized.bucket;
  let signedPath = normalized.path;
  const pathBeforeProbe = signedPath;
  if (viewerUserId) {
    const shortId = shortLogId();
    const source = candidate.source ?? null;
    const quoteFileId =
      typeof candidate.quoteFileId === "string" && candidate.quoteFileId.trim()
        ? candidate.quoteFileId.trim()
        : null;
    const usedFieldNames = Array.isArray(source?.usedFieldNames) ? source!.usedFieldNames : [];
    const filename = inferredFileName ?? null;
    const probeEnabled = process.env.PORTAL_PREVIEW_SIGN_PROBE === "1";
    let probe: ProbeMatchResult | null = null;
    if (probeEnabled) {
      probe = await probeStorageForKeyMatch({
        shortId,
        quoteId,
        quoteFileId,
        bucket: signedBucket,
        path: signedPath,
        filename,
      });
      if (probe.matchedKey && probe.matchCount === 1) {
        signedPath = probe.matchedKey;
      }
    }

    console.info("[portal-preview-sign]", {
      shortId,
      quoteId,
      quoteFileId,
      bucket: signedBucket,
      path: signedPath,
      pathBeforeProbe: probeEnabled ? pathBeforeProbe : undefined,
      usedFieldNames,
      filename,
    });
  }
  const token = viewerUserId
    ? signPreviewToken({
        userId: viewerUserId,
        bucket: signedBucket,
        path: signedPath,
        exp,
        quoteId,
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

    const usedFieldNames: string[] = [];
    if (hasCanonicalBucket) usedFieldNames.push("files.storage_bucket_id");
    else if (hasLegacyBucket) usedFieldNames.push("files.bucket_id");
    usedFieldNames.push(canonicalPathValue ? "files.storage_path" : "files.file_path");

    candidates.push({
      quoteFileId: typeof file?.id === "string" ? file.id : null,
      storagePath,
      bucketId: bucketId ?? null,
      fileName: file.filename,
      mime: file.mime,
      source: {
        table: "files",
        bucketField: hasCanonicalBucket ? "storage_bucket_id" : hasLegacyBucket ? "bucket_id" : null,
        pathField: canonicalPathValue ? "storage_path" : "file_path",
        usedFieldNames,
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
    const usedFieldNames: string[] = [];
    if (uploadHasCanonicalBucket) usedFieldNames.push("uploads.storage_bucket_id");
    else if (uploadHasLegacyBucket) usedFieldNames.push("uploads.bucket_id");
    usedFieldNames.push(uploadHasCanonicalPath ? "uploads.storage_path" : "uploads.file_path");
    candidates.push({
      quoteFileId: typeof upload?.id === "string" ? upload.id : null,
      storagePath: uploadStoragePath,
      bucketId: uploadBucketId,
      fileName: upload?.file_name ?? null,
      source: {
        table: "uploads",
        bucketField: uploadHasCanonicalBucket ? "storage_bucket_id" : uploadHasLegacyBucket ? "bucket_id" : null,
        pathField: uploadHasCanonicalPath ? "storage_path" : "file_path",
        usedFieldNames,
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

  // Path normalization rules:
  // - trim leading slash only
  // - collapse accidental double slashes
  // - do NOT infer or relocate into "uploads/" (caller must supply real object key)
  let path = rawPath.replace(/^\/+/, "");
  path = path.replace(/\/{2,}/g, "/");
  if (!path) return null;

  let bucket = rawBucket ? canonicalizeCadBucket(rawBucket) : "";

  const firstSegment = (path.split("/")[0] ?? "").trim();
  const firstSegmentCanonical = canonicalizeCadBucket(firstSegment);

  // If a known CAD bucket prefix exists in the path, prefer it.
  // This rescues cases where DB stored `bucket/path` but bucket column is missing/mismatched.
  if (firstSegmentCanonical && isAllowedCadBucket(firstSegmentCanonical)) {
    if (!bucket || !isAllowedCadBucket(bucket)) {
      bucket = firstSegmentCanonical;
    }
    if (bucket === firstSegmentCanonical) {
      path = path.slice(firstSegment.length + 1);
    }
  }

  // Final bucket resolution: constrain to portal CAD buckets only.
  if (!bucket || !isAllowedCadBucket(bucket)) {
    const fallback = canonicalizeCadBucket(DEFAULT_CAD_BUCKET);
    bucket = isAllowedCadBucket(fallback) ? fallback : "cad_uploads";
  }

  // Strip an exact bucket prefix if present (supports accidental duplication like bucket/bucket/...).
  const legacyPrefix = bucket === "cad_uploads" ? "cad-uploads" : bucket === "cad_previews" ? "cad-previews" : null;
  while (path.startsWith(`${bucket}/`) || (legacyPrefix ? path.startsWith(`${legacyPrefix}/`) : false)) {
    const prefix = path.startsWith(`${bucket}/`) ? bucket : legacyPrefix!;
    path = path.slice(prefix.length + 1);
    path = path.replace(/^\/+/, "");
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

type ProbeMatchResult = {
  triedPrefixes: string[];
  matchCount: number;
  matchedKey: string | null;
};

async function probeStorageForKeyMatch(input: {
  shortId: string;
  quoteId: string;
  quoteFileId: string | null;
  bucket: string;
  path: string;
  filename: string | null;
}): Promise<ProbeMatchResult> {
  // Safety: never probe in prod unless explicitly enabled.
  if (process.env.NODE_ENV === "production" && process.env.PORTAL_PREVIEW_SIGN_PROBE !== "1") {
    return { triedPrefixes: [], matchCount: 0, matchedKey: null };
  }
  if (!isAllowedCadBucket(input.bucket)) {
    return { triedPrefixes: [], matchCount: 0, matchedKey: null };
  }

  const quoteId = typeof input.quoteId === "string" ? input.quoteId.trim() : "";
  const basename = extractFileNameFromPath(input.path) ?? "";
  const filenameHint = (input.filename ?? basename).trim();
  const needle = filenameHint.toLowerCase();

  const prefixes: string[] = ["uploads"];
  if (quoteId) {
    prefixes.push(
      `quote_uploads/${quoteId}`,
      `quote_uploads/${quoteId}/uploads`,
      `quotes/${quoteId}`,
      `quotes/${quoteId}/uploads`,
    );
  }

  const triedPrefixes: string[] = [];
  const matches: string[] = [];
  try {
    for (const prefix of prefixes) {
      triedPrefixes.push(prefix);
      const { data, error } = await supabaseServer.storage.from(input.bucket).list(prefix, {
        limit: 50,
        offset: 0,
        sortBy: { column: "name", order: "asc" },
      });
      if (error) {
        console.info("[portal-preview-sign-probe]", {
          shortId: input.shortId,
          quoteId,
          quoteFileId: input.quoteFileId,
          bucket: input.bucket,
          triedPrefixes,
          prefix,
          error: serializeSupabaseError(error),
        });
        continue;
      }
      const items = Array.isArray(data) ? data : [];
      for (const it of items as any[]) {
        const name = typeof it?.name === "string" ? it.name : "";
        if (!name) continue;
        const fullKey = `${prefix}/${name}`.replace(/\/{2,}/g, "/");
        if (needle && fullKey.toLowerCase().includes(needle)) {
          matches.push(fullKey);
        }
      }
    }

    const uniqueMatches = Array.from(new Set(matches));
    const matchedKey = uniqueMatches.length === 1 ? uniqueMatches[0]! : null;

    console.info("[portal-preview-sign-probe]", {
      shortId: input.shortId,
      quoteId,
      quoteFileId: input.quoteFileId,
      bucket: input.bucket,
      triedPrefixes,
      matchCount: uniqueMatches.length,
      matchedKey,
      filename: filenameHint || null,
    });

    return {
      triedPrefixes,
      matchCount: uniqueMatches.length,
      matchedKey,
    };
  } catch (err) {
    console.info("[portal-preview-sign-probe]", {
      shortId: input.shortId,
      quoteId,
      quoteFileId: input.quoteFileId,
      bucket: input.bucket,
      triedPrefixes,
      probeFailed: true,
      error: serializeSupabaseError(err),
    });
    return { triedPrefixes, matchCount: 0, matchedKey: null };
  }
}
