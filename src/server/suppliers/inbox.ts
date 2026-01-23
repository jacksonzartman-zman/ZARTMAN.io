import { supabaseServer } from "@/lib/supabaseServer";
import { serializeSupabaseError } from "@/server/admin/logging";
import {
  deriveSupplierBidSummaryState,
  isWinningBidStatus,
  normalizeBidStatus,
  type SupplierBidStatusNormalized,
  type SupplierBidSummaryState,
} from "@/lib/bids/status";

export type SupplierInboxBidAggregate = {
  quoteId: string;
  bidCount: number;
  lastBidAt: string | null;
  hasWinningBid: boolean;
  latestStatus: SupplierBidStatusNormalized | null;
};

type SupplierBidAggregateRow = {
  quote_id: string | null;
  status: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export async function loadSupplierInboxBidAggregates(
  supplierId: string,
  quoteIds: readonly (string | null | undefined)[],
): Promise<Record<string, SupplierInboxBidAggregate>> {
  const normalizedSupplierId =
    typeof supplierId === "string" ? supplierId.trim() : "";
  if (!normalizedSupplierId) {
    return {};
  }

  const normalizedQuoteIds = Array.from(
    new Set(
      (quoteIds ?? [])
        .map((value) => (typeof value === "string" ? value.trim() : ""))
        .filter((value) => value.length > 0),
    ),
  );

  if (normalizedQuoteIds.length === 0) {
    return {};
  }

  try {
    const { data, error } = await supabaseServer()
      .from("supplier_bids")
      .select("quote_id,status,created_at,updated_at")
      .eq("supplier_id", normalizedSupplierId)
      .in("quote_id", normalizedQuoteIds)
      .returns<SupplierBidAggregateRow[]>();

    if (error) {
      console.error("[supplier inbox] failed to load bid aggregates", {
        supplierId: normalizedSupplierId,
        quoteCount: normalizedQuoteIds.length,
        error: serializeSupabaseError(error),
      });
      return {};
    }

    const aggregates: Record<string, SupplierInboxBidAggregate> = {};

    for (const row of data ?? []) {
      const quoteId = normalizeQuoteId(row?.quote_id);
      if (!quoteId) {
        continue;
      }

      const existing = aggregates[quoteId] ?? {
        quoteId,
        bidCount: 0,
        lastBidAt: null,
        hasWinningBid: false,
        latestStatus: null,
      };

      const candidateTimestamp = resolveLatestTimestamp(
        row?.updated_at,
        row?.created_at,
      );
      const normalizedStatus = normalizeBidStatus(row?.status ?? null);
      const shouldCaptureStatus =
        !existing.lastBidAt ||
        (candidateTimestamp !== null &&
          (!existing.lastBidAt ||
            candidateTimestamp > existing.lastBidAt));

      aggregates[quoteId] = {
        quoteId,
        bidCount: existing.bidCount + 1,
        lastBidAt:
          !existing.lastBidAt ||
          (candidateTimestamp && candidateTimestamp > existing.lastBidAt)
            ? candidateTimestamp ?? existing.lastBidAt
            : existing.lastBidAt,
        hasWinningBid:
          existing.hasWinningBid || isWinningBidStatus(row?.status ?? null),
        latestStatus:
          shouldCaptureStatus && normalizedStatus
            ? normalizedStatus
            : existing.latestStatus,
      };
    }

    console.info("[supplier inbox] bid aggregates loaded", {
      supplierId: normalizedSupplierId,
      quoteCount: normalizedQuoteIds.length,
      withBids: Object.keys(aggregates).length,
    });

    return aggregates;
  } catch (error) {
    console.error("[supplier inbox] bid aggregates crashed", {
      supplierId: normalizedSupplierId,
      quoteCount: normalizedQuoteIds.length,
      error: serializeSupabaseError(error) ?? error ?? null,
    });
    return {};
  }
}

function normalizeQuoteId(value: unknown): string | null {
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

export function summarizeSupplierBidState(
  aggregate: SupplierInboxBidAggregate | undefined,
): SupplierBidSummaryState {
  if (!aggregate) {
    return "no_bid";
  }
  return deriveSupplierBidSummaryState({
    bidCount: aggregate.bidCount,
    latestStatus: aggregate.latestStatus,
  });
}
