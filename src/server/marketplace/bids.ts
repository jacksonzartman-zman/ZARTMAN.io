import { supabaseServer } from "@/lib/supabaseServer";
import { ensureSupplierEligibleForRfq } from "./matching";
import { logMarketplaceEvent } from "./events";
import {
  loadRfqById,
  OPEN_RFQ_STATUSES,
  updateRfqStatus,
} from "./rfqs";
import type {
  BidMutationResult,
  ListBidsResult,
  MarketplaceRfq,
  MatchableRfq,
  RfqBidRecord,
  SubmitRfqBidInput,
  SupplierSummary,
} from "./types";

const RFQ_BID_SELECT = [
  "id",
  "rfq_id",
  "supplier_id",
  "price_total",
  "currency",
  "lead_time_days",
  "notes",
  "status",
  "created_at",
  "updated_at",
  "supplier:suppliers(id,company_name,primary_email)",
].join(",");

export async function listBidsForRfq(rfqId: string): Promise<ListBidsResult> {
  if (!rfqId) {
    return { bids: [], error: "rfqId is required" };
  }

  try {
    const { data, error } = await supabaseServer()
      .from("rfq_bids")
      .select(RFQ_BID_SELECT)
      .eq("rfq_id", rfqId)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("marketplace: listBidsForRfq query failed", { rfqId, error });
      return { bids: [], error: "Unable to load offers" };
    }

    const rows = (Array.isArray(data) ? data : []) as unknown as RawBidRow[];
    const bids = rows.map((row) => normalizeBidRow(row));

    return { bids, error: null };
  } catch (error) {
    console.error("marketplace: listBidsForRfq unexpected error", { rfqId, error });
    return { bids: [], error: "Unexpected error while loading offers" };
  }
}

export async function submitRfqBid(input: SubmitRfqBidInput): Promise<BidMutationResult> {
  const { rfqId, supplierId } = input;
  if (!rfqId || !supplierId) {
    return { bid: null, error: "rfqId and supplierId are required" };
  }

  const rfq = await loadRfqById(rfqId);
  if (!rfq) {
    return { bid: null, error: "Search request not found" };
  }

  if (!isOpenRfq(rfq)) {
    return { bid: null, error: "Search request is not open for new offers" };
  }

  const eligibility = await ensureSupplierEligibleForRfq(rfq, supplierId);
  if (!eligibility.eligible) {
    return {
      bid: null,
      error: "Supplier is not eligible to make an offer on this search request",
    };
  }

  const payload = buildBidPayload(input);

  try {
    const existing = await loadExistingBid(rfqId, supplierId);
    const isUpdate = Boolean(existing);

    const mutation = isUpdate
      ? supabaseServer()
          .from("rfq_bids")
          .update({
            ...payload,
            updated_at: new Date().toISOString(),
          })
          .eq("id", existing!.id)
          .select(RFQ_BID_SELECT)
          .maybeSingle<RawBidRow>()
      : supabaseServer()
          .from("rfq_bids")
          .insert({
            ...payload,
            rfq_id: rfqId,
            supplier_id: supplierId,
            status: "submitted",
          })
          .select(RFQ_BID_SELECT)
          .single<RawBidRow>();

    const { data, error } = await mutation;
    if (error || !data) {
      console.error("marketplace: submitRfqBid mutation failed", {
        rfqId,
        supplierId,
        error,
      });
      return { bid: null, error: "Unable to save bid" };
    }

    const normalized = normalizeBidRow(data);

    await logMarketplaceEvent({
      rfqId,
      type: isUpdate ? "bid_updated" : "bid_submitted",
      actorId: supplierId,
      supplierId,
      payload: {
        bid_id: normalized.id,
        price_total: normalized.price_total,
        currency: normalized.currency,
        lead_time_days: normalized.lead_time_days,
        score: eligibility.score,
        explanation: eligibility.explanation,
      },
    });

    return { bid: normalized, error: null };
  } catch (error) {
    console.error("marketplace: submitRfqBid unexpected error", {
      rfqId,
      supplierId,
      error,
    });
    return { bid: null, error: "Unexpected error while saving bid" };
  }
}

export async function withdrawRfqBid(
  rfqId: string,
  bidId: string,
  supplierId: string,
): Promise<BidMutationResult> {
  if (!rfqId || !bidId || !supplierId) {
    return { bid: null, error: "rfqId, bidId, and supplierId are required" };
  }

  try {
    const { data, error } = await supabaseServer()
      .from("rfq_bids")
      .update({
        status: "withdrawn",
        updated_at: new Date().toISOString(),
      })
      .eq("id", bidId)
      .eq("rfq_id", rfqId)
      .eq("supplier_id", supplierId)
      .select(RFQ_BID_SELECT)
      .maybeSingle<RawBidRow>();

    if (error || !data) {
      console.error("marketplace: withdrawRfqBid failed", {
        rfqId,
        bidId,
        supplierId,
        error,
      });
      return { bid: null, error: "Unable to withdraw bid" };
    }

    const bid = normalizeBidRow(data);

    await logMarketplaceEvent({
      rfqId,
      type: "bid_withdrawn",
      actorId: supplierId,
      supplierId,
      payload: {
        bid_id: bid.id,
      },
    });

    return { bid, error: null };
  } catch (error) {
    console.error("marketplace: withdrawRfqBid unexpected error", {
      rfqId,
      bidId,
      supplierId,
      error,
    });
    return { bid: null, error: "Unexpected error while withdrawing bid" };
  }
}

