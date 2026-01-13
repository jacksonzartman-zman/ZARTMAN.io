import { supabaseServer } from "@/lib/supabaseServer";
import { schemaGate } from "@/server/db/schemaContract";
import { isMissingTableOrColumnError, serializeSupabaseError, warnOnce } from "@/server/db/schemaErrors";

export type OutboundEmailAttachment = {
  filename: string;
  contentType: string;
  contentBase64: string;
  sizeBytes: number;
  /**
   * Best-effort attribution to a canonical file row (files_valid/files) or legacy upload row.
   * Never required; used only for metadata/audit.
   */
  fileId?: string | null;
};

const WARN_PREFIX = "[email_attachments]";

const MAX_FILES = 5;
const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10MB
const MAX_TOTAL_BYTES = 15 * 1024 * 1024; // 15MB

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeId(value: unknown): string {
  return normalizeString(value);
}

function normalizePath(value: unknown): string {
  const raw = normalizeString(value);
  return raw.replace(/^\/+/, "");
}

function safeFilename(value: unknown, fallback: string): string {
  const raw = typeof value === "string" ? value.trim() : "";
  const basename = raw.replace(/\\/g, "/").split("/").filter(Boolean).slice(-1)[0] ?? "";
  const normalized = basename
    .normalize("NFKD")
    .replace(/[^\w.\- ]+/g, "-")
    .replace(/\s+/g, " ")
    .replace(/-+/g, "-")
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 120);
  return normalized || fallback;
}

function contentTypeOrDefault(value: unknown): string {
  const v = normalizeString(value);
  return v || "application/octet-stream";
}

function looksLikeUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

type InboundAttachmentPointer = {
  filename: string;
  storageBucketId: string;
  storagePath: string;
  sizeBytes: number | null;
  mime: string | null;
  quoteFileId?: string | null;
};

async function loadLatestInboundAttachmentPointers(args: {
  quoteId: string;
}): Promise<InboundAttachmentPointer[]> {
  const quoteId = normalizeId(args.quoteId);
  if (!quoteId) return [];

  const supported = await schemaGate({
    enabled: true,
    relation: "quote_messages",
    requiredColumns: ["quote_id", "metadata"],
    warnPrefix: WARN_PREFIX,
    warnKey: "email_attachments:quote_messages_metadata",
  });
  if (!supported) return [];

  try {
    const run = async (orderBy: "created_at" | "id") => {
      const select = orderBy === "created_at" ? "id,created_at,metadata" : "id,metadata";
      const q = supabaseServer
        .from("quote_messages")
        .select(select)
        .eq("quote_id", quoteId)
        .order(orderBy, { ascending: false })
        .limit(12) as any;
      return (await q) as { data?: any[]; error?: unknown };
    };

    let result = await run("created_at");
    if (result.error && isMissingTableOrColumnError(result.error)) {
      result = await run("id");
    }
    if (result.error) {
      return [];
    }

    const rows = Array.isArray(result.data) ? result.data : [];
    for (const row of rows) {
      const meta = row?.metadata && typeof row.metadata === "object" ? (row.metadata as any) : null;
      const via = typeof meta?.via === "string" ? meta.via : "";
      const isInbound = via.startsWith("email_inbound_");
      const attachmentsRaw = meta?.attachments;
      if (!isInbound || !Array.isArray(attachmentsRaw) || attachmentsRaw.length === 0) continue;

      const pointers: InboundAttachmentPointer[] = [];
      for (const item of attachmentsRaw) {
        if (!item || typeof item !== "object") continue;
        const a = item as Record<string, unknown>;
        const filename = safeFilename(a.filename, "attachment");
        const bucket = normalizeId(a.storageBucketId);
        const path = normalizePath(a.storagePath);
        if (!bucket || !path) continue;

        pointers.push({
          filename,
          storageBucketId: bucket,
          storagePath: path,
          sizeBytes: typeof a.sizeBytes === "number" ? a.sizeBytes : null,
          mime: typeof a.mime === "string" ? a.mime : null,
          quoteFileId: typeof a.quoteFileId === "string" ? a.quoteFileId : null,
        });
      }
      return pointers;
    }

    return [];
  } catch {
    return [];
  }
}

