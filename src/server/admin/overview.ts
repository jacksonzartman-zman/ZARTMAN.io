import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { requireAdminUser } from "@/server/auth";
import {
  logAdminDashboardError,
  logAdminDashboardWarn,
  serializeSupabaseError,
} from "@/server/admin/logging";
import { loadAdminInbox } from "@/server/messages/inbox";
import { loadAdminSupplierBenchHealth } from "@/server/suppliers/benchHealth";
import { loadPartsCoverageSignalsForQuotes } from "@/server/quotes/partsCoverageHealth";
import { loadSystemHealth, type SystemHealthStatus } from "@/server/admin/systemHealth";

export type AdminOverviewSummary = {
  pipeline: {
    totalQuotes: number;
    openQuotes: number;
    needsDecisionQuotes: number; // bids exist, no winner
    awardedQuotes: number;
  };
  messaging: {
    threadsNeedingReply: number;
    customerNeedingReply: number;
    supplierNeedingReply: number;
    adminNeedingReply: number; // usually 0, but keep for completeness
    totalUnread: number;
  };
  kickoff: {
    kickoffNotStarted: number;
    kickoffInProgress: number;
    kickoffComplete: number;
  };
  partsCoverage: {
    withParts: number;
    goodCoverage: number;
    needsAttention: number;
  };
  benchHealth: {
    good: number;
    caution: number;
    poor: number;
    underused: number;
    balanced: number;
    overused: number;
  };
  systemHealth: {
    status: SystemHealthStatus;
  };
};

const ADMIN_QUOTES_INBOX_TABLE = "admin_quotes_inbox" as const;

type AdminQuotesInboxOverviewRow = {
  id: string;
  created_at: string | null;
  status: string | null;
  bid_count: number | null;
  has_awarded_bid: boolean | null;
  awarded_supplier_id: string | null;
};

function emptySummary(): AdminOverviewSummary {
  return {
    pipeline: {
      totalQuotes: 0,
      openQuotes: 0,
      needsDecisionQuotes: 0,
      awardedQuotes: 0,
    },
    messaging: {
      threadsNeedingReply: 0,
      customerNeedingReply: 0,
      supplierNeedingReply: 0,
      adminNeedingReply: 0,
      totalUnread: 0,
    },
    kickoff: {
      kickoffNotStarted: 0,
      kickoffInProgress: 0,
      kickoffComplete: 0,
    },
    partsCoverage: {
      withParts: 0,
      goodCoverage: 0,
      needsAttention: 0,
    },
    benchHealth: {
      good: 0,
      caution: 0,
      poor: 0,
      underused: 0,
      balanced: 0,
      overused: 0,
    },
    systemHealth: {
      status: "degraded",
    },
  };
}

function normalizeId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function toIntOrZero(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.floor(value));
  }
  return 0;
}

function getSinceIso(days: number): string {
  const ms = Math.max(1, Math.floor(days)) * 24 * 60 * 60 * 1000;
  return new Date(Date.now() - ms).toISOString();
}

let cachedServiceRoleClient: SupabaseClient | null | undefined;

function getServiceRoleSupabaseClient(): SupabaseClient | null {
  if (cachedServiceRoleClient !== undefined) return cachedServiceRoleClient;

  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? null;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? null;

  if (!url || typeof url !== "string" || url.trim().length === 0) {
    cachedServiceRoleClient = null;
    return cachedServiceRoleClient;
  }

  if (!serviceKey || typeof serviceKey !== "string" || serviceKey.trim().length === 0) {
    cachedServiceRoleClient = null;
    return cachedServiceRoleClient;
  }

  cachedServiceRoleClient = createClient(url, serviceKey, {
    auth: { persistSession: false },
    global: { fetch },
  });

  return cachedServiceRoleClient;
}

async function countAdminQuotesInbox(args: {
  sinceIso: string;
  where?: (q: any) => any;
}): Promise<number> {
  const supabase = getServiceRoleSupabaseClient();
  if (!supabase) return 0;

  try {
    let query = supabase
      .from(ADMIN_QUOTES_INBOX_TABLE)
      .select("id", { count: "exact" })
      .gte("created_at", args.sinceIso)
      .range(0, 0);

    if (args.where) {
      query = args.where(query);
    }

    const { error, count } = await query.returns<Array<{ id: string }>>();
    if (error) {
      throw error;
    }
    return typeof count === "number" && Number.isFinite(count) ? count : 0;
  } catch (error) {
    logAdminDashboardWarn("overview: pipeline count query failed", {
      supabaseError: serializeSupabaseError(error) ?? error,
    });
    return 0;
  }
}

