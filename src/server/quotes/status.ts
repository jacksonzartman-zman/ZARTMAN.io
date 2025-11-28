const QUOTE_STATUSES = [
  "submitted",
  "in_review",
  "quoted",
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
  in_review: "In review",
  quoted: "Quote prepared",
  won: "Won",
  lost: "Lost",
  cancelled: "Cancelled",
};

export function normalizeQuoteStatus(
  raw: string | null | undefined,
): QuoteStatus {
  const value = (raw ?? "").toLowerCase().trim();
  if (value === "in_review") return "in_review";
  if (value === "quoted") return "quoted";
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
