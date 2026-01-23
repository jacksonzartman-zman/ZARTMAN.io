/**
 * Customer pricing estimate
 *
 * IMPORTANT:
 * - This is customer-facing logic. Keep output high-level and aggregated.
 * - Do NOT return raw deal rows or anything that could expose internal pricing logic.
 * - Estimates come from aggregated priors ("based on similar projects").
 */
import { hasPricingPriorsSchema } from "@/server/pricingPriors/schema";
import { serializeSupabaseError, isMissingTableOrColumnError } from "@/server/admin/logging";
 
type PartsBucket = "1" | "2-3" | "4-10" | "11+";
 
export type CustomerPricingEstimateConfidence = "strong" | "moderate" | "limited" | "unknown";
 
export type CustomerPricingEstimateSource =
  | "tech+mat+parts"
  | "tech+mat"
  | "tech+parts"
  | "tech"
  | "global";
 
export type CustomerPricingEstimate = {
  p10: number;
  p50: number;
  p90: number;
  confidence: CustomerPricingEstimateConfidence;
  source: CustomerPricingEstimateSource;
};
 
type PricingPriorRow = {
  technology: string;
  material_canon: string | null;
  parts_bucket: string | null;
  n: number;
  p10: unknown;
  p50: unknown;
  p90: unknown;
};
 
type NormalizedPrior = {
  technology: string;
  material_canon: string | null;
  parts_bucket: PartsBucket | null;
  n: number;
  p10: number;
  p50: number;
  p90: number;
};
 
const GLOBAL_TECHNOLOGY_SENTINEL = "__global__";
const SHRINKAGE_K = 50;
 
// Temporary server-side debug logging (deduped).
const pricingEstimateDebugOnceSeen = new Set<string>();
function pricingEstimateDebugOnce(key: string, payload: Record<string, unknown>) {
  if (pricingEstimateDebugOnceSeen.has(key)) return;
  pricingEstimateDebugOnceSeen.add(key);
  console.log("[pricing estimate debugOnce]", payload);
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const s = value.trim();
  return s.length ? s : null;
}
 
function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
 
export function partsBucketFromCount(partsCount: number | null | undefined): PartsBucket | null {
  if (typeof partsCount !== "number" || !Number.isFinite(partsCount) || partsCount <= 0) {
    return null;
  }
  const n = Math.trunc(partsCount);
  if (n === 1) return "1";
  if (n >= 2 && n <= 3) return "2-3";
  if (n >= 4 && n <= 10) return "4-10";
  return "11+";
}
 
function confidenceFromN(n: number): CustomerPricingEstimateConfidence {
  const nn = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
  if (nn >= 200) return "strong";
  if (nn >= 50) return "moderate";
  if (nn >= 10) return "limited";
  return "unknown";
}
 
function shrinkBlend(args: { child: NormalizedPrior; parent: NormalizedPrior }): Pick<CustomerPricingEstimate, "p10" | "p50" | "p90"> {
  const n = Math.max(0, Math.floor(args.child.n));
  const w = n / (n + SHRINKAGE_K);
  const blend = (child: number, parent: number) => w * child + (1 - w) * parent;
  return {
    p10: blend(args.child.p10, args.parent.p10),
    p50: blend(args.child.p50, args.parent.p50),
    p90: blend(args.child.p90, args.parent.p90),
  };
}
 
function normalizePriorRow(row: PricingPriorRow | null): NormalizedPrior | null {
  if (!row) return null;
  const technology = normalizeText(row.technology);
  if (!technology) return null;
 
  const material_canon = normalizeText(row.material_canon);
  const parts_bucket_raw = normalizeText(row.parts_bucket);
  const parts_bucket =
    parts_bucket_raw === "1" || parts_bucket_raw === "2-3" || parts_bucket_raw === "4-10" || parts_bucket_raw === "11+"
      ? (parts_bucket_raw as PartsBucket)
      : null;
 
  const n = toFiniteNumber(row.n);
  const p10 = toFiniteNumber(row.p10);
  const p50 = toFiniteNumber(row.p50);
  const p90 = toFiniteNumber(row.p90);
  if (n === null || p10 === null || p50 === null || p90 === null) return null;
 
  return {
    technology,
    material_canon: material_canon ?? null,
    parts_bucket,
    n: Math.max(0, Math.floor(n)),
    p10,
    p50,
    p90,
  };
}
 
type PriorKey = {
  technology: string;
  material_canon: string | null;
  parts_bucket: PartsBucket | null;
};
 
function keyString(k: PriorKey): string {
  return `${k.technology}\u001f${k.material_canon ?? ""}\u001f${k.parts_bucket ?? ""}`;
}
 
