import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type CanonicalTable = "files_valid" | "files";

function formatSupabaseError(e: any): string {
  const out: Record<string, unknown> = {};

  if (!e || (typeof e !== "object" && typeof e !== "function")) {
    out.message = String(e);
    return JSON.stringify(out);
  }

  for (const k of ["message", "details", "hint", "code", "status", "name", "stack"] as const) {
    const v = (e as Record<string, unknown>)[k];
    if (v !== undefined) out[k] = v;
  }

  return JSON.stringify(out);
}

function maybeLogStep(verbose: boolean, stepName: string): void {
  if (verbose) console.log(`[backfill] step: ${stepName}`);
}

type CliArgs = {
  dryRun: boolean;
  limit: number;
  quoteId?: string;
  verbose: boolean;
};

type CanonicalColumns = {
  bucketCol: "bucket_id" | "storage_bucket_id";
  pathCol: "storage_path" | "file_path";
  filenameCol: "filename" | "file_name";
  hasSizeBytes: boolean;
};

type QuoteRow = {
  id: string;
  upload_id: string | null;
};

type UploadRow = {
  id: string;
  quote_id: string | null;
  file_path: string | null;
  file_name: string | null;
  mime_type: string | null;
  created_at: string | null;
};

type StorageObjectRow = {
  name: string;
  bucket_id: string;
  metadata: unknown | null;
  created_at: string | null;
};

type PerQuoteDetail = {
  quoteId: string;
  uploadId: string | null;
  uploadFilePath: string | null;
  uploadFileName: string | null;
  storageObjectName: string | null;
  action:
    | "skipped_no_upload_id"
    | "skipped_missing_upload_row"
    | "missing_storage_object"
    | "skipped_existing"
    | "would_insert"
    | "inserted";
};

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = { dryRun: false, limit: 200, verbose: false };

  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--dryRun") {
      out.dryRun = true;
      continue;
    }
    if (a === "--verbose") {
      out.verbose = true;
      continue;
    }
    if (a === "--limit") {
      const v = argv[i + 1];
      if (!v) throw new Error("Missing value for --limit");
      const n = Number(v);
      if (!Number.isFinite(n) || n <= 0) throw new Error(`Invalid --limit value: ${v}`);
      out.limit = Math.floor(n);
      i += 1;
      continue;
    }
    if (a === "--quoteId") {
      const v = argv[i + 1];
      if (!v) throw new Error("Missing value for --quoteId");
      out.quoteId = v;
      i += 1;
      continue;
    }
    throw new Error(`Unknown arg: ${a}`);
  }

  return out;
}

function basename(path: string): string {
  const normalized = String(path ?? "").trim().replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  return (parts[parts.length - 1] ?? "").trim();
}

function deriveMimeFromExtension(filename: string): string {
  const lower = (filename ?? "").toLowerCase();
  const ext = lower.includes(".") ? lower.split(".").pop() ?? "" : "";
  if (ext === "step" || ext === "stp") return "model/step";
  if (ext === "stl") return "model/stl";
  if (ext === "pdf") return "application/pdf";
  return "application/octet-stream";
}

function sizeBytesFromMetadata(metadata: unknown): number | null {
  if (!metadata || typeof metadata !== "object") return null;
  const m = metadata as Record<string, unknown>;

  const direct =
    m.size ??
    m.contentLength ??
    m.content_length ??
    m["content-length"] ??
    m["content_length"] ??
    m["Content-Length"];

  if (typeof direct === "number" && Number.isFinite(direct)) return direct;
  if (typeof direct === "string") {
    const n = Number(direct);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function isMissingRelationError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const msg = String((error as { message?: unknown }).message ?? "").toLowerCase();
  const code = String((error as { code?: unknown }).code ?? "");
  return code === "42P01" || (msg.includes("relation") && msg.includes("does not exist"));
}

function isMissingColumnError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const msg = String((error as { message?: unknown }).message ?? "").toLowerCase();
  return msg.includes("column") && msg.includes("does not exist");
}

