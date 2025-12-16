import { supabaseServer } from "@/lib/supabaseServer";
import { getNextWeekStartDateIso } from "@/lib/dates/weekStart";
import { requireAdminUser } from "@/server/auth";
import {
  CAPACITY_CAPABILITY_UNIVERSE,
  getCapacitySnapshotsForSuppliersWeek,
  listCapacitySuppliers,
  type CapacityCapability,
  type CapacitySnapshot,
} from "@/server/admin/capacity";
import {
  isMissingTableOrColumnError,
  serializeSupabaseError,
} from "@/server/admin/logging";
import { emitQuoteEvent } from "@/server/quotes/events";

export type RoutingMatchHealth = "good" | "caution" | "poor";

export type RoutingSupplierSummary = {
  supplierId: string;
  supplierName: string | null;
  coverageCount: number; // 0..4
  totalCount: number; // 4
  levels: Record<CapacityCapability, string | null>;
  hasBlockingCapacity: boolean;
  matchHealth: RoutingMatchHealth;
  blockingReason: string | null;
  lastUpdatedAt: string | null; // ISO timestamp
};

export type RoutingSuggestionResult = {
  resolvedSupplierId: string | null;
  weekStartDate: string; // YYYY-MM-DD (Monday, UTC)
  supplierSummaries: RoutingSupplierSummary[];
};

type QuoteRoutingContext = {
  id: string;
  status: string | null;
  awarded_supplier_id: string | null;
};

const QUOTES_TABLE = "quotes";
const SUPPLIER_BIDS_TABLE = "supplier_bids";
const SUPPLIERS_TABLE = "suppliers";

function normalizeId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeMatchHealth(value: RoutingMatchHealth): number {
  if (value === "good") return 3;
  if (value === "caution") return 2;
  return 1;
}

function capabilityLabel(capability: string): string {
  switch (capability) {
    case "cnc_mill":
      return "CNC Mill";
    case "cnc_lathe":
      return "CNC Lathe";
    case "mjp":
      return "MJP";
    case "sla":
      return "SLA";
    default: {
      const cleaned = capability.replace(/[_-]+/g, " ").trim();
      if (!cleaned) return "Capability";
      return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
    }
  }
}

function normalizeCapacityLevel(value: unknown): string | null {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return normalized.length > 0 ? normalized : null;
}

function isBlockingCapacityLevel(level: string | null): boolean {
  return level === "overloaded" || level === "unavailable";
}

function maxIso(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (!Number.isFinite(ta)) return b;
  if (!Number.isFinite(tb)) return a;
  return tb > ta ? b : a;
}

function summarizeSupplierCapacity(args: {
  supplierId: string;
  supplierName: string | null;
  snapshots: CapacitySnapshot[] | null | undefined;
}): RoutingSupplierSummary {
  const totalCount = CAPACITY_CAPABILITY_UNIVERSE.length;
  const levels = Object.fromEntries(
    CAPACITY_CAPABILITY_UNIVERSE.map((cap) => [cap, null]),
  ) as Record<CapacityCapability, string | null>;

  let lastUpdatedAt: string | null = null;

  const rows = Array.isArray(args.snapshots) ? args.snapshots : [];
  for (const row of rows) {
    const capability =
      typeof row?.capability === "string" ? row.capability.trim().toLowerCase() : "";
    if (!capability) continue;
    if (!CAPACITY_CAPABILITY_UNIVERSE.includes(capability as CapacityCapability)) {
      continue;
    }
    const key = capability as CapacityCapability;
    if (levels[key] === null) {
      levels[key] = normalizeCapacityLevel(row.capacity_level);
    }
    lastUpdatedAt = maxIso(lastUpdatedAt, normalizeId(row.created_at) || null);
  }

  const coverageCount = CAPACITY_CAPABILITY_UNIVERSE.reduce((count, cap) => {
    return levels[cap] ? count + 1 : count;
  }, 0);

  let blockingReason: string | null = null;
  const hasBlockingCapacity = CAPACITY_CAPABILITY_UNIVERSE.some((cap) => {
    const level = levels[cap];
    const normalized = normalizeCapacityLevel(level);
    if (!isBlockingCapacityLevel(normalized)) return false;
    if (!blockingReason) {
      blockingReason = `${capabilityLabel(cap)} ${normalized ?? "unavailable"}`;
    }
    return true;
  });

  const matchHealth: RoutingMatchHealth = hasBlockingCapacity
    ? "poor"
    : coverageCount >= 2
      ? "good"
      : "caution";

  return {
    supplierId: args.supplierId,
    supplierName: args.supplierName,
    coverageCount,
    totalCount,
    levels,
    hasBlockingCapacity,
    matchHealth,
    blockingReason,
    lastUpdatedAt,
  };
}

async function loadQuoteRoutingContext(
  quoteId: string,
): Promise<QuoteRoutingContext | null> {
  const normalizedQuoteId = normalizeId(quoteId);
  if (!normalizedQuoteId) return null;

  const { data, error } = await supabaseServer
    .from(QUOTES_TABLE)
    .select("id,status,awarded_supplier_id")
    .eq("id", normalizedQuoteId)
    .maybeSingle<QuoteRoutingContext>();

  if (error) {
    throw error;
  }
  if (!data?.id) return null;
  return data;
}

