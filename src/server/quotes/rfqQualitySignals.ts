import { supabaseServer } from "@/lib/supabaseServer";
import {
  isMissingTableOrColumnError,
  serializeSupabaseError,
} from "@/server/admin/logging";
import { loadQuoteMessages } from "@/server/quotes/messages";
import { computePartsCoverage } from "@/lib/quote/partsCoverage";
import { loadQuoteWorkspaceData } from "@/app/(portals)/quotes/workspaceData";

export type SupplierFeedbackCategory =
  | "scope_unclear"
  | "missing_drawings"
  | "missing_cad"
  | "timeline_unrealistic"
  | "materials_unclear"
  | "pricing_risk"
  | "outside_capability"
  | "other";

export type RfqQualitySignal = {
  quoteId: string;
  supplierId: string;
  relevance: number; // 1–100
  category: SupplierFeedbackCategory;
  reason?: string;
};

export type RfqQualitySummary = {
  quoteId: string;
  score: number; // 0–100
  missingCad: boolean;
  missingDrawings: boolean;
  partsCoverage: "none" | "needs_attention" | "good";
  suppliersDeclined: number;
  suppliersRequestedClarification: number;
  signals: RfqQualitySignal[];
};

type QuoteInviteRow = {
  supplier_id: string | null;
  created_at: string | null;
};

type SupplierBidRowLite = {
  supplier_id: string | null;
  unit_price: number | string | null;
  currency: string | null;
  created_at: string | null;
};

type SupplierMatchHealthRowLite = {
  supplier_id: string;
  match_health: string | null;
};

type QuoteRfqFeedbackRowLite = {
  supplier_id: string | null;
  categories: string[] | null;
  note: string | null;
  created_at: string | null;
};

function normalizeId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function parseIsoMs(value: string | null | undefined): number {
  if (!value) return Number.NaN;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : Number.NaN;
}

function toNumberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function isClarificationMessage(body: string): boolean {
  const text = body.trim().toLowerCase();
  if (!text) return false;
  if (text.includes("?")) return true;
  // Heuristic keywords to catch “can you clarify…” messages without a question mark.
  return (
    text.includes("clarif") ||
    text.includes("unclear") ||
    text.includes("question") ||
    text.includes("spec") ||
    text.includes("tolerance") ||
    text.includes("material") ||
    text.includes("finish") ||
    text.includes("rev ") ||
    text.includes("revision")
  );
}

function summarizeMatchHealth(value: unknown): "good" | "caution" | "poor" | "unknown" {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (normalized === "good" || normalized === "caution" || normalized === "poor") {
    return normalized;
  }
  return "unknown";
}

async function safeLoadQuoteInvites(quoteId: string): Promise<QuoteInviteRow[]> {
  try {
    const { data, error } = await supabaseServer
      .from("quote_invites")
      .select("supplier_id,created_at")
      .eq("quote_id", quoteId)
      .returns<QuoteInviteRow[]>();

    if (error) {
      if (isMissingTableOrColumnError(error)) return [];
      console.error("[rfq quality] quote_invites load failed", {
        quoteId,
        error: serializeSupabaseError(error) ?? error,
      });
      return [];
    }

    return Array.isArray(data) ? data : [];
  } catch (error) {
    if (isMissingTableOrColumnError(error)) return [];
    console.error("[rfq quality] quote_invites load crashed", {
      quoteId,
      error: serializeSupabaseError(error) ?? error,
    });
    return [];
  }
}

async function safeLoadSupplierBids(quoteId: string): Promise<SupplierBidRowLite[]> {
  try {
    const { data, error } = await supabaseServer
      .from("supplier_bids")
      .select("supplier_id,unit_price,currency,created_at")
      .eq("quote_id", quoteId)
      .returns<SupplierBidRowLite[]>();

    if (error) {
      if (isMissingTableOrColumnError(error)) return [];
      console.error("[rfq quality] supplier_bids load failed", {
        quoteId,
        error: serializeSupabaseError(error) ?? error,
      });
      return [];
    }

    return Array.isArray(data) ? data : [];
  } catch (error) {
    if (isMissingTableOrColumnError(error)) return [];
    console.error("[rfq quality] supplier_bids load crashed", {
      quoteId,
      error: serializeSupabaseError(error) ?? error,
    });
    return [];
  }
}