function buildFallbackPlan(args: {
  technology: string | null;
  materialCanon: string | null;
  partsBucket: PartsBucket | null;
}): Array<{ source: CustomerPricingEstimateSource; key: PriorKey }> {
  const technology = args.technology;
  const materialCanon = args.materialCanon;
  const bucket = args.partsBucket;
 
  const plan: Array<{ source: CustomerPricingEstimateSource; key: PriorKey }> = [];
 
  if (technology) {
    if (materialCanon && bucket) {
      plan.push({
        source: "tech+mat+parts",
        key: { technology, material_canon: materialCanon, parts_bucket: bucket },
      });
    }
 
    if (materialCanon) {
      plan.push({
        source: "tech+mat",
        key: { technology, material_canon: materialCanon, parts_bucket: null },
      });
    }
 
    if (bucket) {
      plan.push({
        source: "tech+parts",
        key: { technology, material_canon: null, parts_bucket: bucket },
      });
    }
 
    plan.push({
      source: "tech",
      key: { technology, material_canon: null, parts_bucket: null },
    });
  }
 
  plan.push({
    source: "global",
    key: { technology: GLOBAL_TECHNOLOGY_SENTINEL, material_canon: null, parts_bucket: null },
  });
 
  // De-dupe while preserving order.
  const seen = new Set<string>();
  return plan.filter((p) => {
    const s = `${p.source}:${keyString(p.key)}`;
    if (seen.has(s)) return false;
    seen.add(s);
    return true;
  });
}
 
function parentSource(source: CustomerPricingEstimateSource): CustomerPricingEstimateSource | null {
  if (source === "tech+mat+parts") return "tech+mat";
  if (source === "tech+mat") return "tech";
  if (source === "tech+parts") return "tech";
  if (source === "tech") return "global";
  return null;
}
 
function parentKey(args: {
  source: CustomerPricingEstimateSource;
  childKey: PriorKey;
}): PriorKey | null {
  const s = args.source;
  const child = args.childKey;
  if (s === "tech+mat+parts") {
    return { technology: child.technology, material_canon: child.material_canon, parts_bucket: null };
  }
  if (s === "tech+mat") {
    return { technology: child.technology, material_canon: null, parts_bucket: null };
  }
  if (s === "tech+parts") {
    return { technology: child.technology, material_canon: null, parts_bucket: null };
  }
  if (s === "tech") {
    return { technology: GLOBAL_TECHNOLOGY_SENTINEL, material_canon: null, parts_bucket: null };
  }
  return null;
}
 
/**
 * Pure estimate builder (unit-test friendly).
 *
 * - Applies fallback ladder:
 *   tech+mat+parts -> tech+mat -> tech+parts -> tech -> global
 * - Applies shrinkage toward the nearest available parent (k=50).
 * - Computes confidence from the selected group's n (not exposed to customers).
 */
export function computeCustomerPricingEstimateFromPriors(args: {
  technology: string | null;
  materialCanon: string | null;
  partsCount: number | null;
  priors: PricingPriorRow[];
}): CustomerPricingEstimate | null {
  const technology = normalizeText(args.technology);
  const materialCanon = normalizeText(args.materialCanon);
  const bucket = partsBucketFromCount(args.partsCount);
 
  const priorByKey = new Map<string, NormalizedPrior>();
  for (const row of args.priors ?? []) {
    const normalized = normalizePriorRow(row);
    if (!normalized) continue;
    const key: PriorKey = {
      technology: normalized.technology,
      material_canon: normalized.material_canon,
      parts_bucket: normalized.parts_bucket,
    };
    priorByKey.set(keyString(key), normalized);
  }
 
  const plan = buildFallbackPlan({ technology, materialCanon, partsBucket: bucket });
 
  let chosen: { source: CustomerPricingEstimateSource; key: PriorKey; prior: NormalizedPrior } | null = null;
  for (const step of plan) {
    const p = priorByKey.get(keyString(step.key));
    if (p) {
      chosen = { source: step.source, key: step.key, prior: p };
      break;
    }
  }
 
  if (!chosen) return null;
 
  // Shrinkage: blend toward nearest available parent.
  let blended = { p10: chosen.prior.p10, p50: chosen.prior.p50, p90: chosen.prior.p90 };
  let currentSource: CustomerPricingEstimateSource | null = chosen.source;
  let currentKey: PriorKey | null = chosen.key;
 
  while (currentSource && currentKey) {
    const pKey = parentKey({ source: currentSource, childKey: currentKey });
    const pSource = parentSource(currentSource);
    if (!pKey || !pSource) break;
 
    const parent = priorByKey.get(keyString(pKey));
    if (parent) {
      blended = shrinkBlend({ child: chosen.prior, parent });
      break;
    }
 
    // Walk up to the next parent.
    currentSource = pSource;
    currentKey = pKey;
  }
 
  return {
    p10: blended.p10,
    p50: blended.p50,
    p90: blended.p90,
    confidence: confidenceFromN(chosen.prior.n),
    source: chosen.source,
  };
}
 