async function fetchAdminQuotesInboxRows(args: {
  sinceIso: string;
  select: string;
  where?: (q: any) => any;
  orderBy?: { column: string; ascending: boolean };
  maxRows: number;
  pageSize?: number;
}): Promise<AdminQuotesInboxOverviewRow[]> {
  const supabase = getServiceRoleSupabaseClient();
  if (!supabase) return [];

  const pageSize = Math.max(50, Math.min(1000, Math.floor(args.pageSize ?? 1000)));
  const maxRows = Math.max(0, Math.floor(args.maxRows));
  if (maxRows <= 0) return [];

  const results: AdminQuotesInboxOverviewRow[] = [];
  try {
    for (let offset = 0; offset < maxRows; offset += pageSize) {
      const from = offset;
      const to = Math.min(maxRows - 1, offset + pageSize - 1);

      let query = supabase
        .from(ADMIN_QUOTES_INBOX_TABLE)
        .select(args.select)
        .gte("created_at", args.sinceIso)
        .range(from, to);

      if (args.where) {
        query = args.where(query);
      }

      if (args.orderBy) {
        query = query.order(args.orderBy.column, { ascending: args.orderBy.ascending });
      }

      const { data, error } = await query.returns<AdminQuotesInboxOverviewRow[]>();
      if (error) {
        throw error;
      }

      const rows = Array.isArray(data) ? data : [];
      results.push(...rows);

      if (rows.length < to - from + 1) {
        break;
      }
    }
  } catch (error) {
    logAdminDashboardWarn("overview: pipeline rows query failed", {
      supabaseError: serializeSupabaseError(error) ?? error,
    });
    return results;
  }

  if (results.length > maxRows) {
    return results.slice(0, maxRows);
  }
  return results;
}

type KickoffTotals = { total: number; completed: number };

function deriveKickoffStatus(input: {
  kickoffCompletedAt: string | null;
  totals: KickoffTotals | null;
}): "not_started" | "in_progress" | "complete" {
  if (input.kickoffCompletedAt) return "complete";
  const totals = input.totals ?? { total: 0, completed: 0 };
  if (totals.total <= 0) return "not_started";
  if (totals.completed <= 0) return "not_started";
  if (totals.completed >= totals.total) return "complete";
  return "in_progress";
}

