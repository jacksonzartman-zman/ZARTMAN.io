import { supabaseServer } from "@/lib/supabaseServer";
import { loadQuoteMessages } from "@/server/quotes/messages";
import { loadBenchHealthBySupplierIds } from "@/server/suppliers/benchHealth";
import { UnauthorizedError } from "@/server/auth";
import {
  isMissingTableOrColumnError,
  serializeSupabaseError,
} from "@/server/admin/logging";
import { computeRfqQualitySummary } from "@/server/quotes/rfqQualitySignals";

export type BidComparisonRow = {
  quoteId: string;
  supplierId: string;
  supplierName: string;
  totalAmount: number | null;
  currency: string | null;
  leadTimeDays: number | null;

  // Routing + fit
  matchHealth: "good" | "caution" | "poor" | "unknown";
  benchStatus: "underused" | "balanced" | "overused" | "unknown";

  // Engagement / behavior
  submittedAt: string | null;
  hasMessages: boolean;
  lastSupplierMessageAt: string | null;

  // RFQ / parts completeness
  partsCoverage: "none" | "needs_attention" | "good";
  missingCad: boolean;
  missingDrawings: boolean;

  // Supplier feedback on this RFQ (if any)
  declinedWithReasons: boolean;
  declineCategories: string[];

  // Simple ranking helpers
  priceRank: number | null;
  leadTimeRank: number | null;
  compositeScore: number | null;
};

export type BidComparisonSummary = {
  quoteId: string;
  rows: BidComparisonRow[];
};

type SupplierBidCompareRow = {
  id: string;
  quote_id: string;
  supplier_id: string;
  unit_price: number | string | null;
  currency: string | null;
  lead_time_days: number | null;
  status: string | null;
  created_at: string | null;
  updated_at: string | null;
  supplier:
    | null
    | {
        id: string;
        company_name: string | null;
        primary_email: string | null;
      }
    | Array<{
        id: string;
        company_name: string | null;
        primary_email: string | null;
      }>;
};

type QuoteRfqFeedbackRow = {
  supplier_id: string | null;
  categories: string[] | null;
  created_at: string | null;
};