async function fetchPriorRow(args: {
  technology: string;
  materialCanon: string | null;
  partsBucket: PartsBucket | null;
}): Promise<PricingPriorRow | null> {
  // Lazy import: keeps this module safe to import in unit tests.
  const { supabaseServer } = await import("@/lib/supabaseServer");
 
  let q = supabaseServer()
    .from("pricing_priors")
    .select("technology,material_canon,parts_bucket,n,p10,p50,p90")
    .eq("technology", args.technology)
    .limit(1);
 
  if (args.materialCanon) q = q.eq("material_canon", args.materialCanon);
  else q = q.is("material_canon", null);
 
  if (args.partsBucket) q = q.eq("parts_bucket", args.partsBucket);
  else q = q.is("parts_bucket", null);
 
  const { data, error } = await q.maybeSingle<PricingPriorRow>();
  if (error) {
    // Schema gating should prevent most of these, but tolerate drift.
    if (isMissingTableOrColumnError(error)) return null;
    console.warn("[pricing estimate] pricing_priors fetch failed", {
      error: serializeSupabaseError(error) ?? error,
    });
    return null;
  }
  return (data ?? null) as PricingPriorRow | null;
}
 
export async function getCustomerPricingEstimate(args: {
  technology: string | null;
  materialCanon: string | null;
  partsCount: number | null;
}): Promise<CustomerPricingEstimate | null> {
  const supported = await hasPricingPriorsSchema();
  pricingEstimateDebugOnce(`schema_supported=${supported}`, {
    schema_supported: supported,
  });
  if (!supported) return null;
 
  const technology = normalizeText(args.technology);
  const materialCanon = normalizeText(args.materialCanon);
  const bucket = partsBucketFromCount(args.partsCount);
 
  const plan = buildFallbackPlan({ technology, materialCanon, partsBucket: bucket });
 
  // Fetch candidates in ladder order until we find a match.
  let chosen: { source: CustomerPricingEstimateSource; key: PriorKey; prior: NormalizedPrior } | null = null;
  for (const step of plan) {
    const row = await fetchPriorRow({
      technology: step.key.technology,
      materialCanon: step.key.material_canon,
      partsBucket: step.key.parts_bucket,
    });
    const prior = normalizePriorRow(row);
    if (!prior) continue;
    chosen = { source: step.source, key: step.key, prior };
    break;
  }
 
  if (!chosen) return null;
 
  pricingEstimateDebugOnce(
    `chosen:${chosen.source}:${chosen.key.technology}|${chosen.key.material_canon ?? ""}|${chosen.key.parts_bucket ?? ""}`,
    {
      // Confirm call inputs (process/material/parts count) + computed bucket.
      inputs: {
        technology_raw: args.technology,
        material_canon_raw: args.materialCanon,
        parts_count_raw: args.partsCount,
        technology,
        material_canon: materialCanon,
        parts_bucket: bucket,
      },
      // Confirm chosen ladder step + exact group key + n.
      chosen: {
        source: chosen.source,
        group_key: {
          technology: chosen.key.technology,
          material_canon: chosen.key.material_canon,
          parts_bucket: chosen.key.parts_bucket,
        },
        n: chosen.prior.n,
      },
    },
  );

  // Fetch nearest available parent for shrinkage (walk up the chain).
  let parent: NormalizedPrior | null = null;
  let currentSource: CustomerPricingEstimateSource | null = chosen.source;
  let currentKey: PriorKey | null = chosen.key;
 
  while (currentSource && currentKey) {
    const pKey = parentKey({ source: currentSource, childKey: currentKey });
    const pSource = parentSource(currentSource);
    if (!pKey || !pSource) break;
 
    const row = await fetchPriorRow({
      technology: pKey.technology,
      materialCanon: pKey.material_canon,
      partsBucket: pKey.parts_bucket,
    });
    parent = normalizePriorRow(row);
    if (parent) break;
 
    currentSource = pSource;
    currentKey = pKey;
  }
 
  const blended = parent ? shrinkBlend({ child: chosen.prior, parent }) : { p10: chosen.prior.p10, p50: chosen.prior.p50, p90: chosen.prior.p90 };
 
  return {
    p10: blended.p10,
    p50: blended.p50,
    p90: blended.p90,
    confidence: confidenceFromN(chosen.prior.n),
    source: chosen.source,
  };
}

