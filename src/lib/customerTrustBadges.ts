export type CustomerTrustBadgeId =
  | "verified_supplier"
  | "fast_turnaround"
  | "best_value"
  | "great_fit";

export type CustomerTrustBadgeTone = "emerald" | "blue" | "amber" | "slate";

export type CustomerTrustBadge = {
  id: CustomerTrustBadgeId;
  label: string;
  tooltip: string;
  tone: CustomerTrustBadgeTone;
  /**
   * When true, this badge should count as a "badge pick" highlight in the UI.
   * (Verified suppliers may be common, so we treat that separately.)
   */
  highlight: boolean;
};

/**
 * Customer-safe offer shape for decision support views (Compare Offers, intro request).
 * IMPORTANT: This must not include internal scoring signals (confidence, risk flags, routing, etc).
 */
export type CustomerCompareOffer = {
  id: string;
  rfq_id: string;
  provider_id: string;
  destination_id: string | null;
  currency: string;
  total_price: number | string | null;
  unit_price: number | string | null;
  tooling_price: number | string | null;
  shipping_price: number | string | null;
  lead_time_days_min: number | null;
  lead_time_days_max: number | null;
  assumptions: string | null;
  status: string;
  received_at: string;
  created_at: string;
  providerName: string;
  priceDisplay: string;
  leadTimeDisplay: string;
  totalPriceValue: number | null;
  leadTimeDaysAverage: number | null;
  trustBadges: CustomerTrustBadge[];
};