type CanonicalFileRow = {
  id: string;
  filename: string | null;
  mime: string | null;
  size_bytes: number | null;
  bucket_id: string | null;
  storage_path: string | null;
};

async function loadCanonicalFilesForQuote(args: {
  quoteId: string;
  fileIds?: string[] | null;
}): Promise<CanonicalFileRow[]> {
  const quoteId = normalizeId(args.quoteId);
  if (!quoteId) return [];
  const requested = Array.isArray(args.fileIds) ? args.fileIds.map((v) => normalizeId(v)).filter(Boolean) : null;

  const tryFrom = async (relation: "files_valid_compat" | "files_valid" | "files") => {
    const supported = await schemaGate({
      enabled: true,
      relation,
      requiredColumns: ["id", "quote_id", "filename", "bucket_id", "storage_path"],
      warnPrefix: WARN_PREFIX,
      warnKey: `email_attachments:${relation}`,
    });
    if (!supported) return [] as CanonicalFileRow[];

    try {
      let query = supabaseServer
        .from(relation)
        .select("id,filename,mime,size_bytes,bucket_id,storage_path")
        .eq("quote_id", quoteId) as any;

      if (requested && requested.length > 0) {
        // Only allow ids that look like canonical UUIDs when targeting canonical surfaces.
        const filtered = requested.filter(looksLikeUuid).slice(0, 25);
        if (filtered.length === 0) return [];
        query = query.in("id", filtered);
      } else {
        query = query.order("created_at", { ascending: false }).limit(10);
      }

      const { data, error } = (await query) as { data?: unknown; error?: unknown };
      if (error) return [];
      const rows = Array.isArray(data) ? (data as any[]) : [];
      return rows
        .map((row) => ({
          id: normalizeId(row?.id),
          filename: typeof row?.filename === "string" ? row.filename : null,
          mime: typeof row?.mime === "string" ? row.mime : null,
          size_bytes: typeof row?.size_bytes === "number" ? row.size_bytes : null,
          bucket_id: typeof row?.bucket_id === "string" ? row.bucket_id : null,
          storage_path: typeof row?.storage_path === "string" ? row.storage_path : null,
        }))
        .filter((row) => row.id && row.bucket_id && row.storage_path);
    } catch {
      return [];
    }
  };

  // Prefer the drift-tolerant view, then fall back.
  const compat = await tryFrom("files_valid_compat");
  if (compat.length > 0 || requested) return compat;

  const valid = await tryFrom("files_valid");
  if (valid.length > 0) return valid;

  return tryFrom("files");
}

type LegacyUploadRow = {
  id: string;
  filename: string | null;
  extension: string | null;
  is_from_archive: boolean;
  upload_id: string;
};

