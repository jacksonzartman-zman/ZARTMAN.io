import AdmZip from "adm-zip";
import { randomBytes } from "node:crypto";
import { supabaseServer } from "@/lib/supabaseServer";
import {
  isMissingTableOrColumnError,
  serializeSupabaseError,
} from "@/server/admin/logging";

export type QuoteUploadFileEntry = {
  id: string;
  upload_id: string;
  path: string;
  filename: string;
  extension: string | null;
  size_bytes: number | null;
  is_from_archive: boolean;
  created_at: string | null;
};

export type QuoteUploadGroup = {
  uploadId: string;
  uploadFileName: string | null;
  uploadMimeType: string | null;
  uploadCreatedAt: string | null;
  entries: QuoteUploadFileEntry[];
};

export type StoredUploadFileForEnumeration = {
  originalName: string;
  sizeBytes: number;
  mimeType: string;
  buffer?: Buffer; // only retained for ZIP enumeration
};

const CAD_BUCKET =
  process.env.SUPABASE_CAD_BUCKET ||
  process.env.NEXT_PUBLIC_CAD_BUCKET ||
  process.env.NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET ||
  "cad";

const DEFAULT_UPLOAD_STATUS = "submitted";

const MAX_UPLOAD_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB (align with intake)

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
  dwg: "application/acad",
  dxf: "application/dxf",
};

const ADMIN_APPEND_ALLOWED_EXTENSIONS = new Set([
  "pdf",
  "dwg",
  "dxf",
  "step",
  "stp",
  "igs",
  "iges",
  "sldprt",
  "prt",
  "stl",
  "zip",
]);

type StoredCadFile = {
  originalName: string;
  sanitizedFileName: string;
  storageKey: string;
  storagePath: string;
  mimeType: string;
  sizeBytes: number;
  bucket: string;
  buffer?: Buffer; // retained only for ZIP enumeration
};

