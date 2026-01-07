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
  hasMime: boolean;
  hasSizeBytes: boolean;
};

type StorageObjectRow = {
  name: string;
  bucket_id: string;
  metadata: unknown | null;
};

type PerQuoteVerbose = {
  quoteId: string;
  legacyFilenames: string[];
  matchedCount: number;
  sampleKeys: string[];
};

type Summary = {
  canonicalTableUsed: CanonicalTable;
  scannedQuotes: number;
  eligibleQuotes: number;
  insertedRows: number;
  skippedExisting: number;
  missingStorageObjects: number;
  perQuote?: PerQuoteVerbose[];
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

function uniq(items: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const it of items) {
    const v = it.trim();
    if (!v) continue;
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
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
  const direct = m.size ?? m["content-length"] ?? m["content_length"] ?? m["Content-Length"];
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

async function loadQuotesForBackfill(
  supabase: any,
  quoteId: string | undefined,
  limit: number
): Promise<Array<{ id: string; file_name: string | null }>> {
  let q = supabase.from("quotes").select("id,file_name");
  if (quoteId) q = q.eq("id", quoteId);
  q = q.limit(limit);

  const res = await q;
  if (res.error) throw res.error;

  return (res.data || []).map((r: any) => ({
    id: r.id,
    file_name: r.file_name ?? null
  }));
}

async function detectCanonicalTable(supabase: SupabaseClient): Promise<CanonicalTable> {
  const probe = await supabase.from("files_valid").select("id", { head: true }).limit(1);
  if (!probe.error) return "files_valid";
  if (!isMissingRelationError(probe.error)) throw probe.error;

  const fallback = await supabase.from("files").select("id", { head: true }).limit(1);
  if (fallback.error) throw fallback.error;
  return "files";
}

async function detectCanonicalColumns(
  supabase: SupabaseClient,
  table: CanonicalTable,
): Promise<CanonicalColumns> {
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

  const hasMime = await (async () => {
    const q = await supabase.from(table).select("mime", { head: true }).limit(1);
    if (!q.error) return true;
    if (isMissingColumnError(q.error)) return false;
    throw q.error;
  })();

  const hasSizeBytes = await (async () => {
    const q = await supabase.from(table).select("size_bytes", { head: true }).limit(1);
    if (!q.error) return true;
    if (isMissingColumnError(q.error)) return false;
    throw q.error;
  })();

  return { bucketCol, pathCol, filenameCol, hasMime, hasSizeBytes };
}

async function listObjectsByLike(params: {
  supabase: SupabaseClient;
  bucketId: string;
  like: string;
  maxRows: number;
}): Promise<StorageObjectRow[]> {
  const { supabase, bucketId, like, maxRows } = params;
  const pageSize = 1000;
  const out: StorageObjectRow[] = [];

  for (let offset = 0; offset < maxRows; offset += pageSize) {
    const q = await supabase
      .schema("storage")
      .from("objects")
      .select("name,bucket_id,metadata")
      .eq("bucket_id", bucketId)
      .like("name", like)
      .range(offset, offset + pageSize - 1);
    if (q.error) throw q.error;
    const rows = (q.data ?? []) as StorageObjectRow[];
    out.push(...rows);
    if (rows.length < pageSize) break;
  }

  return out;
}

async function listObjectsByILike(params: {
  supabase: SupabaseClient;
  bucketId: string;
  ilike: string;
  maxRows: number;
}): Promise<StorageObjectRow[]> {
  const { supabase, bucketId, ilike, maxRows } = params;
  const pageSize = 1000;
  const out: StorageObjectRow[] = [];

  for (let offset = 0; offset < maxRows; offset += pageSize) {
    const q = await supabase
      .schema("storage")
      .from("objects")
      .select("name,bucket_id,metadata")
      .eq("bucket_id", bucketId)
      .ilike("name", ilike)
      .range(offset, offset + pageSize - 1);
    if (q.error) throw q.error;
    const rows = (q.data ?? []) as StorageObjectRow[];
    out.push(...rows);
    if (rows.length < pageSize) break;
  }

  return out;
}

async function scanStorageForQuote(params: {
  supabase: SupabaseClient;
  quoteId: string;
  legacyFilenames: string[];
}): Promise<StorageObjectRow[]> {
  const { supabase, quoteId, legacyFilenames } = params;
  const buckets = ["cad_uploads", "cad-uploads"] as const;

  for (const bucketId of buckets) {
    const matches: StorageObjectRow[] = [];
    const seen = new Set<string>();

    const take = (rows: StorageObjectRow[]) => {
      for (const r of rows) {
        if (!r?.name) continue;
        if (seen.has(r.name)) continue;
        seen.add(r.name);
        matches.push(r);
      }
    };

    // 1) Prefix scan (in order)
    const p1 = `uploads/intake/%/${quoteId}/%`;
    const r1 = await listObjectsByLike({ supabase, bucketId, like: p1, maxRows: 5000 });
    take(r1);

    if (r1.length === 0) {
      const p2 = `uploads/intake/%/%`;
      const r2 = await listObjectsByLike({ supabase, bucketId, like: p2, maxRows: 5000 });
      // Best-effort filter to avoid unrelated intake rows.
      const filtered = r2.filter((r) => r.name.includes(quoteId));
      take(filtered);
    }

    const p3 = `uploads/${quoteId}/%`;
    take(await listObjectsByLike({ supabase, bucketId, like: p3, maxRows: 5000 }));

    const p4 = `quotes/${quoteId}/%`;
    take(await listObjectsByLike({ supabase, bucketId, like: p4, maxRows: 5000 }));

    if (matches.length === 0) {
      const p5 = `uploads/%`;
      const r5 = await listObjectsByLike({ supabase, bucketId, like: p5, maxRows: 5000 });
      const filtered = r5.filter((r) => r.name.includes(quoteId));
      take(filtered);
    }

    // 2) Fallback contains scan per legacy filename (only if nothing found)
    if (matches.length === 0) {
      for (const fn of legacyFilenames) {
        const needle = fn.trim();
        if (!needle) continue;
        const rows = await listObjectsByILike({
          supabase,
          bucketId,
          ilike: `%${needle}%`,
          maxRows: 2000,
        });
        take(rows);
      }
    }

    if (matches.length > 0) {
      return matches;
    }
  }

  return [];
}

async function loadEligibleQuotes(params: {
  supabase: SupabaseClient;
  canonicalTable: CanonicalTable;
  quoteId?: string;
  limit: number;
}): Promise<{ scannedQuotes: number; eligible: Array<{ quoteId: string; legacyFilenames: string[] }> }> {
  const { supabase, canonicalTable, quoteId, limit } = params;

  const quoteRows = await loadQuotesForBackfill(supabase, quoteId, limit);

  const scannedQuotes = quoteRows.length;
  const candidates = quoteRows
    .map((q) => {
      const legacyFilenames: string[] = [];
      if (q.file_name && String(q.file_name).trim()) legacyFilenames.push(String(q.file_name).trim());

      return { quoteId: q.id, legacyFilenames: uniq(legacyFilenames) };
    })
    .filter((r) => r.legacyFilenames.length > 0);

  if (candidates.length === 0) return { scannedQuotes, eligible: [] };

  if (quoteId) {
    const only = candidates[0];
    const existing = await supabase
      .from(canonicalTable)
      .select("id", { head: true, count: "exact" })
      .eq("quote_id", only.quoteId);
    if (existing.error) throw existing.error;
    if ((existing.count ?? 0) !== 0) return { scannedQuotes, eligible: [] };
    return { scannedQuotes, eligible: [only] };
  }

  // Filter out any quote that already has canonical rows in the chosen canonical table.
  const ids = candidates.map((c) => c.quoteId);
  const existing = await supabase.from(canonicalTable).select("quote_id").in("quote_id", ids).limit(5000);
  if (existing.error) throw existing.error;
  const existingIds = new Set((existing.data ?? []).map((r) => (r as { quote_id?: string }).quote_id).filter(Boolean));

  const eligible = candidates.filter((c) => !existingIds.has(c.quoteId));
  return { scannedQuotes, eligible: eligible.slice(0, limit) };
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

  const { scannedQuotes, eligible } = await loadEligibleQuotes({
    supabase,
    canonicalTable: canonicalTableUsed,
    quoteId: args.quoteId,
    limit: args.limit,
  });

  let insertedRows = 0;
  let skippedExisting = 0;
  let missingStorageObjects = 0;
  const perQuote: PerQuoteVerbose[] = [];

  for (const q of eligible) {
    // Scan storage for object keys.
    const objects = await scanStorageForQuote({
      supabase,
      quoteId: q.quoteId,
      legacyFilenames: q.legacyFilenames,
    });

    const objectKeys = uniq(objects.map((o) => o.name));
    if (objectKeys.length === 0) {
      missingStorageObjects += 1;
      if (args.verbose) {
        perQuote.push({
          quoteId: q.quoteId,
          legacyFilenames: q.legacyFilenames,
          matchedCount: 0,
          sampleKeys: [],
        });
      }
      continue;
    }

    // Load existing canonical paths for this quote and skip any already present.
    const existingRes = await supabase
      .from(canonicalTableUsed)
      .select(`${canonicalCols.pathCol}`)
      .eq("quote_id", q.quoteId)
      .limit(5000);
    if (existingRes.error) throw existingRes.error;
    const existingPaths = new Set(
      (existingRes.data ?? [])
        .map((r) => (r as Record<string, unknown>)[canonicalCols.pathCol])
        .filter((v): v is string => typeof v === "string" && v.trim().length > 0),
    );

    const toInsert: Array<Record<string, unknown>> = [];

    for (const obj of objects) {
      const storagePath = obj.name;
      if (existingPaths.has(storagePath)) {
        skippedExisting += 1;
        continue;
      }

      const filename = basename(storagePath) || storagePath;
      const row: Record<string, unknown> = {
        quote_id: q.quoteId,
        [canonicalCols.bucketCol]: "cad_uploads",
        [canonicalCols.pathCol]: storagePath,
        [canonicalCols.filenameCol]: filename,
      };

      if (canonicalCols.hasMime) row.mime = deriveMimeFromExtension(filename);
      if (canonicalCols.hasSizeBytes) row.size_bytes = sizeBytesFromMetadata(obj.metadata);

      toInsert.push(row);
      existingPaths.add(storagePath);
    }

    if (args.verbose) {
      perQuote.push({
        quoteId: q.quoteId,
        legacyFilenames: q.legacyFilenames,
        matchedCount: objectKeys.length,
        sampleKeys: objectKeys.slice(0, 5),
      });
    }

    if (toInsert.length === 0) continue;
    if (args.dryRun) continue;

    // Insert in batches (idempotent under unique constraint + our in-memory path set).
    const batchSize = 100;
    for (let i = 0; i < toInsert.length; i += batchSize) {
      const batch = toInsert.slice(i, i + batchSize);
      const ins = await supabase.from(canonicalTableUsed).insert(batch);
      if (ins.error) throw ins.error;
      insertedRows += batch.length;
    }
  }

  const summary: Summary = {
    canonicalTableUsed,
    scannedQuotes,
    eligibleQuotes: eligible.length,
    insertedRows,
    skippedExisting,
    missingStorageObjects,
  };
  if (args.verbose) summary.perQuote = perQuote;

  // Required output: final JSON summary to stdout.
  // Keep stdout machine-readable by avoiding any other writes to stdout.
  process.stdout.write(`${JSON.stringify(summary)}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

