const WIN_STATUSES = new Set([
  "won",
  "winner",
  "accepted",
  "approved",
]);

const LOSS_STATUSES = new Set(["lost"]);

export type SupplierBidStatusNormalized =
  | "pending"
  | "submitted"
  | "revised"
  | "accepted"
  | "declined"
  | "withdrawn"
  | "won"
  | "lost"
  | "winner"
  | "approved";

export type SupplierBidSummaryState =
  | "no_bid"
  | "submitted"
  | "won"
  | "lost";

export const SUPPLIER_BID_SUMMARY_LABELS: Record<
  SupplierBidSummaryState,
  string
> = {
  no_bid: "No bid yet",
  submitted: "Bid submitted",
  won: "Won",
  lost: "Not selected",
};

export function normalizeBidStatus(
  value: unknown,
): SupplierBidStatusNormalized | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  return normalized as SupplierBidStatusNormalized;
}

export function isWinningBidStatus(value: unknown): boolean {
  const normalized = normalizeBidStatus(value);
  return Boolean(normalized && WIN_STATUSES.has(normalized));
}

export function isLosingBidStatus(value: unknown): boolean {
  const normalized = normalizeBidStatus(value);
  return Boolean(normalized && LOSS_STATUSES.has(normalized));
}

export function deriveSupplierBidSummaryState(args: {
  bidCount: number;
  latestStatus?: string | null;
}): SupplierBidSummaryState {
  if (!args.bidCount || args.bidCount <= 0) {
    return "no_bid";
  }

  if (isWinningBidStatus(args.latestStatus)) {
    return "won";
  }

  if (
    isLosingBidStatus(args.latestStatus) ||
    normalizeBidStatus(args.latestStatus) === "declined" ||
    normalizeBidStatus(args.latestStatus) === "withdrawn"
  ) {
    return "lost";
  }

  return "submitted";
}

export function getSupplierBidSummaryLabel(
  state: SupplierBidSummaryState,
): string {
  return SUPPLIER_BID_SUMMARY_LABELS[state] ?? SUPPLIER_BID_SUMMARY_LABELS.no_bid;
}
