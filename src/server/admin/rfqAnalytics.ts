import { supabaseServer } from "@/lib/supabaseServer";
import { requireAdminUser } from "@/server/auth";
import {
  isMissingTableOrColumnError,
  serializeSupabaseError,
} from "@/server/admin/logging";
import { normalizeQuoteStatus } from "@/server/quotes/status";
import {
  computeRfqQualitySummary,
  type SupplierFeedbackCategory,
} from "@/server/quotes/rfqQualitySignals";

export type RfqAnalyticsFilters = {
  range?: "7d" | "30d" | "90d" | "365d";
  customerId?: string | null;
  region?: string | null;
  process?: string | null;
  material?: string | null;
};

export type RfqFunnelSnapshot = {
  from: string; // ISO date
  to: string; // ISO date
  rfqsCreated: number;
  rfqsWithBids: number;
  rfqsWith2PlusBids: number;
  rfqsAwarded: number;
};

export type RfqQualityBucketCounts = {
  high: number; // score >= 85
  medium: number; // 70–84
  low: number; // 50–69
  veryLow: number; // < 50
};

export type RfqIssueBreakdown = {
  missingCad: number;
  missingDrawings: number;
  partsNeedsAttention: number;
  partsNone: number;
  supplierScopeUnclear: number;
  supplierTimelineUnrealistic: number;
  supplierOutsideCapability: number;
};

export type RfqAnalyticsSummary = {
  filters: RfqAnalyticsFilters & { from: string; to: string };
  funnel: RfqFunnelSnapshot;
  averageQualityScore: number | null;
  qualityBuckets: RfqQualityBucketCounts;
  issueBreakdown: RfqIssueBreakdown;
};

type QuoteRowLite = {
  id: string;
  upload_id: string | null;
  customer_id: string | null;
  customer_email: string | null;
  status: string | null;
  created_at: string | null;
  awarded_supplier_id: string | null;
  awarded_bid_id: string | null;
};

type UploadMetaLite = {
  id: string;
  manufacturing_process: string | null;
  shipping_postal_code: string | null;
  export_restriction: string | null;
  rfq_reason: string | null;
  notes: string | null;
};

type SupplierBidRowLite = {
  quote_id: string | null;
  supplier_id: string | null;
};

const DEFAULT_RANGE: NonNullable<RfqAnalyticsFilters["range"]> = "30d";

function normalizeString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function parseRangeDays(value: RfqAnalyticsFilters["range"]): number {
  switch (value) {
    case "7d":
      return 7;
    case "90d":
      return 90;
    case "365d":
      return 365;
    case "30d":
    default:
      return 30;
  }
}

function resolveWindowIso(range: RfqAnalyticsFilters["range"]): { from: string; to: string } {
  const days = parseRangeDays(range ?? DEFAULT_RANGE);
  const toMs = Date.now();
  const fromMs = toMs - days * 24 * 60 * 60 * 1000;
  return { from: new Date(fromMs).toISOString(), to: new Date(toMs).toISOString() };
}

