import { supabaseServer } from "@/lib/supabaseServer";
import { requireAdminUser } from "@/server/auth";
import {
  handleMissingSupabaseRelation,
  isMissingTableOrColumnError,
  isSupabaseRelationMarkedMissing,
  serializeSupabaseError,
} from "@/server/admin/logging";
import { isRfqFeedbackEnabled } from "@/server/quotes/rfqFeedback";
import { schemaGate } from "@/server/db/schemaContract";

export type SupplierReputationLabel =
  | "excellent"
  | "good"
  | "fair"
  | "limited"
  | "unknown";

export type SupplierReputationScore = {
  supplierId: string;
  score: number | null; // 0–100
  label: SupplierReputationLabel;

  // Components (for debugging / UI hints)
  winRateScore?: number | null;
  participationScore?: number | null;
  kickoffScore?: number | null;
  responsivenessScore?: number | null;
  benchMatchScore?: number | null;
  feedbackPenalty?: number | null;
};

export type SupplierReputationMap = Record<string, SupplierReputationScore>;

type MatchHealthViewRow = {
  supplier_id: string;
  rfqs_bid_90d: number | null;
  rfqs_won_90d: number | null;
  win_rate_pct_90d: number | null;
  match_health: string | null;
};

type BenchUtilViewRow = {
  supplier_id: string;
  bench_status: string | null;
  awards_last_30d: number | null;
};

type QuoteAwardRow = {
  id: string;
  awarded_supplier_id: string | null;
  awarded_at: string | null;
  kickoff_completed_at?: string | null;
};

type SupplierBidLite = {
  supplier_id: string | null;
  quote_id: string;
  created_at: string | null;
};

type QuoteMessageLite = {
  id?: string;
  quote_id: string;
  created_at: string;
  sender_role: string | null;
};

type QuoteRfqFeedbackLite = {
  supplier_id: string | null;
  categories: string[] | null;
  created_at: string | null;
};

const MATCH_VIEW = "supplier_match_health_summary" as const;
const BENCH_VIEW = "supplier_bench_utilization_summary" as const;

let didWarnMissingSignals = false;
let didWarnSkippedResponsivenessForLargeBatch = false;

function normalizeId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function uniqIds(ids: string[]): string[] {
  return Array.from(new Set((Array.isArray(ids) ? ids : []).map(normalizeId).filter(Boolean)));
}

function toIntOrZero(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.floor(value));
  }
  return 0;
}

function toNumberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function normalizeMatchHealth(value: unknown): "good" | "caution" | "poor" | "unknown" {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (normalized === "good" || normalized === "caution" || normalized === "poor") {
    return normalized;
  }
  return "unknown";
}

function normalizeBenchStatus(value: unknown): "underused" | "balanced" | "overused" | "unknown" {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (normalized === "underused" || normalized === "balanced" || normalized === "overused") {
    return normalized;
  }
  return "unknown";
}

function scoreToLabel(score: number | null): SupplierReputationLabel {
  if (score === null) return "unknown";
  if (score >= 85) return "excellent";
  if (score >= 70) return "good";
  if (score >= 50) return "fair";
  if (score >= 1) return "limited";
  return "limited";
}

function computeWinRateDelta(args: {
  winRatePct: number | null;
  bids90d: number | null;
}): number | null {
  const pct = typeof args.winRatePct === "number" && Number.isFinite(args.winRatePct) ? args.winRatePct : null;
  const bids = typeof args.bids90d === "number" && Number.isFinite(args.bids90d) ? Math.max(0, Math.floor(args.bids90d)) : null;
  if (pct === null || bids === null) return null;

  if (pct <= 0) {
    // Per rubric: "0% with at least 3 bids → 0 (no change)".
    if (bids >= 3) return 0;
    return 0;
  }
  if (pct >= 50) return 25;
  if (pct >= 20) return 15;
  if (pct >= 5) return 5;
  if (pct >= 1) return 2;
  return 0;
}

