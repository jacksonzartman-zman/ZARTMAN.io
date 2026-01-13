import { supabaseServer } from "@/lib/supabaseServer";
import { requireAdminUser } from "@/server/auth";
import { isMissingTableOrColumnError, serializeSupabaseError } from "@/server/admin/logging";

export type SupplierBenchHealthRow = {
  supplierId: string;
  supplierName: string;
  rfqsConsidered: number;
  rfqsBid: number;
  rfqsWon: number;
  winRatePct: number | null;
  mismatchCount: number | null;
  goodMatchCount: number | null;
  matchHealth: "good" | "caution" | "poor" | "unknown";
  avgCapacityRecent: number | null;
  lastCapacityUpdateAt: string | null;
  awardsLast30d: number | null;
  benchStatus: "underused" | "balanced" | "overused" | "unknown";
};

export type SupplierSelfBenchHealth = {
  matchHealth: "good" | "caution" | "poor" | "unknown";
  rfqsBid: number;
  rfqsWon: number;
  winRatePct: number | null;
  benchStatus: "underused" | "balanced" | "overused" | "unknown";
  awardsLast30d: number | null;
  lastCapacityUpdateAt: string | null;
};

type MatchHealthViewRow = {
  supplier_id: string;
  supplier_name: string | null;
  rfqs_considered_90d: number | null;
  rfqs_bid_90d: number | null;
  rfqs_won_90d: number | null;
  win_rate_pct_90d: number | null;
  mismatch_count: number | null;
  good_match_count: number | null;
  match_health: string | null;
};

type BenchUtilizationViewRow = {
  supplier_id: string;
  supplier_name: string | null;
  avg_capacity_recent: number | null;
  last_capacity_update_at: string | null;
  awards_last_30d: number | null;
  bench_status: string | null;
};

const MATCH_VIEW = "supplier_match_health_summary" as const;
const BENCH_VIEW = "supplier_bench_utilization_summary" as const;

const MATCH_VIEW_SELECT = [
  "supplier_id",
  "supplier_name",
  "rfqs_considered_90d",
  "rfqs_bid_90d",
  "rfqs_won_90d",
  "win_rate_pct_90d",
  "mismatch_count",
  "good_match_count",
  "match_health",
].join(",");

const BENCH_VIEW_SELECT = [
  "supplier_id",
  "supplier_name",
  "avg_capacity_recent",
  "last_capacity_update_at",
  "awards_last_30d",
  "bench_status",
].join(",");

function normalizeId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeMatchHealth(value: unknown): SupplierBenchHealthRow["matchHealth"] {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (normalized === "good" || normalized === "caution" || normalized === "poor") {
    return normalized;
  }
  return "unknown";
}

function normalizeBenchStatus(value: unknown): SupplierBenchHealthRow["benchStatus"] {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (normalized === "underused" || normalized === "balanced" || normalized === "overused") {
    return normalized;
  }
  return "unknown";
}

function toNumberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return null;
}

function toIntOrZero(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.floor(value));
  }
  return 0;
}