function normalizeNeedle(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

function includesEitherWay(haystack: string | null | undefined, needle: string): boolean {
  const source = (haystack ?? "").trim().toLowerCase();
  if (!source) return false;
  return source.includes(needle) || needle.includes(source);
}

function bucketizeScore(score: number): keyof RfqQualityBucketCounts {
  if (score >= 85) return "high";
  if (score >= 70) return "medium";
  if (score >= 50) return "low";
  return "veryLow";
}

function hasCategory(
  categories: ReadonlySet<SupplierFeedbackCategory>,
  value: SupplierFeedbackCategory,
): boolean {
  return categories.has(value);
}

async function mapWithConcurrency<TIn, TOut>(
  items: readonly TIn[],
  concurrency: number,
  mapper: (item: TIn, index: number) => Promise<TOut>,
): Promise<TOut[]> {
  const limit = Math.max(1, Math.min(25, Math.floor(concurrency)));
  const results: TOut[] = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await mapper(items[index]!, index);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

export async function loadRfqAnalytics(
  filters: RfqAnalyticsFilters,
): Promise<RfqAnalyticsSummary> {
  // Defense-in-depth: analytics uses service role data; never expose without admin gating.
  await requireAdminUser();

  const normalizedFilters: RfqAnalyticsFilters = {
    range: filters.range ?? DEFAULT_RANGE,
    customerId: normalizeString(filters.customerId),
    region: normalizeString(filters.region),
    process: normalizeString(filters.process),
    material: normalizeString(filters.material),
  };

  const window = resolveWindowIso(normalizedFilters.range);

  const empty: RfqAnalyticsSummary = {
    filters: { ...normalizedFilters, from: window.from, to: window.to },
    funnel: {
      from: window.from,
      to: window.to,
      rfqsCreated: 0,
      rfqsWithBids: 0,
      rfqsWith2PlusBids: 0,
      rfqsAwarded: 0,
    },
    averageQualityScore: null,
    qualityBuckets: { high: 0, medium: 0, low: 0, veryLow: 0 },
    issueBreakdown: {
      missingCad: 0,
      missingDrawings: 0,
      partsNeedsAttention: 0,
      partsNone: 0,
      supplierScopeUnclear: 0,
      supplierTimelineUnrealistic: 0,
      supplierOutsideCapability: 0,
    },
  };

  let baseQuotes: QuoteRowLite[] = [];

  try {
    let query = supabaseServer
      .from("quotes_with_uploads")
      .select(
        "id,upload_id,customer_id,customer_email,status,created_at,awarded_supplier_id,awarded_bid_id",
      )
      .gte("created_at", window.from)
      .lte("created_at", window.to);

    const customerId = normalizedFilters.customerId;
    if (customerId) {
      // Mirror existing patterns: allow matching on customer_id (uuid) or customer_email.
      if (customerId.includes("@")) {
        query = query.ilike("customer_email", `%${customerId}%`);
      } else {
        query = query.eq("customer_id", customerId);
      }
    }

    const { data, error } = await query.returns<QuoteRowLite[]>();
    if (error) {
      if (isMissingTableOrColumnError(error)) {
        console.warn("[rfq analytics] missing schema for quotes_with_uploads; returning empty", {
          error: serializeSupabaseError(error) ?? error,
        });
        return empty;
      }
      console.error("[rfq analytics] quotes_with_uploads query failed", {
        error: serializeSupabaseError(error) ?? error,
      });
      return empty;
    }

    baseQuotes = Array.isArray(data) ? data : [];
  } catch (error) {
    if (isMissingTableOrColumnError(error)) {
      console.warn("[rfq analytics] missing schema for quotes_with_uploads; returning empty", {
        error: serializeSupabaseError(error) ?? error,
      });
      return empty;
    }
    console.error("[rfq analytics] quotes_with_uploads query crashed", {
      error: serializeSupabaseError(error) ?? error,
    });
    return empty;
  }

  // Optional enrichment from uploads for process/material/region filtering.
  const uploadIds = Array.from(
    new Set(
      baseQuotes
        .map((q) => normalizeId(q.upload_id))
        .filter((id) => id.length > 0),
    ),
  );

  const uploadMetaById = new Map<string, UploadMetaLite>();
  if (uploadIds.length > 0) {
    try {
      const { data, error } = await supabaseServer
        .from("uploads")
        .select("id,manufacturing_process,shipping_postal_code,export_restriction,rfq_reason,notes")
        .in("id", uploadIds)
        .returns<UploadMetaLite[]>();

      if (error) {
        if (!isMissingTableOrColumnError(error)) {
          console.warn("[rfq analytics] uploads lookup failed; continuing without upload filters", {
            error: serializeSupabaseError(error) ?? error,
          });
        }
      } else {
        for (const row of data ?? []) {
          const id = normalizeId(row?.id);
          if (id) uploadMetaById.set(id, row);
        }
      }
    } catch (error) {
      if (!isMissingTableOrColumnError(error)) {
        console.warn("[rfq analytics] uploads lookup crashed; continuing without upload filters", {
          error: serializeSupabaseError(error) ?? error,
        });
      }
    }
  }

  const processNeedle = normalizeNeedle(normalizedFilters.process);
  const materialNeedle = normalizeNeedle(normalizedFilters.material);
  const regionNeedle = normalizeNeedle(normalizedFilters.region);

  const filteredQuotes = baseQuotes.filter((quote) => {
    if (!processNeedle && !materialNeedle && !regionNeedle) return true;

    const uploadId = normalizeId(quote.upload_id);
    if (!uploadId) return false;
    const meta = uploadMetaById.get(uploadId) ?? null;
    if (!meta) return false;

    if (processNeedle) {
      const process = normalizeNeedle(meta.manufacturing_process);
      if (!process || !includesEitherWay(process, processNeedle)) {
        return false;
      }
    }

    if (materialNeedle) {
      const searchable = `${meta.notes ?? ""} ${meta.rfq_reason ?? ""}`.toLowerCase();
      if (!searchable.includes(materialNeedle)) {
        return false;
      }
    }

    if (regionNeedle) {
      // Best-effort: we don’t have a stable “region” column on quotes; treat region as
      // a free-text match against export restriction + shipping hint.
      const exportRestriction = normalizeNeedle(meta.export_restriction);
      const postal = normalizeNeedle(meta.shipping_postal_code);
      const matches =
        (exportRestriction && exportRestriction.includes(regionNeedle)) ||
        (postal && postal.includes(regionNeedle));
      if (!matches) return false;
    }

    return true;
  });

  const quoteIds = Array.from(new Set(filteredQuotes.map((q) => normalizeId(q.id)).filter(Boolean)));

  const funnel: RfqFunnelSnapshot = {
    from: window.from,
    to: window.to,
    rfqsCreated: quoteIds.length,
    rfqsWithBids: 0,
    rfqsWith2PlusBids: 0,
    rfqsAwarded: 0,
  };

  // Funnel: awarded
  for (const q of filteredQuotes) {
    const status = normalizeQuoteStatus(q.status);
    const hasAwardedSupplier = Boolean(normalizeId(q.awarded_supplier_id));
    if (status === "won" && hasAwardedSupplier) {
      funnel.rfqsAwarded += 1;
    }
  }

  // Funnel: bids (batched)
  if (quoteIds.length > 0) {
    try {
      const { data, error } = await supabaseServer
        .from("supplier_bids")
        .select("quote_id,supplier_id")
        .in("quote_id", quoteIds)
        .returns<SupplierBidRowLite[]>();

      if (error) {
        if (!isMissingTableOrColumnError(error)) {
          console.error("[rfq analytics] supplier_bids query failed", {
            quoteCount: quoteIds.length,
            error: serializeSupabaseError(error) ?? error,
          });
        }
      } else {
        const suppliersByQuoteId = new Map<string, Set<string>>();
        for (const row of data ?? []) {
          const quoteId = normalizeId(row?.quote_id);
          const supplierId = normalizeId(row?.supplier_id);
          if (!quoteId) continue;
          const set = suppliersByQuoteId.get(quoteId) ?? new Set<string>();
          if (supplierId) set.add(supplierId);
          suppliersByQuoteId.set(quoteId, set);
        }

        funnel.rfqsWithBids = Array.from(suppliersByQuoteId.keys()).length;
        funnel.rfqsWith2PlusBids = Array.from(suppliersByQuoteId.values()).filter(
          (set) => set.size >= 2,
        ).length;
      }
    } catch (error) {
      if (!isMissingTableOrColumnError(error)) {
        console.error("[rfq analytics] supplier_bids query crashed", {
          quoteCount: quoteIds.length,
          error: serializeSupabaseError(error) ?? error,
        });
      }
    }
  }

  // Quality metrics (reuse computeRfqQualitySummary)
  const qualityBuckets: RfqQualityBucketCounts = { high: 0, medium: 0, low: 0, veryLow: 0 };
  const issueBreakdown: RfqIssueBreakdown = {
    missingCad: 0,
    missingDrawings: 0,
    partsNeedsAttention: 0,
    partsNone: 0,
    supplierScopeUnclear: 0,
    supplierTimelineUnrealistic: 0,
    supplierOutsideCapability: 0,
  };

  let scoredCount = 0;
  let scoreSum = 0;

  await mapWithConcurrency(
    quoteIds,
    8,
    async (quoteId) => {
      try {
        const summary = await computeRfqQualitySummary(quoteId);
        const score = typeof summary.score === "number" ? summary.score : 0;

        scoredCount += 1;
        scoreSum += score;
        qualityBuckets[bucketizeScore(score)] += 1;

        if (summary.missingCad) issueBreakdown.missingCad += 1;
        if (summary.missingDrawings) issueBreakdown.missingDrawings += 1;
        if (summary.partsCoverage === "needs_attention") issueBreakdown.partsNeedsAttention += 1;
        if (summary.partsCoverage === "none") issueBreakdown.partsNone += 1;

        const cats = new Set(
          (summary.signals ?? [])
            .map((s) => s?.category)
            .filter((v): v is SupplierFeedbackCategory => typeof v === "string"),
        );
        if (hasCategory(cats, "scope_unclear")) issueBreakdown.supplierScopeUnclear += 1;
        if (hasCategory(cats, "timeline_unrealistic")) {
          issueBreakdown.supplierTimelineUnrealistic += 1;
        }
        if (hasCategory(cats, "outside_capability")) {
          issueBreakdown.supplierOutsideCapability += 1;
        }
      } catch (error) {
        console.warn("[rfq analytics] computeRfqQualitySummary failed; skipping", {
          quoteId,
          error: serializeSupabaseError(error) ?? error,
        });
      }
      return null;
    },
  );

  const averageQualityScore =
    scoredCount > 0 ? Math.round((scoreSum / scoredCount) * 10) / 10 : null;

  return {
    filters: { ...normalizedFilters, from: window.from, to: window.to },
    funnel,
    averageQualityScore,
    qualityBuckets,
    issueBreakdown,
  };
}