async function safeLoadMatchHealthBySupplierIds(
  supplierIds: string[],
): Promise<Record<string, "good" | "caution" | "poor" | "unknown">> {
  const ids = Array.from(new Set((supplierIds ?? []).map(normalizeId).filter(Boolean)));
  if (ids.length === 0) return {};

  try {
    const { data, error } = await supabaseServer
      .from("supplier_match_health_summary")
      .select("supplier_id,match_health")
      .in("supplier_id", ids)
      .returns<SupplierMatchHealthRowLite[]>();

    if (error) {
      if (isMissingTableOrColumnError(error)) {
        return Object.fromEntries(ids.map((id) => [id, "unknown"]));
      }
      console.error("[rfq quality] supplier_match_health_summary load failed", {
        supplierCount: ids.length,
        error: serializeSupabaseError(error) ?? error,
      });
      return Object.fromEntries(ids.map((id) => [id, "unknown"]));
    }

    const out: Record<string, "good" | "caution" | "poor" | "unknown"> = Object.fromEntries(
      ids.map((id) => [id, "unknown"]),
    );
    for (const row of data ?? []) {
      const supplierId = normalizeId(row?.supplier_id);
      if (!supplierId) continue;
      out[supplierId] = summarizeMatchHealth(row?.match_health);
    }
    return out;
  } catch (error) {
    if (isMissingTableOrColumnError(error)) {
      return Object.fromEntries(ids.map((id) => [id, "unknown"]));
    }
    console.error("[rfq quality] supplier_match_health_summary load crashed", {
      supplierCount: ids.length,
      error: serializeSupabaseError(error) ?? error,
    });
    return Object.fromEntries(ids.map((id) => [id, "unknown"]));
  }
}

async function safeLoadQuoteRfqFeedback(quoteId: string): Promise<QuoteRfqFeedbackRowLite[]> {
  try {
    const { data, error } = await supabaseServer
      .from("quote_rfq_feedback")
      .select("supplier_id,categories,note,created_at")
      .eq("quote_id", quoteId)
      .returns<QuoteRfqFeedbackRowLite[]>();

    if (error) {
      if (isMissingTableOrColumnError(error)) return [];
      console.error("[rfq quality] quote_rfq_feedback load failed", {
        quoteId,
        error: serializeSupabaseError(error) ?? error,
      });
      return [];
    }

    return Array.isArray(data) ? data : [];
  } catch (error) {
    if (isMissingTableOrColumnError(error)) return [];
    console.error("[rfq quality] quote_rfq_feedback load crashed", {
      quoteId,
      error: serializeSupabaseError(error) ?? error,
    });
    return [];
  }
}

