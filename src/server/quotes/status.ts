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

export const QUOTE_STATUS_LABELS: Record<QuoteStatus, string> = {
  submitted: "RFQ submitted",
  in_review: "Reviewing bids",
  quoted: "Quote prepared",
  approved: "Approved to award",
  won: "Won / Awarded",
  lost: "Lost",
  cancelled: "Cancelled",
};

export const QUOTE_STATUS_HELPERS: Record<QuoteStatus, string> = {
  submitted: "RFQ received. We’re collecting supplier bids.",
  in_review: "Bids are being reviewed. We’ll reach out in Messages if anything needs clarification.",
  quoted:
    "Pricing is ready to review. Compare options and use Messages for questions or scope changes.",
  approved:
    "Approved to award. Select a supplier to start kickoff tasks and confirm final details.",
  won: "Supplier selected. Kickoff tasks and project updates are tracked in this workspace.",
  lost: "Closed as lost. You can reopen if you’d like to request bids again.",
  cancelled: "Cancelled. Your files and timeline remain available.",
};

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

export function getQuoteStatusLabel(raw: string | null | undefined): string {
  const normalized = normalizeQuoteStatus(raw);
  return QUOTE_STATUS_LABELS[normalized] ?? "Status update";
}

export function getQuoteStatusHelper(raw: string | null | undefined): string {
  const normalized = normalizeQuoteStatus(raw);
  return (
    QUOTE_STATUS_HELPERS[normalized] ??
    "Status updates keep your team in sync on this RFQ."
  );
}
