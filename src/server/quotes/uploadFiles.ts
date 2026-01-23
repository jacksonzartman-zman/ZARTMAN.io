import AdmZip from "adm-zip";
import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseServer } from "@/lib/supabaseServer";
import { requireSchema, schemaGate } from "@/server/db/schemaContract";
import { createAuthClient } from "@/server/auth";
import { normalizeEmailInput } from "@/app/(portals)/quotes/pageUtils";
import { MAX_UPLOAD_BYTES } from "@/lib/uploads/uploadLimits";
import {
  handleMissingSupabaseRelation,
  isMissingTableOrColumnError,
  isSupabaseRelationMarkedMissing,
  isSupabaseSelectIncompatibleError,
  serializeSupabaseError,
  warnOnce,
  type SerializedSupabaseError,
} from "@/server/admin/logging";

export type UploadTarget = {
  /**
   * Object key within the bucket (no leading slash).
   *
   * Note: older records sometimes store `bucket/path` in `file_path`/`storage_path`;
   * downstream readers normalize both formats.
   */
  storagePath: string;
  bucketId: string;
  originalFileName: string;
  mimeType: string | null;
  sizeBytes: number;
};

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

/**
 * Canonical invariant:
 * - Portal previews only use canonical quote files from `files_valid` (view over `files`).
 * - Canonical rows MUST store the exact Storage bucket + object key that was written.
 * - If there is no canonical row, there is no preview (no path guessing).
 */
const CANONICAL_CAD_BUCKET = "cad_uploads";

function canonicalizeCadBucketId(input: unknown): string {
  const raw = typeof input === "string" ? input.trim() : "";
  if (!raw) return "";
  if (raw === "cad-uploads") return "cad_uploads";
  if (raw === "cad_uploads") return "cad_uploads";
  if (raw === "cad") return "cad_uploads";
  return raw;
}

const CAD_BUCKET = (() => {
  const configured =
    process.env.SUPABASE_CAD_BUCKET ||
    process.env.NEXT_PUBLIC_CAD_BUCKET ||
    process.env.NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET ||
    "";
  const normalized = canonicalizeCadBucketId(configured) || CANONICAL_CAD_BUCKET;
  if (normalized !== CANONICAL_CAD_BUCKET) {
    console.warn("[quote upload files] overriding configured CAD bucket", {
      configuredBucket: configured || null,
      normalizedBucket: normalized,
      canonicalBucket: CANONICAL_CAD_BUCKET,
    });
  }
  return CANONICAL_CAD_BUCKET;
})();

const DEFAULT_UPLOAD_STATUS = "submitted";

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

type SupabaseWriteClient = ReturnType<typeof createAuthClient> | ReturnType<typeof supabaseServer>;

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

function normalizeStorageObjectKey(bucket: string, path: string): string {
  const normalizedBucket = canonicalizeCadBucketId(bucket) || bucket;
  const rawPath = typeof path === "string" ? path.trim() : "";
  if (!rawPath) return "";
  // Strip leading slashes.
  let key = rawPath.replace(/^\/+/, "");
  // If callers accidentally pass `bucket/key`, strip the bucket prefix.
  if (key.startsWith(`${normalizedBucket}/`)) {
    key = key.slice(normalizedBucket.length + 1);
  } else if (normalizedBucket === "cad_uploads" && key.startsWith("cad-uploads/")) {
    key = key.slice("cad-uploads/".length);
  }
  key = key.replace(/^\/+/, "");
  return key;
}

type CanonicalFileRow = {
  quote_id: string;
  filename: string;
  mime: string;
  storage_path: string;
  bucket_id: string;
  size_bytes?: number | null;
};

type CanonicalInsertResult = {
  ok: boolean;
  inserted: number;
  table: "files" | null;
  error?: SerializedSupabaseError | null;
};

type QuoteFileRegistrationMode = "canonical" | "quote_upload_files" | "none";

