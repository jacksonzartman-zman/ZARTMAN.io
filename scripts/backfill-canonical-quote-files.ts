import { createClient } from "@supabase/supabase-js";

type CanonicalTable = "files_valid" | "files";

type Summary = {
  canonicalTableUsed: CanonicalTable;
  scannedQuotes: number;
  eligibleQuotes: number;
  insertedRows: number;
  skippedExisting: number;
  missingStorageObjects: number;
  perQuote?: Array<{
    quoteId: string;
    legacyFilenames: string[];
    matchedObjectCount: number;
    matchedSample: string[];
    plannedInserts: number;
    skippedExisting: number;
  }>;
};

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`[backfill] missing env: ${name}`);
    process.exit(1);
  }
  return v;
}

function parseArgs(argv: string[]) {
  const args = new Set(argv);
  const get = (name: string) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };

  const dryRun = args.has("--dryRun");
  const verbose = args.has("--verbose");
  const quoteId = get("--quoteId");
  const limitRaw = get("--limit");
  const limit = limitRaw ? Number(limitRaw) : 200;

  if (limitRaw && (!Number.isFinite(limit) || limit <= 0)) {
    throw new Error(`[backfill] invalid --limit: ${limitRaw}`);
  }
  if (quoteId && !/^[0-9a-fA-F-]{36}$/.test(quoteId)) {
    throw new Error(`[backfill] invalid --quoteId: ${quoteId}`);
  }

  return { dryRun, verbose, quoteId, limit };
}

function basename(p: string) {
  const parts = p.split("/");
  return parts[parts.length - 1] || p;
}

function extOf(filename: string) {
  const i = filename.lastIndexOf(".");
  return i >= 0 ? filename.slice(i + 1).toLowerCase() : "";
}

function mimeFor(filename: string) {
  const ext = extOf(filename);
  if (ext === "stl") return "model/stl";
  if (ext === "step" || ext === "stp") return "model/step";
  if (ext === "pdf") return "application/pdf";
  return "application/octet-stream";
}

async function detectCanonicalTable(supabase: any): Promise<CanonicalTable> {
  // Prefer files_valid if it exists; otherwise fallback to files.
  const probe = await supabase.from("files_valid").select("id").limit(1);
  if (!probe.error) return "files_valid";
  const msg = String(probe.error?.message || "");
  if (msg.toLowerCase().includes("relation") && msg.toLowerCase().includes("does not exist")) return "files";
  // If some other error happens, still try files_valid first (but log)
  console.warn("[backfill] warning probing files_valid:", msg);
  return "files_valid";
}