function computeParticipationDelta(bids90d: number | null): number | null {
  const bids = typeof bids90d === "number" && Number.isFinite(bids90d) ? Math.max(0, Math.floor(bids90d)) : null;
  if (bids === null) return null;
  if (bids >= 10) return 10;
  if (bids >= 5) return 6;
  if (bids >= 1) return 2;
  return -5;
}

function computeKickoffDelta(ratioOnTime: number | null): number | null {
  const r = typeof ratioOnTime === "number" && Number.isFinite(ratioOnTime) ? ratioOnTime : null;
  if (r === null) return null;
  if (r >= 0.8) return 10;
  if (r >= 0.5) return 5;
  return -10;
}

function computeBenchMatchDelta(args: {
  matchHealth: "good" | "caution" | "poor" | "unknown";
  benchStatus: "underused" | "balanced" | "overused" | "unknown";
}): number | null {
  const { matchHealth, benchStatus } = args;
  // If both are unknown, treat as "no signal" rather than neutral 0.
  if (matchHealth === "unknown" && benchStatus === "unknown") return null;

  let delta = 0;
  if (matchHealth === "good") {
    delta += benchStatus === "underused" ? 8 : benchStatus === "balanced" ? 5 : 2;
  } else if (matchHealth === "caution") {
    delta -= 3;
  } else if (matchHealth === "poor") {
    delta -= 8;
  }

  if (benchStatus === "overused") delta -= 5;
  return delta;
}

function normalizeFeedbackCategory(value: unknown): string | null {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return normalized ? normalized : null;
}

function computeFeedbackPenalty(byCategory: Record<string, number>): number | null {
  const outside = toIntOrZero(byCategory["outside_capability"]);
  const scopeUnclear = toIntOrZero(byCategory["scope_unclear"]);
  const timeline = toIntOrZero(byCategory["timeline_unrealistic"]);

  // Per rubric:
  // - outside_capability repeated → -5
  // - timeline_unrealistic should not penalize (or at most tiny -1)
  // - scope_unclear optional small -3
  let penalty = 0;
  let hasAny = false;

  if (outside >= 3) {
    penalty -= 5;
    hasAny = true;
  }
  if (scopeUnclear >= 3) {
    penalty -= 3;
    hasAny = true;
  }
  if (timeline >= 6) {
    penalty -= 1;
    hasAny = true;
  }

  return hasAny ? penalty : null;
}

function computeResponsivenessDelta(args: {
  needsReplyCount: number;
  needsReplyWithin48hCount: number;
}): number | null {
  const total = Math.max(0, Math.floor(args.needsReplyCount));
  const within = Math.max(0, Math.floor(args.needsReplyWithin48hCount));
  if (total <= 0) return null;
  const ratio = within / total;
  if (ratio >= 0.8) return 10;
  if (ratio >= 0.5) return 5;
  return -10;
}

