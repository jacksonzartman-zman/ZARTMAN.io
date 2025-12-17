import AdmZip from "adm-zip";
import { supabaseServer } from "@/lib/supabaseServer";
import {
  isMissingTableOrColumnError,
  serializeSupabaseError,
} from "@/server/admin/logging";

export type QuoteUploadFileEntry = {
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
        "upload_id,path,filename,extension,size_bytes,is_from_archive,created_at",
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

