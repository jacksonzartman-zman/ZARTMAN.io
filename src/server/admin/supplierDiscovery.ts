import { supabaseServer } from "@/lib/supabaseServer";
import { requireAdminUser } from "@/server/auth";
import {
  isMissingTableOrColumnError,
  serializeSupabaseError,
} from "@/server/admin/logging";
import { loadBenchHealthBySupplierIds } from "@/server/suppliers/benchHealth";

export type SupplierDiscoveryFilters = {
  search?: string | null;
  process?: string | null;
  material?: string | null;
  region?: string | null;
  matchHealth?: "good" | "caution" | "poor" | "unknown" | null;
  benchStatus?: "underused" | "balanced" | "overused" | "unknown" | null;
};

export type SupplierDiscoveryRow = {
  supplierId: string;
  name: string;
  primaryEmail: string | null;
  region: string | null;
  processes: string[];
  materials: string[];
  matchHealth: "good" | "caution" | "poor" | "unknown";
  benchStatus: "underused" | "balanced" | "overused" | "unknown";
  rfqsConsidered90d: number | null;
  rfqsBid90d: number | null;
  rfqsWon90d: number | null;
  winRate90d: number | null; // percent, best-effort (matches view output)
  awardsLast30d: number | null;
  lastCapacityUpdateAt: string | null;
};

type SupplierBaseRow = {
  id: string;
  company_name: string | null;
  primary_email: string | null;
  region?: string | null;
  country?: string | null;
  is_active?: boolean | null;
  status?: string | null;
};

type SupplierCapabilityRow = {
  supplier_id: string;
  process: string | null;
  materials: string[] | null;
};

type MatchHealthSummaryRow = {
  supplier_id: string;
  rfqs_considered_90d: number | null;
  rfqs_bid_90d: number | null;
  rfqs_won_90d: number | null;
  win_rate_pct_90d: number | null;
};

type BenchUtilizationSummaryRow = {
  supplier_id: string;
  awards_last_30d: number | null;
  last_capacity_update_at: string | null;
};

const SUPPLIERS_TABLE = "suppliers" as const;
const CAPABILITIES_TABLE = "supplier_capabilities" as const;
const MATCH_VIEW = "supplier_match_health_summary" as const;
const BENCH_VIEW = "supplier_bench_utilization_summary" as const;

function normalizeId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeFilterValue(value: unknown): string | null {
  const trimmed = normalizeString(value);
  return trimmed ? trimmed : null;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .filter((v) => v.length > 0);
}

function normalizeMatchHealth(value: unknown): SupplierDiscoveryRow["matchHealth"] {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (normalized === "good" || normalized === "caution" || normalized === "poor") {
    return normalized;
  }
  return "unknown";
}

function normalizeBenchStatus(value: unknown): SupplierDiscoveryRow["benchStatus"] {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (normalized === "underused" || normalized === "balanced" || normalized === "overused") {
    return normalized;
  }
  return "unknown";
}

function toNumberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}

function includesNormalized(haystack: string[], needle: string): boolean {
  const target = needle.trim().toLowerCase();
  if (!target) return false;
  return haystack.some((item) => item.trim().toLowerCase() === target);
}

function benchStatusSortKey(value: SupplierDiscoveryRow["benchStatus"]): number {
  // Lower is better.
  if (value === "underused") return 0;
  if (value === "balanced") return 1;
  if (value === "overused") return 2;
  return 3;
}

function matchHealthSortKey(value: SupplierDiscoveryRow["matchHealth"]): number {
  // Lower is better.
  if (value === "good") return 0;
  if (value === "caution") return 1;
  if (value === "poor") return 2;
  return 3;
}