function computeScore(args: {
  supplierId: string;
  winRatePct: number | null;
  bids90d: number | null;
  matchHealth: "good" | "caution" | "poor" | "unknown";
  benchStatus: "underused" | "balanced" | "overused" | "unknown";
  kickoffOnTimeRatio: number | null;
  responsiveness?: { needsReplyCount: number; needsReplyWithin48hCount: number } | null;
  feedbackByCategory?: Record<string, number> | null;
}): SupplierReputationScore {
  const base = 50;
  const winRateScore = computeWinRateDelta({
    winRatePct: args.winRatePct,
    bids90d: args.bids90d,
  });
  const participationScore = computeParticipationDelta(args.bids90d);
  const benchMatchScore = computeBenchMatchDelta({
    matchHealth: args.matchHealth,
    benchStatus: args.benchStatus,
  });
  const kickoffScore = computeKickoffDelta(args.kickoffOnTimeRatio);
  const responsivenessScore = args.responsiveness
    ? computeResponsivenessDelta(args.responsiveness)
    : null;
  const feedbackPenalty = computeFeedbackPenalty(args.feedbackByCategory ?? {});

  const components = [
    winRateScore,
    participationScore,
    benchMatchScore,
    kickoffScore,
    responsivenessScore,
    feedbackPenalty,
  ];

  const hasAnySignal = components.some((v) => typeof v === "number" && Number.isFinite(v));
  if (!hasAnySignal) {
    return {
      supplierId: args.supplierId,
      score: null,
      label: "unknown",
      winRateScore: null,
      participationScore: null,
      kickoffScore: null,
      responsivenessScore: null,
      benchMatchScore: null,
      feedbackPenalty: null,
    };
  }

  let score = base;
  for (const v of components) {
    if (typeof v === "number" && Number.isFinite(v)) score += v;
  }
  const clamped = clampScore(score);

  return {
    supplierId: args.supplierId,
    score: clamped,
    label: scoreToLabel(clamped),
    winRateScore: winRateScore ?? null,
    participationScore: participationScore ?? null,
    kickoffScore: kickoffScore ?? null,
    responsivenessScore: responsivenessScore ?? null,
    benchMatchScore: benchMatchScore ?? null,
    feedbackPenalty: feedbackPenalty ?? null,
  };
}

async function safeLoadMatchHealth(ids: string[]): Promise<Map<string, MatchHealthViewRow> | null> {
  if (ids.length === 0) return new Map();
  try {
    const { data, error } = await supabaseServer
      .from(MATCH_VIEW)
      .select("supplier_id,rfqs_bid_90d,rfqs_won_90d,win_rate_pct_90d,match_health")
      .in("supplier_id", ids)
      .returns<MatchHealthViewRow[]>();
    if (error) {
      if (isMissingTableOrColumnError(error)) return null;
      console.error("[supplier reputation] supplier_match_health_summary load failed", {
        supplierCount: ids.length,
        error: serializeSupabaseError(error) ?? error,
      });
      return new Map();
    }
    const map = new Map<string, MatchHealthViewRow>();
    for (const row of data ?? []) {
      const id = normalizeId(row?.supplier_id);
      if (!id) continue;
      map.set(id, row);
    }
    return map;
  } catch (error) {
    if (isMissingTableOrColumnError(error)) return null;
    console.error("[supplier reputation] supplier_match_health_summary load crashed", {
      supplierCount: ids.length,
      error: serializeSupabaseError(error) ?? error,
    });
    return new Map();
  }
}

async function safeLoadBenchUtil(ids: string[]): Promise<Map<string, BenchUtilViewRow> | null> {
  if (ids.length === 0) return new Map();
  try {
    const { data, error } = await supabaseServer
      .from(BENCH_VIEW)
      .select("supplier_id,bench_status,awards_last_30d")
      .in("supplier_id", ids)
      .returns<BenchUtilViewRow[]>();
    if (error) {
      if (isMissingTableOrColumnError(error)) return null;
      console.error("[supplier reputation] supplier_bench_utilization_summary load failed", {
        supplierCount: ids.length,
        error: serializeSupabaseError(error) ?? error,
      });
      return new Map();
    }
    const map = new Map<string, BenchUtilViewRow>();
    for (const row of data ?? []) {
      const id = normalizeId(row?.supplier_id);
      if (!id) continue;
      map.set(id, row);
    }
    return map;
  } catch (error) {
    if (isMissingTableOrColumnError(error)) return null;
    console.error("[supplier reputation] supplier_bench_utilization_summary load crashed", {
      supplierCount: ids.length,
      error: serializeSupabaseError(error) ?? error,
    });
    return new Map();
  }
}