function normalizeId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeCurrency(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toUpperCase();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeAmount(value: unknown): number | null {
  const numeric = typeof value === "string" ? Number(value) : value;
  if (typeof numeric === "number" && Number.isFinite(numeric)) return numeric;
  return null;
}

function normalizeLeadTime(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  return null;
}

function resolveSupplierRecord(
  raw: SupplierBidCompareRow["supplier"],
): { name: string; email: string | null } {
  const record = Array.isArray(raw) ? raw[0] : raw;
  const name =
    typeof record?.company_name === "string" && record.company_name.trim()
      ? record.company_name.trim()
      : "Supplier partner";
  const email = normalizeEmail(record?.primary_email);
  return { name, email };
}

function rankAsc(values: Array<number | null>): Array<number | null> {
  const normalized = values.map((v) => (typeof v === "number" && Number.isFinite(v) ? v : null));
  const sortedUnique = Array.from(new Set(normalized.filter((v): v is number => v !== null))).sort(
    (a, b) => a - b,
  );
  return normalized.map((v) => {
    if (v === null) return null;
    const idx = sortedUnique.indexOf(v);
    return idx >= 0 ? idx + 1 : null;
  });
}

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function computeCompositeScore(args: {
  bestPrice: number | null;
  fastestLead: number | null;
  totalAmount: number | null;
  leadTimeDays: number | null;
  matchHealth: BidComparisonRow["matchHealth"];
  benchStatus: BidComparisonRow["benchStatus"];
}): number | null {
  let score = 100;

  const bestPrice = args.bestPrice;
  const price = args.totalAmount;
  if (typeof bestPrice === "number" && typeof price === "number" && bestPrice > 0) {
    const ratio = price / bestPrice;
    if (ratio > 1) {
      // ~ -5 pts per +10% above best, capped.
      score -= Math.min(40, (ratio - 1) * 50);
    }
  }

  const fastestLead = args.fastestLead;
  const lead = args.leadTimeDays;
  if (typeof fastestLead === "number" && typeof lead === "number") {
    const delta = lead - fastestLead;
    if (delta > 0) {
      // Small linear penalty; don't dominate price.
      score -= Math.min(25, delta * 1.5);
    }
  }

  if (args.matchHealth === "caution") score -= 5;
  if (args.matchHealth === "poor") score -= 15;

  if (args.benchStatus === "underused") score += 3;
  if (args.benchStatus === "overused") score -= 3;

  return clampScore(score);
}

export async function loadBidComparisonSummary(
  quoteId: string,
): Promise<BidComparisonSummary> {
  const normalizedQuoteId = normalizeId(quoteId);
  const fallback: BidComparisonSummary = { quoteId: normalizedQuoteId, rows: [] };
  if (!normalizedQuoteId) return fallback;

  let bids: SupplierBidCompareRow[] = [];
  try {
    const { data, error } = await supabaseServer
      .from("supplier_bids")
      .select(
        "id,quote_id,supplier_id,unit_price,currency,lead_time_days,status,created_at,updated_at,supplier:suppliers(id,company_name,primary_email)",
      )
      .eq("quote_id", normalizedQuoteId)
      .order("created_at", { ascending: false })
      .returns<SupplierBidCompareRow[]>();

    if (error) {
      if (!isMissingTableOrColumnError(error)) {
        console.warn("[bid compare] base query failed", {
          quoteId: normalizedQuoteId,
          error: serializeSupabaseError(error) ?? error,
        });
      }
      return fallback;
    }
    bids = Array.isArray(data) ? data : [];
  } catch (error) {
    if (!isMissingTableOrColumnError(error)) {
      console.warn("[bid compare] base query crashed", {
        quoteId: normalizedQuoteId,
        error: serializeSupabaseError(error) ?? error,
      });
    }
    return fallback;
  }

  const supplierIds = Array.from(
    new Set(bids.map((row) => normalizeId(row?.supplier_id)).filter(Boolean)),
  );

  const rows: BidComparisonRow[] = [];
  for (const bid of bids) {
    const supplierId = normalizeId(bid?.supplier_id);
    if (!supplierId) continue;
    const supplier = resolveSupplierRecord(bid?.supplier ?? null);
    const row: BidComparisonRow = {
      quoteId: normalizedQuoteId,
      supplierId,
      supplierName: supplier.name,
      totalAmount: normalizeAmount(bid?.unit_price),
      currency: normalizeCurrency(bid?.currency),
      leadTimeDays: normalizeLeadTime(bid?.lead_time_days),
      matchHealth: "unknown",
      benchStatus: "unknown",
      submittedAt: typeof bid?.created_at === "string" ? bid.created_at : null,
      hasMessages: false,
      lastSupplierMessageAt: null,
      partsCoverage: "none",
      missingCad: false,
      missingDrawings: false,
      declinedWithReasons: false,
      declineCategories: [],
      priceRank: null,
      leadTimeRank: null,
      compositeScore: null,
    };
    rows.push(row);
  }

  // RFQ-level completeness (shared across rows)
  try {
    const rfqQuality = await computeRfqQualitySummary(normalizedQuoteId);
    for (const row of rows) {
      row.partsCoverage = rfqQuality.partsCoverage;
      row.missingCad = Boolean(rfqQuality.missingCad);
      row.missingDrawings = Boolean(rfqQuality.missingDrawings);
    }
  } catch (error) {
    console.warn("[bid compare] rfq quality enrichment failed", {
      quoteId: normalizedQuoteId,
      error: serializeSupabaseError(error) ?? error,
    });
  }

  // Match + bench (admin-only; customers should fall back to unknown)
  if (supplierIds.length > 0) {
    try {
      const benchBySupplierId = await loadBenchHealthBySupplierIds(supplierIds);
      for (const row of rows) {
        const bench = benchBySupplierId[row.supplierId];
        if (bench) {
          row.matchHealth = bench.matchHealth ?? "unknown";
          row.benchStatus = bench.benchStatus ?? "unknown";
        }
      }
    } catch (error) {
      if (!(error instanceof UnauthorizedError)) {
        console.warn("[bid compare] bench health enrichment failed", {
          quoteId: normalizedQuoteId,
          supplierCount: supplierIds.length,
          error: serializeSupabaseError(error) ?? error,
        });
      }
      // Keep unknown values.
    }
  }

  // Messages (best-effort: match supplier messages by sender_email = supplier.primary_email)
  try {
    const messagesResult = await loadQuoteMessages(normalizedQuoteId);
    const messages = messagesResult.ok ? messagesResult.messages : [];
    const supplierEmailById = new Map<string, string | null>();
    for (const bid of bids) {
      const supplierId = normalizeId(bid?.supplier_id);
      if (!supplierId || supplierEmailById.has(supplierId)) continue;
      supplierEmailById.set(
        supplierId,
        resolveSupplierRecord(bid?.supplier ?? null).email,
      );
    }

    for (const row of rows) {
      const supplierEmail = supplierEmailById.get(row.supplierId) ?? null;
      if (!supplierEmail) continue;
      const last = messages
        .filter(
          (msg) =>
            msg.sender_role === "supplier" &&
            normalizeEmail(msg.sender_email) === supplierEmail,
        )
        .reduce<string | null>((acc, msg) => {
          const ts = typeof msg?.created_at === "string" ? msg.created_at : null;
          if (!ts) return acc;
          if (!acc) return ts;
          return ts > acc ? ts : acc;
        }, null);

      row.lastSupplierMessageAt = last;
      row.hasMessages = Boolean(last);
    }
  } catch (error) {
    console.warn("[bid compare] messages enrichment failed", {
      quoteId: normalizedQuoteId,
      error: serializeSupabaseError(error) ?? error,
    });
  }

  // Supplier feedback on this quote
  try {
    const { data, error } = await supabaseServer
      .from("quote_rfq_feedback")
      .select("supplier_id,categories,created_at")
      .eq("quote_id", normalizedQuoteId)
      .order("created_at", { ascending: false })
      .limit(100)
      .returns<QuoteRfqFeedbackRow[]>();

    if (error) {
      if (!isMissingTableOrColumnError(error)) {
        console.warn("[bid compare] rfq feedback load failed", {
          quoteId: normalizedQuoteId,
          error: serializeSupabaseError(error) ?? error,
        });
      }
    } else {
      const bySupplier = new Map<string, Set<string>>();
      const hasFeedback = new Set<string>();
      for (const row of data ?? []) {
        const supplierId = normalizeId(row?.supplier_id);
        if (!supplierId) continue;
        hasFeedback.add(supplierId);
        if (!bySupplier.has(supplierId)) bySupplier.set(supplierId, new Set<string>());
        for (const cat of Array.isArray(row?.categories) ? row.categories : []) {
          if (typeof cat !== "string") continue;
          const trimmed = cat.trim();
          if (trimmed) bySupplier.get(supplierId)!.add(trimmed);
        }
      }

      for (const row of rows) {
        if (!hasFeedback.has(row.supplierId)) continue;
        row.declinedWithReasons = true;
        row.declineCategories = Array.from(
          bySupplier.get(row.supplierId) ?? new Set<string>(),
        ).sort();
      }
    }
  } catch (error) {
    if (!isMissingTableOrColumnError(error)) {
      console.warn("[bid compare] rfq feedback load crashed", {
        quoteId: normalizedQuoteId,
        error: serializeSupabaseError(error) ?? error,
      });
    }
  }

  // Ranks + composite score
  const bestPrice = rows.reduce<number | null>((acc, row) => {
    const v = row.totalAmount;
    if (typeof v !== "number") return acc;
    if (acc === null || v < acc) return v;
    return acc;
  }, null);
  const fastestLead = rows.reduce<number | null>((acc, row) => {
    const v = row.leadTimeDays;
    if (typeof v !== "number") return acc;
    if (acc === null || v < acc) return v;
    return acc;
  }, null);

  const priceRanks = rankAsc(rows.map((r) => r.totalAmount));
  const leadRanks = rankAsc(rows.map((r) => r.leadTimeDays));
  for (let i = 0; i < rows.length; i += 1) {
    rows[i]!.priceRank = priceRanks[i] ?? null;
    rows[i]!.leadTimeRank = leadRanks[i] ?? null;
    rows[i]!.compositeScore =
      computeCompositeScore({
        bestPrice,
        fastestLead,
        totalAmount: rows[i]!.totalAmount,
        leadTimeDays: rows[i]!.leadTimeDays,
        matchHealth: rows[i]!.matchHealth,
        benchStatus: rows[i]!.benchStatus,
      }) ?? null;
  }

  return {
    quoteId: normalizedQuoteId,
    rows,
  };
}

