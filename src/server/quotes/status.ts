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
  submitted: "We're routing this RFQ to vetted suppliers and collecting bids.",
  in_review: "We're reviewing supplier responses and lining up the best fit.",
  quoted:
    "We've reviewed supplier bids and prepared pricing. Compare options and ask questions.",
  approved:
    "You've selected a winning supplier. Next step is kickoff based on the plan you aligned on.",
  won: "You've selected a winning supplier. Next step is kickoff based on the plan you aligned on.",
  lost: "This RFQ was marked lost. Reach out if you'd like to reopen or adjust scope.",
  cancelled: "This RFQ was canceled. Upload a new RFQ whenever you're ready.",
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