async function loadBidCount(quoteId: string): Promise<number> {
  const normalizedQuoteId = normalizeId(quoteId);
  if (!normalizedQuoteId) return 0;
  const { count, error } = await supabaseServer
    .from(SUPPLIER_BIDS_TABLE)
    .select("id", { count: "exact", head: true })
    .eq("quote_id", normalizedQuoteId);
  if (error) {
    throw error;
  }
  return typeof count === "number" && Number.isFinite(count) ? count : 0;
}

async function resolveOnlyBidderSupplierId(quoteId: string): Promise<string | null> {
  const normalizedQuoteId = normalizeId(quoteId);
  if (!normalizedQuoteId) return null;

  const { data, error } = await supabaseServer
    .from(SUPPLIER_BIDS_TABLE)
    .select("supplier_id,created_at")
    .eq("quote_id", normalizedQuoteId)
    .order("created_at", { ascending: true })
    .limit(2)
    .returns<Array<{ supplier_id: string | null; created_at: string | null }>>();

  if (error) {
    throw error;
  }
  const rows = Array.isArray(data) ? data : [];
  if (rows.length !== 1) return null;
  const supplierId = normalizeId(rows[0]?.supplier_id);
  return supplierId || null;
}

async function loadSupplierNameById(supplierId: string): Promise<string | null> {
  const normalizedSupplierId = normalizeId(supplierId);
  if (!normalizedSupplierId) return null;
  const { data, error } = await supabaseServer
    .from(SUPPLIERS_TABLE)
    .select("company_name")
    .eq("id", normalizedSupplierId)
    .maybeSingle<{ company_name: string | null }>();
  if (error) {
    throw error;
  }
  const name =
    typeof data?.company_name === "string" && data.company_name.trim().length > 0
      ? data.company_name.trim()
      : null;
  return name;
}

export async function getRoutingSuggestionForQuote(args: {
  quoteId: string;
}): Promise<RoutingSuggestionResult> {
  const weekStartDate = getNextWeekStartDateIso();
  const fallback: RoutingSuggestionResult = {
    resolvedSupplierId: null,
    weekStartDate,
    supplierSummaries: [],
  };

  // Defense-in-depth: this loader uses the service role key.
  const adminUser = await requireAdminUser();

  const quoteId = normalizeId(args?.quoteId);
  if (!quoteId) return fallback;

  try {
    const quote = await loadQuoteRoutingContext(quoteId);
    if (!quote) return fallback;

    const bidCount = await loadBidCount(quoteId);

    let resolvedSupplierId = normalizeId(quote.awarded_supplier_id) || null;
    if (!resolvedSupplierId && bidCount === 1) {
      resolvedSupplierId = await resolveOnlyBidderSupplierId(quoteId);
    }

    let supplierSummaries: RoutingSupplierSummary[] = [];

    if (resolvedSupplierId) {
      const supplierName = await loadSupplierNameById(resolvedSupplierId);
      const bySupplier = await getCapacitySnapshotsForSuppliersWeek({
        supplierIds: [resolvedSupplierId],
        weekStartDate,
      });
      const summary = summarizeSupplierCapacity({
        supplierId: resolvedSupplierId,
        supplierName,
        snapshots: bySupplier[resolvedSupplierId] ?? [],
      });
      supplierSummaries = [summary];
    } else {
      const suppliersResult = await listCapacitySuppliers();
      const candidates = suppliersResult.ok ? suppliersResult.data.suppliers : [];
      const candidateIds = candidates.map((row) => row.id).filter(Boolean);

      const bySupplier = await getCapacitySnapshotsForSuppliersWeek({
        supplierIds: candidateIds,
        weekStartDate,
      });

      const allSummaries = candidates.map((supplier) =>
        summarizeSupplierCapacity({
          supplierId: supplier.id,
          supplierName: supplier.company_name ?? null,
          snapshots: bySupplier[supplier.id] ?? [],
        }),
      );

      allSummaries.sort((a, b) => {
        const health = normalizeMatchHealth(b.matchHealth) - normalizeMatchHealth(a.matchHealth);
        if (health !== 0) return health;
        const coverage = (b.coverageCount ?? 0) - (a.coverageCount ?? 0);
        if (coverage !== 0) return coverage;
        const ta = a.lastUpdatedAt ? Date.parse(a.lastUpdatedAt) : 0;
        const tb = b.lastUpdatedAt ? Date.parse(b.lastUpdatedAt) : 0;
        return (Number.isFinite(tb) ? tb : 0) - (Number.isFinite(ta) ? ta : 0);
      });

      supplierSummaries = allSummaries.slice(0, 5);
    }

    // Nice-to-have: best-effort admin-only event emission.
    void emitQuoteEvent({
      quoteId,
      eventType: "routing_suggestion_viewed",
      actorRole: "admin",
      actorUserId: adminUser.id,
      actorSupplierId: null,
      metadata: {
        weekStartDate,
        resolvedSupplierId,
        candidateCount: resolvedSupplierId ? 0 : supplierSummaries.length,
      },
    });

    return {
      resolvedSupplierId,
      weekStartDate,
      supplierSummaries,
    };
  } catch (error) {
    if (isMissingTableOrColumnError(error)) {
      // Failure-only logging: schema mismatch is common in ephemeral envs.
      console.warn("[admin routing] missing schema; returning empty", {
        quoteId,
        weekStartDate,
        supabaseError: serializeSupabaseError(error),
      });
      return fallback;
    }
    console.error("[admin routing] failed to compute routing suggestion", {
      quoteId,
      weekStartDate,
      supabaseError: serializeSupabaseError(error) ?? error,
    });
    return fallback;
  }
}

