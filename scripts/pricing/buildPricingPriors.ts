/**
 * buildPricingPriors.ts
 *
 * Purpose
 * - Read the canonical pricing CSV produced by `convertPricingNumbersToCsv.ts`
 * - Filter to `amount > 0`
 * - Derive `parts_bucket`:
 *    - 1
 *    - 2-3
 *    - 4-10
 *    - 11+
 *   (null if `parts_count` is missing / invalid)
 * - Aggregate priors keyed by (technology, material_canon, parts_bucket):
 *    - n
 *    - p10 / p50 / p90
 * - Also compute parent “fallback” groups:
 *    - (technology, material_canon, null)
 *    - (technology, null, parts_bucket)
 *    - (technology, null, null)
 *    - (global nulls): (null, null, null)
 * - Write a deterministic JSON artifact at `/tmp/pricing_priors.json`
 * - Optionally upsert into Supabase `public.pricing_priors` using service role
 *   when env vars exist; otherwise print a small summary.
 *
 * Determinism notes
 * - Groups are emitted in a stable sorted order.
 * - Percentiles are computed from sorted samples using a fixed method (R-7 / Hyndman-Fan type 7).
 * - Output numbers are rounded to 2 decimals to keep stable JSON and avoid floating noise.
 * - The JSON artifact intentionally does NOT include timestamps.
 *
 * Usage
 *   npx tsx scripts/pricing/buildPricingPriors.ts \
 *     --in data/pricing_for_algo.cleaned.csv \
 *     --out /tmp/pricing_priors.json
 *
 * Upsert behavior
 * - If `--noUpsert` is provided: never upsert.
 * - Else if `--upsert` is provided: require Supabase env vars and upsert.
 * - Else (default): auto-upsert only if env vars exist; otherwise print summary.
 *
 * Required CSV headers (exact):
 *   amount, technology, material_canon, parts_count
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

type PartsBucket = "1" | "2-3" | "4-10" | "11+" | null;

type CanonicalCsvRow = {
  amount: number;
  technology: string | null;
  material_canon: string | null;
  parts_count: number | null;
  parts_bucket: PartsBucket;
};

type PriorKey = {
  technology: string | null;
  material_canon: string | null;
  parts_bucket: PartsBucket;
};

type PriorRow = PriorKey & {
  n: number;
  p10: number;
  p50: number;
  p90: number;
};

type CliArgs = {
  inPath: string;
  outPath: string;
  upsertMode: "auto" | "yes" | "no";
};

const DEFAULT_IN = resolve(process.cwd(), "data/pricing_for_algo.cleaned.csv");
const DEFAULT_OUT = "/tmp/pricing_priors.json";

const GLOBAL_TECH_SENTINEL = "__global__";

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = { inPath: DEFAULT_IN, outPath: DEFAULT_OUT, upsertMode: "auto" };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--help" || a === "-h") printHelpAndExit(0);
    if (a === "--in") {
      const v = argv[i + 1];
      if (!v) throw new Error("Missing value for --in");
      out.inPath = resolve(process.cwd(), v);
      i += 1;
      continue;
    }
    if (a === "--out") {
      const v = argv[i + 1];
      if (!v) throw new Error("Missing value for --out");
      out.outPath = resolve(process.cwd(), v);
      i += 1;
      continue;
    }
    if (a === "--upsert") {
      out.upsertMode = "yes";
      continue;
    }
    if (a === "--noUpsert") {
      out.upsertMode = "no";
      continue;
    }
    throw new Error(`Unknown arg: ${a}`);
  }
  return out;
}

function printHelpAndExit(code: number): never {
  // eslint-disable-next-line no-console
  console.log(
    [
      "buildPricingPriors.ts",
      "",
      "Builds pricing priors (p10/p50/p90) from the canonical pricing CSV.",
      "",
      "Usage:",
      "  npx tsx scripts/pricing/buildPricingPriors.ts --in data/pricing_for_algo.cleaned.csv --out /tmp/pricing_priors.json",
      "",
      "Options:",
      `  --in <path>         Default: ${DEFAULT_IN}`,
      `  --out <path>        Default: ${DEFAULT_OUT}`,
      "  --upsert            Force Supabase upsert (requires env vars)",
      "  --noUpsert          Disable Supabase upsert even if env vars exist",
      "",
      "Supabase env vars (service role):",
      "  - NEXT_PUBLIC_SUPABASE_URL (preferred) or SUPABASE_URL",
      "  - SUPABASE_SERVICE_ROLE_KEY",
      "",
    ].join("\n"),
  );
  process.exit(code);
}

function normalizeSpaces(s: string): string {
  return String(s ?? "").trim().replace(/\s+/g, " ");
}

function normalizeNullableText(raw: string): string | null {
  const s = normalizeSpaces(raw);
  return s.length ? s : null;
}

function parseNumber(raw: string): number | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const isParenNeg = /^\(.*\)$/.test(s);
  const cleaned = s
    .replace(/^\(/, "")
    .replace(/\)$/, "")
    .replace(/[$,]/g, "")
    .replace(/[%]/g, "")
    .trim();
  if (!cleaned) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return isParenNeg ? -n : n;
}

function parseInteger(raw: string): number | null {
  const n = parseNumber(raw);
  if (n === null) return null;
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

function round2(n: number): number {
  // Stable rounding for currency-ish values.
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function partsBucket(partsCount: number | null): PartsBucket {
  if (partsCount === null) return null;
  if (!Number.isFinite(partsCount) || partsCount <= 0) return null;
  if (partsCount === 1) return "1";
  if (partsCount >= 2 && partsCount <= 3) return "2-3";
  if (partsCount >= 4 && partsCount <= 10) return "4-10";
  return "11+";
}

function parseQuotedCsvLine(line: string): string[] {
  // Minimal RFC4180-ish parser: supports quotes and escaped quotes.
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i] ?? "";
    if (ch === '"') {
      const next = line[i + 1] ?? "";
      if (inQuotes && next === '"') {
        cur += '"';
        i += 1;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && ch === ",") {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function requireHeaderIndex(headers: string[], expected: string): number {
  const idx = headers.findIndex((h) => normalizeSpaces(h).toLowerCase() === expected.toLowerCase());
  if (idx < 0) {
    throw new Error(
      `Missing required CSV column "${expected}". Got headers: ${JSON.stringify(headers)}`,
    );
  }
  return idx;
}

function loadCanonicalCsv(inPath: string): CanonicalCsvRow[] {
  if (!existsSync(inPath)) {
    throw new Error(
      `Input file not found: ${inPath}\n` +
        "Expected the canonical CSV produced earlier (via convertPricingNumbersToCsv.ts).",
    );
  }

  const raw = readFileSync(inPath, "utf8");
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.replace(/\uFEFF/g, ""))
    .filter((l) => l.trim().length > 0);

  if (lines.length < 2) {
    throw new Error("CSV must have a header row and at least one data row.");
  }

  const headers = parseQuotedCsvLine(lines[0] ?? "");
  const amountIdx = requireHeaderIndex(headers, "amount");
  const technologyIdx = requireHeaderIndex(headers, "technology");
  const materialCanonIdx = requireHeaderIndex(headers, "material_canon");
  const partsCountIdx = requireHeaderIndex(headers, "parts_count");

  const out: CanonicalCsvRow[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cells = parseQuotedCsvLine(lines[i] ?? "");
    const amount = parseNumber(cells[amountIdx] ?? "");
    if (amount === null || !(amount > 0)) continue;

    const technology = normalizeNullableText(cells[technologyIdx] ?? "");
    const material_canon = normalizeNullableText(cells[materialCanonIdx] ?? "");
    const parts_count = parseInteger(cells[partsCountIdx] ?? "");
    const parts_bucket = partsBucket(parts_count);

    out.push({
      amount,
      technology,
      material_canon,
      parts_count,
      parts_bucket,
    });
  }
  return out;
}

function keyToString(k: PriorKey): string {
  const t = k.technology ?? "";
  const m = k.material_canon ?? "";
  const b = k.parts_bucket ?? "";
  // Use a separator that won't appear in normal fields.
  return `${t}\u001f${m}\u001f${b}`;
}

function stringToKey(s: string): PriorKey {
  const [t, m, b] = s.split("\u001f");
  return {
    technology: t ? t : null,
    material_canon: m ? m : null,
    parts_bucket: (b ? (b as Exclude<PartsBucket, null>) : null) as PartsBucket,
  };
}

function computeQuantileR7(sorted: number[], q: number): number {
  if (sorted.length === 0) throw new Error("computeQuantileR7 requires non-empty input");
  if (sorted.length === 1) return sorted[0] ?? 0;
  const n = sorted.length;
  const h = (n - 1) * q + 1;
  const k = Math.floor(h);
  const d = h - k;
  const xk = sorted[k - 1] ?? sorted[0]!;
  const xk1 = sorted[Math.min(k, n - 1)] ?? sorted[n - 1]!;
  return xk + d * (xk1 - xk);
}

function compareNullable(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a.localeCompare(b);
}

function compareBucket(a: PartsBucket, b: PartsBucket): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  const order: Record<Exclude<PartsBucket, null>, number> = { "1": 1, "2-3": 2, "4-10": 3, "11+": 4 };
  return (order[a] ?? 999) - (order[b] ?? 999);
}

function buildPriors(rows: CanonicalCsvRow[]): PriorRow[] {
  const buckets = new Map<string, number[]>();

  for (const r of rows) {
    const amount = r.amount;
    // Each record contributes to:
    // - exact (tech, mat, bucket)
    // - (tech, mat, null)
    // - (tech, null, bucket)
    // - (tech, null, null)
    // - global (null, null, null)
    const candidates: PriorKey[] = [
      { technology: r.technology, material_canon: r.material_canon, parts_bucket: r.parts_bucket },
      { technology: r.technology, material_canon: r.material_canon, parts_bucket: null },
      { technology: r.technology, material_canon: null, parts_bucket: r.parts_bucket },
      { technology: r.technology, material_canon: null, parts_bucket: null },
      { technology: null, material_canon: null, parts_bucket: null },
    ];

    const seen = new Set<string>();
    for (const k of candidates) {
      const ks = keyToString(k);
      if (seen.has(ks)) continue;
      seen.add(ks);
      const arr = buckets.get(ks);
      if (arr) arr.push(amount);
      else buckets.set(ks, [amount]);
    }
  }

  const priors: PriorRow[] = [];
  for (const [ks, amounts] of buckets.entries()) {
    const key = stringToKey(ks);
    const sorted = [...amounts].sort((a, b) => a - b);
    const p10 = round2(computeQuantileR7(sorted, 0.1));
    const p50 = round2(computeQuantileR7(sorted, 0.5));
    const p90 = round2(computeQuantileR7(sorted, 0.9));
    priors.push({
      ...key,
      n: sorted.length,
      p10,
      p50,
      p90,
    });
  }

  priors.sort((a, b) => {
    const ct = compareNullable(a.technology, b.technology);
    if (ct !== 0) return ct;
    const cm = compareNullable(a.material_canon, b.material_canon);
    if (cm !== 0) return cm;
    return compareBucket(a.parts_bucket, b.parts_bucket);
  });

  return priors;
}

function hasSupabaseEnv(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return Boolean(url && key);
}

async function upsertPriors(priors: PriorRow[]) {
  const { createClient } = await import("@supabase/supabase-js");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error("Missing Supabase env vars (NEXT_PUBLIC_SUPABASE_URL or SUPABASE_URL) and/or SUPABASE_SERVICE_ROLE_KEY");
  }

  const supabase = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let skippedNullTechnology = 0;
  const payload = priors
    .map((p) => {
      // DB requires technology NOT NULL. We map the explicit “global nulls” row to a sentinel.
      if (p.technology === null && p.material_canon === null && p.parts_bucket === null) {
        return {
          technology: GLOBAL_TECH_SENTINEL,
          material_canon: null,
          parts_bucket: null,
          n: p.n,
          p10: p.p10,
          p50: p.p50,
          p90: p.p90,
          updated_at: new Date().toISOString(),
        };
      }
      if (p.technology === null || !p.technology.trim()) {
        skippedNullTechnology += 1;
        return null;
      }
      return {
        technology: p.technology,
        material_canon: p.material_canon,
        parts_bucket: p.parts_bucket,
        n: p.n,
        p10: p.p10,
        p50: p.p50,
        p90: p.p90,
        updated_at: new Date().toISOString(),
      };
    })
    .filter((v): v is NonNullable<typeof v> => Boolean(v));

  const batchSize = 500;
  let upserted = 0;

  for (let i = 0; i < payload.length; i += batchSize) {
    const chunk = payload.slice(i, i + batchSize);
    const res = await supabase
      .from("pricing_priors")
      .upsert(chunk, { onConflict: "technology,material_canon,parts_bucket" });
    if (res.error) throw res.error;
    upserted += chunk.length;
  }

  return { upserted, skippedNullTechnology };
}

function printSummary(opts: {
  sourceRows: number;
  priors: PriorRow[];
  outPath: string;
  didUpsert: boolean;
  upserted?: number;
  skippedNullTechnology?: number;
}) {
  const globalRow = opts.priors.find(
    (p) => p.technology === null && p.material_canon === null && p.parts_bucket === null,
  );
  const exactRows = opts.priors.filter((p) => p.technology !== null && p.material_canon !== null && p.parts_bucket !== null).length;
  const techOnlyRows = opts.priors.filter((p) => p.technology !== null && p.material_canon === null && p.parts_bucket === null).length;

  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      {
        inputRowsUsed: opts.sourceRows,
        priorsRows: opts.priors.length,
        priorsExactRows: exactRows,
        priorsTechOnlyRows: techOnlyRows,
        global: globalRow
          ? { n: globalRow.n, p10: globalRow.p10, p50: globalRow.p50, p90: globalRow.p90 }
          : null,
        artifact: opts.outPath,
        upsert: opts.didUpsert
          ? { ok: true, upserted: opts.upserted ?? 0, skippedNullTechnology: opts.skippedNullTechnology ?? 0, table: "public.pricing_priors" }
          : { ok: false, reason: "missing env vars or disabled" },
      },
      null,
      2,
    ),
  );
}

async function run() {
  const args = parseArgs(process.argv.slice(2));

  const rows = loadCanonicalCsv(args.inPath);
  const priors = buildPriors(rows);

  const artifact = {
    schemaVersion: 1,
    input: {
      path: args.inPath,
      note: "Rows filtered to amount > 0; parts_bucket derived from parts_count; percentiles use R-7 method.",
    },
    globalTechnologySentinelForDb: GLOBAL_TECH_SENTINEL,
    priors,
  };

  writeFileSync(args.outPath, JSON.stringify(artifact, null, 2) + "\n", "utf8");

  const auto = args.upsertMode === "auto";
  const shouldUpsert =
    args.upsertMode === "yes" ? true : args.upsertMode === "no" ? false : auto && hasSupabaseEnv();

  if (!shouldUpsert) {
    printSummary({
      sourceRows: rows.length,
      priors,
      outPath: args.outPath,
      didUpsert: false,
    });
    return;
  }

  if (!hasSupabaseEnv()) {
    throw new Error(
      "Requested upsert but Supabase env vars are missing. Provide NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY.",
    );
  }

  const { upserted, skippedNullTechnology } = await upsertPriors(priors);
  printSummary({
    sourceRows: rows.length,
    priors,
    outPath: args.outPath,
    didUpsert: true,
    upserted,
    skippedNullTechnology,
  });
}

run().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});

