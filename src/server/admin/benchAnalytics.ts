import { supabaseServer } from "@/lib/supabaseServer";
import { requireAdminUser } from "@/server/auth";
import {
  isMissingTableOrColumnError,
  serializeSupabaseError,
} from "@/server/admin/logging";

export type BenchAnalyticsFilters = {
  range?: "30d" | "90d" | "365d";
  region?: string | null;
};

export type BenchUtilizationBucketCounts = {
  underused: number;
  balanced: number;
  overused: number;
  unknown: number;
};

export type BenchWinRateBucketCounts = {
  high: number; // >= 50% win
  medium: number; // 20–49%
  low: number; // 1–19%
  zero: number; // 0%
  unknown: number; // insufficient data
};

export type BenchAnalyticsSummary = {
  filters: BenchAnalyticsFilters & { from: string; to: string };
  utilizationBuckets: BenchUtilizationBucketCounts;
  winRateBuckets: BenchWinRateBucketCounts;
  totalSuppliers: number;
};

type SupplierMatchHealthRowLite = {
  supplier_id: string;
  rfqs_considered: number | null;
  win_rate_pct: number | null;
};

type SupplierBenchUtilRowLite = {
  supplier_id: string;
  bench_status: string | null;
};

type SupplierIdRow = { id: string };

const DEFAULT_RANGE: NonNullable<BenchAnalyticsFilters["range"]> = "90d";

function normalizeString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function parseRangeDays(value: BenchAnalyticsFilters["range"]): number {
  switch (value) {
    case "30d":
      return 30;
    case "365d":
      return 365;
    case "90d":
    default:
      return 90;
  }
}

function resolveWindowIso(range: BenchAnalyticsFilters["range"]): { from: string; to: string } {
  const days = parseRangeDays(range ?? DEFAULT_RANGE);
  const toMs = Date.now();
  const fromMs = toMs - days * 24 * 60 * 60 * 1000;
  return { from: new Date(fromMs).toISOString(), to: new Date(toMs).toISOString() };
}

function normalizeBenchStatus(value: unknown): keyof BenchUtilizationBucketCounts {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (normalized === "underused" || normalized === "balanced" || normalized === "overused") {
    return normalized;
  }
  return "unknown";
}

function bucketizeWinRatePct(
  winRatePct: number | null,
  rfqsConsidered: number | null,
): keyof BenchWinRateBucketCounts {
  const considered =
    typeof rfqsConsidered === "number" && Number.isFinite(rfqsConsidered)
      ? Math.max(0, rfqsConsidered)
      : 0;
  const pct =
    typeof winRatePct === "number" && Number.isFinite(winRatePct) ? winRatePct : null;

  if (considered <= 0 || pct === null) {
    return "unknown";
  }

  if (pct <= 0) return "zero";
  if (pct >= 50) return "high";
  if (pct >= 20) return "medium";
  return "low";
}

async function resolveSupplierIdsForRegion(region: string): Promise<Set<string> | null> {
  const needle = normalizeString(region);
  if (!needle) return null;

  try {
    const { data, error } = await supabaseServer()
      .from("suppliers")
      .select("id")
      .ilike("country", `%${needle}%`)
      .limit(5000)
      .returns<SupplierIdRow[]>();

    if (error) {
      if (isMissingTableOrColumnError(error)) {
        return null;
      }
      console.warn("[bench analytics] supplier region lookup failed", {
        region: needle,
        error: serializeSupabaseError(error) ?? error,
      });
      return null;
    }

    const ids = new Set<string>();
    for (const row of data ?? []) {
      const id = normalizeId(row?.id);
      if (id) ids.add(id);
    }
    return ids;
  } catch (error) {
    if (isMissingTableOrColumnError(error)) {
      return null;
    }
    console.warn("[bench analytics] supplier region lookup crashed", {
      region: needle,
      error: serializeSupabaseError(error) ?? error,
    });
    return null;
  }
}

async function loadMatchHealthWindow(days: number): Promise<SupplierMatchHealthRowLite[] | null> {
  // Attempt range-specific columns first, then fall back to 90d (the most commonly deployed).
  const preferredSelect = `supplier_id,rfqs_considered_${days}d,win_rate_pct_${days}d`;
  try {
    const preferred = await supabaseServer()
      .from("supplier_match_health_summary")
      .select(preferredSelect)
      .returns<
        Array<{
          supplier_id: string;
          [key: string]: unknown;
        }>
      >();
    if (!preferred.error) {
      const rows = Array.isArray(preferred.data) ? preferred.data : [];
      return rows.map((row) => ({
        supplier_id: row.supplier_id,
        rfqs_considered:
          typeof (row as any)[`rfqs_considered_${days}d`] === "number"
            ? ((row as any)[`rfqs_considered_${days}d`] as number)
            : null,
        win_rate_pct:
          typeof (row as any)[`win_rate_pct_${days}d`] === "number"
            ? ((row as any)[`win_rate_pct_${days}d`] as number)
            : null,
      }));
    }
    if (!isMissingTableOrColumnError(preferred.error)) {
      console.warn("[bench analytics] supplier_match_health_summary preferred window failed", {
        select: preferredSelect,
        error: serializeSupabaseError(preferred.error) ?? preferred.error,
      });
    }
  } catch (error) {
    if (!isMissingTableOrColumnError(error)) {
      console.warn("[bench analytics] supplier_match_health_summary preferred window crashed", {
        select: preferredSelect,
        error: serializeSupabaseError(error) ?? error,
      });
    }
  }

  try {
    const { data, error } = await supabaseServer()
      .from("supplier_match_health_summary")
      .select("supplier_id,rfqs_considered_90d,win_rate_pct_90d")
      .returns<
        Array<{
          supplier_id: string;
          rfqs_considered_90d: number | null;
          win_rate_pct_90d: number | null;
        }>
      >();

    if (error) {
      if (isMissingTableOrColumnError(error)) {
        return null;
      }
      console.warn("[bench analytics] supplier_match_health_summary query failed", {
        error: serializeSupabaseError(error) ?? error,
      });
      return [];
    }

    return (data ?? []).map((row) => ({
      supplier_id: row.supplier_id,
      rfqs_considered: row.rfqs_considered_90d ?? null,
      win_rate_pct: row.win_rate_pct_90d ?? null,
    }));
  } catch (error) {
    if (isMissingTableOrColumnError(error)) {
      return null;
    }
    console.warn("[bench analytics] supplier_match_health_summary query crashed", {
      error: serializeSupabaseError(error) ?? error,
    });
    return [];
  }
}

