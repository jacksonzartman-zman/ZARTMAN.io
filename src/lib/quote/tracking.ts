import { formatCurrency } from "@/lib/formatCurrency";

export type QuoteTimelineEventKind =
  | "rfq-submitted"
  | "status-changed"
  | "bid-submitted"
  | "bid-updated"
  | "winner-selected"
  | "project_created";

export type QuoteTimelineEvent = {
  id: string;
  kind: QuoteTimelineEventKind;
  at: string;
  title: string;
  description?: string;
  actorLabel?: string;
  meta?: Record<string, unknown>;
};

export interface QuoteRowLike {
  id: string;
  status?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  price?: number | string | null;
  currency?: string | null;
}

export interface BidRowLike {
  id: string;
  quote_id: string;
  supplier_id: string;
  status?: string | null;
  unit_price?: number | null;
  amount?: number | null;
  currency?: string | null;
  lead_time_days?: number | null;
  created_at?: string | null;
  updated_at?: string | null;
}

type CustomerTimelineArgs = {
  quote: QuoteRowLike;
  bids: BidRowLike[];
  project?: QuoteProjectLike | null;
};

type SupplierTimelineArgs = {
  quote: QuoteRowLike;
  bids: BidRowLike[];
  supplierId: string;
  project?: QuoteProjectLike | null;
};

type QuoteProjectLike = {
  id: string;
  po_number?: string | null;
  created_at?: string | null;
};

function timestampsAreEqual(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  if (!a || !b) {
    return false;
  }

  const aTime = new Date(a).getTime();
  const bTime = new Date(b).getTime();

  if (Number.isNaN(aTime) || Number.isNaN(bTime)) {
    return false;
  }

  return aTime === bTime;
}

export function buildCustomerQuoteTimeline(
  args: CustomerTimelineArgs,
): QuoteTimelineEvent[] {
  const { quote } = args;
  const bids = Array.isArray(args.bids) ? args.bids : [];
  const events: QuoteTimelineEvent[] = [];
  const quoteFallbackAt =
    normalizeTimestamp(quote.updated_at) ?? normalizeTimestamp(quote.created_at);

  pushRfqSubmittedEvent(events, quote);
  pushStatusEvent(events, quote);
  pushProjectCreatedEvent(events, args.project ?? null, quoteFallbackAt);

  bids.forEach((bid, index) => {
    pushBidSubmissionEvent(events, bid, {
      title: "Supplier bid submitted",
      actorLabel: `Supplier ${index + 1}`,
    });
    if (!timestampsAreEqual(bid.created_at, bid.updated_at)) {
      pushBidUpdatedEvent(events, bid, {
        title: "Supplier bid updated",
        actorLabel: `Supplier ${index + 1}`,
      });
    }
  });

  bids
    .filter((bid) => normalizeBidStatus(bid.status) === "won")
    .forEach((bid) => {
      pushWinnerSelectedEvent(events, bid, {
        title: "Winning supplier selected",
        actorLabel: "Customer decision",
      }, quoteFallbackAt);
    });

  return sortTimelineEvents(events);
}

export function buildSupplierQuoteTimeline(
  args: SupplierTimelineArgs,
): QuoteTimelineEvent[] {
  const { quote } = args;
  const bids = Array.isArray(args.bids) ? args.bids : [];
  const normalizedSupplierId = normalizeId(args.supplierId);
  const events: QuoteTimelineEvent[] = [];
  const quoteFallbackAt =
    normalizeTimestamp(quote.updated_at) ?? normalizeTimestamp(quote.created_at);

  pushRfqSubmittedEvent(events, quote);
  pushStatusEvent(events, quote);
  pushProjectCreatedEvent(events, args.project ?? null, quoteFallbackAt);

  if (!normalizedSupplierId) {
    return sortTimelineEvents(events);
  }

  const supplierBids = bids.filter(
    (bid) => normalizeId(bid.supplier_id) === normalizedSupplierId,
  );

  supplierBids.forEach((bid) => {
    pushBidSubmissionEvent(events, bid, {
      title: "You submitted a bid",
      actorLabel: "Your shop",
    });
    if (!timestampsAreEqual(bid.created_at, bid.updated_at)) {
      pushBidUpdatedEvent(events, bid, {
        title: "You updated your bid",
        actorLabel: "Your shop",
      });
    }
  });

  supplierBids
    .filter((bid) => normalizeBidStatus(bid.status) === "won")
    .forEach((bid) => {
      pushWinnerSelectedEvent(events, bid, {
        title: "Your bid was selected as the winner",
        actorLabel: "Customer decision",
      }, quoteFallbackAt);
    });

  return sortTimelineEvents(events);
}