async function selectActiveSuppliers(args: {
  search: string | null;
  region: string | null;
}): Promise<{ rows: SupplierBaseRow[]; usedRegionField: "region" | "country" | null }> {
  const search = normalizeFilterValue(args.search);
  const region = normalizeFilterValue(args.region);

  const applyCommonFilters = (query: any) => {
    let q = query;
    if (search) {
      const term = search.replaceAll("%", "\\%").replaceAll(",", "\\,");
      q = q.or(`company_name.ilike.%${term}%,primary_email.ilike.%${term}%`);
    }
    return q;
  };

  // Attempt 1: is_active + region
  try {
    let q = supabaseServer
      .from(SUPPLIERS_TABLE)
      .select("id,company_name,primary_email,region,is_active,status")
      .eq("is_active", true)
      .order("company_name", { ascending: true })
      .limit(2000);
    q = applyCommonFilters(q);
    if (region) {
      q = q.eq("region", region);
    }
    const { data, error } = await q.returns<SupplierBaseRow[]>();
    if (error) throw error;
    return { rows: Array.isArray(data) ? data : [], usedRegionField: "region" };
  } catch (error) {
    if (!isMissingTableOrColumnError(error)) {
      console.error("[supplier discovery] supplier query failed (is_active+region)", {
        supabaseError: serializeSupabaseError(error) ?? error,
      });
      return { rows: [], usedRegionField: null };
    }
    console.warn("[supplier discovery] missing schema for supplier query (is_active+region); falling back", {
      supabaseError: serializeSupabaseError(error),
    });
  }

  // Attempt 2: status=approved + region
  try {
    let q = supabaseServer
      .from(SUPPLIERS_TABLE)
      .select("id,company_name,primary_email,region,status")
      .eq("status", "approved")
      .order("company_name", { ascending: true })
      .limit(2000);
    q = applyCommonFilters(q);
    if (region) {
      q = q.eq("region", region);
    }
    const { data, error } = await q.returns<SupplierBaseRow[]>();
    if (error) throw error;
    return { rows: Array.isArray(data) ? data : [], usedRegionField: "region" };
  } catch (error) {
    if (!isMissingTableOrColumnError(error)) {
      console.error("[supplier discovery] supplier query failed (status=approved+region)", {
        supabaseError: serializeSupabaseError(error) ?? error,
      });
      return { rows: [], usedRegionField: null };
    }
    console.warn(
      "[supplier discovery] missing schema for supplier query (status=approved+region); falling back",
      { supabaseError: serializeSupabaseError(error) },
    );
  }

  // Attempt 3: country as region field + no active flag
  try {
    let q = supabaseServer
      .from(SUPPLIERS_TABLE)
      .select("id,company_name,primary_email,country,status")
      .order("company_name", { ascending: true })
      .limit(2000);
    q = applyCommonFilters(q);
    if (region) {
      q = q.eq("country", region);
    }
    const { data, error } = await q.returns<SupplierBaseRow[]>();
    if (error) throw error;
    return { rows: Array.isArray(data) ? data : [], usedRegionField: "country" };
  } catch (error) {
    if (isMissingTableOrColumnError(error)) {
      console.warn("[supplier discovery] suppliers table missing; returning empty", {
        supabaseError: serializeSupabaseError(error),
      });
      return { rows: [], usedRegionField: null };
    }
    console.error("[supplier discovery] supplier query failed (fallback country)", {
      supabaseError: serializeSupabaseError(error) ?? error,
    });
    return { rows: [], usedRegionField: null };
  }
}

async function loadCapabilitiesBySupplierId(
  supplierIds: string[],
): Promise<{ processesBySupplier: Map<string, Set<string>>; materialsBySupplier: Map<string, Set<string>> }> {
  const ids = Array.from(new Set((supplierIds ?? []).map(normalizeId).filter(Boolean)));
  const processesBySupplier = new Map<string, Set<string>>();
  const materialsBySupplier = new Map<string, Set<string>>();
  if (ids.length === 0) {
    return { processesBySupplier, materialsBySupplier };
  }

  try {
    const { data, error } = await supabaseServer
      .from(CAPABILITIES_TABLE)
      .select("supplier_id,process,materials")
      .in("supplier_id", ids)
      .returns<SupplierCapabilityRow[]>();

    if (error) {
      throw error;
    }

    for (const row of data ?? []) {
      const supplierId = normalizeId(row?.supplier_id);
      if (!supplierId) continue;

      const process = normalizeString(row?.process);
      if (process) {
        const set = processesBySupplier.get(supplierId) ?? new Set<string>();
        set.add(process);
        processesBySupplier.set(supplierId, set);
      }

      const materials = normalizeStringArray(row?.materials);
      if (materials.length > 0) {
        const set = materialsBySupplier.get(supplierId) ?? new Set<string>();
        for (const m of materials) set.add(m);
        materialsBySupplier.set(supplierId, set);
      }
    }

    return { processesBySupplier, materialsBySupplier };
  } catch (error) {
    if (isMissingTableOrColumnError(error)) {
      console.warn("[supplier discovery] supplier_capabilities missing; returning empty capabilities", {
        supplierCount: ids.length,
        supabaseError: serializeSupabaseError(error),
      });
      return { processesBySupplier, materialsBySupplier };
    }
    console.error("[supplier discovery] capabilities load failed", {
      supplierCount: ids.length,
      supabaseError: serializeSupabaseError(error) ?? error,
    });
    return { processesBySupplier, materialsBySupplier };
  }
}

