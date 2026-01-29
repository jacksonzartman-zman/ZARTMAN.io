import { supabaseServer } from "@/lib/supabaseServer";
import { formatCurrency } from "@/lib/formatCurrency";
import type { RfqOffer } from "@/server/rfqs/offers";
import type {
  CustomerCompareOffer,
  CustomerTrustBadge,
  CustomerTrustBadgeId,
} from "@/lib/customerTrustBadges";
import { isMissingTableOrColumnError, serializeSupabaseError } from "@/server/admin/logging";

type MatchHealthRow = {
  supplier_id: string;
  match_health: string | null;
};

const MATCH_HEALTH_VIEW = "supplier_match_health_summary" as const;

const TRUST_BADGE_DEFS: Record<CustomerTrustBadgeId, Omit<CustomerTrustBadge, "id">> = {
  verified_supplier: {
    label: "Verified provider",
    tooltip: "This provider has been verified by our team.",
    tone: "blue",
    highlight: false,
  },
  fastest: {
    label: "Fastest",
    tooltip: "Shortest lead time among these offers.",
    tone: "blue",
    highlight: true,
  },
  best_value: {
    label: "Best value",
    tooltip: "Lowest total price among these offers.",
    tone: "emerald",
    highlight: true,
  },
  great_fit: {
    label: "Great fit",
    tooltip: "Strong match for your requirements.",
    tone: "emerald",
    highlight: true,
  },
};

function normalizeId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function resolveProviderName(offer: RfqOffer): string {
  const name = typeof offer.provider?.name === "string" ? offer.provider.name.trim() : "";
  const sourceName = typeof offer.source_name === "string" ? offer.source_name.trim() : "";
  return name || sourceName || "Supplier";
}

function resolveLeadTimeAverage(minDays: number | null, maxDays: number | null): number | null {
  const minValue = typeof minDays === "number" && Number.isFinite(minDays) ? minDays : null;
  const maxValue = typeof maxDays === "number" && Number.isFinite(maxDays) ? maxDays : null;
  if (minValue !== null && maxValue !== null) return (minValue + maxValue) / 2;
  return minValue ?? maxValue ?? null;
}

function formatLeadTimeDisplay(minDays: number | null, maxDays: number | null): string {
  const minValue = typeof minDays === "number" && Number.isFinite(minDays) ? minDays : null;
  const maxValue = typeof maxDays === "number" && Number.isFinite(maxDays) ? maxDays : null;
  if (minValue !== null && maxValue !== null) {
    if (minValue === maxValue) return `${minValue} day${minValue === 1 ? "" : "s"}`;
    return `${minValue}-${maxValue} days`;
  }
  if (minValue !== null) return `${minValue}+ days`;
  if (maxValue !== null) return `Up to ${maxValue} days`;
  return "-";
}

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

function pickLowestPriceOfferId(
  offers: Array<Pick<CustomerCompareOffer, "id" | "totalPriceValue" | "leadTimeDaysAverage">>,
): string | null {
  let best: { id: string; price: number; lead: number | null } | null = null;
  for (const offer of offers) {
    const price = offer.totalPriceValue;
    if (typeof price !== "number" || !Number.isFinite(price)) continue;
    const lead =
      typeof offer.leadTimeDaysAverage === "number" && Number.isFinite(offer.leadTimeDaysAverage)
        ? offer.leadTimeDaysAverage
        : null;
    if (!best) {
      best = { id: offer.id, price, lead };
      continue;
    }
    if (price < best.price) {
      best = { id: offer.id, price, lead };
      continue;
    }
    if (price === best.price) {
      // Tie-break: faster lead time if available.
      const bestLead = best.lead ?? Number.POSITIVE_INFINITY;
      const offerLead = lead ?? Number.POSITIVE_INFINITY;
      if (offerLead < bestLead) {
        best = { id: offer.id, price, lead };
      }
    }
  }
  return best?.id ?? null;
}

function pickFastestOfferId(
  offers: Array<Pick<CustomerCompareOffer, "id" | "totalPriceValue" | "leadTimeDaysAverage">>,
): string | null {
  let best: { id: string; lead: number; price: number | null } | null = null;
  for (const offer of offers) {
    const lead = offer.leadTimeDaysAverage;
    if (typeof lead !== "number" || !Number.isFinite(lead)) continue;
    const price =
      typeof offer.totalPriceValue === "number" && Number.isFinite(offer.totalPriceValue)
        ? offer.totalPriceValue
        : null;
    if (!best) {
      best = { id: offer.id, lead, price };
      continue;
    }
    if (lead < best.lead) {
      best = { id: offer.id, lead, price };
      continue;
    }
    if (lead === best.lead) {
      // Tie-break: lower price if available.
      const bestPrice = best.price ?? Number.POSITIVE_INFINITY;
      const offerPrice = price ?? Number.POSITIVE_INFINITY;
      if (offerPrice < bestPrice) {
        best = { id: offer.id, lead, price };
      }
    }
  }
  return best?.id ?? null;
}