export async function loadAdminSupplierBenchHealth(ctx?: {
  authenticatedAdminUserId?: string;
}): Promise<SupplierBenchHealthRow[]> {
  // Defense-in-depth: this reads admin-only views using the service role key.
  // For admin notification refresh we can skip the auth check, since the entrypoint already validated admin.
  const authenticatedAdminUserId =
    typeof ctx?.authenticatedAdminUserId === "string" ? ctx.authenticatedAdminUserId.trim() : "";
  if (!authenticatedAdminUserId) {
    await requireAdminUser();
  }

  try {
    const [matchResult, benchResult] = await Promise.all([
      supabaseServer.from(MATCH_VIEW).select(MATCH_VIEW_SELECT).returns<MatchHealthViewRow[]>(),
      supabaseServer.from(BENCH_VIEW).select(BENCH_VIEW_SELECT).returns<BenchUtilizationViewRow[]>(),
    ]);

    if (matchResult.error) {
      throw matchResult.error;
    }
    if (benchResult.error) {
      throw benchResult.error;
    }

    const matchRows = Array.isArray(matchResult.data) ? matchResult.data : [];
    const benchRows = Array.isArray(benchResult.data) ? benchResult.data : [];

    const benchBySupplierId = new Map<string, BenchUtilizationViewRow>();
    for (const row of benchRows) {
      const supplierId = normalizeId(row?.supplier_id);
      if (!supplierId) continue;
      benchBySupplierId.set(supplierId, row);
    }

    const results: SupplierBenchHealthRow[] = [];

    for (const matchRow of matchRows) {
      const supplierId = normalizeId(matchRow?.supplier_id);
      if (!supplierId) continue;

      const benchRow = benchBySupplierId.get(supplierId) ?? null;
      const supplierName =
        normalizeString(matchRow?.supplier_name) ??
        normalizeString(benchRow?.supplier_name) ??
        supplierId;

      results.push({
        supplierId,
        supplierName,
        rfqsConsidered: toIntOrZero(matchRow?.rfqs_considered_90d),
        rfqsBid: toIntOrZero(matchRow?.rfqs_bid_90d),
        rfqsWon: toIntOrZero(matchRow?.rfqs_won_90d),
        winRatePct: toNumberOrNull(matchRow?.win_rate_pct_90d),
        mismatchCount: toNumberOrNull(matchRow?.mismatch_count),
        goodMatchCount: toNumberOrNull(matchRow?.good_match_count),
        matchHealth: normalizeMatchHealth(matchRow?.match_health),
        avgCapacityRecent: toNumberOrNull(benchRow?.avg_capacity_recent),
        lastCapacityUpdateAt: normalizeString(benchRow?.last_capacity_update_at),
        awardsLast30d: toNumberOrNull(benchRow?.awards_last_30d),
        benchStatus: normalizeBenchStatus(benchRow?.bench_status),
      });
    }

    // In case the match view is missing a supplier (unexpected), include bench-only suppliers.
    const seen = new Set(results.map((row) => row.supplierId));
    for (const benchRow of benchRows) {
      const supplierId = normalizeId(benchRow?.supplier_id);
      if (!supplierId || seen.has(supplierId)) continue;
      const supplierName = normalizeString(benchRow?.supplier_name) ?? supplierId;
      results.push({
        supplierId,
        supplierName,
        rfqsConsidered: 0,
        rfqsBid: 0,
        rfqsWon: 0,
        winRatePct: null,
        mismatchCount: null,
        goodMatchCount: null,
        matchHealth: "unknown",
        avgCapacityRecent: toNumberOrNull(benchRow?.avg_capacity_recent),
        lastCapacityUpdateAt: normalizeString(benchRow?.last_capacity_update_at),
        awardsLast30d: toNumberOrNull(benchRow?.awards_last_30d),
        benchStatus: normalizeBenchStatus(benchRow?.bench_status),
      });
    }

    return results;
  } catch (error) {
    if (isMissingTableOrColumnError(error)) {
      console.warn("[bench health] missing views; returning empty admin list", {
        supabaseError: serializeSupabaseError(error),
      });
      return [];
    }
    console.error("[bench health] admin load failed", {
      supabaseError: serializeSupabaseError(error) ?? error,
    });
    return [];
  }
}

