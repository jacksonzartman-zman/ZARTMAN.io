import { createClient } from "@supabase/supabase-js";

type CanonicalTable = "files_valid" | "files";

type CanonicalColumnConfig = {
  quoteId: "quote_id";
  bucket:
    | "bucket_id"
    | "storage_bucket_id"
    | null /* required, but tolerate unknown */;
  path: "storage_path" | "file_path" | null /* required, but tolerate unknown */;
  filename: "filename" | "file_name" | null;
  mime: "mime" | null;
  sizeBytes: "size_bytes" | null;
};

type QuoteRow = {
  id: string;
  user_id: string | null;
  file_name: string | null;
  file_names: unknown | null;
};

type StorageObjectRow = {
  name: string;
  bucket_id: string;
  metadata: unknown | null;
};

type CliArgs = {
  quoteId?: string;
  limit: number;
  dryRun: boolean;
  verbose: boolean;
};

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { limit: 200, dryRun: false, verbose: false };

  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];

    if (a === "--quoteId") {
      const v = argv[i + 1];
      if (!v) throw new Error("Missing value for --quoteId");
      args.quoteId = v;
      i += 1;
      continue;
    }

    if (a === "--limit") {
      const v = argv[i + 1];
      if (!v) throw new Error("Missing value for --limit");
      const n = Number(v);
      if (!Number.isFinite(n) || n <= 0) {
        throw new Error(`Invalid --limit value: ${v}`);
      }
      args.limit = Math.floor(n);
      i += 1;
      continue;
    }

    if (a === "--dryRun") {
      args.dryRun = true;
      continue;
    }

    if (a === "--verbose") {
      args.verbose = true;
      continue;
    }

    throw new Error(`Unknown arg: ${a}`);
  }

  return args;
}

function baseFilename(input: string): string {
  // Normalize to last path segment and preserve extension.
  const trimmed = input.trim();
  const parts = trimmed.split(/[/\\]/);
  return parts[parts.length - 1] ?? trimmed;
}

function dedupe<T>(items: T[]): T[] {
  const seen = new Set<T>();
  const out: T[] = [];
  for (const i of items) {
    if (seen.has(i)) continue;
    seen.add(i);
    out.push(i);
  }
  return out;
}

function mimeFromFilename(filename: string): string {
  const lower = filename.toLowerCase();
  const ext = lower.includes(".") ? lower.split(".").pop() : "";

  if (!ext) return "application/octet-stream";
  if (ext === "step" || ext === "stp") return "application/step";
  if (ext === "stl") return "model/stl";
  if (ext === "pdf") return "application/pdf";
  return "application/octet-stream";
}

function sizeBytesFromMetadata(metadata: unknown): number | null {
  if (!metadata || typeof metadata !== "object") return null;

  const m = metadata as Record<string, unknown>;
  const direct = m.size;
  if (typeof direct === "number" && Number.isFinite(direct)) return direct;
  if (typeof direct === "string") {
    const n = Number(direct);
    if (Number.isFinite(n)) return n;
  }

  const contentLength =
    m["content-length"] ?? m["content_length"] ?? m["Content-Length"];
  if (typeof contentLength === "number" && Number.isFinite(contentLength)) {
    return contentLength;
  }
  if (typeof contentLength === "string") {
    const n = Number(contentLength);
    if (Number.isFinite(n)) return n;
  }

  return null;
}

function isMissingRelationOrPermission(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const msg = String((error as { message?: unknown }).message ?? "");
  const code = String((error as { code?: unknown }).code ?? "");

  return (
    code === "42P01" || // undefined_table
    msg.includes("does not exist") ||
    msg.toLowerCase().includes("permission denied") ||
    msg.toLowerCase().includes("not allowed") ||
    msg.toLowerCase().includes("schema cache")
  );
}

async function detectCanonicalTable(supabase: ReturnType<typeof createClient>) {
  const probe = await supabase
    .from("files_valid")
    .select("id", { head: true })
    .limit(1);

  if (!probe.error) return "files_valid" as const;
  if (!isMissingRelationOrPermission(probe.error)) throw probe.error;

  const fallback = await supabase.from("files").select("id", { head: true }).limit(1);
  if (fallback.error) throw fallback.error;
  return "files" as const;
}