async function main() {
  const { dryRun, verbose, quoteId, limit } = parseArgs(process.argv.slice(2));

  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const canonicalTableUsed = await detectCanonicalTable(supabase);

  const summary: Summary = {
    canonicalTableUsed,
    scannedQuotes: 0,
    eligibleQuotes: 0,
    insertedRows: 0,
    skippedExisting: 0,
    missingStorageObjects: 0,
    ...(verbose ? { perQuote: [] } : {}),
  };

  // 1) Find candidate quotes (legacy filenames exist)
  // We only need: id, file_name, file_names
  let quotesQuery = supabase
    .from("quotes")
    .select("id,file_name,file_names")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (quoteId) quotesQuery = quotesQuery.eq("id", quoteId);

  const quotesRes = await quotesQuery;
  if (quotesRes.error) throw quotesRes.error;

  const quotes: Array<{ id: string; file_name: string | null; file_names: any }> = quotesRes.data || [];
  summary.scannedQuotes = quotes.length;

  for (const q of quotes) {
    const legacy: string[] = [];
    if (q.file_name && String(q.file_name).trim()) legacy.push(String(q.file_name).trim());

    // file_names could be text[] or json; handle both safely
    if (Array.isArray(q.file_names)) {
      for (const x of q.file_names) {
        if (x && String(x).trim()) legacy.push(String(x).trim());
      }
    }

    const legacyFilenames = Array.from(new Set(legacy));
    if (legacyFilenames.length === 0) continue;

    // 2) Skip quotes that already have canonical rows
    const canonCountRes = await supabase
      .from(canonicalTableUsed)
      .select("id", { count: "exact", head: true })
      .eq("quote_id", q.id);

    if (canonCountRes.error) throw canonCountRes.error;
    const canonCount = canonCountRes.count || 0;
    if (canonCount > 0) continue;

    summary.eligibleQuotes += 1;

    // 3) Load existing canonical (bucket,path) set for idempotency
    const existingRes = await supabase
      .from(canonicalTableUsed)
      .select("bucket_id,storage_bucket_id,storage_path,file_path")
      .eq("quote_id", q.id);

    if (existingRes.error) throw existingRes.error;

    const existing = new Set<string>();
    for (const row of existingRes.data || []) {
      const bucket = (row.bucket_id || row.storage_bucket_id || "cad_uploads") as string;
      const path = (row.storage_path || row.file_path || "") as string;
      if (path) existing.add(`${bucket}:${path}`);
    }

    // 4) Find storage objects for this quote.
    // We look in cad_uploads and cad-uploads; normalize bucket_id to cad_uploads on insert.
    const buckets = ["cad_uploads", "cad-uploads"] as const;

    const matchedKeys = new Set<string>();

    for (const bucket of buckets) {
      // Prefer quote-scoped prefixes first (low false positives)
      const prefixes = [
        `uploads/${q.id}/`,
        `uploads/${q.id}/uploads/`,
        `uploads/${q.id}/files/`,
        `quote_uploads/${q.id}/`,
        `quotes/${q.id}/`,
      ];

      for (const prefix of prefixes) {
        const r = await supabase
          .schema("storage")
          .from("objects")
          .select("name")
          .eq("bucket_id", bucket)
          .like("name", `${prefix}%`)
          .limit(200);

        if (r.error) throw r.error;
        for (const obj of r.data || []) matchedKeys.add(String(obj.name));
      }

      // Intake pattern (user-scoped) is hard to query without uid; do filename contains fallback
      if (matchedKeys.size === 0) {
        for (const fn of legacyFilenames) {
          const r = await supabase
            .schema("storage")
            .from("objects")
            .select("name")
            .eq("bucket_id", bucket)
            .ilike("name", `%${fn}%`)
            .limit(50);

          if (r.error) throw r.error;
          for (const obj of r.data || []) matchedKeys.add(String(obj.name));
        }
      }
    }

    const matched = Array.from(matchedKeys);

    if (verbose) {
      summary.perQuote!.push({
        quoteId: q.id,
        legacyFilenames,
        matchedObjectCount: matched.length,
        matchedSample: matched.slice(0, 5),
        plannedInserts: 0,
        skippedExisting: 0,
      });
    }

    if (matched.length === 0) {
      summary.missingStorageObjects += 1;
      continue;
    }

    // 5) Plan inserts (dedupe, normalize bucket, skip existing)
    const rowsToInsert: any[] = [];

    for (const key of matched) {
      const normalizedBucket = "cad_uploads";
      const idempotencyKey = `${normalizedBucket}:${key}`;
      if (existing.has(idempotencyKey)) {
        summary.skippedExisting += 1;
        if (verbose) {
          const last = summary.perQuote![summary.perQuote!.length - 1];
          last.skippedExisting += 1;
        }
        continue;
      }

      rowsToInsert.push({
        quote_id: q.id,
        bucket_id: normalizedBucket,
        storage_bucket_id: normalizedBucket,
        storage_path: key,
        file_path: key,
        filename: basename(key),
        mime: mimeFor(key),
      });
    }

    if (verbose) {
      const last = summary.perQuote![summary.perQuote!.length - 1];
      last.plannedInserts = rowsToInsert.length;
    }

    if (rowsToInsert.length === 0) continue;

    if (dryRun) {
      summary.insertedRows += rowsToInsert.length;
      continue;
    }

    // 6) Insert
    const ins = await supabase.from(canonicalTableUsed).insert(rowsToInsert);
    if (ins.error) throw ins.error;
    summary.insertedRows += rowsToInsert.length;
  }

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error("[backfill] fatal", err);
  process.exit(1);
});
