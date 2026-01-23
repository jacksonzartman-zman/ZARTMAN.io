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
    label: "Verified supplier",
    tooltip: "This supplier has been verified by our team.",
    tone: "blue",
    highlight: false,
  },
  fast_turnaround: {
    label: "Fast turnaround",
    tooltip: "Short lead time compared to typical turnaround.",
    tone: "blue",
    highlight: true,
  },
  best_value: {
    label: "Best value",
    tooltip: "Strong balance of price and lead time.",
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

const FAST_TURNAROUND_DAYS_THRESHOLD = 10;

function normalizeId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function resolveProviderName(offer: RfqOffer): string {
  const name = typeof offer.provider?.name === "string" ? offer.provider.name.trim() : "";
  return name || offer.provider_id || "Supplier";
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

function scoreRelative(minValue: number | null, value: number | null): number {
  if (typeof minValue !== "number" || !Number.isFinite(minValue)) return 0;
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  if (minValue === 0) return value === 0 ? 1 : 0;
  return minValue / value;
}

function minNumeric(values: Array<number | null>): number | null {
  let min: number | null = null;
  for (const value of values) {
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    if (min === null || value < min) min = value;
  }
  return min;
}

function pickBestValueOfferId(offers: Array<Pick<CustomerCompareOffer, "id" | "totalPriceValue" | "leadTimeDaysAverage">>): string | null {
  const minPrice = minNumeric(offers.map((o) => o.totalPriceValue));
  const minLead = minNumeric(offers.map((o) => o.leadTimeDaysAverage));

  // Internal heuristic (not exposed): prioritize price, then lead time.
  const PRICE_WEIGHT = 0.6;
  const LEAD_WEIGHT = 0.4;

  let bestId: string | null = null;
  let bestScore: number | null = null;

  for (const offer of offers) {
    const priceScore = scoreRelative(minPrice, offer.totalPriceValue);
    const leadScore = scoreRelative(minLead, offer.leadTimeDaysAverage);
    const score = priceScore * PRICE_WEIGHT + leadScore * LEAD_WEIGHT;
    if (!Number.isFinite(score) || score <= 0) continue;
    if (bestScore === null || score > bestScore) {
      bestScore = score;
      bestId = offer.id;
    }
  }

  return bestId;
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
    const isVerifiedSupplier = verificationRaw === "verified" || verificationRaw === "";

    const safeOffer: CustomerCompareOffer = {
      id: offer.id,
      rfq_id: offer.rfq_id,
      provider_id: offer.provider_id,
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

    return { safeOffer, isVerifiedSupplier };
  });

  const supplierIds = normalized.map((o) => o.safeOffer.provider_id).filter(Boolean);
  const matchHealthBySupplierId = await loadMatchHealthBySupplierId(supplierIds);

  const bestValueOfferId = pickBestValueOfferId(normalized.map((o) => o.safeOffer));

  return normalized.map(({ safeOffer: offer, isVerifiedSupplier }) => {
    const badges: CustomerTrustBadge[] = [];

    // Verified supplier: customer-safe, and should never mention routing/ops.
    if (isVerifiedSupplier) {
      badges.push(buildBadge("verified_supplier"));
    }

    const avg = offer.leadTimeDaysAverage;
    if (typeof avg === "number" && Number.isFinite(avg) && avg > 0 && avg <= FAST_TURNAROUND_DAYS_THRESHOLD) {
      badges.push(buildBadge("fast_turnaround"));
    }

    if (offer.id === bestValueOfferId) {
      badges.push(buildBadge("best_value"));
    }

    const mh = matchHealthBySupplierId.get(offer.provider_id) ?? "unknown";
    if (mh === "good") {
      badges.push(buildBadge("great_fit"));
    }

    return { ...offer, trustBadges: badges };
  });
}