async function loadBenchUtilization(): Promise<SupplierBenchUtilRowLite[] | null> {
  try {
    const { data, error } = await supabaseServer()
      .from("supplier_bench_utilization_summary")
      .select("supplier_id,bench_status")
      .returns<SupplierBenchUtilRowLite[]>();

    if (error) {
      if (isMissingTableOrColumnError(error)) {
        return null;
      }
      console.warn("[bench analytics] supplier_bench_utilization_summary query failed", {
        error: serializeSupabaseError(error) ?? error,
      });
      return [];
    }

    return Array.isArray(data) ? data : [];
  } catch (error) {
    if (isMissingTableOrColumnError(error)) {
      return null;
    }
    console.warn("[bench analytics] supplier_bench_utilization_summary query crashed", {
      error: serializeSupabaseError(error) ?? error,
    });
    return [];
  }
}

export async function loadBenchAnalytics(
  filters: BenchAnalyticsFilters,
): Promise<BenchAnalyticsSummary> {
  // Defense-in-depth: analytics uses admin-only views.
  await requireAdminUser();

  const normalizedFilters: BenchAnalyticsFilters = {
    range: filters.range ?? DEFAULT_RANGE,
    region: normalizeString(filters.region),
  };

  const window = resolveWindowIso(normalizedFilters.range);

  const empty: BenchAnalyticsSummary = {
    filters: { ...normalizedFilters, from: window.from, to: window.to },
    utilizationBuckets: { underused: 0, balanced: 0, overused: 0, unknown: 0 },
    winRateBuckets: { high: 0, medium: 0, low: 0, zero: 0, unknown: 0 },
    totalSuppliers: 0,
  };

  const days = parseRangeDays(normalizedFilters.range);

  let allowedSupplierIds: Set<string> | null = null;
  if (normalizedFilters.region) {
    allowedSupplierIds = await resolveSupplierIdsForRegion(normalizedFilters.region);
    // If we cannot resolve region → ids (schema drift, missing suppliers table, etc),
    // keep behavior safe by falling back to "no region filter" rather than returning empty.
    if (allowedSupplierIds && allowedSupplierIds.size === 0) {
      // Legit “no suppliers in this region” case.
      return empty;
    }
  }

  const [matchRows, benchRows] = await Promise.all([
    loadMatchHealthWindow(days),
    loadBenchUtilization(),
  ]);

  // Missing views: log + safe empty default.
  if (matchRows === null || benchRows === null) {
    console.warn("[bench analytics] views missing; returning empty buckets", {
      matchViewMissing: matchRows === null,
      benchViewMissing: benchRows === null,
    });
    return empty;
  }

  const utilizationBuckets: BenchUtilizationBucketCounts = {
    underused: 0,
    balanced: 0,
    overused: 0,
    unknown: 0,
  };
  const winRateBuckets: BenchWinRateBucketCounts = {
    high: 0,
    medium: 0,
    low: 0,
    zero: 0,
    unknown: 0,
  };

  const supplierIdUnion = new Set<string>();

  for (const row of benchRows) {
    const supplierId = normalizeId(row?.supplier_id);
    if (!supplierId) continue;
    if (allowedSupplierIds && !allowedSupplierIds.has(supplierId)) continue;
    supplierIdUnion.add(supplierId);
    utilizationBuckets[normalizeBenchStatus(row?.bench_status)] += 1;
  }

  for (const row of matchRows) {
    const supplierId = normalizeId(row?.supplier_id);
    if (!supplierId) continue;
    if (allowedSupplierIds && !allowedSupplierIds.has(supplierId)) continue;
    supplierIdUnion.add(supplierId);
    winRateBuckets[bucketizeWinRatePct(row.win_rate_pct, row.rfqs_considered)] += 1;
  }

  return {
    filters: { ...normalizedFilters, from: window.from, to: window.to },
    utilizationBuckets,
    winRateBuckets,
    totalSuppliers: supplierIdUnion.size,
  };
}

