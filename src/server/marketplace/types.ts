import type { SupplierRow } from "@/server/suppliers/types";

export type MarketplaceRfqStatus =
  | "draft"
  | "open"
  | "in_review"
  | "pending_award"
  | "awarded"
  | "closed"
  | "cancelled";

export type MarketplaceRfq = {
  id: string;
  customer_id: string | null;
  status: MarketplaceRfqStatus;
  title: string | null;
  description: string | null;
  quantity: number | null;
  process_requirements: string[] | null;
  material_requirements: string[] | null;
  certification_requirements: string[] | null;
  target_date: string | null;
  created_at: string;
  updated_at: string;
  priority?: number | null;
  files?: string[] | null;
  upload_id?: string | null;
};

export type SupplierSummary = {
  id: string;
  company_name: string | null;
  primary_email: string | null;
};

export type RfqBidStatus =
  | "draft"
  | "submitted"
  | "withdrawn"
  | "accepted"
  | "rejected";

export type RfqBidRecord = {
  id: string;
  rfq_id: string;
  supplier_id: string;
  price_total: number | string | null;
  currency: string | null;
  lead_time_days: number | null;
  notes: string | null;
  status: RfqBidStatus;
  created_at: string;
  updated_at: string;
};

export type ListBidsResult = {
  bids: Array<
    RfqBidRecord & {
      supplier?: SupplierSummary | null;
    }
  >;
  error: string | null;
};

export type MatchableRfq = MarketplaceRfq & {
  match_score?: number;
  match_explanation?: SupplierScoreBreakdown | null;
};

export type ListOpenRfqsResult = {
  rfqs: MatchableRfq[];
  error: string | null;
};

export type SupplierScoreFactorDetail = {
  label: string;
  weight: number;
  awarded: number;
  max: number;
  ratio: number;
  reason: string;
  evidence?: string[];
};

export type SupplierScoreBreakdown = {
  total: number;
  max: number;
  factors: {
    process: SupplierScoreFactorDetail;
    material: SupplierScoreFactorDetail;
    certifications: SupplierScoreFactorDetail;
    winRate: SupplierScoreFactorDetail;
    recency: SupplierScoreFactorDetail;
  };
};

export type SupplierScoreEvaluation = SupplierScoreBreakdown & {
  supplier: SupplierRow;
  rfqId: string;
};

export type SupplierEligibilityResult = {
  eligible: boolean;
  score: number;
  explanation: SupplierScoreBreakdown;
};

export type SubmitRfqBidInput = {
  rfqId: string;
  supplierId: string;
  priceTotal: number | string | null;
  currency?: string | null;
  leadTimeDays?: number | null;
  notes?: string | null;
};

export type BidMutationResult = {
  bid: RfqBidRecord | null;
  error: string | null;
};

export type MarketplaceEventType =
  | "rfq_opened"
  | "bid_submitted"
  | "bid_updated"
  | "bid_withdrawn"
  | "rfq_awarded"
  | "visibility_filtered"
  | "market_pressure_calculated"
  | "supplier_advantage_shifted"
  | "pricing_band_recommended"
  | "customer_strategy_recommended"
  | "customer_view_transformed"
  | "trust_explained";

export type MarketplaceEventInput = {
  rfqId: string;
  type: MarketplaceEventType;
  actorId?: string | null;
  supplierId?: string | null;
  customerId?: string | null;
  payload?: Record<string, unknown> | null;
};

export type SupplierPerformanceStats = {
  totalBids: number;
  awards: number;
  winRate: number;
  lastActivityAt: string | null;
};
