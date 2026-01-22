const QUOTE_STATUSES = [
  "submitted",
  "in_review",
  "quoted",
  "approved",
  "won",
  "lost",
  "cancelled",
] as const;

export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

export const QUOTE_STATUS_OPTIONS: readonly QuoteStatus[] = [...QUOTE_STATUSES];

export const DEFAULT_QUOTE_STATUS: QuoteStatus = "submitted";

export const QUOTE_OPEN_STATUSES: readonly QuoteStatus[] = [
  "submitted",
  "in_review",
  "quoted",
] as const;

export type QuoteStatusCopyVariant = "rfq" | "search";

export const QUOTE_STATUS_LABELS_BY_VARIANT: Record<
  QuoteStatusCopyVariant,
  Record<QuoteStatus, string>
> = {
  rfq: {
    submitted: "RFQ submitted",
    in_review: "Reviewing bids",
    quoted: "Quote prepared",
    approved: "Approved to award",
    won: "Won / Awarded",
    lost: "Lost",
    cancelled: "Cancelled",
  },
  search: {
    submitted: "Search request submitted",
    in_review: "Suppliers contacted",
    quoted: "Offers ready",
    approved: "Ready for introduction",
    won: "Introduction requested",
    lost: "Closed",
    cancelled: "Cancelled",
  },
};

export const QUOTE_STATUS_HELPERS_BY_VARIANT: Record<
  QuoteStatusCopyVariant,
  Record<QuoteStatus, string>
> = {
  rfq: {
    submitted: "RFQ received. We’re collecting supplier bids.",
    in_review:
      "Bids are being reviewed. We’ll reach out in Messages if anything needs clarification.",
    quoted:
      "Pricing is ready to review. Compare options and use Messages for questions or scope changes.",
    approved:
      "Approved to award. Select supplier to start kickoff tasks and confirm final details.",
    won: "Selection confirmed. Kickoff tasks and project updates are tracked in this workspace.",
    lost: "Closed as lost. You can reopen if you’d like to request bids again.",
    cancelled: "Cancelled. Your files and timeline remain available.",
  },
  search: {
    submitted: "Search request received. We’re contacting suppliers.",
    in_review:
      "Suppliers are reviewing your files. We’ll message you if anything needs clarification.",
    quoted:
      "Offers are ready to review. Compare options and use Messages for questions or scope changes.",
    approved:
      "Ready for introduction. Pick an offer to start kickoff tasks and confirm final details.",
    won: "Introduction requested. Kickoff tasks and project updates are tracked in this workspace.",
    lost: "Closed. You can reopen if you’d like us to contact suppliers again.",
    cancelled: "Cancelled. Your files and timeline remain available.",
  },
};

// Backwards-compatible exports (admin/internal copy).
export const QUOTE_STATUS_LABELS: Record<QuoteStatus, string> =
  QUOTE_STATUS_LABELS_BY_VARIANT.rfq;
export const QUOTE_STATUS_HELPERS: Record<QuoteStatus, string> =
  QUOTE_STATUS_HELPERS_BY_VARIANT.rfq;

export function normalizeQuoteStatus(
  raw: string | null | undefined,
): QuoteStatus {
  const value = (raw ?? "").toLowerCase().trim();
  if (value === "in_review") return "in_review";
  if (value === "quote_prepared") return "quoted";
  if (value === "quoted") return "quoted";
  if (value === "approved") return "approved";
  if (value === "won") return "won";
  if (value === "lost") return "lost";
  if (value === "cancelled" || value === "canceled") return "cancelled";
  return "submitted";
}

export function isOpenQuoteStatus(
  status: string | null | undefined,
): boolean {
  return QUOTE_OPEN_STATUSES.includes(normalizeQuoteStatus(status));
}

export function getQuoteStatusLabel(
  raw: string | null | undefined,
  options?: { copyVariant?: QuoteStatusCopyVariant },
): string {
  const normalized = normalizeQuoteStatus(raw);
  const copyVariant: QuoteStatusCopyVariant = options?.copyVariant ?? "rfq";
  return (
    QUOTE_STATUS_LABELS_BY_VARIANT[copyVariant]?.[normalized] ??
    QUOTE_STATUS_LABELS[normalized] ??
    "Status update"
  );
}

export function getQuoteStatusHelper(
  raw: string | null | undefined,
  options?: { copyVariant?: QuoteStatusCopyVariant },
): string {
  const normalized = normalizeQuoteStatus(raw);
  const copyVariant: QuoteStatusCopyVariant = options?.copyVariant ?? "rfq";
  return (
    QUOTE_STATUS_HELPERS_BY_VARIANT[copyVariant]?.[normalized] ??
    QUOTE_STATUS_HELPERS[normalized] ??
    (copyVariant === "search"
      ? "Status updates keep your team in sync on this search request."
      : "Status updates keep your team in sync on this RFQ.")
  );
}

export function getQuoteStatusLabelForVariant(
  raw: string | null | undefined,
  copyVariant: QuoteStatusCopyVariant,
): string {
  const normalized = normalizeQuoteStatus(raw);
  return (
    QUOTE_STATUS_LABELS_BY_VARIANT[copyVariant]?.[normalized] ??
    QUOTE_STATUS_LABELS[normalized] ??
    "Status update"
  );
}