async function insertCanonicalQuoteFiles(params: {
  supabase: SupabaseClient;
  quoteId: string;
  files: Array<{
    bucketId: string;
    storagePath: string;
    filename: string;
    mimeType: string | null;
    sizeBytes: number | null;
  }>;
}): Promise<CanonicalInsertResult> {
  const quoteId = typeof params.quoteId === "string" ? params.quoteId.trim() : "";
  const supabase = params.supabase;
  const inputFiles = Array.isArray(params.files) ? params.files.filter(Boolean) : [];
  if (!quoteId) return { ok: false, inserted: 0, table: null };
  if (inputFiles.length === 0) return { ok: true, inserted: 0, table: null };

  // Avoid duplicates without relying on schema constraints.
  const existing = new Set<string>();
  const loadExisting = async () => {
    try {
      const { data, error } = await supabase
        .from("files")
        .select("*")
        .eq("quote_id", quoteId)
        .returns<
          Array<{
            bucket_id?: string | null;
            storage_bucket_id?: string | null;
            storage_path?: string | null;
            file_path?: string | null;
          }>
        >();
      if (error) {
        if (isMissingTableOrColumnError(error)) return;
        return;
      }

      for (const row of data ?? []) {
        const rawBucket =
          typeof row.storage_bucket_id === "string" && row.storage_bucket_id.trim()
            ? row.storage_bucket_id
            : typeof row.bucket_id === "string"
              ? row.bucket_id
              : "";
        const bucket = canonicalizeCadBucketId(rawBucket) || rawBucket;
        const rawPath =
          typeof row.storage_path === "string" && row.storage_path.trim()
            ? row.storage_path
            : typeof row.file_path === "string"
              ? row.file_path
              : "";
        const key = normalizeStorageObjectKey(bucket || CANONICAL_CAD_BUCKET, rawPath);
        if (!bucket || !key) continue;
        existing.add(`${bucket}:${key}`);
      }
    } catch (error) {
      if (isMissingTableOrColumnError(error)) return;
    }
  };

  await loadExisting();

  const rows: CanonicalFileRow[] = [];
  for (const file of inputFiles) {
    const bucket = CANONICAL_CAD_BUCKET;
    const key = normalizeStorageObjectKey(bucket, file.storagePath);
    const filename = typeof file.filename === "string" ? file.filename.trim() : "";
    if (!key || !filename) continue;

    const dedupeKey = `${bucket}:${key}`;
    if (existing.has(dedupeKey)) continue;

    rows.push({
      quote_id: quoteId,
      filename,
      mime:
        typeof file.mimeType === "string" && file.mimeType.trim().length > 0
          ? file.mimeType
          : "application/octet-stream",
      storage_path: key,
      bucket_id: bucket,
      size_bytes:
        typeof file.sizeBytes === "number" && Number.isFinite(file.sizeBytes)
          ? file.sizeBytes
          : null,
    });
    existing.add(dedupeKey);
  }

  if (rows.length === 0) {
    return { ok: true, inserted: 0, table: null };
  }

  const isUniqueViolation = (error: unknown): boolean => {
    const serialized = serializeSupabaseError(error);
    return serialized.code === "23505";
  };

  const attempts: Array<{
    bucketColumn: "bucket_id" | "storage_bucket_id";
    pathColumn: "storage_path" | "file_path";
  }> = [
    { bucketColumn: "bucket_id", pathColumn: "storage_path" },
    { bucketColumn: "storage_bucket_id", pathColumn: "storage_path" },
    { bucketColumn: "bucket_id", pathColumn: "file_path" },
    { bucketColumn: "storage_bucket_id", pathColumn: "file_path" },
  ];

  let lastError: unknown = null;
  for (const attempt of attempts) {
    try {
      const { error } = await supabase.from("files").insert(
        rows.map((r) => ({
          quote_id: r.quote_id,
          filename: r.filename,
          mime: r.mime,
          [attempt.pathColumn]: r.storage_path,
          [attempt.bucketColumn]: r.bucket_id,
          size_bytes: r.size_bytes ?? null,
        })),
      );
      if (!error) {
        return { ok: true, inserted: rows.length, table: "files" };
      }
      if (isUniqueViolation(error)) {
        return { ok: true, inserted: 0, table: "files" };
      }
      if (!isMissingTableOrColumnError(error)) {
        return {
          ok: false,
          inserted: 0,
          table: "files",
          error: serializeSupabaseError(error),
        };
      }
      lastError = error;
    } catch (error) {
      if (isMissingTableOrColumnError(error)) {
        lastError = error;
        continue;
      }
      return {
        ok: false,
        inserted: 0,
        table: "files",
        error: serializeSupabaseError(error),
      };
    }
  }

  if (lastError) {
    return {
      ok: false,
      inserted: 0,
      table: "files",
      error: serializeSupabaseError(lastError),
    };
  }

  return { ok: false, inserted: 0, table: "files" };
}