export async function computeRfqQualitySummary(
  quoteId: string,
): Promise<RfqQualitySummary> {
  const normalizedQuoteId = normalizeId(quoteId);
  const base: RfqQualitySummary = {
    quoteId: normalizedQuoteId,
    score: 100,
    missingCad: false,
    missingDrawings: false,
    partsCoverage: "none",
    suppliersDeclined: 0,
    suppliersRequestedClarification: 0,
    signals: [],
  };
  if (!normalizedQuoteId) return { ...base, quoteId: quoteId };

  const signals: RfqQualitySignal[] = [];
  let score = 100;

  // Parts coverage + file completeness (via existing computePartsCoverage summary).
  try {
    const workspaceResult = await loadQuoteWorkspaceData(normalizedQuoteId, {
      safeOnly: true,
    });
    const parts =
      workspaceResult.ok && workspaceResult.data ? workspaceResult.data.parts : [];
    const { summary: partsSummary } = computePartsCoverage(parts ?? []);

    if (!partsSummary.anyParts) {
      base.partsCoverage = "none";
      score -= 30;
    } else if (partsSummary.allCovered) {
      base.partsCoverage = "good";
    } else {
      base.partsCoverage = "needs_attention";
      score -= 15;
    }

    const missingCad = partsSummary.anyParts && partsSummary.partsNeedingCad > 0;
    const missingDrawings =
      partsSummary.anyParts && partsSummary.partsNeedingDrawing > 0;

    base.missingCad = missingCad;
    base.missingDrawings = missingDrawings;

    if (missingCad) {
      score -= 20;
      signals.push({
        quoteId: normalizedQuoteId,
        supplierId: "unknown",
        relevance: 85,
        category: "missing_cad",
        reason: `${partsSummary.partsNeedingCad} part(s) need CAD.`,
      });
    }
    if (missingDrawings) {
      score -= 15;
      signals.push({
        quoteId: normalizedQuoteId,
        supplierId: "unknown",
        relevance: 75,
        category: "missing_drawings",
        reason: `${partsSummary.partsNeedingDrawing} part(s) need drawings.`,
      });
    }
  } catch (error) {
    // If workspace data fails, don’t tank the whole signal engine.
    console.warn("[rfq quality] workspace load crashed; skipping parts signals", {
      quoteId: normalizedQuoteId,
      error: serializeSupabaseError(error) ?? error,
    });
  }

  // Invites + bids timing / engagement.
  const [invites, bids, messagesResult, feedbackRows] = await Promise.all([
    safeLoadQuoteInvites(normalizedQuoteId),
    safeLoadSupplierBids(normalizedQuoteId),
    loadQuoteMessages({ quoteId: normalizedQuoteId, limit: 250 }),
    safeLoadQuoteRfqFeedback(normalizedQuoteId),
  ]);

  const invitedSupplierIds = Array.from(
    new Set(invites.map((row) => normalizeId(row?.supplier_id)).filter(Boolean)),
  );
  const inviteCount = invites.length;
  const earliestInviteMs = invites.reduce<number>((best, row) => {
    const ms = parseIsoMs(row?.created_at ?? null);
    if (!Number.isFinite(ms)) return best;
    if (!Number.isFinite(best)) return ms;
    return Math.min(best, ms);
  }, Number.NaN);

  const bidCount = bids.length;
  const firstBidMs = bids.reduce<number>((best, row) => {
    const ms = parseIsoMs(row?.created_at ?? null);
    if (!Number.isFinite(ms)) return best;
    if (!Number.isFinite(best)) return ms;
    return Math.min(best, ms);
  }, Number.NaN);

  const hasBeenInvitedLongEnough =
    Number.isFinite(earliestInviteMs) &&
    Date.now() - (earliestInviteMs as number) > 48 * 60 * 60 * 1000;

  if (inviteCount >= 2 && hasBeenInvitedLongEnough && bidCount < 2) {
    score -= 20;
    signals.push({
      quoteId: normalizedQuoteId,
      supplierId: "unknown",
      relevance: 70,
      category: "scope_unclear",
      reason: `Only ${bidCount} bid(s) after 48h despite ${inviteCount} invite(s).`,
    });
  }

  // If bids are arriving *very* late relative to invites, treat as mild timeline/scope risk.
  if (
    inviteCount > 0 &&
    Number.isFinite(earliestInviteMs) &&
    Number.isFinite(firstBidMs) &&
    (firstBidMs as number) - (earliestInviteMs as number) > 72 * 60 * 60 * 1000
  ) {
    signals.push({
      quoteId: normalizedQuoteId,
      supplierId: "unknown",
      relevance: 45,
      category: "timeline_unrealistic",
      reason: "First bid arrived >72h after invites.",
    });
  }

  // Clarification messages: supplier questions before bidding (weak scope_unclear signal).
  const messages = messagesResult.ok ? messagesResult.messages : [];
  const supplierClarifiers = new Map<string, string>(); // sender_id -> snippet
  for (const msg of messages) {
    const role = typeof msg.sender_role === "string" ? msg.sender_role.trim().toLowerCase() : "";
    if (role !== "supplier") continue;
    const body = typeof msg.body === "string" ? msg.body : "";
    if (!isClarificationMessage(body)) continue;
    const senderId = normalizeId(msg.sender_id);
    if (!senderId) continue;

    // Best-effort: if we have *any* bids, treat questions before first bid as “pre-bid”.
    const msgMs = parseIsoMs(msg.created_at);
    const isPreBid = !Number.isFinite(firstBidMs) || (Number.isFinite(msgMs) && msgMs < firstBidMs);
    if (!isPreBid) continue;

    if (!supplierClarifiers.has(senderId)) {
      supplierClarifiers.set(senderId, body.trim().replace(/\s+/g, " ").slice(0, 160));
    }
  }

  base.suppliersRequestedClarification = supplierClarifiers.size;
  if (supplierClarifiers.size > 0) {
    score -= 10;
    for (const [senderId, snippet] of supplierClarifiers.entries()) {
      signals.push({
        quoteId: normalizedQuoteId,
        supplierId: senderId,
        relevance: 35,
        category: "scope_unclear",
        reason: snippet ? `Supplier asked: "${snippet}"` : "Supplier asked for clarification.",
      });
    }
  }

  // Price variance signal (optional, best-effort).
  const pricedBids = bids
    .map((row) => toNumberOrNull(row?.unit_price))
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (pricedBids.length >= 3) {
    const min = Math.min(...pricedBids);
    const max = Math.max(...pricedBids);
    const ratio = min > 0 ? max / min : Number.POSITIVE_INFINITY;
    if (Number.isFinite(ratio) && ratio >= 1.5) {
      score -= 5;
      signals.push({
        quoteId: normalizedQuoteId,
        supplierId: "unknown",
        relevance: 40,
        category: "pricing_risk",
        reason: `Wide price variance (max/min ≈ ${ratio.toFixed(2)}).`,
      });
    }
  }

  // Invited supplier match health (flag-only; does not change score in v0).
  if (invitedSupplierIds.length > 0) {
    const matchHealthBySupplierId = await safeLoadMatchHealthBySupplierIds(invitedSupplierIds);
    const cautionOrPoor = invitedSupplierIds.filter((id) => {
      const h = matchHealthBySupplierId[id] ?? "unknown";
      return h === "caution" || h === "poor";
    });
    if (cautionOrPoor.length >= 2) {
      signals.push({
        quoteId: normalizedQuoteId,
        supplierId: "unknown",
        relevance: 30,
        category: "outside_capability",
        reason: `${cautionOrPoor.length} invited supplier(s) are flagged caution/poor by match health.`,
      });
    }
  }

  // Persisted supplier declines (explicit feedback).
  base.suppliersDeclined = feedbackRows.length;
  if (feedbackRows.length > 0) {
    const penaltyByCategory: Record<SupplierFeedbackCategory, number> = {
      scope_unclear: 10,
      missing_drawings: 10,
      missing_cad: 10,
      materials_unclear: 5,
      timeline_unrealistic: 10,
      outside_capability: 5,
      pricing_risk: 5,
      other: 0,
    };

    const categoryCounts = new Map<SupplierFeedbackCategory, number>();

    for (const row of feedbackRows) {
      const raw = Array.isArray(row?.categories) ? row.categories : [];
      const cats = new Set(
        raw
          .map((value) => (typeof value === "string" ? value.trim() : ""))
          .filter(Boolean) as SupplierFeedbackCategory[],
      );
      for (const cat of cats) {
        if (!Object.prototype.hasOwnProperty.call(penaltyByCategory, cat)) continue;
        categoryCounts.set(cat, (categoryCounts.get(cat) ?? 0) + 1);
        score -= penaltyByCategory[cat] ?? 0;
      }
    }

    for (const [category, count] of categoryCounts.entries()) {
      if (count <= 0) continue;
      const reason = `${count} supplier decline(s) cited ${category.replace(/_/g, " ")}.`;
      const relevance =
        category === "missing_cad" || category === "missing_drawings"
          ? 90
          : category === "timeline_unrealistic"
            ? 80
            : category === "scope_unclear" || category === "materials_unclear"
              ? 70
              : 55;

      signals.push({
        quoteId: normalizedQuoteId,
        supplierId: "aggregate",
        relevance,
        category,
        reason,
      });
    }
  }

  // Sort by relevance (high → low) for stable UI.
  signals.sort((a, b) => {
    const dr = (b.relevance ?? 0) - (a.relevance ?? 0);
    if (dr !== 0) return dr;
    const dc = a.category.localeCompare(b.category);
    if (dc !== 0) return dc;
    return a.supplierId.localeCompare(b.supplierId);
  });

  return {
    ...base,
    quoteId: normalizedQuoteId,
    score: clampScore(score),
    signals,
  };
}

