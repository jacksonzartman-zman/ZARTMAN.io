import { supabaseServer } from "@/lib/supabaseServer";
import { OPEN_RFQ_STATUSES } from "./rfqs";
import type {
  RfqBidRecord,
  RfqBidStatus,
  SupplierSummary,
} from "./types";

export type CustomerDecision = {
  id: string;
  type:
    | "supplier_bid_ready"
    | "rfq_clarification_needed"
    | "collaboration_ready"
    | "reorder_opportunity";
  title: string;
  description: string;
  relatedRfqId?: string;
  relatedBidId?: string;
  supplierName?: string;
  urgencyLevel: "low" | "medium" | "high";
};

/**
 * Example output:
 * [
 *   {
 *     id: "supplier_bid_ready:bid_123",
 *     type: "supplier_bid_ready",
 *     title: "Northwind Precision ready to collaborate",
 *     description:
 *       "Northwind Precision shared a fresh bid for Gearbox Housing. We can review it together whenever you're ready.",
 *     relatedRfqId: "rfq_456",
 *     relatedBidId: "bid_123",
 *     supplierName: "Northwind Precision",
 *     urgencyLevel: "medium",
 *   },
 * ];
 */

type CustomerRfqRecord = {
  id: string;
  title: string | null;
  priority: number | null;
  target_date: string | null;
  status: (typeof OPEN_RFQ_STATUSES)[number];
};

type RawBidRow = RfqBidRecord & {
  supplier?: SupplierSummary | SupplierSummary[] | null;
};

type BidWithSupplier = Omit<RawBidRow, "supplier"> & {
  supplier: SupplierSummary | null;
};

const RFQ_SELECT_FIELDS = ["id", "title", "priority", "target_date", "status"].join(
  ",",
);

const BID_SELECT_FIELDS = [
  "id",
  "rfq_id",
  "supplier_id",
  "price_total",
  "currency",
  "lead_time_days",
  "notes",
  "status",
  "created_at",
  "supplier:suppliers(id,company_name,primary_email)",
].join(",");

const LIVE_BID_STATUSES: RfqBidStatus[] = ["submitted", "accepted"];

export async function getCustomerDecisions(
  customerId: string,
): Promise<CustomerDecision[]> {
  if (!customerId) {
    return [];
  }

  const rfqs = await fetchOpenCustomerRfqs(customerId);
  if (rfqs.length === 0) {
    return [];
  }

  const bids = await fetchBidsForRfqs(rfqs.map((rfq) => rfq.id));
  if (bids.length === 0) {
    return [];
  }

  const bidsByRfq = groupBidsByRfq(bids);

  const decisions: CustomerDecision[] = [];
  rfqs.forEach((rfq) => {
    const rfqBids = bidsByRfq.get(rfq.id);
    if (!rfqBids || rfqBids.length === 0) {
      return;
    }

    const urgency = deriveUrgencyLevel(rfq.priority, rfq.target_date);

    rfqBids.forEach((bid) => {
      const supplierLabel = bid.supplier?.company_name ?? "Supplier partner";
      decisions.push({
        id: `supplier_bid_ready:${bid.id}`,
        type: "supplier_bid_ready",
        title:
          bid.supplier?.company_name?.trim()?.length ?? 0 > 0
            ? `${bid.supplier?.company_name} ready to collaborate`
            : "Supplier ready to collaborate",
        description: buildSupplierReadyDescription(rfq.title, supplierLabel),
        relatedRfqId: rfq.id,
        relatedBidId: bid.id,
        supplierName: bid.supplier?.company_name ?? undefined,
        urgencyLevel: urgency,
      });
    });
  });

  return decisions;
}

async function fetchOpenCustomerRfqs(
  customerId: string,
): Promise<CustomerRfqRecord[]> {
  try {
    const { data, error } = await supabaseServer
      .from("rfqs")
      .select(RFQ_SELECT_FIELDS)
      .eq("customer_id", customerId)
      .in("status", OPEN_RFQ_STATUSES)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("decisions: fetchOpenCustomerRfqs failed", {
        customerId,
        error,
      });
      return [];
    }

    return Array.isArray(data) ? (data as CustomerRfqRecord[]) : [];
  } catch (error) {
    console.error("decisions: fetchOpenCustomerRfqs unexpected error", {
      customerId,
      error,
    });
    return [];
  }
}

async function fetchBidsForRfqs(rfqIds: string[]): Promise<BidWithSupplier[]> {
  if (rfqIds.length === 0) {
    return [];
  }

  try {
    const { data, error } = await supabaseServer
      .from("rfq_bids")
      .select(BID_SELECT_FIELDS)
      .in("rfq_id", rfqIds)
      .in("status", LIVE_BID_STATUSES)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("decisions: fetchBidsForRfqs failed", {
        rfqIds,
        error,
      });
      return [];
    }

    const rows = Array.isArray(data) ? (data as RawBidRow[]) : [];
    return rows.map(normalizeBidRow);
  } catch (error) {
    console.error("decisions: fetchBidsForRfqs unexpected error", {
      rfqIds,
      error,
    });
    return [];
  }
}

function groupBidsByRfq(
  bids: BidWithSupplier[],
): Map<string, BidWithSupplier[]> {
  return bids.reduce<Map<string, BidWithSupplier[]>>((map, bid) => {
    const list = map.get(bid.rfq_id) ?? [];
    list.push(bid);
    map.set(bid.rfq_id, list);
    return map;
  }, new Map());
}

function normalizeBidRow(row: RawBidRow): BidWithSupplier {
  const supplierArray = Array.isArray(row.supplier)
    ? row.supplier
    : row.supplier
      ? [row.supplier]
      : [];
  const supplier = supplierArray[0] ?? null;
  const { supplier: _omit, ...rest } = row;
  return {
    ...rest,
    supplier,
  };
}

function deriveUrgencyLevel(
  priority: number | null,
  targetDate: string | null,
): CustomerDecision["urgencyLevel"] {
  const normalizedPriority = normalizePriority(priority);
  const daysToTarget = computeDaysToTarget(targetDate);

  if (daysToTarget !== null && daysToTarget <= 7) {
    return "high";
  }

  if (normalizedPriority >= 0.7) {
    return "high";
  }

  if (
    (daysToTarget !== null && daysToTarget <= 14) ||
    normalizedPriority >= 0.4
  ) {
    return "medium";
  }

  return "low";
}

function normalizePriority(value: number | null): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return 0.35;
  }

  if (value > 1) {
    return Math.min(Math.max(value / 100, 0), 1);
  }

  return Math.min(Math.max(value, 0), 1);
}

function computeDaysToTarget(targetDate: string | null): number | null {
  if (!targetDate) {
    return null;
  }
  const parsed = Date.parse(targetDate);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  const diffMs = parsed - Date.now();
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
}

function buildSupplierReadyDescription(
  rfqTitle: string | null,
  supplierLabel: string,
): string {
  const rfqFragment = rfqTitle ? ` for ${rfqTitle}` : "";
  return `${supplierLabel} shared a fresh bid${rfqFragment}. We can review the details together and decide on next steps whenever it feels right.`;
}