async function loadLegacyUploads(args: {
  quoteId: string;
  fileIds?: string[] | null;
}): Promise<Array<{ id: string; filename: string; bucket: string; path: string; sizeBytes?: number | null; mime?: string | null }>> {
  const quoteId = normalizeId(args.quoteId);
  if (!quoteId) return [];

  const requested = Array.isArray(args.fileIds) ? args.fileIds.map((v) => normalizeId(v)).filter(Boolean) : null;
  if (!requested || requested.length === 0) {
    return [];
  }

  const hasUploadsSchema = await schemaGate({
    enabled: true,
    relation: "quote_upload_files",
    requiredColumns: ["id", "upload_id", "filename", "extension", "is_from_archive", "quote_id"],
    warnPrefix: WARN_PREFIX,
    warnKey: "email_attachments:quote_upload_files",
  });
  if (!hasUploadsSchema) return [];

  const hasUploadsTable = await schemaGate({
    enabled: true,
    relation: "uploads",
    requiredColumns: ["id", "file_path"],
    warnPrefix: WARN_PREFIX,
    warnKey: "email_attachments:uploads",
  });
  if (!hasUploadsTable) return [];

  try {
    const ids = requested.slice(0, 25);
    const { data, error } = await supabaseServer
      .from("quote_upload_files")
      .select("id,upload_id,filename,extension,is_from_archive")
      .eq("quote_id", quoteId)
      .in("id", ids)
      .returns<LegacyUploadRow[]>();
    if (error) return [];

    const rows = Array.isArray(data) ? data : [];
    const nonArchive = rows.filter((r) => r && r.id && r.upload_id && !r.is_from_archive);
    if (nonArchive.length === 0) return [];

    const uploadIds = Array.from(new Set(nonArchive.map((r) => r.upload_id))).slice(0, 50);
    const uploadRows = await supabaseServer
      .from("uploads")
      .select("id,file_path")
      .in("id", uploadIds)
      .returns<Array<{ id: string; file_path: string | null }>>();
    if (uploadRows.error) return [];

    const filePathByUploadId = new Map<string, string>();
    for (const u of uploadRows.data ?? []) {
      const id = normalizeId(u?.id);
      const filePath = normalizePath(u?.file_path ?? "");
      if (id && filePath) filePathByUploadId.set(id, filePath);
    }

    const out: Array<{ id: string; filename: string; bucket: string; path: string }> = [];
    for (const row of nonArchive) {
      const filePath = filePathByUploadId.get(row.upload_id) ?? "";
      if (!filePath) continue;
      // uploads.file_path may be stored as "bucket/key" or just "key".
      const parts = filePath.split("/").filter(Boolean);
      if (parts.length < 2) continue;
      const bucket = parts[0]!;
      const path = parts.slice(1).join("/");
      const filename = safeFilename(row.filename ?? "attachment", "attachment");
      out.push({ id: row.id, filename, bucket, path });
    }

    return out;
  } catch {
    return [];
  }
}

async function blobToBuffer(blob: Blob): Promise<Buffer> {
  const ab = await blob.arrayBuffer();
  return Buffer.from(ab);
}

async function downloadAsOutboundAttachment(args: {
  bucket: string;
  path: string;
  filename: string;
  contentType?: string | null;
  fileId?: string | null;
}): Promise<{ ok: true; attachment: OutboundEmailAttachment } | { ok: false; reason: string; sizeBytes?: number }> {
  const bucket = normalizeId(args.bucket);
  const path = normalizePath(args.path);
  if (!bucket || !path) return { ok: false, reason: "missing_storage_identity" };

  const filename = safeFilename(args.filename, "attachment");
  const explicitType = contentTypeOrDefault(args.contentType);

  try {
    const { data: blob, error } = await supabaseServer.storage.from(bucket).download(path);
    if (error || !blob) {
      return { ok: false, reason: "download_failed" };
    }

    const sizeBytes = typeof (blob as any).size === "number" ? (blob as any).size : null;
    if (typeof sizeBytes === "number" && sizeBytes > MAX_FILE_BYTES) {
      return { ok: false, reason: "file_too_large", sizeBytes };
    }

    const bytes = await blobToBuffer(blob);
    if (bytes.byteLength <= 0) return { ok: false, reason: "empty" };
    if (bytes.byteLength > MAX_FILE_BYTES) {
      return { ok: false, reason: "file_too_large", sizeBytes: bytes.byteLength };
    }

    const blobType =
      typeof (blob as any)?.type === "string" && (blob as any).type.trim()
        ? ((blob as any).type as string)
        : null;

    const contentType = contentTypeOrDefault(blobType ?? explicitType);

    return {
      ok: true,
      attachment: {
        filename,
        contentType,
        contentBase64: bytes.toString("base64"),
        sizeBytes: bytes.byteLength,
        fileId: normalizeId(args.fileId ?? null) || null,
      },
    };
  } catch (error) {
    warnOnce("email_attachments:download_crashed", `${WARN_PREFIX} storage download crashed`, {
      code: serializeSupabaseError(error).code ?? null,
    });
    return { ok: false, reason: "download_crashed" };
  }
}