async function resolveQuoteFileRegistrationMode(): Promise<QuoteFileRegistrationMode> {
  const canWriteCanonical = await schemaGate({
    enabled: true,
    relation: "files",
    requiredColumns: ["quote_id", "filename", "mime"],
    warnPrefix: "[canonical quote files]",
    warnKey: "schema_contract:files:write",
  });
  if (canWriteCanonical) return "canonical";

  if (isSupabaseRelationMarkedMissing("quote_upload_files")) {
    return "none";
  }

  const canWriteUploads = await schemaGate({
    enabled: true,
    relation: "quote_upload_files",
    requiredColumns: [
      "quote_id",
      "upload_id",
      "path",
      "filename",
      "extension",
      "size_bytes",
      "is_from_archive",
    ],
    warnPrefix: "[quote_upload_files]",
    warnKey: "schema_contract:quote_upload_files:register",
  });

  return canWriteUploads ? "quote_upload_files" : "none";
}

export function buildUploadTargetForQuote(params: {
  quoteId: string;
  fileName: string;
  sizeBytes: number;
  mimeType: string | null;
}): UploadTarget {
  const quoteId = typeof params.quoteId === "string" ? params.quoteId.trim() : "";
  const fileName = typeof params.fileName === "string" ? params.fileName : "";
  const sizeBytes =
    typeof params.sizeBytes === "number" && Number.isFinite(params.sizeBytes)
      ? params.sizeBytes
      : 0;
  const mimeType = typeof params.mimeType === "string" ? params.mimeType : null;

  const bucketId = CAD_BUCKET;
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const timestamp = Date.now();
  // Keep the historical `uploads/` prefix to avoid surprises with any path-based policies.
  const storagePath = `uploads/quotes/${quoteId || "unknown-quote"}/${timestamp}-${safeName || "file"}`;
  return { storagePath, bucketId, originalFileName: fileName, mimeType, sizeBytes };
}

export function isAllowedQuoteUploadFileName(fileName: string): boolean {
  const name = typeof fileName === "string" ? fileName.trim() : "";
  if (!name) return false;
  const extension = getFileExtension(name);
  return Boolean(extension && ADMIN_APPEND_ALLOWED_EXTENSIONS.has(extension));
}

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

  const quote = await loadQuoteForUpload(supabaseServer(), quoteId);

  return appendFilesToQuoteUploadWithClient({
    supabase: supabaseServer(),
    quoteId,
    quote,
    files,
  });
}

export async function customerAppendFilesToQuote(args: {
  quoteId: string;
  files: File[];
  customerUserId: string;
  customerEmail: string | null;
}): Promise<{ uploadId: string; uploadFileIds: string[] }> {
  const quoteId = typeof args.quoteId === "string" ? args.quoteId.trim() : "";
  const customerUserId =
    typeof args.customerUserId === "string" ? args.customerUserId.trim() : "";
  const customerEmail = normalizeEmailInput(args.customerEmail ?? null);
  const files = Array.isArray(args.files) ? args.files.filter(Boolean) : [];

  if (!quoteId) {
    throw new Error("invalid_quote_id");
  }
  if (!customerUserId) {
    throw new Error("invalid_customer_user");
  }
  if (files.length === 0) {
    throw new Error("missing_files");
  }

  const supabase = createAuthClient();

  // 1) Verify the customer can see this quote (customer_id or customer_email match).
  const quote = await assertCustomerCanUploadToQuote({
    supabase,
    quoteId,
    customerUserId,
    customerEmail,
  });

  // 2) Use the cookie-based client bound to the user session, and delegate to the shared helper.
  return appendFilesToQuoteUploadWithClient({
    supabase,
    quoteId,
    quote,
    files,
  });
}