async function loadKickoffSummaryForAwardedQuotes(args: {
  quoteIdSupplierPairs: Array<{ quoteId: string; supplierId: string }>;
}): Promise<AdminOverviewSummary["kickoff"]> {
  const kickoff = { kickoffNotStarted: 0, kickoffInProgress: 0, kickoffComplete: 0 };
  const pairs = (args.quoteIdSupplierPairs ?? []).filter(
    (p) => normalizeId(p.quoteId) && normalizeId(p.supplierId),
  );

  if (pairs.length === 0) return kickoff;

  // De-dupe by quoteId (keep first); winner should be stable per quote.
  const byQuoteId = new Map<string, string>();
  for (const pair of pairs) {
    const quoteId = normalizeId(pair.quoteId);
    const supplierId = normalizeId(pair.supplierId);
    if (!quoteId || !supplierId) continue;
    if (!byQuoteId.has(quoteId)) {
      byQuoteId.set(quoteId, supplierId);
    }
  }

  const quoteIds = Array.from(byQuoteId.keys());
  const supplierIds = Array.from(new Set(Array.from(byQuoteId.values())));

  // Query kickoff_completed_at
  const kickoffCompletedAtByQuoteId = new Map<string, string | null>();
  for (const quoteId of quoteIds) {
    kickoffCompletedAtByQuoteId.set(quoteId, null);
  }

  try {
    // Lazily import here to avoid pulling supabaseServer for every overview call.
    const { supabaseServer } = await import("@/lib/supabaseServer");
    const { data, error } = await supabaseServer
      .from("quotes")
      .select("id,kickoff_completed_at")
      .in("id", quoteIds)
      .returns<{ id: string; kickoff_completed_at?: string | null }[]>();

    if (error) throw error;

    for (const row of data ?? []) {
      const quoteId = normalizeId(row?.id);
      if (!quoteId) continue;
      const value =
        typeof row?.kickoff_completed_at === "string" && row.kickoff_completed_at.trim()
          ? row.kickoff_completed_at
          : null;
      kickoffCompletedAtByQuoteId.set(quoteId, value);
    }
  } catch (error) {
    logAdminDashboardWarn("overview: kickoff_completed_at query failed", {
      supabaseError: serializeSupabaseError(error) ?? error,
    });
  }

  // Query kickoff tasks for those quote+supplier pairs.
  const totalsByKey = new Map<string, KickoffTotals>();
  try {
    const { supabaseServer } = await import("@/lib/supabaseServer");
    const { data, error } = await supabaseServer
      .from("quote_kickoff_tasks")
      .select("quote_id,supplier_id,completed")
      .in("quote_id", quoteIds)
      .in("supplier_id", supplierIds)
      .returns<{ quote_id: string; supplier_id: string; completed: boolean | null }[]>();

    if (error) throw error;

    for (const row of data ?? []) {
      const quoteId = normalizeId(row?.quote_id);
      const supplierId = normalizeId(row?.supplier_id);
      if (!quoteId || !supplierId) continue;
      const winnerSupplierId = byQuoteId.get(quoteId);
      if (!winnerSupplierId || winnerSupplierId !== supplierId) continue;

      const key = `${quoteId}:${supplierId}`;
      const existing = totalsByKey.get(key) ?? { total: 0, completed: 0 };
      existing.total += 1;
      if (row?.completed) {
        existing.completed += 1;
      }
      totalsByKey.set(key, existing);
    }
  } catch (error) {
    logAdminDashboardWarn("overview: kickoff tasks query failed", {
      supabaseError: serializeSupabaseError(error) ?? error,
    });
  }

  for (const quoteId of quoteIds) {
    const supplierId = byQuoteId.get(quoteId) ?? null;
    if (!supplierId) continue;
    const key = `${quoteId}:${supplierId}`;
    const status = deriveKickoffStatus({
      kickoffCompletedAt: kickoffCompletedAtByQuoteId.get(quoteId) ?? null,
      totals: totalsByKey.get(key) ?? null,
    });

    if (status === "complete") kickoff.kickoffComplete += 1;
    else if (status === "in_progress") kickoff.kickoffInProgress += 1;
    else kickoff.kickoffNotStarted += 1;
  }

  return kickoff;
}

