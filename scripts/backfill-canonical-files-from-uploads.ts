import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type CanonicalTable = "files_valid" | "files";

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

type Summary = {
  canonicalTableUsed: CanonicalTable;
  scannedQuotes: number;
  eligibleQuotes: number;
  wouldInsertRows: number;
  insertedRows: number;
  skippedExisting: number;
  missingUploadId: number;
  missingUploadRows: number;
  missingStorageObjects: number;
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

async function detectCanonicalTable(supabase: SupabaseClient): Promise<CanonicalTable> {
  const probe = await supabase.from("files_valid").select("id", { head: true }).limit(1);
  if (!probe.error) return "files_valid";
  if (!isMissingRelationError(probe.error)) throw probe.error;

  const fallback = await supabase.from("files").select("id", { head: true }).limit(1);
  if (fallback.error) throw fallback.error;
  return "files";
}

async function detectCanonicalColumns(supabase: SupabaseClient, table: CanonicalTable): Promise<CanonicalColumns> {
  const bucketCol: CanonicalColumns["bucketCol"] = await (async () => {
    const q = await supabase.from(table).select("storage_bucket_id", { head: true }).limit(1);
    if (!q.error) return "storage_bucket_id";
    if (isMissingColumnError(q.error)) return "bucket_id";
    throw q.error;
  })();

  const pathCol: CanonicalColumns["pathCol"] = await (async () => {
    const q = await supabase.from(table).select("storage_path", { head: true }).limit(1);
    if (!q.error) return "storage_path";
    if (isMissingColumnError(q.error)) return "file_path";
    throw q.error;
  })();

  const filenameCol: CanonicalColumns["filenameCol"] = await (async () => {
    const q = await supabase.from(table).select("filename", { head: true }).limit(1);
    if (!q.error) return "filename";
    if (isMissingColumnError(q.error)) return "file_name";
    throw q.error;
  })();

  // mime is required for canonical rows; fail fast if absent.
  {
    const q = await supabase.from(table).select("mime", { head: true }).limit(1);
    if (q.error) throw q.error;
  }

  const hasSizeBytes = await (async () => {
    const q = await supabase.from(table).select("size_bytes", { head: true }).limit(1);
    if (!q.error) return true;
    if (isMissingColumnError(q.error)) return false;
    throw q.error;
  })();

  return { bucketCol, pathCol, filenameCol, hasSizeBytes };
}

async function loadCandidateQuotes(params: {
  supabase: SupabaseClient;
  quoteId?: string;
  limit: number;
}): Promise<QuoteRow[]> {
  const { supabase, quoteId, limit } = params;

  let q = supabase.from("quotes").select("id,upload_id");
  if (quoteId) {
    q = q.eq("id", quoteId);
  } else {
    q = q.not("upload_id", "is", null).order("created_at", { ascending: false }).order("id", { ascending: true });
  }

  const res = await q.limit(limit);
  if (res.error) throw res.error;
  return (res.data ?? []) as QuoteRow[];
}

async function loadUploadById(params: { supabase: SupabaseClient; uploadId: string }): Promise<UploadRow | null> {
  const { supabase, uploadId } = params;
  const res = await supabase
    .from("uploads")
    .select("id,quote_id,file_path,file_name,mime_type,created_at")
    .eq("id", uploadId)
    .maybeSingle();
  if (res.error) throw res.error;
  return (res.data ?? null) as UploadRow | null;
}

async function resolveStorageObjectForUpload(params: {
  supabase: SupabaseClient;
  upload: UploadRow;
}): Promise<StorageObjectRow | null> {
  const { supabase, upload } = params;
  const bucketId = "cad_uploads";

  // 1) Exact match on uploads.file_path.
  const filePath = (upload.file_path ?? "").trim();
  if (filePath) {
    const exact = await supabase
      .schema("storage")
      .from("objects")
      .select("name,bucket_id,metadata,created_at")
      .eq("bucket_id", bucketId)
      .eq("name", filePath)
      .maybeSingle();
    if (exact.error) throw exact.error;
    if (exact.data) return exact.data as StorageObjectRow;
  }

  // 2) Fallback contains search by uploads.file_name and pick newest created_at.
  const fileName = (upload.file_name ?? "").trim();
  if (fileName) {
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
    if (fallback.error) throw fallback.error;
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
}): Promise<boolean> {
  const { supabase, canonicalTable, canonicalCols, quoteId, bucketId, storagePath } = params;
  const q = await supabase
    .from(canonicalTable)
    .select("id", { head: true, count: "exact" })
    .eq("quote_id", quoteId)
    .eq(canonicalCols.bucketCol, bucketId)
    .eq(canonicalCols.pathCol, storagePath)
    .limit(1);
  if (q.error) throw q.error;
  return (q.count ?? 0) > 0;
}

async function insertCanonicalRow(params: {
  supabase: SupabaseClient;
  canonicalTable: CanonicalTable;
  canonicalCols: CanonicalColumns;
  quoteId: string;
  upload: UploadRow;
  obj: StorageObjectRow;
}): Promise<Record<string, unknown>> {
  const { supabase, canonicalTable, canonicalCols, quoteId, upload, obj } = params;
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

  const ins = await supabase.from(canonicalTable).insert(row);
  if (ins.error) throw ins.error;
  return row;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    console.error("Missing required env vars: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
    return;
  }

  const supabase = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const canonicalTableUsed = await detectCanonicalTable(supabase);
  const canonicalCols = await detectCanonicalColumns(supabase, canonicalTableUsed);

  const quotes = await loadCandidateQuotes({ supabase, quoteId: args.quoteId, limit: args.limit });

  let eligibleQuotes = 0;
  let wouldInsertRows = 0;
  let insertedRows = 0;
  let skippedExisting = 0;
  let missingUploadId = 0;
  let missingUploadRows = 0;
  let missingStorageObjects = 0;

  for (const quote of quotes) {
    const quoteId = quote.id;
    const uploadId = quote.upload_id;
    if (!uploadId) {
      missingUploadId += 1;
      continue;
    }

    const upload = await loadUploadById({ supabase, uploadId });
    if (!upload) {
      missingUploadRows += 1;
      continue;
    }

    const obj = await resolveStorageObjectForUpload({ supabase, upload });
    if (!obj) {
      missingStorageObjects += 1;
      if (args.verbose) {
        console.log(
          JSON.stringify(
            {
              quoteId,
              uploadId,
              reason: "missing_storage_object",
              upload: {
                file_path: upload.file_path,
                file_name: upload.file_name,
                created_at: upload.created_at,
              },
            },
            null,
            2,
          ),
        );
      }
      continue;
    }

    eligibleQuotes += 1;

    const exists = await canonicalRowExists({
      supabase,
      canonicalTable: canonicalTableUsed,
      canonicalCols,
      quoteId,
      bucketId: "cad_uploads",
      storagePath: obj.name,
    });
    if (exists) {
      skippedExisting += 1;
      continue;
    }

    const plannedRow: Record<string, unknown> = {
      quote_id: quoteId,
      [canonicalCols.bucketCol]: "cad_uploads",
      [canonicalCols.pathCol]: obj.name,
      [canonicalCols.filenameCol]: basename(obj.name) || obj.name,
      mime: (upload.mime_type ?? "").trim() || deriveMimeFromExtension(basename(obj.name) || obj.name),
    };
    if (canonicalCols.hasSizeBytes) plannedRow.size_bytes = sizeBytesFromMetadata(obj.metadata);

    wouldInsertRows += 1;

    if (args.dryRun) {
      console.log(
        JSON.stringify(
          { action: "insert", table: canonicalTableUsed, row: plannedRow },
          null,
          2,
        ),
      );
      continue;
    }

    await insertCanonicalRow({
      supabase,
      canonicalTable: canonicalTableUsed,
      canonicalCols,
      quoteId,
      upload,
      obj,
    });
    insertedRows += 1;
  }

  const summary: Summary = {
    canonicalTableUsed,
    scannedQuotes: quotes.length,
    eligibleQuotes,
    wouldInsertRows,
    insertedRows,
    skippedExisting,
    missingUploadId,
    missingUploadRows,
    missingStorageObjects,
  };

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

