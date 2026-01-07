import { createClient } from "@supabase/supabase-js";

type CanonicalTable = "files_valid" | "files";

type CanonicalColumnConfig = {
  quoteId: "quote_id";
  bucket: "bucket_id" | "storage_bucket_id" | null /* required */;
  path: "storage_path" | "file_path" | null /* required */;
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

type PerQuoteVerbose = {
  quoteId: string;
  legacyFilenames: string[];
  matchedObjectKeysCount: number;
  matchedObjectKeysSample: string[];
  wouldInsertCount: number;
  skippedExistingCount: number;
  missingStorageObjects: boolean;
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

function mimeFromMetadata(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") return null;
  const m = metadata as Record<string, unknown>;
  const candidates = [m.mimetype, m.mimeType, m.contentType, m["content-type"]];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }
  return null;
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

function isMissingColumnError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const msg = String((error as { message?: unknown }).message ?? "").toLowerCase();
  // PostgREST uses "column <x> does not exist" style errors from Postgres.
  return msg.includes("column") && msg.includes("does not exist");
}

async function detectCanonicalColumns(
  supabase: ReturnType<typeof createClient>,
  canonicalTable: CanonicalTable,
): Promise<CanonicalColumnConfig> {
  // We avoid relying on `information_schema` being exposed via PostgREST.
  // Instead, we probe for valid column combos using head selects.
  const combos: Array<{
    bucket: NonNullable<CanonicalColumnConfig["bucket"]>;
    path: NonNullable<CanonicalColumnConfig["path"]>;
  }> = [
    { bucket: "bucket_id", path: "storage_path" },
    { bucket: "storage_bucket_id", path: "storage_path" },
    { bucket: "bucket_id", path: "file_path" },
    { bucket: "storage_bucket_id", path: "file_path" },
  ];

  let bucket: CanonicalColumnConfig["bucket"] = null;
  let path: CanonicalColumnConfig["path"] = null;

  for (const c of combos) {
    const probe = await supabase
      .from(canonicalTable)
      .select(`quote_id,${c.bucket},${c.path}`, { head: true })
      .limit(1);
    if (!probe.error) {
      bucket = c.bucket;
      path = c.path;
      break;
    }
    if (!isMissingColumnError(probe.error)) {
      // Permission or other non-column issue should surface immediately.
      throw probe.error;
    }
  }

  const filenameProbe = await supabase
    .from(canonicalTable)
    .select("filename", { head: true })
    .limit(1);

  let filenameCol: CanonicalColumnConfig["filename"] = null;
  if (!filenameProbe.error) {
    filenameCol = "filename";
  } else if (isMissingColumnError(filenameProbe.error)) {
    const alt = await supabase
      .from(canonicalTable)
      .select("file_name", { head: true })
      .limit(1);
    if (!alt.error) filenameCol = "file_name";
    else if (!isMissingColumnError(alt.error)) throw alt.error;
  } else {
    throw filenameProbe.error;
  }

  const mimeProbe = await supabase.from(canonicalTable).select("mime", { head: true }).limit(1);
  const mime: CanonicalColumnConfig["mime"] = !mimeProbe.error
    ? "mime"
    : isMissingColumnError(mimeProbe.error)
      ? null
      : (() => {
          throw mimeProbe.error;
        })();

  const sizeProbe = await supabase
    .from(canonicalTable)
    .select("size_bytes", { head: true })
    .limit(1);
  const sizeBytes: CanonicalColumnConfig["sizeBytes"] = !sizeProbe.error
    ? "size_bytes"
    : isMissingColumnError(sizeProbe.error)
      ? null
      : (() => {
          throw sizeProbe.error;
        })();

  return {
    quoteId: "quote_id",
    bucket,
    path,
    filename: filenameCol,
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

function normalizeBucketId(bucketId: string): string {
  return bucketId === "cad-uploads" ? "cad_uploads" : bucketId;
}

function canUseOrFilter(patterns: string[]): boolean {
  // PostgREST OR filters use commas as separators; commas inside patterns will break the filter string.
  // Parentheses can also cause confusion in some edge cases.
  return patterns.every((p) => !p.includes(",") && !p.includes("(") && !p.includes(")"));
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
    const take = (rows: unknown[] | null) => {
      for (const r of rows ?? []) {
        const row = r as StorageObjectRow;
        const key = `${row.bucket_id}:${row.name}`;
        if (seen.has(key)) continue;
        seen.add(key);
        all.push(row);
      }
    };

    // Pattern group A: uploads/intake/... + filename match (ILIKE %<filename>%)
    if (hints.length > 0) {
      const patterns = hints.map((f) => `uploads/intake/%${f}%`);
      if (canUseOrFilter(patterns)) {
        const q = await supabase
          .schema("storage")
          .from("objects")
          .select("name,bucket_id,metadata")
          .eq("bucket_id", bucket)
          .or(makeLikeOrFilter("name", patterns))
          .limit(200);
        if (q.error) throw q.error;
        take(q.data as unknown[]);
      } else {
        for (const p of patterns) {
          const q = await supabase
            .schema("storage")
            .from("objects")
            .select("name,bucket_id,metadata")
            .eq("bucket_id", bucket)
            .ilike("name", p)
            .limit(200);
          if (q.error) throw q.error;
          take(q.data as unknown[]);
        }
      }
    }

    // Pattern group B: uploads/... + filename match (covers uploads/<ts>-<random>-<filename>)
    if (hints.length > 0) {
      const patterns = hints.map((f) => `uploads/%${f}%`);
      if (canUseOrFilter(patterns)) {
        const q = await supabase
          .schema("storage")
          .from("objects")
          .select("name,bucket_id,metadata")
          .eq("bucket_id", bucket)
          .or(makeLikeOrFilter("name", patterns))
          .limit(200);
        if (q.error) throw q.error;
        take(q.data as unknown[]);
      } else {
        for (const p of patterns) {
          const q = await supabase
            .schema("storage")
            .from("objects")
            .select("name,bucket_id,metadata")
            .eq("bucket_id", bucket)
            .ilike("name", p)
            .limit(200);
          if (q.error) throw q.error;
          take(q.data as unknown[]);
        }
      }
    }

    // Pattern group C: quote-scoped prefix (uploads/<quoteId>/%)
    const qQuote = await supabase
      .schema("storage")
      .from("objects")
      .select("name,bucket_id,metadata")
      .eq("bucket_id", bucket)
      .ilike("name", `uploads/${quoteId}/%`)
      .limit(200);
    if (qQuote.error) throw qQuote.error;
    take(qQuote.data as unknown[]);

    // Loose fallback: anywhere in key (ILIKE %<filename>%) if prefix matching finds nothing for this bucket.
    if (hints.length > 0) {
      const hadAnyForBucket = Array.from(seen).some((k) => k.startsWith(`${bucket}:`));
      if (!hadAnyForBucket) {
        const patterns = hints.map((f) => `%${f}%`);
        if (canUseOrFilter(patterns)) {
          const q = await supabase
            .schema("storage")
            .from("objects")
            .select("name,bucket_id,metadata")
            .eq("bucket_id", bucket)
            .or(makeLikeOrFilter("name", patterns))
            .limit(200);
          if (q.error) throw q.error;
          take(q.data as unknown[]);
        } else {
          for (const p of patterns) {
            const q = await supabase
              .schema("storage")
              .from("objects")
              .select("name,bucket_id,metadata")
              .eq("bucket_id", bucket)
              .ilike("name", p)
              .limit(200);
            if (q.error) throw q.error;
            take(q.data as unknown[]);
          }
        }
      }
    }
  }

  return all.slice(0, 200);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    console.error(
      "Missing required env vars: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY",
    );
    process.exit(1);
    return;
  }

  let canonicalTableUsed: CanonicalTable | "unknown" = "unknown";
  let scannedQuotes = 0;
  let eligibleQuotes = 0;
  let insertedRows = 0;
  let skippedExisting = 0;
  let missingStorageObjects = 0;
  const perQuoteVerbose: PerQuoteVerbose[] = [];

  try {
    const supabase = createClient(url, serviceRoleKey, {
      auth: { persistSession: false },
    });

    const canonicalTable = await detectCanonicalTable(supabase);
    canonicalTableUsed = canonicalTable;
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
        if (args.verbose) {
          perQuoteVerbose.push({
            quoteId: quote.id,
            legacyFilenames: hintNamesRaw,
            matchedObjectKeysCount: 0,
            matchedObjectKeysSample: [],
            wouldInsertCount: 0,
            skippedExistingCount: 0,
            missingStorageObjects: true,
          });
        }
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
        const bRaw = String(row[canonicalColumns.bucket] ?? "");
        const b = normalizeBucketId(bRaw);
        const p = String(row[canonicalColumns.path] ?? "");
        if (!b || !p) continue;
        existing.add(`${b}:${p}`);
      }

      const toInsert: Record<string, unknown>[] = [];
      let quoteSkippedExisting = 0;

      for (const obj of matches) {
        const storagePath = obj.name;
        const filenameFromPath = baseFilename(obj.name);
        const bestLegacy = filenameHints.find((f) =>
          obj.name.toLowerCase().includes(f.toLowerCase()),
        );
        const filename = bestLegacy ?? filenameFromPath;
        const canonicalBucket = "cad_uploads"; // normalize, even when found in cad-uploads

        const key = `${canonicalBucket}:${storagePath}`;
        if (existing.has(key)) {
          skippedExisting += 1;
          quoteSkippedExisting += 1;
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
        if (canonicalColumns.mime) {
          row[canonicalColumns.mime] =
            mimeFromMetadata(obj.metadata) ?? mimeFromFilename(filename);
        }
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

      if (args.verbose) {
        const sample = matches
          .slice(0, 5)
          .map((m) => `${m.bucket_id}/${m.name}`)
          .filter(Boolean);
        perQuoteVerbose.push({
          quoteId: quote.id,
          legacyFilenames: hintNamesRaw,
          matchedObjectKeysCount: matches.length,
          matchedObjectKeysSample: sample,
          wouldInsertCount: toInsert.length,
          skippedExistingCount: quoteSkippedExisting,
          missingStorageObjects: false,
        });
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
  } finally {
    // Always print a final JSON summary to stdout (even if no eligible quotes).
    console.log(
      JSON.stringify({
        canonicalTableUsed,
        scannedQuotes,
        eligibleQuotes,
        insertedRows,
        skippedExisting,
        missingStorageObjects,
      }),
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