export async function loadAdminOverview(): Promise<AdminOverviewSummary> {
  // Defense-in-depth: overview is admin-only (it composes service-role signals).
  await requireAdminUser();

  const summary = emptySummary();
  const sinceIso = getSinceIso(90);

  // Pipeline (quotes)
  try {
    const totalQuotes = await countAdminQuotesInbox({ sinceIso });
    const closedQuotes = await countAdminQuotesInbox({
      sinceIso,
      where: (q) => q.in("status", ["lost", "cancelled"]),
    });
    const awardedQuotes = await countAdminQuotesInbox({
      sinceIso,
      where: (q) =>
        q
          .not("status", "in", "(lost,cancelled)")
          .or("has_awarded_bid.eq.true,status.eq.won,status.eq.approved"),
    });
    const needsDecisionQuotes = await countAdminQuotesInbox({
      sinceIso,
      where: (q) =>
        q
          .in("status", ["quoted", "approved"])
          .gt("bid_count", 0)
          .eq("has_awarded_bid", false),
    });

    summary.pipeline.totalQuotes = Math.max(0, totalQuotes);
    summary.pipeline.awardedQuotes = Math.max(0, awardedQuotes);
    summary.pipeline.openQuotes = Math.max(0, totalQuotes - closedQuotes - awardedQuotes);
    summary.pipeline.needsDecisionQuotes = Math.max(0, needsDecisionQuotes);
  } catch (error) {
    logAdminDashboardWarn("overview: pipeline aggregation crashed", {
      supabaseError: serializeSupabaseError(error) ?? error,
    });
  }

  // Messaging SLAs
  try {
    const rows = await loadAdminInbox();
    let threadsNeedingReply = 0;
    let customerNeedingReply = 0;
    let supplierNeedingReply = 0;
    let adminNeedingReply = 0;
    let totalUnread = 0;

    for (const row of rows ?? []) {
      const needs = row.needsReplyFrom;
      if (needs === "customer" || needs === "supplier" || needs === "admin") {
        threadsNeedingReply += 1;
        if (needs === "customer") customerNeedingReply += 1;
        if (needs === "supplier") supplierNeedingReply += 1;
        if (needs === "admin") adminNeedingReply += 1;
      }
      totalUnread += toIntOrZero(row.unreadCount);
    }

    summary.messaging.threadsNeedingReply = threadsNeedingReply;
    summary.messaging.customerNeedingReply = customerNeedingReply;
    summary.messaging.supplierNeedingReply = supplierNeedingReply;
    summary.messaging.adminNeedingReply = adminNeedingReply;
    summary.messaging.totalUnread = totalUnread;
  } catch (error) {
    logAdminDashboardWarn("overview: messaging aggregation failed", {
      error: serializeSupabaseError(error) ?? error,
    });
  }

  // Kickoff status (awarded quotes in the same window)
  try {
    const rows = await fetchAdminQuotesInboxRows({
      sinceIso,
      select: "id,created_at,status,bid_count,has_awarded_bid,awarded_supplier_id",
      where: (q) =>
        q
          .not("status", "in", "(lost,cancelled)")
          .or("has_awarded_bid.eq.true,status.eq.won,status.eq.approved"),
      orderBy: { column: "created_at", ascending: false },
      maxRows: 600,
      pageSize: 200,
    });

    const pairs: Array<{ quoteId: string; supplierId: string }> = [];
    for (const row of rows) {
      const quoteId = normalizeId(row?.id);
      const supplierId = normalizeId(row?.awarded_supplier_id);
      if (!quoteId || !supplierId) continue;
      pairs.push({ quoteId, supplierId });
    }

    const kickoff = await loadKickoffSummaryForAwardedQuotes({ quoteIdSupplierPairs: pairs });
    summary.kickoff = kickoff;
  } catch (error) {
    logAdminDashboardWarn("overview: kickoff aggregation failed", {
      error: serializeSupabaseError(error) ?? error,
    });
  }

  // Parts coverage (open + awarded quotes in the same window; capped for safety)
  try {
    const rows = await fetchAdminQuotesInboxRows({
      sinceIso,
      select: "id,created_at,status,bid_count,has_awarded_bid,awarded_supplier_id",
      where: (q) => q.not("status", "in", "(lost,cancelled)"),
      orderBy: { column: "created_at", ascending: false },
      maxRows: 400,
      pageSize: 200,
    });

    const quoteIds = rows.map((r) => normalizeId(r?.id)).filter(Boolean);
    const signals = await loadPartsCoverageSignalsForQuotes(quoteIds);

    let withParts = 0;
    let goodCoverage = 0;
    let needsAttention = 0;

    for (const quoteId of quoteIds) {
      const signal = signals.get(quoteId) ?? { partsCoverageHealth: "none" as const, partsCount: 0 };
      if ((signal.partsCount ?? 0) > 0) {
        withParts += 1;
      }
      if (signal.partsCoverageHealth === "good") {
        goodCoverage += 1;
      }
      if (signal.partsCoverageHealth === "needs_attention") {
        needsAttention += 1;
      }
    }

    summary.partsCoverage.withParts = withParts;
    summary.partsCoverage.goodCoverage = goodCoverage;
    summary.partsCoverage.needsAttention = needsAttention;
  } catch (error) {
    logAdminDashboardWarn("overview: parts coverage aggregation failed", {
      error: serializeSupabaseError(error) ?? error,
    });
  }

  // Bench health
  try {
    const rows = await loadAdminSupplierBenchHealth();
    let good = 0;
    let caution = 0;
    let poor = 0;
    let underused = 0;
    let balanced = 0;
    let overused = 0;

    for (const row of rows ?? []) {
      if (row.matchHealth === "good") good += 1;
      if (row.matchHealth === "caution") caution += 1;
      if (row.matchHealth === "poor") poor += 1;
      if (row.benchStatus === "underused") underused += 1;
      if (row.benchStatus === "balanced") balanced += 1;
      if (row.benchStatus === "overused") overused += 1;
    }

    summary.benchHealth.good = good;
    summary.benchHealth.caution = caution;
    summary.benchHealth.poor = poor;
    summary.benchHealth.underused = underused;
    summary.benchHealth.balanced = balanced;
    summary.benchHealth.overused = overused;
  } catch (error) {
    logAdminDashboardWarn("overview: bench health aggregation failed", {
      error: serializeSupabaseError(error) ?? error,
    });
  }

  // System health
  try {
    const health = await loadSystemHealth();
    summary.systemHealth.status = health.status;
  } catch (error) {
    // Do not throw; keep a conservative status.
    logAdminDashboardError("overview: system health load failed", {
      error: serializeSupabaseError(error) ?? error,
    });
  }

  return summary;
}

