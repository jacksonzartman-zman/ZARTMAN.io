import { formatCurrency } from "@/lib/formatCurrency";
import type { RfqOffer } from "@/server/rfqs/offers";

export type OfferDraft = {
  totalPrice: string;
  unitPrice: string;
  toolingPrice: string;
  shippingPrice: string;
  leadTimeDaysMin: string;
  leadTimeDaysMax: string;
  confidenceScore: string;
  riskFlags: string;
  assumptions: string;
};

export const EMPTY_OFFER_DRAFT: OfferDraft = {
  totalPrice: "",
  unitPrice: "",
  toolingPrice: "",
  shippingPrice: "",
  leadTimeDaysMin: "",
  leadTimeDaysMax: "",
  confidenceScore: "",
  riskFlags: "",
  assumptions: "",
};

export function formatEnumLabel(value?: string | null): string {
  if (!value) return "-";
  const collapsed = value.replace(/[_-]+/g, " ").trim();
  if (!collapsed) return "-";
  return collapsed
    .split(" ")
    .map((segment) => (segment ? segment[0].toUpperCase() + segment.slice(1) : ""))
    .join(" ");
}

export function buildOfferDraft(offer: RfqOffer | null): OfferDraft {
  if (!offer) {
    return { ...EMPTY_OFFER_DRAFT };
  }
  return {
    ...EMPTY_OFFER_DRAFT,
    totalPrice: formatDraftValue(offer.total_price),
    unitPrice: formatDraftValue(offer.unit_price),
    toolingPrice: formatDraftValue(offer.tooling_price),
    shippingPrice: formatDraftValue(offer.shipping_price),
    leadTimeDaysMin: formatDraftValue(offer.lead_time_days_min),
    leadTimeDaysMax: formatDraftValue(offer.lead_time_days_max),
    confidenceScore: formatDraftValue(offer.confidence_score),
    riskFlags: Array.isArray(offer.quality_risk_flags) ? offer.quality_risk_flags.join(", ") : "",
    assumptions: offer.assumptions ?? "",
  };
}

export function formatOfferSummary(offer: RfqOffer): string {
  const parts: string[] = [];
  const currency = offer.currency ?? "USD";
  const total = toFiniteNumber(offer.total_price);
  const unit = toFiniteNumber(offer.unit_price);
  if (typeof total === "number") {
    parts.push(`Customer ${formatCurrency(total, currency)}`);
  } else if (typeof unit === "number") {
    parts.push(`Unit ${formatCurrency(unit, currency)}`);
  }

  const internalCost = toFiniteNumber((offer as any)?.internal_cost);
  const internalShipping = toFiniteNumber((offer as any)?.internal_shipping_cost);
  const internalTotal =
    internalCost === null && internalShipping === null
      ? null
      : (internalCost ?? 0) + (internalShipping ?? 0);
  if (typeof internalTotal === "number" && Number.isFinite(internalTotal) && internalTotal > 0) {
    parts.push(`Internal ${formatCurrency(internalTotal, currency)}`);
  } else if (typeof internalCost === "number" && Number.isFinite(internalCost) && internalCost === 0) {
    parts.push(`Internal ${formatCurrency(0, currency)}`);
  }
  if (
    typeof total === "number" &&
    typeof internalTotal === "number" &&
    Number.isFinite(total) &&
    Number.isFinite(internalTotal)
  ) {
    const margin = total - internalTotal;
    parts.push(`Margin ${formatCurrency(margin, currency)}`);
  }

  const leadTimeLabel = formatLeadTimeSummary(offer.lead_time_days_min, offer.lead_time_days_max);
  if (leadTimeLabel) {
    parts.push(leadTimeLabel);
  }

  if (typeof offer.confidence_score === "number") {
    parts.push(`Confidence ${offer.confidence_score}`);
  }

  return parts.length > 0 ? parts.join(" | ") : "Offer saved";
}

function formatDraftValue(value: number | string | null | undefined): string {
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "";
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : "";
  }
  return "";
}

function formatLeadTimeSummary(minDays: number | null, maxDays: number | null): string | null {
  if (typeof minDays === "number" && typeof maxDays === "number") {
    return `${minDays}-${maxDays} days`;
  }
  if (typeof minDays === "number") {
    return `${minDays}+ days`;
  }
  if (typeof maxDays === "number") {
    return `Up to ${maxDays} days`;
  }
  return null;
}

function toFiniteNumber(value: number | string | null | undefined): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}