export async function registerUploadedObjectsForQuote(params: {
  quoteId: string;
  targets: UploadTarget[];
}): Promise<{ uploadId: string; recorded: boolean; mode: QuoteFileRegistrationMode }> {
  const quoteId = typeof params.quoteId === "string" ? params.quoteId.trim() : "";
  const targets = Array.isArray(params.targets) ? params.targets.filter(Boolean) : [];
  if (!quoteId) {
    throw new Error("invalid_quote_id");
  }
  if (targets.length === 0) {
    throw new Error("missing_targets");
  }

  const quote = await loadQuoteForUpload(supabaseServer(), quoteId);

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
    typeof quote.company === "string" && quote.company.trim().length > 0
      ? quote.company.trim()
      : null;

  const primary = targets[0];
  const { data: uploadRow, error: uploadError } = await supabaseServer()
    .from("uploads")
    .insert({
      quote_id: quoteId,
      status: uploadStatus,
      file_name: primary?.originalFileName ?? "multiple-files.zip",
      file_path: primary?.storagePath ?? null,
      mime_type: primary?.mimeType ?? null,
      name: uploadName,
      email: uploadEmail,
      company: uploadCompany,
    })
    .select("id")
    .single<{ id: string }>();

  if (uploadError || !uploadRow?.id) {
    throw uploadError ?? new Error("uploads_insert_failed");
  }

  const registerResult = await registerUploadedObjectsForExistingUpload({
    quoteId,
    uploadId: uploadRow.id,
    targets,
    supabase: supabaseServer(),
  });

  if (!registerResult.ok) {
    throw new Error("register_uploaded_objects_failed");
  }

  return { uploadId: uploadRow.id, recorded: registerResult.recorded, mode: registerResult.mode };
}

export async function registerUploadedObjectsForExistingUpload(params: {
  quoteId: string;
  uploadId: string;
  targets: UploadTarget[];
  supabase?: SupabaseClient;
}): Promise<{ ok: boolean; recorded: boolean; mode: QuoteFileRegistrationMode }> {
  const quoteId = typeof params.quoteId === "string" ? params.quoteId.trim() : "";
  const uploadId = typeof params.uploadId === "string" ? params.uploadId.trim() : "";
  const targets = Array.isArray(params.targets) ? params.targets.filter(Boolean) : [];
  const supabase = params.supabase ?? supabaseServer();

  if (!quoteId || !uploadId) {
    return { ok: false, recorded: false, mode: "none" };
  }
  if (targets.length === 0) {
    return { ok: true, recorded: false, mode: "none" };
  }

  const mode = await resolveQuoteFileRegistrationMode();

  if (mode === "canonical") {
    const canonicalResult = await insertCanonicalQuoteFiles({
      supabase,
      quoteId,
      files: targets.map((t) => ({
        bucketId: t.bucketId,
        storagePath: t.storagePath,
        filename: t.originalFileName,
        mimeType: t.mimeType,
        sizeBytes: t.sizeBytes,
      })),
    });

    if (!canonicalResult.ok) {
      console.error("[quote upload files] canonical registration failed", {
        quoteId,
        uploadId,
        helper: "insertCanonicalQuoteFiles",
        table: canonicalResult.table ?? "files",
        error: canonicalResult.error ?? null,
      });
      return { ok: false, recorded: false, mode };
    }

    return { ok: true, recorded: false, mode };
  }

  if (mode === "quote_upload_files") {
    const storedFiles = await buildStoredFilesForEnumerationFromTargets(targets);
    const result = await recordQuoteUploadFiles({
      quoteId,
      uploadId,
      storedFiles,
      supabase,
    });

    if (result.ok && result.recorded) {
      return { ok: true, recorded: true, mode };
    }

    if (result.ok && !result.recorded) {
      console.error("[quote upload files] registration skipped", {
        quoteId,
        uploadId,
        helper: "recordQuoteUploadFiles",
        reason: "schema_missing_or_incompatible",
      });
    }

    return { ok: false, recorded: result.recorded, mode };
  }

  console.error("[quote upload files] registration unavailable", {
    quoteId,
    uploadId,
    helper: "registerUploadedObjectsForExistingUpload",
    reason: "no_write_model",
  });
  return { ok: false, recorded: false, mode };
}