async function detectCanonicalColumns(
  supabase: ReturnType<typeof createClient>,
  canonicalTable: CanonicalTable,
): Promise<CanonicalColumnConfig> {
  const colRes = await supabase
    .schema("information_schema")
    .from("columns")
    .select("column_name")
    .eq("table_schema", "public")
    .eq("table_name", canonicalTable);

  let cols: string[] | null = null;

  if (!colRes.error && colRes.data) {
    cols = colRes.data
      .map((r) => (r as { column_name?: unknown }).column_name)
      .filter((c): c is string => typeof c === "string");
  } else {
    // Fallback: try to infer from an existing row.
    const sample = await supabase.from(canonicalTable).select("*").limit(1);
    if (sample.error) throw sample.error;
    if (!sample.data || sample.data.length === 0) {
      throw new Error(
        `Unable to detect columns for ${canonicalTable}: information_schema unavailable and table appears empty`,
      );
    }
    cols = Object.keys(sample.data[0] ?? {});
  }

  const has = (c: string) => cols?.includes(c) ?? false;

  const bucket: CanonicalColumnConfig["bucket"] = has("bucket_id")
    ? "bucket_id"
    : has("storage_bucket_id")
      ? "storage_bucket_id"
      : null;

  const path: CanonicalColumnConfig["path"] = has("storage_path")
    ? "storage_path"
    : has("file_path")
      ? "file_path"
      : null;

  const filename: CanonicalColumnConfig["filename"] = has("filename")
    ? "filename"
    : has("file_name")
      ? "file_name"
      : null;

  const mime: CanonicalColumnConfig["mime"] = has("mime") ? "mime" : null;
  const sizeBytes: CanonicalColumnConfig["sizeBytes"] = has("size_bytes")
    ? "size_bytes"
    : null;

  return {
    quoteId: "quote_id",
    bucket,
    path,
    filename,
    mime,
    sizeBytes,
  };
}

function coerceFileNames(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  // Sometimes arrays come back as Postgres array string (e.g. "{a,b}").
  if (typeof value === "string") {
    const s = value.trim();
    if (s.startsWith("{") && s.endsWith("}")) {
      const inner = s.slice(1, -1).trim();
      if (!inner) return [];
      return inner
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);
    }
  }
  return [];
}

