import { formatCurrency } from "@/lib/formatCurrency";
import type { RfqOffer } from "@/server/rfqs/offers";

const BADGE_LABELS = {
  bestValue: "Best Value",
  fastest: "Fastest",
  lowestRisk: "Lowest Risk",
} as const;

const SCORE_WEIGHTS = {
  price: 0.55,
  leadTime: 0.3,
  confidence: 0.1,
  riskPenalty: 0.08,
};

const COMPLETENESS_WEIGHTS = {
  totalPrice: 50,
  unitPrice: 15,
  leadTime: 35,
};

export type DecoratedRfqOffer = RfqOffer & {
  badges: string[];
  rankScore: number;
  priceDisplay: string;
  leadTimeDisplay: string;
  totalPriceValue: number | null;
  leadTimeDaysAverage: number | null;
  confidenceValue: number | null;
  riskFlagCount: number;
  providerName: string;
};

export type OfferCompletenessScore = {
  score: number;
  missing: string[];
  isActionable: boolean;
};

export function decorateOffersForCompare(offers: RfqOffer[]): DecoratedRfqOffer[] {
  const normalized = offers.map((offer) => {
    const totalPriceValue = toFiniteNumber(offer.total_price);
    const leadTimeDaysAverage = resolveLeadTimeAverage(
      offer.lead_time_days_min,
      offer.lead_time_days_max,
    );
    const confidenceValue = normalizeConfidence(offer.confidence_score);
    const riskFlagCount = Array.isArray(offer.quality_risk_flags)
      ? offer.quality_risk_flags.filter((flag) => typeof flag === "string" && flag.trim().length > 0)
          .length
      : 0;
    const providerName = resolveProviderName(offer);

    return {
      ...offer,
      badges: [],
      rankScore: 0,
      priceDisplay: formatPriceDisplay(offer.total_price, offer.currency),
      leadTimeDisplay: formatLeadTimeDisplay(
        offer.lead_time_days_min,
        offer.lead_time_days_max,
      ),
      totalPriceValue,
      leadTimeDaysAverage,
      confidenceValue,
      riskFlagCount,
      providerName,
    };
  });

  const minPrice = minNumeric(normalized.map((offer) => offer.totalPriceValue));
  const minLeadTime = minNumeric(normalized.map((offer) => offer.leadTimeDaysAverage));

  const scored = normalized.map((offer) => {
    const priceScore = scoreRelative(minPrice, offer.totalPriceValue);
    const leadTimeScore = scoreRelative(minLeadTime, offer.leadTimeDaysAverage);
    const confidenceScore = typeof offer.confidenceValue === "number"
      ? offer.confidenceValue / 100
      : 0;
    const riskPenalty = offer.riskFlagCount * SCORE_WEIGHTS.riskPenalty;

    const rankScore =
      priceScore * SCORE_WEIGHTS.price +
      leadTimeScore * SCORE_WEIGHTS.leadTime +
      confidenceScore * SCORE_WEIGHTS.confidence -
      riskPenalty;

    return {
      ...offer,
      rankScore,
    };
  });

  const bestValueId = pickBestValueId(scored);
  const fastestId = pickFastestId(scored);
  const lowestRiskId = pickLowestRiskId(scored);

  return scored.map((offer) => {
    const badges = [];
    if (offer.id === bestValueId) badges.push(BADGE_LABELS.bestValue);
    if (offer.id === fastestId) badges.push(BADGE_LABELS.fastest);
    if (offer.id === lowestRiskId) badges.push(BADGE_LABELS.lowestRisk);

    return {
      ...offer,
      badges,
    };
  });
}

export function scoreOfferCompleteness(offer: RfqOffer): OfferCompletenessScore {
  const totalPriceValue = toFiniteNumber(offer.total_price);
  const unitPriceValue = toFiniteNumber(offer.unit_price);
  const minLeadTime = toFiniteNumber(offer.lead_time_days_min);
  const maxLeadTime = toFiniteNumber(offer.lead_time_days_max);
  const hasTotalPrice = typeof totalPriceValue === "number";
  const hasUnitPrice = typeof unitPriceValue === "number";
  const hasLeadTime = typeof minLeadTime === "number" || typeof maxLeadTime === "number";
  const missing: string[] = [];

  if (!hasTotalPrice) {
    missing.push("Missing total price");
  }
  if (!hasUnitPrice) {
    missing.push("Missing unit price");
  }
  if (!hasLeadTime) {
    missing.push("Missing lead time");
  }

  const score = clampScore(
    (hasTotalPrice ? COMPLETENESS_WEIGHTS.totalPrice : 0) +
      (hasUnitPrice ? COMPLETENESS_WEIGHTS.unitPrice : 0) +
      (hasLeadTime ? COMPLETENESS_WEIGHTS.leadTime : 0),
  );

  return {
    score,
    missing,
    isActionable: hasTotalPrice || hasUnitPrice,
  };
}