const QUOTE_STATUS_LABELS: Record<string, string> = {
  submitted: "Search request submitted",
  in_review: "Reviewing bids",
  quoted: "Quote prepared",
  approved: "Approved to award",
  won: "Won / Awarded",
  lost: "Lost",
  cancelled: "Cancelled",
};

function pushRfqSubmittedEvent(
  events: QuoteTimelineEvent[],
  quote: QuoteRowLike,
) {
  const at = normalizeTimestamp(quote.created_at);
  if (!at) {
    return;
  }

  events.push({
    id: `rfq-submitted:${quote.id}`,
    kind: "rfq-submitted",
    at,
    title: "Search request submitted",
    description: "Your search request was submitted to Zartman.io.",
  });
}

function pushStatusEvent(events: QuoteTimelineEvent[], quote: QuoteRowLike) {
  const status = normalizeQuoteStatus(quote.status);
  if (!status) {
    return;
  }

  const at =
    normalizeTimestamp(quote.updated_at) ?? normalizeTimestamp(quote.created_at);

  if (!at) {
    return;
  }

  const statusLabel = QUOTE_STATUS_LABELS[status] ?? "Status updated";

  events.push({
    id: `status-changed:${quote.id}:${status}`,
    kind: "status-changed",
    at,
    title: `Status updated to ${statusLabel}`,
    meta: {
      status,
    },
  });
}

function pushBidSubmissionEvent(
  events: QuoteTimelineEvent[],
  bid: BidRowLike,
  copy: { title: string; actorLabel?: string },
) {
  const at = normalizeTimestamp(bid.created_at);
  if (!at) {
    return;
  }

  events.push({
    id: `bid-submitted:${bid.id}`,
    kind: "bid-submitted",
    at,
    title: copy.title,
    description: formatBidSummary(bid),
    actorLabel: copy.actorLabel,
    meta: buildBidMeta(bid),
  });
}

function pushBidUpdatedEvent(
  events: QuoteTimelineEvent[],
  bid: BidRowLike,
  copy: { title: string; actorLabel?: string },
) {
  const updatedAt = normalizeTimestamp(bid.updated_at);
  const createdAt = normalizeTimestamp(bid.created_at);

  if (!updatedAt) {
    return;
  }

  if (createdAt && createdAt === updatedAt) {
    return;
  }

  events.push({
    id: `bid-updated:${bid.id}`,
    kind: "bid-updated",
    at: updatedAt,
    title: copy.title,
    description: formatBidSummary(bid),
    actorLabel: copy.actorLabel,
    meta: buildBidMeta(bid),
  });
}

function pushWinnerSelectedEvent(
  events: QuoteTimelineEvent[],
  bid: BidRowLike,
  copy: { title: string; actorLabel?: string },
  fallbackAt?: string | null,
) {
  const at =
    normalizeTimestamp(bid.updated_at) ??
    normalizeTimestamp(bid.created_at) ??
    (fallbackAt ?? null) ??
    new Date().toISOString();

  events.push({
    id: `winner-selected:${bid.id}`,
    kind: "winner-selected",
    at: normalizeTimestamp(at) ?? new Date().toISOString(),
    title: copy.title,
    description: formatBidSummary(bid),
    actorLabel: copy.actorLabel,
    meta: buildBidMeta(bid),
  });
}