async function safeLoadAwardKickoffRatios(args: {
  supplierIds: string[];
  lookbackDays: number;
  onTimeDays: number;
}): Promise<Map<string, { awardedCount: number; onTimeCount: number; ratio: number | null }>> {
  const ids = args.supplierIds;
  const out = new Map<string, { awardedCount: number; onTimeCount: number; ratio: number | null }>();
  for (const id of ids) {
    out.set(id, { awardedCount: 0, onTimeCount: 0, ratio: null });
  }
  if (ids.length === 0) return out;

  const cutoffIso = new Date(Date.now() - args.lookbackDays * 24 * 60 * 60 * 1000).toISOString();

  try {
    const { data, error } = await supabaseServer
      .from("quotes")
      .select("id,awarded_supplier_id,awarded_at,kickoff_completed_at")
      .in("awarded_supplier_id", ids)
      .gte("awarded_at", cutoffIso)
      .returns<QuoteAwardRow[]>();

    if (error) {
      if (isMissingTableOrColumnError(error)) {
        return out;
      }
      console.error("[supplier reputation] kickoff award lookup failed", {
        supplierCount: ids.length,
        error: serializeSupabaseError(error) ?? error,
      });
      return out;
    }

    const onTimeMs = args.onTimeDays * 24 * 60 * 60 * 1000;

    for (const row of data ?? []) {
      const supplierId = normalizeId(row?.awarded_supplier_id);
      if (!supplierId || !out.has(supplierId)) continue;
      const awardedAt = typeof row?.awarded_at === "string" ? row.awarded_at : null;
      if (!awardedAt) continue;
      const awardedMs = Date.parse(awardedAt);
      if (!Number.isFinite(awardedMs)) continue;

      const current = out.get(supplierId)!;
      current.awardedCount += 1;

      const kickoffAt = typeof row?.kickoff_completed_at === "string" ? row.kickoff_completed_at : null;
      if (!kickoffAt) continue;
      const kickoffMs = Date.parse(kickoffAt);
      if (!Number.isFinite(kickoffMs)) continue;
      if (kickoffMs - awardedMs <= onTimeMs) {
        current.onTimeCount += 1;
      }
    }

    for (const [supplierId, summary] of out.entries()) {
      summary.ratio =
        summary.awardedCount > 0 ? summary.onTimeCount / summary.awardedCount : null;
    }

    return out;
  } catch (error) {
    if (isMissingTableOrColumnError(error)) {
      return out;
    }
    console.error("[supplier reputation] kickoff award lookup crashed", {
      supplierCount: ids.length,
      error: serializeSupabaseError(error) ?? error,
    });
    return out;
  }
}

function resolveNeedsReplyFromSupplier(args: {
  lastRole: "customer" | "supplier" | "admin" | null;
  lastCustomerMessageAt: string | null;
  lastSupplierMessageAt: string | null;
}): boolean {
  if (!args.lastRole) return false;
  if (args.lastRole !== "customer") return false;
  if (!args.lastCustomerMessageAt) return false;
  if (!args.lastSupplierMessageAt) return true;
  return args.lastSupplierMessageAt < args.lastCustomerMessageAt;
}