async function detectCanonicalTable(params: { supabase: SupabaseClient; verbose: boolean }): Promise<CanonicalTable> {
  const { supabase, verbose } = params;
  maybeLogStep(verbose, "probe canonical table");
  const probe = await supabase.from("files_valid").select("id", { head: true }).limit(1);
  if (!probe.error) return "files_valid";
  if (!isMissingRelationError(probe.error)) {
    throw new Error(`[backfill] probe canonical table failed: ${formatSupabaseError(probe.error)}`);
  }

  maybeLogStep(verbose, "probe canonical table");
  const fallback = await supabase.from("files").select("id", { head: true }).limit(1);
  if (fallback.error) throw new Error(`[backfill] probe canonical table failed: ${formatSupabaseError(fallback.error)}`);
  return "files";
}

async function detectCanonicalColumns(params: {
  supabase: SupabaseClient;
  table: CanonicalTable;
  verbose: boolean;
}): Promise<CanonicalColumns> {
  const { supabase, table, verbose } = params;
  const bucketCol: CanonicalColumns["bucketCol"] = await (async () => {
    maybeLogStep(verbose, "probe canonical table");
    const q = await supabase.from(table).select("storage_bucket_id", { head: true }).limit(1);
    if (!q.error) return "storage_bucket_id";
    if (isMissingColumnError(q.error)) return "bucket_id";
    throw new Error(`[backfill] probe canonical table failed: ${formatSupabaseError(q.error)}`);
  })();

  const pathCol: CanonicalColumns["pathCol"] = await (async () => {
    maybeLogStep(verbose, "probe canonical table");
    const q = await supabase.from(table).select("storage_path", { head: true }).limit(1);
    if (!q.error) return "storage_path";
    if (isMissingColumnError(q.error)) return "file_path";
    throw new Error(`[backfill] probe canonical table failed: ${formatSupabaseError(q.error)}`);
  })();

  const filenameCol: CanonicalColumns["filenameCol"] = await (async () => {
    maybeLogStep(verbose, "probe canonical table");
    const q = await supabase.from(table).select("filename", { head: true }).limit(1);
    if (!q.error) return "filename";
    if (isMissingColumnError(q.error)) return "file_name";
    throw new Error(`[backfill] probe canonical table failed: ${formatSupabaseError(q.error)}`);
  })();

  // mime is required for canonical rows; fail fast if absent.
  {
    maybeLogStep(verbose, "probe canonical table");
    const q = await supabase.from(table).select("mime", { head: true }).limit(1);
    if (q.error) throw new Error(`[backfill] probe canonical table failed: ${formatSupabaseError(q.error)}`);
  }

  const hasSizeBytes = await (async () => {
    maybeLogStep(verbose, "probe canonical table");
    const q = await supabase.from(table).select("size_bytes", { head: true }).limit(1);
    if (!q.error) return true;
    if (isMissingColumnError(q.error)) return false;
    throw new Error(`[backfill] probe canonical table failed: ${formatSupabaseError(q.error)}`);
  })();

  return { bucketCol, pathCol, filenameCol, hasSizeBytes };
}

async function loadCandidateQuotes(params: {
  supabase: SupabaseClient;
  quoteId?: string;
  limit: number;
  verbose: boolean;
}): Promise<QuoteRow[]> {
  const { supabase, quoteId, limit, verbose } = params;

  let q = supabase.from("quotes").select("id,upload_id");
  if (quoteId) {
    q = q.eq("id", quoteId);
  } else {
    q = q.not("upload_id", "is", null).order("created_at", { ascending: false }).order("id", { ascending: true });
  }

  maybeLogStep(verbose, "load quotes");
  const res = await q.limit(limit);
  if (res.error) throw new Error(`[backfill] load quotes failed: ${formatSupabaseError(res.error)}`);
  return (res.data ?? []) as QuoteRow[];
}

