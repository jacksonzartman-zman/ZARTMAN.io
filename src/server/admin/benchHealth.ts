import { supabaseServer } from "@/lib/supabaseServer";
import { requireAdminUser } from "@/server/auth";
import { schemaGate } from "@/server/db/schemaContract";
import {
  handleMissingSupabaseSchema,
  isMissingTableOrColumnError,
  isSupabaseRelationMarkedMissing,
  markSupabaseRelationMissing,
  serializeSupabaseError,
  warnOnce,
} from "@/server/admin/logging";
import { loadAdminSuppliersDirectory } from "@/server/admin/suppliersDirectory";
import { computeAdminThreadSla } from "@/server/quotes/messageState";
import { isSupplierMismatchLogsEnabled } from "@/server/admin/supplierMismatchSummary";

export type SupplierBenchHealth = {
  supplierId: string;
  supplierName: string | null;
  health: "healthy" | "at_risk" | "unresponsive";
  reasons: string[];
  overdueThreadCount: number;
  lastActivityAt: string | null;
  lastInboundAt: string | null; // max supplier/customer inbound on quotes tied to supplier, if available
  mismatchCountLast30d?: number;
};

type BenchHealthStatusFilter = SupplierBenchHealth["health"] | "all";
type BenchHealthSort = "health" | "overdue" | "activity";

const ROLLUP_RELATION = "quote_message_rollup";
const MISMATCH_RELATION = "supplier_capability_mismatch_logs";

function normalizeId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function coerceLimit(value: unknown): number {
  const raw = typeof value === "string" ? Number(value) : typeof value === "number" ? value : NaN;
  if (!Number.isFinite(raw)) return 100;
  return Math.max(1, Math.min(500, Math.floor(raw)));
}