async function safeLoadResponsivenessBySupplierIds(args: {
  supplierIds: string[];
  lookbackDays: number;
  maxSuppliersForThisSignal: number;
  maxQuoteIdsPerSupplier: number;
}): Promise<Map<string, { needsReplyCount: number; needsReplyWithin48hCount: number }> | null> {
  const ids = args.supplierIds;
  if (ids.length === 0) return new Map();

  if (ids.length > args.maxSuppliersForThisSignal) {
    if (!didWarnSkippedResponsivenessForLargeBatch) {
      didWarnSkippedResponsivenessForLargeBatch = true;
      console.warn("[supplier reputation] skipping responsiveness for large batch", {
        supplierCount: ids.length,
        maxSuppliersForThisSignal: args.maxSuppliersForThisSignal,
      });
    }
    return null;
  }

  const cutoffIso = new Date(Date.now() - args.lookbackDays * 24 * 60 * 60 * 1000).toISOString();
  const quoteIdsBySupplier = new Map<string, Set<string>>();
  for (const id of ids) quoteIdsBySupplier.set(id, new Set<string>());

  try {
    const { data, error } = await supabaseServer
      .from("supplier_bids")
      .select("supplier_id,quote_id,created_at")
      .in("supplier_id", ids)
      .gte("created_at", cutoffIso)
      .order("created_at", { ascending: false })
      .limit(Math.min(20000, Math.max(500, ids.length * args.maxQuoteIdsPerSupplier * 2)))
      .returns<SupplierBidLite[]>();

    if (error) {
      if (isMissingTableOrColumnError(error)) return null;
      console.error("[supplier reputation] supplier_bids lookup failed (responsiveness)", {
        supplierCount: ids.length,
        error: serializeSupabaseError(error) ?? error,
      });
      return null;
    }

    for (const row of data ?? []) {
      const supplierId = normalizeId(row?.supplier_id);
      const quoteId = normalizeId(row?.quote_id);
      if (!supplierId || !quoteId) continue;
      const set = quoteIdsBySupplier.get(supplierId);
      if (!set) continue;
      if (set.size >= args.maxQuoteIdsPerSupplier) continue;
      set.add(quoteId);
    }
  } catch (error) {
    if (isMissingTableOrColumnError(error)) return null;
    console.error("[supplier reputation] supplier_bids lookup crashed (responsiveness)", {
      supplierCount: ids.length,
      error: serializeSupabaseError(error) ?? error,
    });
    return null;
  }

  const quoteIds = Array.from(
    new Set(Array.from(quoteIdsBySupplier.values()).flatMap((set) => Array.from(set))),
  );
  if (quoteIds.length === 0) return new Map(ids.map((id) => [id, { needsReplyCount: 0, needsReplyWithin48hCount: 0 }]));

  const latestByQuoteId = new Map<
    string,
    {
      lastMessageAt: string | null;
      lastRole: "customer" | "supplier" | "admin" | null;
      lastCustomerMessageAt: string | null;
      lastSupplierMessageAt: string | null;
    }
  >();

  try {
    // Fetch a bounded message set and compute per-quote rollups in memory.
    const limit = Math.min(15000, Math.max(300, quoteIds.length * 10));
    const { data, error } = await supabaseServer
      .from("quote_messages")
      .select("id,quote_id,created_at,sender_role")
      .in("quote_id", quoteIds)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(limit)
      .returns<QuoteMessageLite[]>();

    if (error) {
      if (isMissingTableOrColumnError(error)) return null;
      console.error("[supplier reputation] quote_messages lookup failed (responsiveness)", {
        quoteCount: quoteIds.length,
        error: serializeSupabaseError(error) ?? error,
      });
      return null;
    }

    for (const msg of data ?? []) {
      const quoteId = normalizeId(msg?.quote_id);
      if (!quoteId) continue;
      const createdAt = typeof msg?.created_at === "string" ? msg.created_at : null;
      if (!createdAt) continue;
      const roleRaw = typeof msg?.sender_role === "string" ? msg.sender_role.trim().toLowerCase() : "";
      const role =
        roleRaw === "customer" || roleRaw === "supplier" || roleRaw === "admin"
          ? (roleRaw as "customer" | "supplier" | "admin")
          : null;

      if (!latestByQuoteId.has(quoteId)) {
        latestByQuoteId.set(quoteId, {
          lastMessageAt: createdAt,
          lastRole: role,
          lastCustomerMessageAt: role === "customer" ? createdAt : null,
          lastSupplierMessageAt: role === "supplier" ? createdAt : null,
        });
      } else {
        const agg = latestByQuoteId.get(quoteId)!;
        if (role === "customer" && !agg.lastCustomerMessageAt) agg.lastCustomerMessageAt = createdAt;
        if (role === "supplier" && !agg.lastSupplierMessageAt) agg.lastSupplierMessageAt = createdAt;
      }
    }
  } catch (error) {
    if (isMissingTableOrColumnError(error)) return null;
    console.error("[supplier reputation] quote_messages lookup crashed (responsiveness)", {
      quoteCount: quoteIds.length,
      error: serializeSupabaseError(error) ?? error,
    });
    return null;
  }

  const nowMs = Date.now();
  const within48hMs = 48 * 60 * 60 * 1000;

  const output = new Map<string, { needsReplyCount: number; needsReplyWithin48hCount: number }>();
  for (const id of ids) {
    output.set(id, { needsReplyCount: 0, needsReplyWithin48hCount: 0 });
  }

  for (const supplierId of ids) {
    const quoteSet = quoteIdsBySupplier.get(supplierId) ?? new Set<string>();
    const bucket = output.get(supplierId);
    if (!bucket) continue;

    for (const quoteId of quoteSet) {
      const agg = latestByQuoteId.get(quoteId);
      if (!agg?.lastCustomerMessageAt || !agg.lastMessageAt) continue;

      const needsReply = resolveNeedsReplyFromSupplier({
        lastRole: agg.lastRole,
        lastCustomerMessageAt: agg.lastCustomerMessageAt,
        lastSupplierMessageAt: agg.lastSupplierMessageAt,
      });
      if (!needsReply) continue;

      bucket.needsReplyCount += 1;
      const lastCustomerMs = Date.parse(agg.lastCustomerMessageAt);
      if (Number.isFinite(lastCustomerMs) && nowMs - lastCustomerMs <= within48hMs) {
        bucket.needsReplyWithin48hCount += 1;
      }
    }
  }

  return output;
}

