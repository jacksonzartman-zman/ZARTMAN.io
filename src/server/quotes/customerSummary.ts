import {
  deriveSupplierBidSummaryState,
  type SupplierBidSummaryState,
} from "@/lib/bids/status";
import { normalizeQuoteStatus, type QuoteStatus } from "@/server/quotes/status";
import type { QuoteBidAggregate } from "./bidAggregates";

export type CustomerQuoteListStatus =
  | "submitted"
  | "bids_received"
  | "awarded"
  | "closed";

type StatusMeta = {
  label: string;
  pillClass: string;
};

const CUSTOMER_STATUS_META: Record<CustomerQuoteListStatus, StatusMeta> = {
  submitted: { label: "Submitted", pillClass: "pill-muted" },
  bids_received: { label: "Bids received", pillClass: "pill-info" },
  awarded: { label: "Awarded", pillClass: "pill-success" },
  closed: { label: "Closed", pillClass: "pill-warning" },
};

export function deriveCustomerQuoteListStatus({
  quoteStatus,
  aggregate,
}: {
  quoteStatus?: string | null;
  aggregate?: QuoteBidAggregate;
}): CustomerQuoteListStatus {
  const normalizedQuoteStatus = normalizeQuoteStatus(quoteStatus ?? undefined);
  const bidSummaryState = summarizeCustomerBidState(aggregate);

  if (isClosedStatus(normalizedQuoteStatus) || bidSummaryState === "lost") {
    return "closed";
  }

  if (
    normalizedQuoteStatus === "approved" ||
    normalizedQuoteStatus === "won" ||
    bidSummaryState === "won" ||
    aggregate?.hasWinningBid
  ) {
    return "awarded";
  }

  if (bidSummaryState === "submitted") {
    return "bids_received";
  }

  return "submitted";
}

export function getCustomerQuoteStatusMeta(
  status: CustomerQuoteListStatus,
): StatusMeta {
  return CUSTOMER_STATUS_META[status] ?? CUSTOMER_STATUS_META.submitted;
}

export function summarizeCustomerBidState(
  aggregate?: QuoteBidAggregate,
): SupplierBidSummaryState {
  return deriveSupplierBidSummaryState({
    bidCount: aggregate?.bidCount ?? 0,
    latestStatus: aggregate?.latestStatus ?? null,
  });
}

export function formatCustomerBidHint(
  aggregate?: QuoteBidAggregate,
): string {
  const bidCount = aggregate?.bidCount ?? 0;
  if (bidCount <= 0) {
    return "No bids yet";
  }
  if (aggregate?.hasWinningBid) {
    if (bidCount === 1) {
      return "1 bid awarded";
    }
    return `Supplier selected from ${bidCount} bids`;
  }
  return bidCount === 1 ? "1 bid received" : `${bidCount} bids received`;
}

function isClosedStatus(status: QuoteStatus): boolean {
  return status === "lost" || status === "cancelled";
}
