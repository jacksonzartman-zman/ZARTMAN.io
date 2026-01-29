type ComparableOffer = {
  id: string;
  total_price: number | string | null;
  lead_time_days_min: number | null;
  lead_time_days_max: number | null;
};

function toFiniteNumber(value: number | string | null): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function resolveLeadTimeAverage(minDays: number | null, maxDays: number | null): number | null {
  const minValue = typeof minDays === "number" && Number.isFinite(minDays) ? minDays : null;
  const maxValue = typeof maxDays === "number" && Number.isFinite(maxDays) ? maxDays : null;
  if (minValue !== null && maxValue !== null) return (minValue + maxValue) / 2;
  return minValue ?? maxValue ?? null;
}

export function pickPublicOfferHighlights(
  offers: readonly ComparableOffer[],
): {
  bestValueOfferId: string | null;
  fastestOfferId: string | null;
} {
  let bestValue: { id: string; price: number; lead: number | null } | null = null;
  let fastest: { id: string; lead: number; price: number | null } | null = null;

  for (const offer of offers ?? []) {
    const price = toFiniteNumber(offer.total_price);
    const lead = resolveLeadTimeAverage(offer.lead_time_days_min, offer.lead_time_days_max);

    if (typeof price === "number") {
      if (!bestValue) {
        bestValue = { id: offer.id, price, lead };
      } else if (price < bestValue.price) {
        bestValue = { id: offer.id, price, lead };
      } else if (price === bestValue.price) {
        const bestLead = bestValue.lead ?? Number.POSITIVE_INFINITY;
        const offerLead = lead ?? Number.POSITIVE_INFINITY;
        if (offerLead < bestLead) {
          bestValue = { id: offer.id, price, lead };
        }
      }
    }

    if (typeof lead === "number" && Number.isFinite(lead)) {
      if (!fastest) {
        fastest = { id: offer.id, lead, price };
      } else if (lead < fastest.lead) {
        fastest = { id: offer.id, lead, price };
      } else if (lead === fastest.lead) {
        const bestPrice = fastest.price ?? Number.POSITIVE_INFINITY;
        const offerPrice = price ?? Number.POSITIVE_INFINITY;
        if (offerPrice < bestPrice) {
          fastest = { id: offer.id, lead, price };
        }
      }
    }
  }

  return {
    bestValueOfferId: bestValue?.id ?? null,
    fastestOfferId: fastest?.id ?? null,
  };
}