async function safeLoadFeedbackBySupplierIds(args: {
  supplierIds: string[];
  lookbackDays: number;
}): Promise<Map<string, Record<string, number>> | null> {
  const ids = args.supplierIds;
  if (ids.length === 0) return new Map();
  if (!isRfqFeedbackEnabled()) return null;
  const hasSchema = await schemaGate({
    enabled: true,
    relation: "quote_rfq_feedback",
    requiredColumns: ["quote_id", "supplier_id", "categories", "created_at"],
    warnPrefix: "[rfq_feedback]",
  });
  if (!hasSchema) return null;
  if (isSupabaseRelationMarkedMissing("quote_rfq_feedback")) return null;
  const cutoffIso = new Date(Date.now() - args.lookbackDays * 24 * 60 * 60 * 1000).toISOString();

  try {
    const { data, error } = await supabaseServer
      .from("quote_rfq_feedback")
      .select("supplier_id,categories,created_at")
      .in("supplier_id", ids)
      .gte("created_at", cutoffIso)
      .limit(20000)
      .returns<QuoteRfqFeedbackLite[]>();

    if (error) {
      if (
        handleMissingSupabaseRelation({
          relation: "quote_rfq_feedback",
          error,
          warnPrefix: "[rfq_feedback]",
        })
      ) {
        return null;
      }
      if (isMissingTableOrColumnError(error)) return null;
      console.error("[supplier reputation] quote_rfq_feedback load failed", {
        supplierCount: ids.length,
        error: serializeSupabaseError(error) ?? error,
      });
      return new Map();
    }

    const out = new Map<string, Record<string, number>>();
    for (const id of ids) out.set(id, {});

    for (const row of data ?? []) {
      const supplierId = normalizeId(row?.supplier_id);
      if (!supplierId || !out.has(supplierId)) continue;
      const set = new Set(
        (Array.isArray(row?.categories) ? row.categories : [])
          .map(normalizeFeedbackCategory)
          .filter((v): v is string => typeof v === "string"),
      );
      if (set.size === 0) continue;
      const agg = out.get(supplierId)!;
      for (const cat of set) {
        agg[cat] = (agg[cat] ?? 0) + 1;
      }
    }

    return out;
  } catch (error) {
    if (
      handleMissingSupabaseRelation({
        relation: "quote_rfq_feedback",
        error,
        warnPrefix: "[rfq_feedback]",
      })
    ) {
      return null;
    }
    if (isMissingTableOrColumnError(error)) return null;
    console.error("[supplier reputation] quote_rfq_feedback load crashed", {
      supplierCount: ids.length,
      error: serializeSupabaseError(error) ?? error,
    });
    return new Map();
  }
}