async function tryLoadMatchSummaryBySupplierId(
  supplierIds: string[],
): Promise<Map<string, MatchHealthSummaryRow>> {
  const ids = Array.from(new Set((supplierIds ?? []).map(normalizeId).filter(Boolean)));
  const map = new Map<string, MatchHealthSummaryRow>();
  if (ids.length === 0) return map;

  try {
    const { data, error } = await supabaseServer
      .from(MATCH_VIEW)
      .select(
        "supplier_id,rfqs_considered_90d,rfqs_bid_90d,rfqs_won_90d,win_rate_pct_90d",
      )
      .in("supplier_id", ids)
      .returns<MatchHealthSummaryRow[]>();

    if (error) throw error;

    for (const row of data ?? []) {
      const supplierId = normalizeId(row?.supplier_id);
      if (!supplierId) continue;
      map.set(supplierId, row);
    }
    return map;
  } catch (error) {
    if (isMissingTableOrColumnError(error)) {
      console.warn("[supplier discovery] match summary view missing; continuing without stats", {
        supplierCount: ids.length,
        supabaseError: serializeSupabaseError(error),
      });
      return new Map();
    }
    console.error("[supplier discovery] match summary view load failed", {
      supplierCount: ids.length,
      supabaseError: serializeSupabaseError(error) ?? error,
    });
    return new Map();
  }
}

async function tryLoadBenchSummaryBySupplierId(
  supplierIds: string[],
): Promise<Map<string, BenchUtilizationSummaryRow>> {
  const ids = Array.from(new Set((supplierIds ?? []).map(normalizeId).filter(Boolean)));
  const map = new Map<string, BenchUtilizationSummaryRow>();
  if (ids.length === 0) return map;

  try {
    const { data, error } = await supabaseServer
      .from(BENCH_VIEW)
      .select("supplier_id,awards_last_30d,last_capacity_update_at")
      .in("supplier_id", ids)
      .returns<BenchUtilizationSummaryRow[]>();

    if (error) throw error;

    for (const row of data ?? []) {
      const supplierId = normalizeId(row?.supplier_id);
      if (!supplierId) continue;
      map.set(supplierId, row);
    }
    return map;
  } catch (error) {
    if (isMissingTableOrColumnError(error)) {
      console.warn("[supplier discovery] bench summary view missing; continuing without stats", {
        supplierCount: ids.length,
        supabaseError: serializeSupabaseError(error),
      });
      return new Map();
    }
    console.error("[supplier discovery] bench summary view load failed", {
      supplierCount: ids.length,
      supabaseError: serializeSupabaseError(error) ?? error,
    });
    return new Map();
  }
}