export async function resolveOutboundAttachments(args: {
  quoteId: string;
  /**
   * Optional list of file IDs:
   * - Canonical ids: files_valid_compat / files_valid / files
   * - Legacy ids: quote_upload_files (best-effort)
   *
   * If omitted or empty, we prefer the latest inbound email attachments (metadata.attachments),
   * falling back to recent canonical quote files.
   */
  fileIds?: string[] | null;
}): Promise<{ attachments: OutboundEmailAttachment[] }> {
  const quoteId = normalizeId(args.quoteId);
  if (!quoteId) return { attachments: [] };

  const requested = Array.isArray(args.fileIds) ? args.fileIds.map((v) => normalizeId(v)).filter(Boolean) : null;
  const wantsSpecific = Boolean(requested && requested.length > 0);

  const chosen: Array<
    | { kind: "inbound"; bucket: string; path: string; filename: string; mime?: string | null; fileId?: string | null; sizeBytes?: number | null }
    | { kind: "canonical"; bucket: string; path: string; filename: string; mime?: string | null; fileId?: string | null; sizeBytes?: number | null }
    | { kind: "legacy"; bucket: string; path: string; filename: string; mime?: string | null; fileId?: string | null; sizeBytes?: number | null }
  > = [];

  if (!wantsSpecific) {
    const inboundPointers = await loadLatestInboundAttachmentPointers({ quoteId });
    for (const pointer of inboundPointers.slice(0, 12)) {
      chosen.push({
        kind: "inbound",
        bucket: pointer.storageBucketId,
        path: pointer.storagePath,
        filename: pointer.filename,
        mime: pointer.mime,
        fileId: pointer.quoteFileId ?? null,
        sizeBytes: pointer.sizeBytes,
      });
      if (chosen.length >= MAX_FILES) break;
    }
  }

  if (chosen.length === 0) {
    const canonical = await loadCanonicalFilesForQuote({ quoteId, fileIds: requested });
    for (const row of canonical) {
      chosen.push({
        kind: "canonical",
        bucket: normalizeId(row.bucket_id),
        path: normalizePath(row.storage_path),
        filename: safeFilename(row.filename ?? "attachment", "attachment"),
        mime: row.mime,
        fileId: row.id,
        sizeBytes: row.size_bytes,
      });
      if (chosen.length >= MAX_FILES) break;
    }
  }

  if (chosen.length === 0 && wantsSpecific) {
    const legacy = await loadLegacyUploads({ quoteId, fileIds: requested });
    for (const row of legacy) {
      chosen.push({
        kind: "legacy",
        bucket: row.bucket,
        path: row.path,
        filename: row.filename,
        mime: null,
        fileId: row.id,
      });
      if (chosen.length >= MAX_FILES) break;
    }
  }

  if (chosen.length === 0) return { attachments: [] };

  const attachments: OutboundEmailAttachment[] = [];
  let totalBytes = 0;

  for (const [index, src] of chosen.entries()) {
    if (attachments.length >= MAX_FILES) break;
    if (totalBytes >= MAX_TOTAL_BYTES) break;

    // Best-effort preflight skip if we have size metadata.
    const knownSize = typeof src.sizeBytes === "number" ? src.sizeBytes : null;
    if (typeof knownSize === "number" && knownSize > MAX_FILE_BYTES) {
      continue;
    }

    const downloaded = await downloadAsOutboundAttachment({
      bucket: src.bucket,
      path: src.path,
      filename: src.filename || `attachment-${index + 1}`,
      contentType: src.mime ?? null,
      fileId: src.fileId ?? null,
    });
    if (!downloaded.ok) {
      // Oversize and download failures are non-fatal; skip.
      continue;
    }

    if (downloaded.attachment.sizeBytes > MAX_FILE_BYTES) {
      continue;
    }
    if (totalBytes + downloaded.attachment.sizeBytes > MAX_TOTAL_BYTES) {
      break;
    }

    attachments.push(downloaded.attachment);
    totalBytes += downloaded.attachment.sizeBytes;
  }

  return { attachments };
}