function ms(value: string | null): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function maxIso(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

function sortHealthRank(value: SupplierBenchHealth["health"]): number {
  // Higher is worse (more urgent).
  if (value === "unresponsive") return 2;
  if (value === "at_risk") return 1;
  return 0;
}

function normalizeSort(value: unknown): BenchHealthSort {
  const v = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (v === "overdue" || v === "activity" || v === "health") return v;
  return "health";
}

function normalizeStatusFilter(value: unknown): BenchHealthStatusFilter {
  const v = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (v === "healthy" || v === "at_risk" || v === "unresponsive") return v;
  return "all";
}

type RollupRow = {
  quote_id: string;
  last_customer_at: string | null;
  last_supplier_at: string | null;
  last_admin_at: string | null;
  last_system_at: string | null;
  last_message_at: string | null;
};

type QuoteAwardRow = {
  id: string;
  status: string | null;
  awarded_supplier_id: string | null;
};

type SupplierBidRow = {
  supplier_id: string | null;
  quote_id: string | null;
  created_at: string | null;
};

type MismatchRow = {
  supplier_id: string | null;
  created_at: string | null;
};

export async function loadBenchHealthDirectory(args?: {
  q?: string | null;
  status?: BenchHealthStatusFilter | null;
  sort?: BenchHealthSort | null;
  limit?: number | string | null;
}): Promise<SupplierBenchHealth[]> {
  await requireAdminUser();

  const limit = coerceLimit(args?.limit);
  const q = normalizeText(args?.q) ?? null;
  const statusFilter = normalizeStatusFilter(args?.status);
  const sort = normalizeSort(args?.sort);

  const suppliers = await loadAdminSuppliersDirectory({
    q,
    status: "all",
    limit,
  });

  const base: SupplierBenchHealth[] = suppliers.map((row) => ({
    supplierId: row.supplierId,
    supplierName: row.supplierName ?? null,
    health: "healthy",
    reasons: [],
    overdueThreadCount: 0,
    lastActivityAt: row.lastActivityAt ?? null,
    lastInboundAt: null,
  }));

  const supplierIds = base.map((r) => r.supplierId).filter(Boolean);
  if (supplierIds.length === 0) {
    return [];
  }

  const rollupEnabled = await schemaGate({
    enabled: true,
    relation: ROLLUP_RELATION,
    requiredColumns: [
      "quote_id",
      "last_admin_at",
      "last_customer_at",
      "last_supplier_at",
      "last_system_at",
      "last_message_at",
    ],
    // Intentionally baked-in message to meet Phase 19.2 requirement.
    warnPrefix: "[bench_health] missing rollup; skipping",
    warnKey: "bench_health:quote_message_rollup",
  });

  // If the rollup view is missing/unavailable, we must fail-soft to the neutral output shape.
  if (!rollupEnabled || isSupabaseRelationMarkedMissing(ROLLUP_RELATION)) {
    return applyDirectorySortingAndFiltering(base, { statusFilter, sort });
  }

  const quoteIdsBySupplierId =
    (await loadQuoteAssociationsBySupplierIds(supplierIds)) ?? new Map<string, Set<string>>();

  const allQuoteIds: string[] = [];
  for (const set of quoteIdsBySupplierId.values()) {
    for (const id of set) allQuoteIds.push(id);
  }

  const uniqueQuoteIds = Array.from(new Set(allQuoteIds));
  if (uniqueQuoteIds.length === 0) {
    // No known quote associations; still allow mismatch reason enrichment.
    const withMismatch = await applyMismatchSignals(base, supplierIds);
    return applyDirectorySortingAndFiltering(withMismatch, { statusFilter, sort });
  }

  const rollupsByQuoteId = await loadBenchRollups(uniqueQuoteIds);
  const mismatchEnriched = await applyMismatchSignals(base, supplierIds);

  const bySupplierId = new Map<string, SupplierBenchHealth>(
    mismatchEnriched.map((row) => [row.supplierId, row]),
  );

  for (const supplierId of supplierIds) {
    const current = bySupplierId.get(supplierId);
    if (!current) continue;

    const quoteIds = Array.from(quoteIdsBySupplierId.get(supplierId) ?? []);
    if (quoteIds.length === 0) continue;

    let overdue = 0;
    let lastInboundAt: string | null = null;
    const now = new Date();

    for (const quoteId of quoteIds) {
      const rollup = rollupsByQuoteId.get(quoteId) ?? null;
      if (!rollup) continue;

      const inboundAt = maxIso(rollup.lastCustomerAt, rollup.lastSupplierAt);
      lastInboundAt = maxIso(lastInboundAt, inboundAt);

      const sla = computeAdminThreadSla(rollup, now);
      if (sla.status === "overdue") {
        overdue += 1;
      }
    }

    current.overdueThreadCount = overdue;
    current.lastInboundAt = lastInboundAt;

    const reasons: string[] = [];
    if (overdue >= 3) {
      current.health = "unresponsive";
      reasons.push("Multiple overdue threads");
    } else if (overdue >= 1) {
      current.health = "at_risk";
      reasons.push("Overdue threads");
    } else {
      current.health = "healthy";
    }

    if (current.lastInboundAt) {
      const inboundMs = ms(current.lastInboundAt);
      if (inboundMs !== null) {
        const ageDays = (Date.now() - inboundMs) / (24 * 60 * 60 * 1000);
        if (ageDays >= 14) {
          reasons.push("No inbound in 14d");
          // Escalate slightly when there is no signal of inbound for a long time.
          if (current.health === "healthy") {
            current.health = "at_risk";
          }
        }
      }
    }

    if (typeof current.mismatchCountLast30d === "number" && current.mismatchCountLast30d >= 5) {
      reasons.push("Mismatch logs elevated (30d)");
    }

    current.reasons = reasons;
  }

  return applyDirectorySortingAndFiltering(Array.from(bySupplierId.values()), { statusFilter, sort });
}

function applyDirectorySortingAndFiltering(
  rows: SupplierBenchHealth[],
  args: { statusFilter: BenchHealthStatusFilter; sort: BenchHealthSort },
): SupplierBenchHealth[] {
  const filtered =
    args.statusFilter === "all"
      ? rows
      : rows.filter((row) => row.health === args.statusFilter);

  const sorted = [...filtered].sort((a, b) => {
    if (args.sort === "overdue") {
      if (a.overdueThreadCount !== b.overdueThreadCount) {
        return b.overdueThreadCount - a.overdueThreadCount;
      }
      const hr = sortHealthRank(b.health) - sortHealthRank(a.health);
      if (hr !== 0) return hr;
    } else if (args.sort === "activity") {
      const ams = ms(a.lastActivityAt) ?? -1;
      const bms = ms(b.lastActivityAt) ?? -1;
      if (ams !== bms) return ams - bms; // stale / null first
      const hr = sortHealthRank(b.health) - sortHealthRank(a.health);
      if (hr !== 0) return hr;
    } else {
      const hr = sortHealthRank(b.health) - sortHealthRank(a.health);
      if (hr !== 0) return hr;
      if (a.overdueThreadCount !== b.overdueThreadCount) {
        return b.overdueThreadCount - a.overdueThreadCount;
      }
    }

    return a.supplierId.localeCompare(b.supplierId);
  });

  return sorted;
}

async function loadQuoteAssociationsBySupplierIds(
  supplierIds: string[],
): Promise<Map<string, Set<string>>> {
  const ids = Array.from(new Set((supplierIds ?? []).map(normalizeId).filter(Boolean)));
  const map = new Map<string, Set<string>>();
  if (ids.length === 0) return map;

  // Preferred: awarded supplier id from quotes.
  const canUseAwardedSupplierId = await schemaGate({
    enabled: true,
    relation: "quotes",
    requiredColumns: ["id", "status", "awarded_supplier_id"],
    warnPrefix: "[bench_health]",
    warnKey: "bench_health:quotes_awarded_supplier_id",
  });

  const OPEN_OR_AWARDED = ["submitted", "in_review", "quoted", "approved", "won"];

  if (canUseAwardedSupplierId && !isSupabaseRelationMarkedMissing("quotes")) {
    try {
      const { data, error } = await supabaseServer
        .from("quotes")
        .select("id,status,awarded_supplier_id")
        .in("awarded_supplier_id", ids)
        .in("status", OPEN_OR_AWARDED)
        .limit(5000)
        .returns<QuoteAwardRow[]>();

      if (error) {
        if (
          handleMissingSupabaseSchema({
            relation: "quotes",
            error,
            warnPrefix: "[bench_health]",
            warnKey: "bench_health:quotes_awarded_supplier_id_missing",
          })
        ) {
          // Fall back to supplier_bids below.
        } else {
          console.warn("[bench_health] quote association query failed", {
            supplierIdsCount: ids.length,
            supabaseError: serializeSupabaseError(error),
          });
        }
      } else {
        for (const row of data ?? []) {
          const supplierId = normalizeId(row?.awarded_supplier_id);
          const quoteId = normalizeId(row?.id);
          if (!supplierId || !quoteId) continue;
          const set = map.get(supplierId) ?? new Set<string>();
          set.add(quoteId);
          map.set(supplierId, set);
        }
        return map;
      }
    } catch (error) {
      if (
        handleMissingSupabaseSchema({
          relation: "quotes",
          error,
          warnPrefix: "[bench_health]",
          warnKey: "bench_health:quotes_awarded_supplier_id_crashed",
        })
      ) {
        // Fall back to supplier_bids below.
      } else {
        console.warn("[bench_health] quote association query crashed", {
          supplierIdsCount: ids.length,
          error: serializeSupabaseError(error) ?? error,
        });
      }
    }
  }

  // Fallback: infer associations via supplier bids.
  const bidsEnabled = await schemaGate({
    enabled: true,
    relation: "supplier_bids",
    requiredColumns: ["supplier_id", "quote_id"],
    warnPrefix: "[bench_health]",
    warnKey: "bench_health:supplier_bids_quote_assoc",
  });

  if (!bidsEnabled || isSupabaseRelationMarkedMissing("supplier_bids")) {
    return map;
  }

  try {
    const { data, error } = await supabaseServer
      .from("supplier_bids")
      .select("supplier_id,quote_id,created_at")
      .in("supplier_id", ids)
      .order("created_at", { ascending: false })
      .limit(Math.min(10000, ids.length * 50))
      .returns<SupplierBidRow[]>();

    if (error) {
      handleMissingSupabaseSchema({
        relation: "supplier_bids",
        error,
        warnPrefix: "[bench_health]",
        warnKey: "bench_health:supplier_bids_quote_assoc_missing",
      });
      return map;
    }

    for (const row of data ?? []) {
      const supplierId = normalizeId(row?.supplier_id);
      const quoteId = normalizeId(row?.quote_id);
      if (!supplierId || !quoteId) continue;
      const set = map.get(supplierId) ?? new Set<string>();
      set.add(quoteId);
      map.set(supplierId, set);
    }

    return map;
  } catch (error) {
    handleMissingSupabaseSchema({
      relation: "supplier_bids",
      error,
      warnPrefix: "[bench_health]",
      warnKey: "bench_health:supplier_bids_quote_assoc_crashed",
    });
    return map;
  }
}

async function loadBenchRollups(
  quoteIds: string[],
): Promise<Map<string, { quoteId: string; lastCustomerAt: string | null; lastSupplierAt: string | null; lastAdminAt: string | null; lastSystemAt: string | null; lastMessageAt: string | null }>> {
  const ids = Array.from(new Set((quoteIds ?? []).map(normalizeId).filter(Boolean)));
  const map = new Map<string, { quoteId: string; lastCustomerAt: string | null; lastSupplierAt: string | null; lastAdminAt: string | null; lastSystemAt: string | null; lastMessageAt: string | null }>();
  if (ids.length === 0) return map;

  if (isSupabaseRelationMarkedMissing(ROLLUP_RELATION)) {
    return map;
  }

  try {
    const { data, error } = await supabaseServer
      .from(ROLLUP_RELATION)
      .select("quote_id,last_customer_at,last_supplier_at,last_admin_at,last_system_at,last_message_at")
      .in("quote_id", ids)
      .returns<RollupRow[]>();

    if (error) {
      if (isMissingTableOrColumnError(error)) {
        markSupabaseRelationMissing(ROLLUP_RELATION);
        const serialized = serializeSupabaseError(error);
        warnOnce("bench_health:missing_rollup", "[bench_health] missing rollup; skipping", {
          code: serialized.code,
          message: serialized.message,
        });
        return map;
      }
      console.warn("[bench_health] rollup query failed", {
        quoteIdsCount: ids.length,
        supabaseError: serializeSupabaseError(error),
      });
      return map;
    }

    for (const row of data ?? []) {
      const quoteId = normalizeId(row?.quote_id);
      if (!quoteId) continue;
      map.set(quoteId, {
        quoteId,
        lastCustomerAt: row.last_customer_at,
        lastSupplierAt: row.last_supplier_at,
        lastAdminAt: row.last_admin_at,
        lastSystemAt: row.last_system_at,
        lastMessageAt: row.last_message_at,
      });
    }

    return map;
  } catch (error) {
    if (isMissingTableOrColumnError(error)) {
      markSupabaseRelationMissing(ROLLUP_RELATION);
      const serialized = serializeSupabaseError(error);
      warnOnce("bench_health:missing_rollup", "[bench_health] missing rollup; skipping", {
        code: serialized.code,
        message: serialized.message,
      });
      return map;
    }
    console.warn("[bench_health] rollup query crashed", {
      quoteIdsCount: ids.length,
      error: serializeSupabaseError(error) ?? error,
    });
    return map;
  }
}

async function applyMismatchSignals(
  base: SupplierBenchHealth[],
  supplierIds: string[],
): Promise<SupplierBenchHealth[]> {
  if (!isSupplierMismatchLogsEnabled()) {
    return base;
  }

  // If we already detected the relation is missing in this process, skip entirely.
  if (isSupabaseRelationMarkedMissing(MISMATCH_RELATION)) {
    return base;
  }

  const enabled = await schemaGate({
    enabled: true,
    relation: MISMATCH_RELATION,
    requiredColumns: ["supplier_id", "created_at"],
    warnPrefix: "[bench_health]",
    warnKey: "bench_health:mismatch_logs",
  });
  if (!enabled) {
    return base;
  }

  const ids = Array.from(new Set((supplierIds ?? []).map(normalizeId).filter(Boolean)));
  if (ids.length === 0) {
    return base;
  }

  const sinceIso = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  try {
    const { data, error } = await supabaseServer
      .from(MISMATCH_RELATION)
      .select("supplier_id,created_at")
      .in("supplier_id", ids)
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: false })
      .limit(5000)
      .returns<MismatchRow[]>();

    if (error) {
      if (
        handleMissingSupabaseSchema({
          relation: MISMATCH_RELATION,
          error,
          warnPrefix: "[bench_health]",
          warnKey: "bench_health:mismatch_logs_missing",
        })
      ) {
        return base;
      }
      warnOnce("bench_health:mismatch_logs_failed", "[bench_health] mismatch log query failed", {
        supplierIdsCount: ids.length,
        supabaseError: serializeSupabaseError(error),
      });
      return base;
    }

    const countBySupplierId = new Map<string, number>();
    for (const row of data ?? []) {
      const supplierId = normalizeId(row?.supplier_id);
      if (!supplierId) continue;
      countBySupplierId.set(supplierId, (countBySupplierId.get(supplierId) ?? 0) + 1);
    }

    return base.map((row) => ({
      ...row,
      mismatchCountLast30d: countBySupplierId.get(row.supplierId) ?? 0,
    }));
  } catch (error) {
    if (
      handleMissingSupabaseSchema({
        relation: MISMATCH_RELATION,
        error,
        warnPrefix: "[bench_health]",
        warnKey: "bench_health:mismatch_logs_crashed",
      })
    ) {
      return base;
    }
    warnOnce("bench_health:mismatch_logs_crashed", "[bench_health] mismatch log query crashed", {
      supplierIdsCount: ids.length,
      error: serializeSupabaseError(error) ?? error,
    });
    return base;
  }
}