export async function loadSupplierDiscovery(
  filters: SupplierDiscoveryFilters,
): Promise<SupplierDiscoveryRow[]> {
  // Defense-in-depth: admin-only view, service role reads.
  await requireAdminUser();

  const search = normalizeFilterValue(filters?.search);
  const process = normalizeFilterValue(filters?.process);
  const material = normalizeFilterValue(filters?.material);
  const region = normalizeFilterValue(filters?.region);
  const matchHealthFilter = normalizeMatchHealth(filters?.matchHealth);
  const benchStatusFilter = normalizeBenchStatus(filters?.benchStatus);

  try {
    const { rows: suppliers, usedRegionField } = await selectActiveSuppliers({
      search,
      region,
    });

    const supplierIds = Array.from(
      new Set((suppliers ?? []).map((row) => normalizeId(row?.id)).filter(Boolean)),
    );
    if (supplierIds.length === 0) {
      return [];
    }

    const [benchHealthMap, capabilities, matchSummaryMap, benchSummaryMap] =
      await Promise.all([
        loadBenchHealthBySupplierIds(supplierIds),
        loadCapabilitiesBySupplierId(supplierIds),
        tryLoadMatchSummaryBySupplierId(supplierIds),
        tryLoadBenchSummaryBySupplierId(supplierIds),
      ]);

    const results: SupplierDiscoveryRow[] = [];

    for (const supplier of suppliers ?? []) {
      const supplierId = normalizeId(supplier?.id);
      if (!supplierId) continue;

      const name =
        normalizeString(supplier?.company_name) ??
        normalizeString(supplier?.primary_email) ??
        "(Unnamed supplier)";

      const primaryEmail = normalizeString(supplier?.primary_email);
      const supplierRegionRaw =
        usedRegionField === "region"
          ? (supplier as SupplierBaseRow).region
          : usedRegionField === "country"
            ? (supplier as SupplierBaseRow).country
            : (supplier as SupplierBaseRow).region ?? (supplier as SupplierBaseRow).country ?? null;
      const supplierRegion = normalizeString(supplierRegionRaw);

      const processesSet = capabilities.processesBySupplier.get(supplierId) ?? new Set();
      const materialsSet = capabilities.materialsBySupplier.get(supplierId) ?? new Set();
      const processes = Array.from(processesSet).sort((a, b) => a.localeCompare(b));
      const materials = Array.from(materialsSet).sort((a, b) => a.localeCompare(b));

      const benchHealth = benchHealthMap[supplierId] ?? {
        matchHealth: "unknown" as const,
        benchStatus: "unknown" as const,
      };

      const matchSummary = matchSummaryMap.get(supplierId) ?? null;
      const benchSummary = benchSummaryMap.get(supplierId) ?? null;

      results.push({
        supplierId,
        name,
        primaryEmail,
        region: supplierRegion,
        processes,
        materials,
        matchHealth: normalizeMatchHealth(benchHealth.matchHealth),
        benchStatus: normalizeBenchStatus(benchHealth.benchStatus),
        rfqsConsidered90d: toNumberOrNull(matchSummary?.rfqs_considered_90d),
        rfqsBid90d: toNumberOrNull(matchSummary?.rfqs_bid_90d),
        rfqsWon90d: toNumberOrNull(matchSummary?.rfqs_won_90d),
        winRate90d: toNumberOrNull(matchSummary?.win_rate_pct_90d),
        awardsLast30d: toNumberOrNull(benchSummary?.awards_last_30d),
        lastCapacityUpdateAt: normalizeString(benchSummary?.last_capacity_update_at),
      });
    }

    const filtered = results.filter((row) => {
      if (process && !includesNormalized(row.processes, process)) {
        return false;
      }
      if (material && !includesNormalized(row.materials, material)) {
        return false;
      }
      if (filters?.matchHealth && matchHealthFilter !== "unknown") {
        if (row.matchHealth !== matchHealthFilter) return false;
      }
      if (filters?.benchStatus && benchStatusFilter !== "unknown") {
        if (row.benchStatus !== benchStatusFilter) return false;
      }
      return true;
    });

    filtered.sort((a, b) => {
      const bs = benchStatusSortKey(a.benchStatus) - benchStatusSortKey(b.benchStatus);
      if (bs !== 0) return bs;

      const mh = matchHealthSortKey(a.matchHealth) - matchHealthSortKey(b.matchHealth);
      if (mh !== 0) return mh;

      const awardsA = typeof a.awardsLast30d === "number" ? a.awardsLast30d : -1;
      const awardsB = typeof b.awardsLast30d === "number" ? b.awardsLast30d : -1;
      if (awardsA !== awardsB) return awardsB - awardsA;

      const nameCmp = (a.name ?? "").localeCompare(b.name ?? "");
      if (nameCmp !== 0) return nameCmp;
      return a.supplierId.localeCompare(b.supplierId);
    });

    return filtered;
  } catch (error) {
    if (isMissingTableOrColumnError(error)) {
      console.warn("[supplier discovery] missing tables/views; returning empty list", {
        supabaseError: serializeSupabaseError(error),
      });
      return [];
    }
    console.error("[supplier discovery] load failed", {
      supabaseError: serializeSupabaseError(error) ?? error,
    });
    return [];
  }
}