async function loadUploadById(params: {
  supabase: SupabaseClient;
  uploadId: string;
  verbose: boolean;
}): Promise<UploadRow | null> {
  const { supabase, uploadId, verbose } = params;
  maybeLogStep(verbose, "load upload row");
  const res = await supabase
    .from("uploads")
    .select("id,quote_id,file_path,file_name,mime_type,created_at")
    .eq("id", uploadId)
    .maybeSingle();
  if (res.error) throw new Error(`[backfill] load upload row failed: ${formatSupabaseError(res.error)}`);
  return (res.data ?? null) as UploadRow | null;
}

async function resolveStorageObjectForUpload(params: {
  supabase: SupabaseClient;
  upload: UploadRow;
  verbose: boolean;
}): Promise<StorageObjectRow | null> {
  const { supabase, upload, verbose } = params;
  const bucketId = "cad_uploads";

  // 1) Exact match on uploads.file_path.
  const filePath = (upload.file_path ?? "").trim();
  if (filePath) {
    maybeLogStep(verbose, "lookup storage exact");
    const exact = await supabase
      .schema("storage")
      .from("objects")
      .select("name,bucket_id,metadata,created_at")
      .eq("bucket_id", bucketId)
      .eq("name", filePath)
      .maybeSingle();
    if (exact.error) throw new Error(`[backfill] lookup storage exact failed: ${formatSupabaseError(exact.error)}`);
    if (exact.data) return exact.data as StorageObjectRow;
  }

  // 2) Fallback contains search by uploads.file_name and pick newest created_at.
  const fileName = (upload.file_name ?? "").trim();
  if (fileName) {
    maybeLogStep(verbose, "lookup storage ilike");
    const fallback = await supabase
      .schema("storage")
      .from("objects")
      .select("name,bucket_id,metadata,created_at")
      .eq("bucket_id", bucketId)
      .ilike("name", `%${fileName}%`)
      .order("created_at", { ascending: false })
      .order("name", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (fallback.error) throw new Error(`[backfill] lookup storage ilike failed: ${formatSupabaseError(fallback.error)}`);
    if (fallback.data) return fallback.data as StorageObjectRow;
  }

  return null;
}

async function canonicalRowExists(params: {
  supabase: SupabaseClient;
  canonicalTable: CanonicalTable;
  canonicalCols: CanonicalColumns;
  quoteId: string;
  bucketId: string;
  storagePath: string;
  verbose: boolean;
}): Promise<boolean> {
  const { supabase, canonicalTable, canonicalCols, quoteId, bucketId, storagePath, verbose } = params;
  maybeLogStep(verbose, "load existing canonical rows");
  const q = await supabase
    .from(canonicalTable)
    .select("id", { head: true, count: "exact" })
    .eq("quote_id", quoteId)
    .eq(canonicalCols.bucketCol, bucketId)
    .eq(canonicalCols.pathCol, storagePath)
    .limit(1);
  if (q.error) throw new Error(`[backfill] load existing canonical rows failed: ${formatSupabaseError(q.error)}`);
  return (q.count ?? 0) > 0;
}

async function insertCanonicalRow(params: {
  supabase: SupabaseClient;
  canonicalTable: CanonicalTable;
  canonicalCols: CanonicalColumns;
  quoteId: string;
  upload: UploadRow;
  obj: StorageObjectRow;
  verbose: boolean;
}): Promise<Record<string, unknown>> {
  const { supabase, canonicalTable, canonicalCols, quoteId, upload, obj, verbose } = params;
  const bucketId = "cad_uploads";
  const storagePath = obj.name;
  const filename = basename(storagePath) || storagePath;
  const mime = (upload.mime_type ?? "").trim() || deriveMimeFromExtension(filename);

  const row: Record<string, unknown> = {
    quote_id: quoteId,
    [canonicalCols.bucketCol]: bucketId,
    [canonicalCols.pathCol]: storagePath,
    [canonicalCols.filenameCol]: filename,
    mime,
  };
  if (canonicalCols.hasSizeBytes) row.size_bytes = sizeBytesFromMetadata(obj.metadata);

  maybeLogStep(verbose, "insert canonical rows");
  const ins = await supabase.from(canonicalTable).insert(row);
  if (ins.error) throw new Error(`[backfill] insert canonical rows failed: ${formatSupabaseError(ins.error)}`);
  return row;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const perQuote: PerQuoteDetail[] = [];
  let canonicalTableUsed: CanonicalTable | null = null;
  let scannedQuotes = 0;
  let eligibleQuotes = 0;
  let insertedRows = 0;
  let skippedExisting = 0;
  let missingStorageObjects = 0;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    if (!url || !serviceRoleKey) {
      throw new Error("Missing required env vars: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
    }

    const supabase = createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    canonicalTableUsed = await detectCanonicalTable({ supabase, verbose: args.verbose });
    const canonicalCols = await detectCanonicalColumns({ supabase, table: canonicalTableUsed, verbose: args.verbose });

    const quotes = await loadCandidateQuotes({ supabase, quoteId: args.quoteId, limit: args.limit, verbose: args.verbose });
    scannedQuotes = quotes.length;

    for (const quote of quotes) {
      const quoteId = quote.id;
      const uploadId = quote.upload_id;
      if (!uploadId) {
        if (args.verbose) {
          perQuote.push({
            quoteId,
            uploadId: null,
            uploadFilePath: null,
            uploadFileName: null,
            storageObjectName: null,
            action: "skipped_no_upload_id",
          });
        }
        continue;
      }

      eligibleQuotes += 1;

      const upload = await loadUploadById({ supabase, uploadId, verbose: args.verbose });
      if (!upload) {
        if (args.verbose) {
          perQuote.push({
            quoteId,
            uploadId,
            uploadFilePath: null,
            uploadFileName: null,
            storageObjectName: null,
            action: "skipped_missing_upload_row",
          });
        }
        continue;
      }

      const obj = await resolveStorageObjectForUpload({ supabase, upload, verbose: args.verbose });
      if (!obj) {
        missingStorageObjects += 1;
        if (args.verbose) {
          perQuote.push({
            quoteId,
            uploadId,
            uploadFilePath: upload.file_path,
            uploadFileName: upload.file_name,
            storageObjectName: null,
            action: "missing_storage_object",
          });
        }
        continue;
      }

      const exists = await canonicalRowExists({
        supabase,
        canonicalTable: canonicalTableUsed,
        canonicalCols,
        quoteId,
        bucketId: "cad_uploads",
        storagePath: obj.name,
        verbose: args.verbose,
      });
      if (exists) {
        skippedExisting += 1;
        if (args.verbose) {
          perQuote.push({
            quoteId,
            uploadId,
            uploadFilePath: upload.file_path,
            uploadFileName: upload.file_name,
            storageObjectName: obj.name,
            action: "skipped_existing",
          });
        }
        continue;
      }

      if (args.dryRun) {
        if (args.verbose) {
          perQuote.push({
            quoteId,
            uploadId,
            uploadFilePath: upload.file_path,
            uploadFileName: upload.file_name,
            storageObjectName: obj.name,
            action: "would_insert",
          });
        }
        continue;
      }

      await insertCanonicalRow({
        supabase,
        canonicalTable: canonicalTableUsed,
        canonicalCols,
        quoteId,
        upload,
        obj,
        verbose: args.verbose,
      });
      insertedRows += 1;
      if (args.verbose) {
        perQuote.push({
          quoteId,
          uploadId,
          uploadFilePath: upload.file_path,
          uploadFileName: upload.file_name,
          storageObjectName: obj.name,
          action: "inserted",
        });
      }
    }
  } catch (err) {
    if (err instanceof Error) console.error(err.stack ?? err.message);
    else console.error(err);
    throw err;
  } finally {
    const summary: Record<string, unknown> = {
      canonicalTableUsed,
      scannedQuotes,
      eligibleQuotes,
      insertedRows,
      skippedExisting,
      missingStorageObjects,
    };
    if (args.verbose) summary.perQuote = perQuote;
    console.log(JSON.stringify(summary));
  }
}

main().catch((err) => {
  process.exit(1);
});