function makeLikeOrFilter(column: string, patterns: string[]): string {
  // PostgREST OR filter format: "name.ilike.%foo,name.ilike.%bar"
  // NOTE: supabase-js will URL encode this string.
  return patterns.map((p) => `${column}.ilike.${p}`).join(",");
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function findStorageObjectsForQuote(params: {
  supabase: ReturnType<typeof createClient>;
  quoteId: string;
  filenameHints: string[];
  verbose: boolean;
}): Promise<StorageObjectRow[]> {
  const { supabase, quoteId, filenameHints } = params;
  const buckets = ["cad_uploads", "cad-uploads"] as const;

  // Bound OR filter size.
  const hints = filenameHints.slice(0, 30);

  const all: StorageObjectRow[] = [];
  const seen = new Set<string>(); // `${bucket}:${name}`

  for (const bucket of buckets) {
    // Pattern group 1: uploads/intake/% + suffix match for any hint
    if (hints.length > 0) {
      const suffixPatterns = hints.map((f) => `%${f}`);
      const q1 = await supabase
        .schema("storage")
        .from("objects")
        .select("name,bucket_id,metadata")
        .eq("bucket_id", bucket)
        .ilike("name", "uploads/intake/%")
        .or(makeLikeOrFilter("name", suffixPatterns))
        .limit(200);
      if (q1.error) throw q1.error;
      for (const row of q1.data ?? []) {
        const key = `${row.bucket_id}:${row.name}`;
        if (seen.has(key)) continue;
        seen.add(key);
        all.push(row as StorageObjectRow);
      }
    }

    // Pattern group 2: uploads/% + suffix match for any hint
    if (hints.length > 0) {
      const suffixPatterns = hints.map((f) => `%${f}`);
      const q2 = await supabase
        .schema("storage")
        .from("objects")
        .select("name,bucket_id,metadata")
        .eq("bucket_id", bucket)
        .ilike("name", "uploads/%")
        .or(makeLikeOrFilter("name", suffixPatterns))
        .limit(200);
      if (q2.error) throw q2.error;
      for (const row of q2.data ?? []) {
        const key = `${row.bucket_id}:${row.name}`;
        if (seen.has(key)) continue;
        seen.add(key);
        all.push(row as StorageObjectRow);
      }
    }

    // Pattern group 3: contains quoteId (quote-scoped prefixes when present)
    const q3 = await supabase
      .schema("storage")
      .from("objects")
      .select("name,bucket_id,metadata")
      .eq("bucket_id", bucket)
      .ilike("name", `%${quoteId}%`)
      .limit(200);
    if (q3.error) throw q3.error;
    for (const row of q3.data ?? []) {
      const key = `${row.bucket_id}:${row.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      all.push(row as StorageObjectRow);
    }
  }

  return all.slice(0, 200);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error(
      "Missing required env vars: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY",
    );
  }

  const supabase = createClient(url, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const canonicalTable = await detectCanonicalTable(supabase);
  const canonicalColumns = await detectCanonicalColumns(supabase, canonicalTable);

  if (!canonicalColumns.bucket || !canonicalColumns.path) {
    throw new Error(
      `Unsupported ${canonicalTable} schema: expected bucket_id/storage_bucket_id and storage_path/file_path`,
    );
  }

  if (args.verbose) {
    console.log(
      `canonicalTable=${canonicalTable} bucketCol=${canonicalColumns.bucket} pathCol=${canonicalColumns.path}`,
    );
  }

  let scannedQuotes = 0;
  let eligibleQuotes = 0;
  let insertedRows = 0;
  let skippedExisting = 0;
  let missingStorageObjects = 0;

  let quotes: QuoteRow[] = [];

  if (args.quoteId) {
    const q = await supabase
      .from("quotes")
      .select("id,user_id,file_name,file_names")
      .eq("id", args.quoteId)
      .limit(1);
    if (q.error) throw q.error;
    quotes = (q.data ?? []) as QuoteRow[];
  } else {
    const q = await supabase
      .from("quotes")
      .select("id,user_id,file_name,file_names,created_at")
      .or("file_name.not.is.null,file_names.not.is.null")
      .order("created_at", { ascending: false })
      .limit(args.limit);
    if (q.error) throw q.error;
    quotes = (q.data ?? []).map((r) => {
      const rr = r as QuoteRow & { created_at?: unknown };
      return {
        id: rr.id,
        user_id: rr.user_id ?? null,
        file_name: rr.file_name ?? null,
        file_names: rr.file_names ?? null,
      };
    });
  }

  scannedQuotes = quotes.length;

  for (const quote of quotes) {
    const legacyFileNames = coerceFileNames(quote.file_names);
    const hintNamesRaw = dedupe(
      [
        typeof quote.file_name === "string" ? quote.file_name : null,
        ...legacyFileNames,
      ].filter((x): x is string => typeof x === "string" && x.trim().length > 0),
    );
    const filenameHints = dedupe(hintNamesRaw.map(baseFilename)).filter(Boolean);

    const hasHints = filenameHints.length > 0;
    if (!hasHints) continue;

    const canonicalCount = await supabase
      .from(canonicalTable)
      .select("id", { head: true, count: "exact" })
      .eq("quote_id", quote.id);
    if (canonicalCount.error) throw canonicalCount.error;
    const count = canonicalCount.count ?? 0;
    if (count !== 0) {
      if (args.verbose) {
        console.log(`skip quote=${quote.id} canonicalRows=${count}`);
      }
      continue;
    }

    eligibleQuotes += 1;

    if (args.verbose) {
      console.log(
        `quote=${quote.id} hints=${filenameHints.length} (${filenameHints.join(", ")})`,
      );
    }

    const matches = await findStorageObjectsForQuote({
      supabase,
      quoteId: quote.id,
      filenameHints,
      verbose: args.verbose,
    });

    if (matches.length === 0) {
      missingStorageObjects += 1;
      if (args.verbose) console.log(`  no storage objects found`);
      continue;
    }

    // Load existing canonical rows for this quote; skip any already present.
    const existingRes = await supabase
      .from(canonicalTable)
      .select(`${canonicalColumns.bucket},${canonicalColumns.path}`)
      .eq("quote_id", quote.id)
      .limit(5000);
    if (existingRes.error) throw existingRes.error;

    const existing = new Set<string>();
    for (const r of existingRes.data ?? []) {
      const row = r as Record<string, unknown>;
      const b = String(row[canonicalColumns.bucket] ?? "");
      const p = String(row[canonicalColumns.path] ?? "");
      if (!b || !p) continue;
      existing.add(`${b}:${p}`);
    }

    const toInsert: Record<string, unknown>[] = [];

    for (const obj of matches) {
      const storagePath = obj.name;
      const filename = baseFilename(obj.name);
      const canonicalBucket = "cad_uploads"; // normalize, even when found in cad-uploads

      const key = `${canonicalBucket}:${storagePath}`;
      if (existing.has(key)) {
        skippedExisting += 1;
        if (args.verbose) {
          console.log(`  skip existing bucket=${canonicalBucket} path=${storagePath}`);
        }
        continue;
      }

      const row: Record<string, unknown> = {
        quote_id: quote.id,
        [canonicalColumns.bucket]: canonicalBucket,
        [canonicalColumns.path]: storagePath,
      };

      if (canonicalColumns.filename) row[canonicalColumns.filename] = filename;
      if (canonicalColumns.mime) row[canonicalColumns.mime] = mimeFromFilename(filename);
      if (canonicalColumns.sizeBytes) {
        row[canonicalColumns.sizeBytes] = sizeBytesFromMetadata(obj.metadata);
      }

      toInsert.push(row);
      existing.add(key);

      if (args.verbose) {
        console.log(
          `  match bucket=${obj.bucket_id} -> ${canonicalBucket} path=${storagePath} filename=${filename}`,
        );
      }
    }

    if (toInsert.length === 0) continue;

    if (args.dryRun) {
      if (args.verbose) console.log(`  dryRun wouldInsert=${toInsert.length}`);
      continue;
    }

    for (const batch of chunk(toInsert, 100)) {
      const ins = await supabase.from(canonicalTable).insert(batch);
      if (ins.error) throw ins.error;
      insertedRows += batch.length;
    }
  }

  console.log(
    JSON.stringify(
      {
        canonicalTable,
        scannedQuotes,
        eligibleQuotes,
        insertedRows,
        skippedExisting,
        missingStorageObjects,
        dryRun: args.dryRun,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