function buildBidMeta(bid: BidRowLike): Record<string, unknown> {
  return {
    bidId: bid.id,
    supplierId: bid.supplier_id,
    quoteId: bid.quote_id,
  };
}

function pushProjectCreatedEvent(
  events: QuoteTimelineEvent[],
  project: QuoteProjectLike | null,
  fallbackAt: string | null,
) {
  if (!project) {
    return;
  }
  const at = normalizeTimestamp(project.created_at) ?? fallbackAt;
  if (!at) {
    return;
  }
  events.push({
    id: `project:${project.id}`,
    kind: "project_created",
    at,
    title: "Project kickoff created",
    description: project.po_number
      ? `PO ${project.po_number} recorded.`
      : "Project details recorded.",
    actorLabel: "Zartman.io",
  });
}

function sortTimelineEvents(events: QuoteTimelineEvent[]): QuoteTimelineEvent[] {
  return [...events].sort((a, b) => {
    const aTime = Date.parse(a.at);
    const bTime = Date.parse(b.at);

    if (!Number.isNaN(aTime) && !Number.isNaN(bTime) && aTime !== bTime) {
      return aTime - bTime;
    }

    if (!Number.isNaN(aTime) && Number.isNaN(bTime)) {
      return -1;
    }

    if (Number.isNaN(aTime) && !Number.isNaN(bTime)) {
      return 1;
    }

    if (a.kind !== b.kind) {
      return a.kind.localeCompare(b.kind);
    }

    return a.id.localeCompare(b.id);
  });
}

function normalizeTimestamp(value?: string | null): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const parsed = Date.parse(trimmed);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

function normalizeQuoteStatus(raw?: string | null): string | null {
  const value = (raw ?? "").trim().toLowerCase();
  if (!value) {
    return null;
  }

  if (value === "in_review") return "in_review";
  if (value === "quote_prepared") return "quoted";
  if (value === "quoted") return "quoted";
  if (value === "approved") return "approved";
  if (value === "won") return "won";
  if (value === "lost") return "lost";
  if (value === "cancelled" || value === "canceled") return "cancelled";
  return "submitted";
}

function normalizeBidStatus(raw?: string | null): string | null {
  const value = (raw ?? "").trim().toLowerCase();
  if (!value) {
    return null;
  }
  if (value === "revised") return "revised";
  if (value === "withdrawn") return "withdrawn";
  if (value === "won") return "won";
  if (value === "lost") return "lost";
  if (value === "accepted") return "won";
  return "submitted";
}

function normalizeId(value?: string | null): string {
  return typeof value === "string" ? value.trim() : "";
}

function formatBidSummary(bid: BidRowLike): string | undefined {
  const amount = resolveBidAmount(bid);
  const amountLabel =
    typeof amount === "number"
      ? formatCurrency(amount, bid.currency ?? undefined, {
          maximumFractionDigits: 2,
        })
      : null;
  const formattedAmount =
    amountLabel && amountLabel !== "—" ? amountLabel : null;
  const leadTimeLabel = formatLeadTime(bid.lead_time_days);

  if (formattedAmount && leadTimeLabel) {
    return `${formattedAmount}, ${leadTimeLabel}`;
  }

  if (formattedAmount) {
    return formattedAmount;
  }

  if (leadTimeLabel) {
    return leadTimeLabel;
  }

  return undefined;
}

function resolveBidAmount(bid: BidRowLike): number | null {
  if (typeof bid.amount === "number") {
    return bid.amount;
  }

  if (typeof bid.unit_price === "number") {
    return bid.unit_price;
  }

  return null;
}

function formatLeadTime(value?: number | null): string | null {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return null;
  }

  const rounded = Math.trunc(value);
  const suffix = rounded === 1 ? "day" : "days";
  return `${rounded} ${suffix}`;
}
