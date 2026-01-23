import { supabaseServer } from "@/lib/supabaseServer";
import {
  isWinningBidStatus,
  normalizeBidStatus,
  type SupplierBidStatusNormalized,
} from "@/lib/bids/status";
import { serializeSupabaseError } from "@/server/admin/logging";

type BidAggregateRow = {
  quote_id: string | null;
  unit_price: number | string | null;
  currency: string | null;
  lead_time_days: number | null;
  status: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export type QuoteBidAggregate = {
  quoteId: string;
  bidCount: number;
  lastBidAt: string | null;
  latestStatus: SupplierBidStatusNormalized | null;
  hasWinningBid: boolean;
  bestPriceAmount: number | null;
  bestPriceCurrency: string | null;
  fastestLeadTimeDays: number | null;
  winningBidAmount: number | null;
  winningBidCurrency: string | null;
  winningBidLeadTimeDays: number | null;
};

const SUPPLIER_BIDS_TABLE = "supplier_bids";

export async function loadQuoteBidAggregates(
  quoteIds: readonly (string | null | undefined)[],
): Promise<Record<string, QuoteBidAggregate>> {
  const normalizedIds = Array.from(
    new Set(
      (quoteIds ?? [])
        .map((value) => (typeof value === "string" ? value.trim() : ""))
        .filter((value) => value.length > 0),
    ),
  );

  if (normalizedIds.length === 0) {
    return {};
  }

  try {
    const { data, error } = await supabaseServer()
      .from(SUPPLIER_BIDS_TABLE)
      .select(
        "quote_id,unit_price,currency,lead_time_days,status,created_at,updated_at",
      )
      .in("quote_id", normalizedIds)
      .returns<BidAggregateRow[]>();

    if (error) {
      console.error("[quote bids] aggregate query failed", {
        quoteCount: normalizedIds.length,
        error: serializeSupabaseError(error),
      });
      return {};
    }

    return buildAggregates(data ?? []);
  } catch (error) {
    console.error("[quote bids] aggregate crashed", {
      quoteCount: normalizedIds.length,
      error: serializeSupabaseError(error) ?? error ?? null,
    });
    return {};
  }
}

function buildAggregates(rows: BidAggregateRow[]): Record<string, QuoteBidAggregate> {
  const aggregates: Record<string, QuoteBidAggregate> = {};

  for (const row of rows) {
    const quoteId = resolveQuoteId(row?.quote_id);
    if (!quoteId) {
      continue;
    }

    const aggregate =
      aggregates[quoteId] ??
      ({
        quoteId,
        bidCount: 0,
        lastBidAt: null,
        latestStatus: null,
        hasWinningBid: false,
        bestPriceAmount: null,
        bestPriceCurrency: null,
        fastestLeadTimeDays: null,
        winningBidAmount: null,
        winningBidCurrency: null,
        winningBidLeadTimeDays: null,
      } satisfies QuoteBidAggregate);

    const timestamp = resolveLatestTimestamp(row?.updated_at, row?.created_at);
    const normalizedStatus = normalizeBidStatus(row?.status ?? null);
    const numericAmount = resolveNumericValue(row?.unit_price);
    const leadTime = resolveLeadTime(row?.lead_time_days);

    aggregate.bidCount += 1;

    if (
      timestamp &&
      (!aggregate.lastBidAt || timestamp > aggregate.lastBidAt)
    ) {
      aggregate.lastBidAt = timestamp;
      aggregate.latestStatus = normalizedStatus;
    }

    if (isWinningBidStatus(row?.status ?? null)) {
      aggregate.hasWinningBid = true;
      if (typeof numericAmount === "number") {
        aggregate.winningBidAmount = numericAmount;
        aggregate.winningBidCurrency = row?.currency ?? aggregate.winningBidCurrency;
      }
      if (typeof leadTime === "number") {
        aggregate.winningBidLeadTimeDays = leadTime;
      }
    }

    if (
      typeof numericAmount === "number" &&
      (aggregate.bestPriceAmount === null || numericAmount < aggregate.bestPriceAmount)
    ) {
      aggregate.bestPriceAmount = numericAmount;
      aggregate.bestPriceCurrency = row?.currency ?? aggregate.bestPriceCurrency;
    }

    if (
      typeof leadTime === "number" &&
      (aggregate.fastestLeadTimeDays === null ||
        leadTime < aggregate.fastestLeadTimeDays)
    ) {
      aggregate.fastestLeadTimeDays = leadTime;
    }

    aggregates[quoteId] = aggregate;
  }

  return aggregates;
}

function resolveQuoteId(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function resolveLatestTimestamp(
  updatedAt?: string | null,
  createdAt?: string | null,
): string | null {
  const normalizedUpdated = normalizeTimestamp(updatedAt);
  const normalizedCreated = normalizeTimestamp(createdAt);

  if (normalizedUpdated && normalizedCreated) {
    return normalizedUpdated > normalizedCreated
      ? normalizedUpdated
      : normalizedCreated;
  }

  return normalizedUpdated ?? normalizedCreated ?? null;
}

function normalizeTimestamp(value?: string | null): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function resolveNumericValue(
  value: number | string | null | undefined,
): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function resolveLeadTime(value: number | null | undefined): number | null {
  if (typeof value !== "number") {
    return null;
  }
  return Number.isFinite(value) ? value : null;
}