async function loadMatchHealthBySupplierId(
  supplierIds: string[],
): Promise<Map<string, "good" | "caution" | "poor" | "unknown">> {
  const ids = Array.from(new Set((supplierIds ?? []).map(normalizeId).filter(Boolean)));
  const out = new Map<string, "good" | "caution" | "poor" | "unknown">();
  for (const id of ids) out.set(id, "unknown");
  if (ids.length === 0) return out;

  try {
    const { data, error } = await supabaseServer()
      .from(MATCH_HEALTH_VIEW)
      .select("supplier_id,match_health")
      .in("supplier_id", ids)
      .returns<MatchHealthRow[]>();

    if (error) {
      if (!isMissingTableOrColumnError(error)) {
        console.warn("[customer compare offers] match health load failed", {
          supplierCount: ids.length,
          error: serializeSupabaseError(error) ?? error,
        });
      }
      return out;
    }

    for (const row of data ?? []) {
      const supplierId = normalizeId(row?.supplier_id);
      if (!supplierId) continue;
      const normalized = typeof row?.match_health === "string" ? row.match_health.trim().toLowerCase() : "";
      const value =
        normalized === "good" || normalized === "caution" || normalized === "poor"
          ? (normalized as "good" | "caution" | "poor")
          : "unknown";
      out.set(supplierId, value);
    }
  } catch (error) {
    if (!isMissingTableOrColumnError(error)) {
      console.warn("[customer compare offers] match health load crashed", {
        supplierCount: ids.length,
        error: serializeSupabaseError(error) ?? error,
      });
    }
  }

  return out;
}

function buildBadge(id: CustomerTrustBadgeId): CustomerTrustBadge {
  const def = TRUST_BADGE_DEFS[id];
  return { id, ...def };
}

export async function buildCustomerCompareOffers(
  offers: RfqOffer[],
): Promise<CustomerCompareOffer[]> {
  const normalized = (offers ?? []).map((offer) => {
    const providerId =
      typeof offer.provider_id === "string" && offer.provider_id.trim()
        ? offer.provider_id.trim()
        : null;
    const providerName = resolveProviderName(offer);
    const totalPriceValue = toFiniteNumber(offer.total_price);
    const leadTimeDaysAverage = resolveLeadTimeAverage(
      offer.lead_time_days_min,
      offer.lead_time_days_max,
    );
    const verificationRaw =
      typeof offer.provider?.verification_status === "string"
        ? offer.provider.verification_status.trim().toLowerCase()
        : "";
    const isVerifiedSupplier =
      Boolean(providerId) && (verificationRaw === "verified" || verificationRaw === "");
    const syntheticProviderId = providerId ?? `external:${offer.id}`;

    const safeOffer: CustomerCompareOffer = {
      id: offer.id,
      rfq_id: offer.rfq_id,
      provider_id: syntheticProviderId,
      destination_id: offer.destination_id ?? null,
      currency: offer.currency,
      total_price: offer.total_price,
      unit_price: offer.unit_price,
      tooling_price: offer.tooling_price,
      shipping_price: offer.shipping_price,
      lead_time_days_min: offer.lead_time_days_min,
      lead_time_days_max: offer.lead_time_days_max,
      assumptions: offer.assumptions,
      status: offer.status,
      received_at: offer.received_at,
      created_at: offer.created_at,
      providerName,
      priceDisplay: formatPriceDisplay(offer.total_price, offer.currency),
      leadTimeDisplay: formatLeadTimeDisplay(offer.lead_time_days_min, offer.lead_time_days_max),
      totalPriceValue,
      leadTimeDaysAverage,
      trustBadges: [],
    };

    return { safeOffer, isVerifiedSupplier, providerIdForMatchHealth: providerId };
  });

  const supplierIds = normalized
    .map((o) => o.providerIdForMatchHealth)
    .filter((v): v is string => Boolean(v));
  const matchHealthBySupplierId = await loadMatchHealthBySupplierId(supplierIds);

  const safeOffers = normalized.map((o) => o.safeOffer);
  const lowestPriceOfferId = pickLowestPriceOfferId(safeOffers);
  const fastestOfferId = pickFastestOfferId(safeOffers);

  return normalized.map(({ safeOffer: offer, isVerifiedSupplier, providerIdForMatchHealth }) => {
    const badges: CustomerTrustBadge[] = [];

    // Verified supplier: customer-safe, and should never mention routing/ops.
    if (isVerifiedSupplier) {
      badges.push(buildBadge("verified_supplier"));
    }

    if (offer.id === fastestOfferId) {
      badges.push(buildBadge("fastest"));
    }

    if (offer.id === lowestPriceOfferId) {
      badges.push(buildBadge("best_value"));
    }

    const mh =
      providerIdForMatchHealth
        ? (matchHealthBySupplierId.get(providerIdForMatchHealth) ?? "unknown")
        : "unknown";
    if (mh === "good") {
      badges.push(buildBadge("great_fit"));
    }

    return { ...offer, trustBadges: badges };
  });
}