async function appendFilesToQuoteUploadWithClient(args: {
  supabase: SupabaseWriteClient;
  quoteId: string;
  quote: {
    id: string;
    customer_name: string | null;
    customer_email: string | null;
    company: string | null;
    status: string | null;
    customer_id?: string | null;
  };
  files: File[];
}): Promise<{ uploadId: string; uploadFileIds: string[] }> {
  const { supabase } = args;
  const quoteId = typeof args.quoteId === "string" ? args.quoteId.trim() : "";
  const files = Array.isArray(args.files) ? args.files.filter(Boolean) : [];
  const quote = args.quote;

  if (!quoteId) {
    throw new Error("invalid_quote_id");
  }
  if (!quote?.id) {
    throw new Error("quote_not_found");
  }
  if (files.length === 0) {
    throw new Error("missing_files");
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
    if (file.size > MAX_UPLOAD_BYTES) {
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
    // Object key inside the bucket. (Canonical rows must store this exact key.)
    const storagePath = storageKey;
    const isZip =
      extension === "zip" ||
      (typeof mimeType === "string" && mimeType.toLowerCase().includes("zip"));

    const { error: storageError } = await supabase.storage
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

  const { data: uploadRow, error: uploadError } = await supabase
    .from("uploads")
    .insert({
      quote_id: quoteId,
      status: uploadStatus,
      file_name: primaryStoredFile.originalName,
      file_path: `${CAD_BUCKET}/${primaryStoredFile.storagePath}`,
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

  const registrationMode = await resolveQuoteFileRegistrationMode();

  if (registrationMode === "canonical") {
    const canonicalResult = await insertCanonicalQuoteFiles({
      supabase: supabase as unknown as SupabaseClient,
      quoteId,
      files: storedFiles.map((storedFile) => ({
        bucketId: storedFile.bucket,
        storagePath: storedFile.storagePath,
        filename: storedFile.originalName,
        mimeType: storedFile.mimeType,
        sizeBytes: storedFile.sizeBytes,
      })),
    });

    if (!canonicalResult.ok) {
      console.error("[quote upload files] canonical registration failed", {
        quoteId,
        uploadId,
        helper: "insertCanonicalQuoteFiles",
        table: canonicalResult.table ?? "files",
        error: canonicalResult.error ?? null,
      });
      throw new Error("canonical_files_insert_failed");
    }

    return { uploadId, uploadFileIds: [] };
  }

  if (registrationMode !== "quote_upload_files") {
    console.error("[quote upload files] registration unavailable", {
      quoteId,
      uploadId,
      helper: "appendFilesToQuoteUploadWithClient",
      reason: "no_write_model",
    });
    throw new Error("quote_files_registration_unavailable");
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
    supabase,
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

  const canLoadIds = await schemaGate({
    enabled: true,
    relation: "quote_upload_files",
    requiredColumns: ["quote_id", "upload_id", "path", "id"],
    warnPrefix: "[quote_upload_files]",
  });
  if (!canLoadIds) {
    // Optional feature: if the relation/schema isn't present, keep the upload but skip per-file ids.
    return { uploadId, uploadFileIds: [] };
  }

  const { data: uploadedEntries, error: uploadedEntriesError } = await supabase
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
  supabase?: SupabaseClient;
}): Promise<{ ok: boolean; recorded: boolean }> {
  const { quoteId, uploadId, storedFiles } = args;
  const supabase = args.supabase ?? supabaseServer();

  if (!quoteId || !uploadId) {
    return { ok: false, recorded: false };
  }

  const rows = buildQuoteUploadFileRows({ quoteId, uploadId, storedFiles });
  if (rows.length === 0) {
    return { ok: true, recorded: false };
  }

  const canRecord = await schemaGate({
    enabled: true,
    relation: "quote_upload_files",
    requiredColumns: [
      "quote_id",
      "upload_id",
      "path",
      "filename",
      "extension",
      "size_bytes",
      "is_from_archive",
    ],
    warnPrefix: "[quote_upload_files]",
  });
  if (!canRecord) {
    return { ok: true, recorded: false };
  }

  try {
    const { error } = await supabase
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

async function buildStoredFilesForEnumerationFromTargets(
  targets: UploadTarget[],
): Promise<StoredUploadFileForEnumeration[]> {
  const stored: StoredUploadFileForEnumeration[] = [];

  for (const target of targets) {
    const originalName = (target?.originalFileName ?? "").trim();
    if (!originalName) continue;

    const extension = extractExtension(originalName);
    const isZip =
      extension === "zip" ||
      (typeof target?.mimeType === "string" && target.mimeType.toLowerCase().includes("zip"));

    let buffer: Buffer | undefined;
    if (isZip) {
      try {
        const { data, error } = await supabaseServer().storage
          .from(target.bucketId)
          .download(target.storagePath);
        if (!error && data) {
          buffer = Buffer.from(await data.arrayBuffer());
        }
      } catch (e) {
        console.warn("[quote upload files] zip download failed; skipping enumeration", {
          fileName: originalName,
          bucket: target.bucketId,
          path: target.storagePath,
          error: serializeSupabaseError(e),
        });
      }
    }

    stored.push({
      originalName,
      sizeBytes:
        typeof target?.sizeBytes === "number" && Number.isFinite(target.sizeBytes)
          ? target.sizeBytes
          : 0,
      mimeType: target?.mimeType ?? "application/octet-stream",
      buffer,
    });
  }

  return stored;
}

export async function loadQuoteUploadGroups(
  quoteId: string,
): Promise<QuoteUploadGroup[]> {
  if (typeof quoteId !== "string" || quoteId.trim().length === 0) {
    return [];
  }

  if (isSupabaseRelationMarkedMissing("quote_upload_files")) return [];

  const normalizedQuoteId = quoteId.trim();

  const attempt1Schema = await requireSchema({
    relation: "quote_upload_files",
    requiredColumns: [
      "quote_id",
      "id",
      "upload_id",
      "filename",
      "extension",
      "size_bytes",
      "is_from_archive",
      "created_at",
    ],
    warnPrefix: "[quote_upload_files]",
    warnKey: "schema_contract:quote_upload_files:load_groups",
  });
  if (!attempt1Schema.ok && attempt1Schema.reason === "missing_relation") {
    return [];
  }

  // Strategy:
  // - Attempt 1: minimal safe select (no nested joins, no path)
  // - Attempt 2: select("*") when schema variant rejects attempt 1
  let rows: Array<Record<string, unknown>> = [];
  let shouldFallback = !attempt1Schema.ok;
  try {
    if (attempt1Schema.ok) {
      const attempt1 = await supabaseServer()
        .from("quote_upload_files")
        .select("id,upload_id,filename,extension,size_bytes,is_from_archive,created_at")
        .eq("quote_id", normalizedQuoteId)
        .returns<
          Array<{
            id: string;
            upload_id: string;
            filename: string | null;
            extension: string | null;
            size_bytes: number | null;
            is_from_archive: boolean;
            created_at: string | null;
          }>
        >();

      if (!attempt1.error) {
        rows = Array.isArray(attempt1.data)
          ? (attempt1.data as unknown as Array<Record<string, unknown>>)
          : [];
      } else {
        if (
          handleMissingSupabaseRelation({
            relation: "quote_upload_files",
            error: attempt1.error,
            warnPrefix: "[quote_upload_files]",
          })
        ) {
          return [];
        }

        if (isSupabaseSelectIncompatibleError(attempt1.error)) {
          const serialized = serializeSupabaseError(attempt1.error);
          warnOnce(
            "quote_upload_files:select_incompatible",
            "[quote_upload_files] select incompatible; falling back",
            { code: serialized.code, message: serialized.message },
          );
          shouldFallback = true;
        } else {
          console.error("[quote upload files] failed to load entries", {
            quoteId: normalizedQuoteId,
            error: serializeSupabaseError(attempt1.error) ?? attempt1.error,
          });
          return [];
        }
      }
    }

    if (shouldFallback) {
      const attempt2 = await supabaseServer()
        .from("quote_upload_files")
        .select("*")
        .eq("quote_id", normalizedQuoteId);

      if (attempt2.error) {
        if (
          handleMissingSupabaseRelation({
            relation: "quote_upload_files",
            error: attempt2.error,
            warnPrefix: "[quote_upload_files]",
          }) ||
          isMissingTableOrColumnError(attempt2.error)
        ) {
          return [];
        }

        console.error("[quote upload files] fallback load failed", {
          quoteId: normalizedQuoteId,
          error: serializeSupabaseError(attempt2.error) ?? attempt2.error,
        });
        return [];
      }

      rows = Array.isArray(attempt2.data)
        ? (attempt2.data as Array<Record<string, unknown>>)
        : [];
    }
  } catch (error) {
    if (
      handleMissingSupabaseRelation({
        relation: "quote_upload_files",
        error,
        warnPrefix: "[quote_upload_files]",
      }) ||
      isMissingTableOrColumnError(error)
    ) {
      return [];
    }
    console.error("[quote upload files] load crashed", {
      quoteId: normalizedQuoteId,
      error: serializeSupabaseError(error) ?? error,
    });
    return [];
  }

  const fileEntries: QuoteUploadFileEntry[] = rows
    .map((row): QuoteUploadFileEntry | null => {
      const id = typeof (row as any)?.id === "string" ? ((row as any).id as string).trim() : "";
      const uploadId =
        typeof (row as any)?.upload_id === "string" ? ((row as any).upload_id as string).trim() : "";
      if (!id || !uploadId) return null;

      const rawPath =
        (row as any)?.path ??
        (row as any)?.storage_path ??
        (row as any)?.file_path ??
        (row as any)?.storagePath ??
        (row as any)?.filePath ??
        null;
      const path = typeof rawPath === "string" ? rawPath : "";

      const filenameRaw = (row as any)?.filename;
      const filename =
        typeof filenameRaw === "string" && filenameRaw.trim().length > 0
          ? filenameRaw.trim()
          : path
            ? path.split("/").filter(Boolean).slice(-1)[0] ?? ""
            : "";

      const extensionRaw = (row as any)?.extension;
      const extension =
        typeof extensionRaw === "string" && extensionRaw.trim().length > 0
          ? extensionRaw.trim()
          : (() => {
              const parts = filename.split(".");
              return parts.length > 1 ? (parts[parts.length - 1] ?? "").toLowerCase() : null;
            })();

      const sizeBytesRaw = (row as any)?.size_bytes;
      const sizeBytes =
        typeof sizeBytesRaw === "number" && Number.isFinite(sizeBytesRaw) ? sizeBytesRaw : null;

      const isFromArchiveRaw = (row as any)?.is_from_archive;
      const isFromArchive = Boolean(isFromArchiveRaw);

      const createdAtRaw = (row as any)?.created_at;
      const createdAt = typeof createdAtRaw === "string" ? createdAtRaw : null;

      return {
        id,
        upload_id: uploadId,
        path,
        filename,
        extension,
        size_bytes: sizeBytes,
        is_from_archive: isFromArchive,
        created_at: createdAt,
      };
    })
    .filter((row): row is QuoteUploadFileEntry => Boolean(row));

  // Best-effort stable ordering (avoid `.order(...)` to reduce schema coupling).
  fileEntries.sort((a, b) => {
    const aKey = a.created_at ?? "";
    const bKey = b.created_at ?? "";
    if (aKey && bKey && aKey !== bKey) return aKey.localeCompare(bKey);
    return a.id.localeCompare(b.id);
  });

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
      const { data, error } = await supabaseServer()
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

async function loadQuoteForUpload(
  supabase: SupabaseWriteClient,
  quoteId: string,
): Promise<{
  id: string;
  customer_name: string | null;
  customer_email: string | null;
  company: string | null;
  status: string | null;
  customer_id?: string | null;
}> {
  const normalizedQuoteId = typeof quoteId === "string" ? quoteId.trim() : "";
  if (!normalizedQuoteId) {
    throw new Error("invalid_quote_id");
  }

  const { data: quote, error: quoteError } = await supabase
    .from("quotes")
    .select("id,customer_id,customer_name,customer_email,company,status")
    .eq("id", normalizedQuoteId)
    .maybeSingle<{
      id: string;
      customer_id: string | null;
      customer_name: string | null;
      customer_email: string | null;
      company: string | null;
      status: string | null;
    }>();

  if (quoteError || !quote?.id) {
    if (!isMissingTableOrColumnError(quoteError)) {
      console.error("[quote upload files] quote lookup failed", {
        quoteId: normalizedQuoteId,
        error: serializeSupabaseError(quoteError),
      });
    }
    throw new Error("quote_not_found");
  }

  return quote;
}

async function assertCustomerCanUploadToQuote(args: {
  supabase: SupabaseWriteClient;
  quoteId: string;
  customerUserId: string;
  customerEmail: string | null;
}): Promise<{
  id: string;
  customer_name: string | null;
  customer_email: string | null;
  company: string | null;
  status: string | null;
  customer_id?: string | null;
}> {
  const { supabase } = args;
  const quoteId = typeof args.quoteId === "string" ? args.quoteId.trim() : "";
  const customerUserId =
    typeof args.customerUserId === "string" ? args.customerUserId.trim() : "";
  const customerEmail = normalizeEmailInput(args.customerEmail ?? null);
  if (!quoteId || !customerUserId) {
    throw new Error("access_denied");
  }

  const quote = await loadQuoteForUpload(supabase, quoteId);

  const quoteCustomerEmail = normalizeEmailInput(quote.customer_email);
  const customerIdFromProfile = await loadCustomerIdForUser(supabase, customerUserId);
  const quoteCustomerId = normalizeId(
    (quote as { customer_id?: string | null }).customer_id ?? null,
  );
  const customerIdMatches = Boolean(
    customerIdFromProfile && quoteCustomerId && customerIdFromProfile === quoteCustomerId,
  );
  const customerEmailMatches = Boolean(
    customerEmail && quoteCustomerEmail && customerEmail === quoteCustomerEmail,
  );

  if (!customerIdMatches && !customerEmailMatches) {
    console.warn("[customer quote upload files] access denied", {
      quoteId,
      customerUserId,
      customerEmail,
      quoteCustomerEmail: quote.customer_email ?? null,
      quoteCustomerId: quoteCustomerId || null,
    });
    throw new Error("access_denied");
  }

  return quote;
}

async function loadCustomerIdForUser(
  supabase: SupabaseWriteClient,
  userId: string,
): Promise<string | null> {
  const normalizedUserId = normalizeId(userId);
  if (!normalizedUserId) return null;

  try {
    const { data, error } = await supabase
      .from("customers")
      .select("id")
      .eq("user_id", normalizedUserId)
      .maybeSingle<{ id: string }>();

    if (error) {
      return null;
    }

    const id = normalizeId(data?.id);
    return id || null;
  } catch {
    return null;
  }
}

function normalizeId(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : "";
}