export async function loadSupplierSelfBenchHealth(
  supplierId: string,
): Promise<SupplierSelfBenchHealth | null> {
  const normalizedSupplierId = normalizeId(supplierId);
  if (!normalizedSupplierId) return null;

  try {
    const [matchResult, benchResult] = await Promise.all([
      supabaseServer
        .from(MATCH_VIEW)
        .select(MATCH_VIEW_SELECT)
        .eq("supplier_id", normalizedSupplierId)
        .maybeSingle<MatchHealthViewRow>(),
      supabaseServer
        .from(BENCH_VIEW)
        .select(BENCH_VIEW_SELECT)
        .eq("supplier_id", normalizedSupplierId)
        .maybeSingle<BenchUtilizationViewRow>(),
    ]);

    if (matchResult.error) {
      throw matchResult.error;
    }
    if (benchResult.error) {
      throw benchResult.error;
    }

    const matchRow = matchResult.data ?? null;
    const benchRow = benchResult.data ?? null;
    const rfqsBid = toIntOrZero(matchRow?.rfqs_bid_90d);

    // Match the UI empty-state requirement: only show once they start bidding.
    if (rfqsBid <= 0) {
      return null;
    }

    return {
      matchHealth: normalizeMatchHealth(matchRow?.match_health),
      rfqsBid,
      rfqsWon: toIntOrZero(matchRow?.rfqs_won_90d),
      winRatePct: toNumberOrNull(matchRow?.win_rate_pct_90d),
      benchStatus: normalizeBenchStatus(benchRow?.bench_status),
      awardsLast30d: toNumberOrNull(benchRow?.awards_last_30d),
      lastCapacityUpdateAt: normalizeString(benchRow?.last_capacity_update_at),
    };
  } catch (error) {
    if (isMissingTableOrColumnError(error)) {
      console.warn("[bench health] missing views; returning null supplier summary", {
        supplierId: normalizedSupplierId,
        supabaseError: serializeSupabaseError(error),
      });
      return null;
    }
    console.error("[bench health] supplier self load failed", {
      supplierId: normalizedSupplierId,
      supabaseError: serializeSupabaseError(error) ?? error,
    });
    return null;
  }
}

export async function loadBenchHealthBySupplierIds(
  supplierIds: string[],
): Promise<
  Record<string, Pick<SupplierBenchHealthRow, "matchHealth" | "benchStatus">>
> {
  // Defense-in-depth: this reads admin-only views using the service role key.
  await requireAdminUser();

  const ids = Array.from(
    new Set(
      (Array.isArray(supplierIds) ? supplierIds : [])
        .map((id) => normalizeId(id))
        .filter((id) => id.length > 0),
    ),
  );
  if (ids.length === 0) return {};

  try {
    const [matchResult, benchResult] = await Promise.all([
      supabaseServer
        .from(MATCH_VIEW)
        .select("supplier_id,match_health")
        .in("supplier_id", ids)
        .returns<Array<Pick<MatchHealthViewRow, "supplier_id" | "match_health">>>(),
      supabaseServer
        .from(BENCH_VIEW)
        .select("supplier_id,bench_status")
        .in("supplier_id", ids)
        .returns<Array<Pick<BenchUtilizationViewRow, "supplier_id" | "bench_status">>>(),
    ]);

    if (matchResult.error) {
      throw matchResult.error;
    }
    if (benchResult.error) {
      throw benchResult.error;
    }

    const output: Record<
      string,
      Pick<SupplierBenchHealthRow, "matchHealth" | "benchStatus">
    > = {};

    for (const id of ids) {
      output[id] = { matchHealth: "unknown", benchStatus: "unknown" };
    }

    for (const row of matchResult.data ?? []) {
      const supplierId = normalizeId(row?.supplier_id);
      if (!supplierId) continue;
      output[supplierId] = {
        ...(output[supplierId] ?? { matchHealth: "unknown", benchStatus: "unknown" }),
        matchHealth: normalizeMatchHealth(row?.match_health),
      };
    }

    for (const row of benchResult.data ?? []) {
      const supplierId = normalizeId(row?.supplier_id);
      if (!supplierId) continue;
      output[supplierId] = {
        ...(output[supplierId] ?? { matchHealth: "unknown", benchStatus: "unknown" }),
        benchStatus: normalizeBenchStatus(row?.bench_status),
      };
    }

    return output;
  } catch (error) {
    if (isMissingTableOrColumnError(error)) {
      console.warn("[bench health] missing views; returning unknown labels", {
        supplierCount: ids.length,
        supabaseError: serializeSupabaseError(error),
      });
      return Object.fromEntries(
        ids.map((id) => [id, { matchHealth: "unknown", benchStatus: "unknown" }]),
      );
    }
    console.error("[bench health] supplier id lookup failed", {
      supplierCount: ids.length,
      supabaseError: serializeSupabaseError(error) ?? error,
    });
    return Object.fromEntries(
      ids.map((id) => [id, { matchHealth: "unknown", benchStatus: "unknown" }]),
    );
  }
}

