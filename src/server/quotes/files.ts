import { supabaseServer } from "@/lib/supabaseServer";
import type { QuoteFileItem } from "@/app/admin/quotes/[id]/QuoteFilesCard";
import type { QuoteFileSource } from "./types";

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
};

export async function getQuoteFilePreviews(
  quote: QuoteFileSource,
  options?: QuoteFilePreviewOptions,
): Promise<QuoteFileItem[]> {
  try {
    const includeFilesTable = options?.includeFilesTable !== false;
    let files: FileStorageRow[] = [];
    if (includeFilesTable) {
      const { data, error: filesError } = await supabaseServer
        .from("files")
        .select("storage_path,bucket_id,filename,mime")
        .eq("quote_id", quote.id)
        .order("created_at", { ascending: true });

      if (filesError) {
        if (options?.onFilesError) {
          options.onFilesError(filesError);
        } else {
          console.error("Failed to load files for quote", quote.id, filesError);
        }
      } else {
        files = data ?? [];
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
        ? await getPreviewForCandidate(candidate, previewCache)
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
      const preview = await getPreviewForCandidate(candidate, previewCache);
      entries.push({
        id: `${candidate.storagePath}-${index}`,
        label: fallbackLabel,
        fileName: preview.fileName ?? fallbackLabel,
        signedUrl: preview.signedUrl,
        fallbackMessage: preview.reason,
      });
    }

    return entries;
  } catch (error) {
    console.error("Unexpected CAD preview error", error);
    return [];
  }
}

function extractFileNames(row: QuoteFileSource): string[] {
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
): Promise<CadPreviewResult> {
  const cacheKey = `${candidate.bucketId ?? "default"}:${candidate.storagePath}`;
  if (cache.has(cacheKey)) {
    return cache.get(cacheKey)!;
  }

  let result: CadPreviewResult;

  if (!isStlCandidate(candidate)) {
    result = {
      signedUrl: null,
      fileName:
        candidate.fileName ??
        extractFileNameFromPath(candidate.storagePath) ??
        undefined,
      reason: "Only STL files are supported for preview today.",
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
      fileName:
        candidate.fileName ??
        extractFileNameFromPath(candidate.storagePath) ??
        undefined,
      reason: "Missing storage path for CAD file.",
    };
    cache.set(cacheKey, result);
    return result;
  }

  const { data: signedData, error: signedError } = await supabaseServer.storage
    .from(normalized.bucket)
    .createSignedUrl(normalized.path, CAD_SIGNED_URL_TTL_SECONDS);

  if (signedError || !signedData?.signedUrl) {
    console.error("Failed to create CAD signed URL", signedError);
    result = {
      signedUrl: null,
      fileName:
        candidate.fileName ??
        extractFileNameFromPath(candidate.storagePath) ??
        undefined,
      reason: "Unable to generate CAD preview link right now.",
    };
    cache.set(cacheKey, result);
    return result;
  }

  result = {
    signedUrl: signedData.signedUrl,
    fileName:
      candidate.fileName ??
      extractFileNameFromPath(candidate.storagePath) ??
      undefined,
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

function isStlCandidate(candidate: CadFileCandidate): boolean {
  const fileName = candidate.fileName?.toLowerCase() ?? "";
  const path = candidate.storagePath.toLowerCase();
  const mime = candidate.mime?.toLowerCase() ?? "";

  return (
    fileName.endsWith(".stl") || path.endsWith(".stl") || mime.includes("stl")
  );
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