function resolveProviderName(offer: RfqOffer): string {
  const name =
    typeof offer.provider?.name === "string" ? offer.provider.name.trim() : "";
  return name || offer.provider_id || "Provider";
}

function scoreRelative(minValue: number | null, value: number | null): number {
  if (typeof minValue !== "number" || !Number.isFinite(minValue)) return 0;
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  if (minValue === 0) {
    return value === 0 ? 1 : 0;
  }
  return minValue / value;
}

function pickBestValueId(offers: DecoratedRfqOffer[]): string | null {
  return pickByNumeric(offers, (offer) => offer.rankScore, "desc");
}

function pickFastestId(offers: DecoratedRfqOffer[]): string | null {
  return pickByNumeric(offers, (offer) => offer.leadTimeDaysAverage, "asc");
}

function pickLowestRiskId(offers: DecoratedRfqOffer[]): string | null {
  let best: DecoratedRfqOffer | null = null;
  for (const offer of offers) {
    if (!best) {
      best = offer;
      continue;
    }
    if (offer.riskFlagCount !== best.riskFlagCount) {
      if (offer.riskFlagCount < best.riskFlagCount) {
        best = offer;
      }
      continue;
    }
    const currentConfidence =
      typeof offer.confidenceValue === "number" ? offer.confidenceValue : -1;
    const bestConfidence =
      typeof best.confidenceValue === "number" ? best.confidenceValue : -1;
    if (currentConfidence !== bestConfidence) {
      if (currentConfidence > bestConfidence) {
        best = offer;
      }
      continue;
    }
    if (compareProviderName(offer, best) < 0) {
      best = offer;
    }
  }
  return best?.id ?? null;
}

function pickByNumeric(
  offers: DecoratedRfqOffer[],
  accessor: (offer: DecoratedRfqOffer) => number | null,
  direction: "asc" | "desc",
): string | null {
  let best: DecoratedRfqOffer | null = null;
  for (const offer of offers) {
    const value = accessor(offer);
    if (typeof value !== "number" || !Number.isFinite(value)) {
      continue;
    }
    if (!best) {
      best = offer;
      continue;
    }
    const bestValue = accessor(best);
    if (typeof bestValue !== "number" || !Number.isFinite(bestValue)) {
      best = offer;
      continue;
    }
    if (value !== bestValue) {
      const isBetter = direction === "asc" ? value < bestValue : value > bestValue;
      if (isBetter) {
        best = offer;
      }
      continue;
    }
    if (compareProviderName(offer, best) < 0) {
      best = offer;
    }
  }
  return best?.id ?? null;
}

function compareProviderName(a: DecoratedRfqOffer, b: DecoratedRfqOffer): number {
  const nameCompare = a.providerName.localeCompare(b.providerName);
  if (nameCompare !== 0) return nameCompare;
  return a.provider_id.localeCompare(b.provider_id);
}

function resolveLeadTimeAverage(
  minDays: number | null,
  maxDays: number | null,
): number | null {
  const minValue = typeof minDays === "number" && Number.isFinite(minDays) ? minDays : null;
  const maxValue = typeof maxDays === "number" && Number.isFinite(maxDays) ? maxDays : null;
  if (minValue !== null && maxValue !== null) {
    return (minValue + maxValue) / 2;
  }
  return minValue ?? maxValue ?? null;
}

function formatLeadTimeDisplay(
  minDays: number | null,
  maxDays: number | null,
): string {
  const minValue = typeof minDays === "number" && Number.isFinite(minDays) ? minDays : null;
  const maxValue = typeof maxDays === "number" && Number.isFinite(maxDays) ? maxDays : null;
  if (minValue !== null && maxValue !== null) {
    if (minValue === maxValue) {
      return `${minValue} day${minValue === 1 ? "" : "s"}`;
    }
    return `${minValue}-${maxValue} days`;
  }
  if (minValue !== null) {
    return `${minValue}+ days`;
  }
  if (maxValue !== null) {
    return `Up to ${maxValue} days`;
  }
  return "-";
}

function formatPriceDisplay(value: number | string | null, currency: string): string {
  const numeric = toFiniteNumber(value);
  if (typeof numeric === "number") {
    return formatCurrency(numeric, currency);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return "-";
}

function normalizeConfidence(value: number | null): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value < 0) return 0;
  if (value > 100) return 100;
  return Math.round(value);
}

function toFiniteNumber(value: number | string | null): number | null {
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

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function minNumeric(values: Array<number | null>): number | null {
  let min: number | null = null;
  for (const value of values) {
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    if (min === null || value < min) {
      min = value;
    }
  }
  return min;
}