export async function acceptRfqBid(
  rfqId: string,
  bidId: string,
  actorId?: string | null,
): Promise<BidMutationResult> {
  if (!rfqId || !bidId) {
    return { bid: null, error: "rfqId and bidId are required" };
  }

  const rfq = await loadRfqById(rfqId);
  if (!rfq) {
    return { bid: null, error: "Search request not found" };
  }

  try {
    const targetBid = await loadBidById(bidId);
    if (!targetBid || targetBid.rfq_id !== rfqId) {
      return { bid: null, error: "Offer does not belong to this search request" };
    }

    const now = new Date().toISOString();
    const { data: accepted, error: acceptError } = await supabaseServer()
      .from("rfq_bids")
      .update({
        status: "accepted",
        updated_at: now,
      })
      .eq("id", bidId)
      .select(RFQ_BID_SELECT)
      .maybeSingle<RawBidRow>();

    if (acceptError || !accepted) {
      console.error("marketplace: acceptRfqBid update failed", {
        rfqId,
        bidId,
        error: acceptError,
      });
      return { bid: null, error: "Unable to accept bid" };
    }

    const acceptedBid = normalizeBidRow(accepted);

    await Promise.all([
      supabaseServer()
        .from("rfq_bids")
        .update({
          status: "rejected",
          updated_at: now,
        })
        .eq("rfq_id", rfqId)
        .neq("id", bidId),
      updateRfqStatus(rfqId, "awarded"),
    ]);

    await logMarketplaceEvent({
      rfqId,
      type: "rfq_awarded",
      actorId: actorId ?? null,
      supplierId: acceptedBid.supplier_id,
      payload: {
        bid_id: acceptedBid.id,
        supplier_id: acceptedBid.supplier_id,
        price_total: acceptedBid.price_total,
      },
    });

    return { bid: acceptedBid, error: null };
  } catch (error) {
    console.error("marketplace: acceptRfqBid unexpected error", {
      rfqId,
      bidId,
      error,
    });
    return { bid: null, error: "Unexpected error while accepting bid" };
  }
}

function normalizeBidRow(row: RawBidRow): ListBidsResult["bids"][number] {
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

function buildBidPayload(input: SubmitRfqBidInput) {
  const normalizedPrice =
    typeof input.priceTotal === "string"
      ? Number.parseFloat(input.priceTotal)
      : input.priceTotal;
  const price = Number.isFinite(normalizedPrice ?? NaN)
    ? normalizedPrice
    : null;
  const leadTime =
    typeof input.leadTimeDays === "string"
      ? Number.parseInt(input.leadTimeDays, 10)
      : input.leadTimeDays ?? null;

  return {
    price_total: price,
    currency: (input.currency ?? "USD").toUpperCase(),
    lead_time_days:
      typeof leadTime === "number" && Number.isFinite(leadTime) ? leadTime : null,
    notes: input.notes && input.notes.trim().length > 0 ? input.notes.trim() : null,
  };
}

async function loadExistingBid(rfqId: string, supplierId: string) {
  const { data, error } = await supabaseServer()
    .from("rfq_bids")
    .select("id")
    .eq("rfq_id", rfqId)
    .eq("supplier_id", supplierId)
    .maybeSingle<{ id: string }>();

  if (error) {
    console.error("marketplace: failed to check existing bid", {
      rfqId,
      supplierId,
      error,
    });
    return null;
  }

  return data ?? null;
}

async function loadBidById(bidId: string): Promise<RfqBidRecord | null> {
  const { data, error } = await supabaseServer()
    .from("rfq_bids")
    .select(
      "id,rfq_id,supplier_id,price_total,currency,lead_time_days,notes,status,created_at,updated_at",
    )
    .eq("id", bidId)
    .maybeSingle<RfqBidRecord>();

  if (error) {
    console.error("marketplace: loadBidById failed", { bidId, error });
    return null;
  }

  return data ?? null;
}

function isOpenRfq(rfq: MarketplaceRfq): rfq is MatchableRfq {
  return OPEN_RFQ_STATUSES.includes(rfq.status);
}

type RawBidRow = RfqBidRecord & {
  supplier?: SupplierSummary | SupplierSummary[] | null;
};