async function loadSupplierReputationInternal(args: {
  supplierIds: string[];
  requireAdmin: boolean;
}): Promise<SupplierReputationMap> {
  const ids = uniqIds(args.supplierIds);
  const fallback: SupplierReputationMap = Object.fromEntries(
    ids.map((id) => [id, { supplierId: id, score: null, label: "unknown" }]),
  );
  if (ids.length === 0) return {};

  if (args.requireAdmin) {
    try {
      await requireAdminUser();
    } catch (error) {
      console.warn("[supplier reputation] admin gate failed; returning unknown", {
        supplierCount: ids.length,
        error: serializeSupabaseError(error) ?? error,
      });
      return fallback;
    }
  }

  // Batch loads (best-effort); each may degrade independently.
  const [matchMap, benchMap, kickoffMap, feedbackMap, responsivenessMap] = await Promise.all([
    safeLoadMatchHealth(ids),
    safeLoadBenchUtil(ids),
    safeLoadAwardKickoffRatios({ supplierIds: ids, lookbackDays: 365, onTimeDays: 14 }),
    safeLoadFeedbackBySupplierIds({ supplierIds: ids, lookbackDays: 365 }),
    safeLoadResponsivenessBySupplierIds({
      supplierIds: ids,
      lookbackDays: 90,
      maxSuppliersForThisSignal: 50,
      maxQuoteIdsPerSupplier: 25,
    }),
  ]);

  if ((matchMap === null || benchMap === null) && !didWarnMissingSignals) {
    didWarnMissingSignals = true;
    console.warn("[supplier reputation] missing views; computing partial reputation", {
      matchViewMissing: matchMap === null,
      benchViewMissing: benchMap === null,
    });
  }

  const out: SupplierReputationMap = {};

  for (const supplierId of ids) {
    const matchRow = matchMap && matchMap instanceof Map ? (matchMap.get(supplierId) ?? null) : null;
    const benchRow = benchMap && benchMap instanceof Map ? (benchMap.get(supplierId) ?? null) : null;

    const bids90d = matchRow ? toNumberOrNull(matchRow.rfqs_bid_90d) : null;
    const wins90d = matchRow ? toNumberOrNull(matchRow.rfqs_won_90d) : null;
    const winRatePctFromView = matchRow ? toNumberOrNull(matchRow.win_rate_pct_90d) : null;
    const winRatePct =
      winRatePctFromView !== null
        ? winRatePctFromView
        : typeof bids90d === "number" && bids90d > 0 && typeof wins90d === "number"
          ? (wins90d / bids90d) * 100
          : null;

    const matchHealth = normalizeMatchHealth(matchRow?.match_health ?? null);
    const benchStatus = normalizeBenchStatus(benchRow?.bench_status ?? null);

    const kickoff = kickoffMap.get(supplierId) ?? null;
    const kickoffOnTimeRatio = kickoff?.ratio ?? null;

    const feedbackByCat = feedbackMap?.get(supplierId) ?? null;
    const responsiveness = responsivenessMap?.get(supplierId) ?? null;

    out[supplierId] = computeScore({
      supplierId,
      winRatePct,
      bids90d,
      matchHealth,
      benchStatus,
      kickoffOnTimeRatio,
      responsiveness,
      feedbackByCategory: feedbackByCat,
    });
  }

  return out;
}

export async function loadSupplierReputationForSuppliers(
  supplierIds: string[],
): Promise<SupplierReputationMap> {
  return await loadSupplierReputationInternal({ supplierIds, requireAdmin: true });
}

export async function loadSupplierReputationForSupplier(
  supplierId: string,
): Promise<SupplierReputationScore | null> {
  const id = normalizeId(supplierId);
  if (!id) return null;
  const map = await loadSupplierReputationInternal({ supplierIds: [id], requireAdmin: false });
  return map[id] ?? null;
}

