import { formatCurrency } from "@/lib/formatCurrency";
import type { AdminQuoteListStatus } from "@/types/adminQuotes";
import type { QuoteBidAggregate } from "@/server/quotes/bidAggregates";
import {
  normalizeQuoteStatus,
  type QuoteStatus,
} from "@/server/quotes/status";

type StatusMeta = {
  label: string;
  pillClass: string;
  helper: string;
};

const ADMIN_STATUS_META: Record<AdminQuoteListStatus, StatusMeta> = {
  no_bids: {
    label: "Awaiting bids",
    pillClass: "pill-muted",
    helper: "Submitted RFQ with no supplier responses yet.",
  },
  active_bidding: {
    label: "Active bidding",
    pillClass: "pill-info",
    helper: "Suppliers are bidding. Review responses and prep award.",
  },
  awarded: {
    label: "Awarded",
    pillClass: "pill-success",
    helper: "Winner selected. Kickoff tasks should be underway.",
  },
  closed: {
    label: "Closed",
    pillClass: "pill-warning",
    helper: "Marked lost/cancelled or otherwise inactive.",
  },
};

const CLOSED_STATUSES: ReadonlySet<QuoteStatus> = new Set(["lost", "cancelled"]);

export function deriveAdminQuoteListStatus({
  quoteStatus,
  aggregate,
}: {
  quoteStatus?: string | null;
  aggregate?: QuoteBidAggregate;
}): AdminQuoteListStatus {
  const normalized = normalizeQuoteStatus(quoteStatus ?? undefined);
  if (CLOSED_STATUSES.has(normalized)) {
    return "closed";
  }

  if (
    normalized === "approved" ||
    normalized === "won" ||
    aggregate?.hasWinningBid
  ) {
    return "awarded";
  }

  const bidCount = aggregate?.bidCount ?? 0;
  if (bidCount <= 0) {
    return "no_bids";
  }

  return "active_bidding";
}

export function getAdminQuoteStatusMeta(
  status: AdminQuoteListStatus,
): StatusMeta {
  return ADMIN_STATUS_META[status] ?? ADMIN_STATUS_META.no_bids;
}

export function formatAdminBidSummary(
  aggregate?: QuoteBidAggregate,
): string {
  const bidLabel = formatAdminBidCountLabel(aggregate);
  const parts: string[] = [];
  const bestPrice = formatAdminBestPriceLabel(
    aggregate?.bestPriceAmount ?? null,
    aggregate?.bestPriceCurrency ?? null,
  );
  if (bestPrice) {
    parts.push(`best ${bestPrice}`);
  }
  const leadTime = formatAdminLeadTimeLabel(aggregate?.fastestLeadTimeDays);
  if (leadTime) {
    parts.push(leadTime);
  }

  if (parts.length === 0) {
    return bidLabel;
  }
  return `${bidLabel} – ${parts.join(", ")}`;
}

export function formatAdminBidCountLabel(
  aggregate?: QuoteBidAggregate,
): string {
  const count = aggregate?.bidCount ?? 0;
  if (count <= 0) {
    return "No bids yet";
  }
  if (count === 1) {
    return "1 bid received";
  }
  return `${count} bids received`;
}

export function formatAdminBestPriceLabel(
  amount: number | null | undefined,
  currency: string | null | undefined,
): string | null {
  if (typeof amount !== "number" || Number.isNaN(amount)) {
    return null;
  }
  return formatCurrency(amount, currency ?? undefined, {
    maximumFractionDigits: 2,
  });
}

export function formatAdminLeadTimeLabel(
  days: number | null | undefined,
): string | null {
  if (typeof days !== "number" || Number.isNaN(days)) {
    return null;
  }
  const rounded = Math.round(days);
  return `${rounded} day${rounded === 1 ? "" : "s"}`;
}