export async function appendFilesToQuoteUpload(args: {
  quoteId: string;
  files: File[];
}): Promise<{ uploadId: string; uploadFileIds: string[] }> {
  const quoteId = typeof args.quoteId === "string" ? args.quoteId.trim() : "";
  const files = Array.isArray(args.files) ? args.files.filter(Boolean) : [];
  if (!quoteId) {
    throw new Error("invalid_quote_id");
  }
  if (files.length === 0) {
    throw new Error("missing_files");
  }

  // Load quote metadata for the uploads row (keeps admin inbox + uploads UI consistent).
  const { data: quote, error: quoteError } = await supabaseServer
    .from("quotes")
    .select("id,customer_name,customer_email,company,status")
    .eq("id", quoteId)
    .maybeSingle<{
      id: string;
      customer_name: string | null;
      customer_email: string | null;
      company: string | null;
      status: string | null;
    }>();

  if (quoteError || !quote?.id) {
    if (!isMissingTableOrColumnError(quoteError)) {
      console.error("[quote upload files] quote lookup failed", {
        quoteId,
        error: serializeSupabaseError(quoteError),
      });
    }
    throw new Error("quote_not_found");
  }

  const storedFiles: StoredCadFile[] = [];

  for (const [index, file] of files.entries()) {
    if (!(file instanceof File)) {
      continue;
    }
    const originalName = typeof file.name === "string" ? file.name.trim() : "";
    if (!originalName) {
      throw new Error("invalid_file_name");
    }
    if (typeof file.size !== "number" || !Number.isFinite(file.size) || file.size <= 0) {
      throw new Error("empty_file");
    }
    if (file.size > MAX_UPLOAD_SIZE_BYTES) {
      throw new Error("file_too_large");
    }

    const extension = getFileExtension(originalName);
    if (!extension || !ADMIN_APPEND_ALLOWED_EXTENSIONS.has(extension)) {
      console.warn("[quote upload files] rejecting unsupported extension", {
        quoteId,
        fileName: originalName,
        extension: extension || null,
      });
      throw new Error("unsupported_file_type");
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    if (buffer.byteLength === 0) {
      throw new Error("empty_file_buffer");
    }

    const mimeType = detectMimeType(file, extension);
    const safeFileName = sanitizeFileName(originalName, extension);
    const storageKey = buildStorageKey(safeFileName);
    const storagePath = `${CAD_BUCKET}/${storageKey}`;
    const isZip =
      extension === "zip" ||
      (typeof mimeType === "string" && mimeType.toLowerCase().includes("zip"));

    const { error: storageError } = await supabaseServer.storage
      .from(CAD_BUCKET)
      .upload(storageKey, buffer, {
        cacheControl: "3600",
        contentType: mimeType,
        upsert: false,
      });

    if (storageError) {
      console.error("[quote upload files] storage upload failed", {
        quoteId,
        failingFile: originalName,
        fileIndex: index,
        error: serializeSupabaseError(storageError),
      });
      throw new Error("storage_upload_failed");
    }

    storedFiles.push({
      originalName,
      sanitizedFileName: safeFileName,
      storageKey,
      storagePath,
      mimeType,
      sizeBytes: file.size,
      bucket: CAD_BUCKET,
      buffer: isZip ? buffer : undefined,
    });
  }

  const primaryStoredFile = storedFiles[0];
  if (!primaryStoredFile) {
    throw new Error("no_stored_files");
  }

  const uploadStatus =
    typeof quote.status === "string" && quote.status.trim().length > 0
      ? quote.status.trim()
      : DEFAULT_UPLOAD_STATUS;
  const uploadName =
    typeof quote.customer_name === "string" && quote.customer_name.trim().length > 0
      ? quote.customer_name.trim()
      : "Zartman Admin";
  const uploadEmail =
    typeof quote.customer_email === "string" && quote.customer_email.trim().length > 0
      ? quote.customer_email.trim()
      : null;
  const uploadCompany =
    typeof quote.company === "string" && quote.company.trim().length > 0 ? quote.company.trim() : null;

  const { data: uploadRow, error: uploadError } = await supabaseServer
    .from("uploads")
    .insert({
      quote_id: quoteId,
      status: uploadStatus,
      file_name: primaryStoredFile.originalName,
      file_path: primaryStoredFile.storagePath,
      mime_type: primaryStoredFile.mimeType,
      name: uploadName,
      email: uploadEmail,
      company: uploadCompany,
    })
    .select("id")
    .single<{ id: string }>();

  if (uploadError || !uploadRow?.id) {
    console.error("[quote upload files] uploads insert failed", {
      quoteId,
      error: serializeSupabaseError(uploadError),
    });
    throw new Error("uploads_insert_failed");
  }

  const uploadId = uploadRow.id;

  // Insert into public.files (best effort in some envs, but required for “Uploads” UI parity).
  try {
    const rows = storedFiles.map((storedFile) => ({
      filename: storedFile.originalName,
      size_bytes: storedFile.sizeBytes,
      mime: storedFile.mimeType,
      storage_path: storedFile.storagePath,
      bucket_id: storedFile.bucket,
      quote_id: quoteId,
    }));
    const { error: filesError } = await supabaseServer.from("files").insert(rows);
    if (filesError) {
      if (isMissingTableOrColumnError(filesError)) {
        console.warn("[quote upload files] files schema missing; skipping file metadata", {
          quoteId,
          uploadId,
          error: serializeSupabaseError(filesError),
        });
      } else {
        console.error("[quote upload files] files insert failed", {
          quoteId,
          uploadId,
          error: serializeSupabaseError(filesError),
        });
      }
    }
  } catch (error) {
    console.error("[quote upload files] files insert crashed", {
      quoteId,
      uploadId,
      error: serializeSupabaseError(error),
    });
  }

  // Record per-file entries (including ZIP member enumeration) and return the inserted ids.
  const storedForEnumeration: StoredUploadFileForEnumeration[] = storedFiles.map((file) => ({
    originalName: file.originalName,
    sizeBytes: file.sizeBytes,
    mimeType: file.mimeType,
    buffer: file.buffer,
  }));

  const recordResult = await recordQuoteUploadFiles({
    quoteId,
    uploadId,
    storedFiles: storedForEnumeration,
  });

  if (!recordResult.ok) {
    throw new Error("quote_upload_files_record_failed");
  }

  const expectedPaths = Array.from(
    new Set(
      buildQuoteUploadFileRows({
        quoteId,
        uploadId,
        storedFiles: storedForEnumeration,
      }).map((row) => row.path),
    ),
  );

  if (expectedPaths.length === 0) {
    throw new Error("quote_upload_files_missing_paths");
  }

  const { data: uploadedEntries, error: uploadedEntriesError } = await supabaseServer
    .from("quote_upload_files")
    .select("id,path")
    .eq("quote_id", quoteId)
    .eq("upload_id", uploadId)
    .in("path", expectedPaths)
    .returns<Array<{ id: string; path: string }>>();

  if (uploadedEntriesError) {
    if (!isMissingTableOrColumnError(uploadedEntriesError)) {
      console.error("[quote upload files] failed to load inserted quote_upload_files rows", {
        quoteId,
        uploadId,
        error: serializeSupabaseError(uploadedEntriesError),
      });
    }
    throw new Error("quote_upload_files_select_failed");
  }

  const uploadFileIds =
    (uploadedEntries ?? [])
      .map((row) => (typeof row?.id === "string" ? row.id.trim() : ""))
      .filter((id) => id.length > 0) ?? [];

  if (uploadFileIds.length === 0) {
    throw new Error("quote_upload_files_missing_ids");
  }

  return { uploadId, uploadFileIds };
}

export async function recordQuoteUploadFiles(args: {
  quoteId: string;
  uploadId: string;
  storedFiles: StoredUploadFileForEnumeration[];
}): Promise<{ ok: boolean; recorded: boolean }> {
  const { quoteId, uploadId, storedFiles } = args;

  if (!quoteId || !uploadId) {
    return { ok: false, recorded: false };
  }

  const rows = buildQuoteUploadFileRows({ quoteId, uploadId, storedFiles });
  if (rows.length === 0) {
    return { ok: true, recorded: false };
  }

  try {
    const { error } = await supabaseServer
      .from("quote_upload_files")
      .upsert(rows, { onConflict: "upload_id,path" });

    if (error) {
      if (isMissingTableOrColumnError(error)) {
        console.warn("[quote upload files] schema missing; skipping", {
          quoteId,
          uploadId,
          error: serializeSupabaseError(error),
        });
        return { ok: true, recorded: false };
      }

      console.error("[quote upload files] upsert failed", {
        quoteId,
        uploadId,
        error: serializeSupabaseError(error),
      });
      return { ok: false, recorded: false };
    }

    return { ok: true, recorded: true };
  } catch (error) {
    console.error("[quote upload files] upsert crashed", {
      quoteId,
      uploadId,
      error: serializeSupabaseError(error),
    });
    return { ok: false, recorded: false };
  }
}

export async function loadQuoteUploadGroups(
  quoteId: string,
): Promise<QuoteUploadGroup[]> {
  if (typeof quoteId !== "string" || quoteId.trim().length === 0) {
    return [];
  }

  let fileEntries: QuoteUploadFileEntry[] = [];
  try {
    const { data, error } = await supabaseServer
      .from("quote_upload_files")
      .select(
        "id,upload_id,path,filename,extension,size_bytes,is_from_archive,created_at",
      )
      .eq("quote_id", quoteId)
      .order("created_at", { ascending: true })
      .returns<QuoteUploadFileEntry[]>();

    if (error) {
      if (isMissingTableOrColumnError(error)) {
        return [];
      }
      console.error("[quote upload files] failed to load entries", {
        quoteId,
        error: serializeSupabaseError(error),
      });
      return [];
    }

    fileEntries = Array.isArray(data) ? data : [];
  } catch (error) {
    console.error("[quote upload files] load crashed", {
      quoteId,
      error: serializeSupabaseError(error),
    });
    return [];
  }

  const uploadIds = Array.from(
    new Set(
      fileEntries
        .map((row) => (typeof row?.upload_id === "string" ? row.upload_id : ""))
        .filter((id) => id.trim().length > 0),
    ),
  );

  type UploadRow = {
    id: string;
    file_name: string | null;
    mime_type: string | null;
    created_at: string | null;
  };

  const uploadsById = new Map<string, UploadRow>();
  if (uploadIds.length > 0) {
    try {
      const { data, error } = await supabaseServer
        .from("uploads")
        .select("id,file_name,mime_type,created_at")
        .in("id", uploadIds)
        .returns<UploadRow[]>();

      if (!error && Array.isArray(data)) {
        data.forEach((row) => {
          if (row?.id) {
            uploadsById.set(row.id, row);
          }
        });
      }
    } catch {
      // best-effort; grouping can still render without upload metadata
    }
  }

  const byUploadId = new Map<string, QuoteUploadFileEntry[]>();
  for (const entry of fileEntries) {
    const uploadId = entry?.upload_id?.trim();
    if (!uploadId) continue;
    if (!byUploadId.has(uploadId)) {
      byUploadId.set(uploadId, []);
    }
    byUploadId.get(uploadId)!.push(entry);
  }

  return Array.from(byUploadId.entries()).map(([uploadId, entries]) => {
    const meta = uploadsById.get(uploadId) ?? null;
    return {
      uploadId,
      uploadFileName: meta?.file_name ?? null,
      uploadMimeType: meta?.mime_type ?? null,
      uploadCreatedAt: meta?.created_at ?? null,
      entries,
    };
  });
}

function buildQuoteUploadFileRows(args: {
  quoteId: string;
  uploadId: string;
  storedFiles: StoredUploadFileForEnumeration[];
}): Array<{
  quote_id: string;
  upload_id: string;
  path: string;
  filename: string;
  extension: string | null;
  size_bytes: number | null;
  is_from_archive: boolean;
}> {
  const { quoteId, uploadId, storedFiles } = args;

  const rows: Array<{
    quote_id: string;
    upload_id: string;
    path: string;
    filename: string;
    extension: string | null;
    size_bytes: number | null;
    is_from_archive: boolean;
  }> = [];

  for (const file of storedFiles) {
    const originalName = (file?.originalName ?? "").trim();
    if (!originalName) continue;

    const extension = extractExtension(originalName);
    const isZip =
      extension === "zip" ||
      (typeof file?.mimeType === "string" &&
        file.mimeType.toLowerCase().includes("zip"));

    if (isZip && file.buffer) {
      const zipEntries = enumerateZipEntries(file.buffer);
      for (const entry of zipEntries) {
        rows.push({
          quote_id: quoteId,
          upload_id: uploadId,
          path: entry.path,
          filename: entry.filename,
          extension: entry.extension,
          size_bytes: entry.size_bytes,
          is_from_archive: true,
        });
      }
      continue;
    }

    rows.push({
      quote_id: quoteId,
      upload_id: uploadId,
      path: originalName,
      filename: basename(originalName),
      extension,
      size_bytes:
        typeof file.sizeBytes === "number" && Number.isFinite(file.sizeBytes)
          ? file.sizeBytes
          : null,
      is_from_archive: false,
    });
  }

  return rows;
}

function enumerateZipEntries(buffer: Buffer): Array<{
  path: string;
  filename: string;
  extension: string | null;
  size_bytes: number | null;
}> {
  const rows: Array<{
    path: string;
    filename: string;
    extension: string | null;
    size_bytes: number | null;
  }> = [];

  const zip = new AdmZip(buffer);
  const entries = zip.getEntries();

  for (const entry of entries) {
    const rawPath =
      typeof entry.entryName === "string" ? entry.entryName : String(entry.entryName);
    const normalizedPath = rawPath.replace(/^\/+/, "").trim();
    if (!normalizedPath) continue;
    if ((entry as { isDirectory?: boolean }).isDirectory) continue;
    if (normalizedPath.endsWith("/")) continue;

    const filename = basename(normalizedPath);
    if (!filename) continue;

    const size =
      typeof (entry as any)?.header?.size === "number"
        ? ((entry as any).header.size as number)
        : null;

    rows.push({
      path: normalizedPath,
      filename,
      extension: extractExtension(filename),
      size_bytes: typeof size === "number" && Number.isFinite(size) ? size : null,
    });
  }

  return rows;
}

function basename(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const parts = normalized.split("/");
  return (parts[parts.length - 1] ?? "").trim();
}

function extractExtension(fileName: string): string | null {
  const normalized = (fileName ?? "").trim().toLowerCase();
  if (!normalized) return null;
  const parts = normalized.split(".");
  if (parts.length < 2) return null;
  const ext = parts[parts.length - 1] ?? "";
  return ext ? ext : null;
}

function getFileExtension(fileName: string): string {
  const ext = extractExtension(fileName);
  return ext ?? "";
}

function sanitizeFileName(originalName: string, preferredExtension?: string) {
  const fallbackBase = "cad-file";
  const fallbackExtension =
    typeof preferredExtension === "string" && preferredExtension.length > 0
      ? preferredExtension
      : "stl";

  if (typeof originalName !== "string" || originalName.trim().length === 0) {
    return `${fallbackBase}.${fallbackExtension}`;
  }

  const normalized = originalName
    .trim()
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();

  if (!normalized) {
    return `${fallbackBase}.${fallbackExtension}`;
  }

  if (normalized.includes(".")) {
    return normalized;
  }

  return `${normalized}.${fallbackExtension}`;
}

function buildStorageKey(fileName: string): string {
  const timestamp = Date.now();
  const random = randomBytes(6).toString("hex");
  return `uploads/${timestamp}-${random}-${fileName}`;
}

function detectMimeType(file: File, extension?: string): string {
  if (file.type && file.type.trim().length > 0) {
    return file.type;
  }
  const normalizedExtension = extension || getFileExtension(file.name);
  return MIME_BY_EXTENSION[normalizedExtension] || "application/octet-stream";
}

