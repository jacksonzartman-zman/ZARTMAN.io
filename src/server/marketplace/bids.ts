import { supabaseServer } from "@/lib/supabaseServer";
import {
  recordRfqEvent,
  type RfqRecord,
} from "./rfqs";

export type RfqBidStatus = "pending" | "accepted" | "rejected" | "withdrawn";

export type RfqBidRecord = {
  id: string;
  rfq_id: string;
  supplier_id: string;
  price_total: number | null;
  currency: string | null;
  lead_time_days: number | null;
  notes: string | null;
  status: RfqBidStatus;
  created_at: string;
  updated_at: string;
};

export type SubmitBidInput = {
  priceTotal?: number | string | null;
  currency?: string | null;
  leadTimeDays?: number | string | null;
  notes?: string | null;
};

export type BidViewer =
  | { role: "customer"; customerId: string }
  | { role: "supplier"; supplierId: string };

export type SubmitBidResult = {
  bid: RfqBidRecord | null;
  error: string | null;
};

export type ListBidsResult = {
  bids: (RfqBidRecord & {
    supplier?: {
      id: string;
      company_name: string | null;
      primary_email: string | null;
    } | null;
  })[];
  error: string | null;
};

export type AcceptBidResult = {
  accepted: RfqBidRecord | null;
  error: string | null;
};

export async function submitBidForRfq(
  rfqId: string,
  supplierId: string,
  input: SubmitBidInput,
): Promise<SubmitBidResult> {
  const normalizedRfqId = rfqId?.trim();
  const normalizedSupplierId = supplierId?.trim();

  if (!normalizedRfqId || !normalizedSupplierId) {
    return { bid: null, error: "RFQ and supplier are required." };
  }

  const rfq = await getRfqById(normalizedRfqId);
  if (!rfq) {
    return { bid: null, error: "RFQ not found." };
  }

  if (rfq.status !== "open") {
    return {
      bid: null,
      error: "This RFQ is not accepting new bids.",
    };
  }

  const supplierExists = await verifySupplier(normalizedSupplierId);
  if (!supplierExists) {
    return { bid: null, error: "Supplier not found." };
  }

  const priceTotal = normalizeNumber(input.priceTotal);
  const currency = normalizeCurrency(input.currency);
  const leadTimeDays = normalizeInteger(input.leadTimeDays);
  const notes = sanitizeNotes(input.notes);
  const timestamp = new Date().toISOString();

  const existing = await getExistingBid(normalizedRfqId, normalizedSupplierId);
  let bidResult: RfqBidRecord | null = null;
  let operation: "created" | "updated" = "created";

  if (existing) {
    if (existing.status === "accepted") {
      return { bid: existing, error: "Accepted bids cannot be edited." };
    }
    operation = "updated";
    const nextStatus = existing.status === "rejected" ? "pending" : existing.status;
    const { data, error } = await supabaseServer
      .from("rfq_bids")
      .update({
        price_total: priceTotal,
        currency,
        lead_time_days: leadTimeDays,
        notes,
        status: nextStatus,
        updated_at: timestamp,
      })
      .eq("id", existing.id)
      .select("*")
      .single<RfqBidRecord>();

    if (error) {
      console.error("submitBidForRfq: update failed", { error, existing });
      return { bid: null, error: "Unable to update bid right now." };
    }

    bidResult = data ?? null;
  } else {
    const { data, error } = await supabaseServer
      .from("rfq_bids")
      .insert({
        rfq_id: normalizedRfqId,
        supplier_id: normalizedSupplierId,
        price_total: priceTotal,
        currency,
        lead_time_days: leadTimeDays,
        notes,
        status: "pending",
      })
      .select("*")
      .single<RfqBidRecord>();

    if (error) {
      console.error("submitBidForRfq: insert failed", { error });
      return { bid: null, error: "Unable to submit bid right now." };
    }

    bidResult = data ?? null;
  }

  if (bidResult) {
    await recordRfqEvent({
      rfqId: normalizedRfqId,
      actorType: "supplier",
      actorId: normalizedSupplierId,
      eventType: operation === "created" ? "bid_submitted" : "bid_updated",
      payload: {
        bid_id: bidResult.id,
        price_total: bidResult.price_total,
        currency: bidResult.currency,
        lead_time_days: bidResult.lead_time_days,
      },
    });
  }

  return { bid: bidResult, error: null };
}

export async function listBidsForRfq(
  rfqId: string,
  viewer: BidViewer,
): Promise<ListBidsResult> {
  const normalizedRfqId = rfqId?.trim();
  if (!normalizedRfqId) {
    return { bids: [], error: "RFQ is required." };
  }

  const rfq = await getRfqById(normalizedRfqId);
  if (!rfq) {
    return { bids: [], error: "RFQ not found." };
  }

  if (viewer.role === "customer") {
    if (rfq.customer_id !== viewer.customerId) {
      return { bids: [], error: "Not authorized to view bids for this RFQ." };
    }

    const { data, error } = await supabaseServer
      .from("rfq_bids")
      .select(
        `
          id,
          rfq_id,
          supplier_id,
          price_total,
          currency,
          lead_time_days,
          notes,
          status,
          created_at,
          updated_at,
          supplier:supplier_id (
            id,
            company_name,
            primary_email
          )
        `,
      )
      .eq("rfq_id", normalizedRfqId)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("listBidsForRfq: customer query failed", { error });
      return { bids: [], error: "Unable to load bids." };
    }

    return {
      bids: (data as ListBidsResult["bids"]) ?? [],
      error: null,
    };
  }

  if (viewer.role === "supplier") {
    const normalizedSupplierId = viewer.supplierId?.trim();
    if (!normalizedSupplierId) {
      return { bids: [], error: "Supplier is required." };
    }

    const { data, error } = await supabaseServer
      .from("rfq_bids")
      .select(
        `
          id,
          rfq_id,
          supplier_id,
          price_total,
          currency,
          lead_time_days,
          notes,
          status,
          created_at,
          updated_at
        `,
      )
      .eq("rfq_id", normalizedRfqId)
      .eq("supplier_id", normalizedSupplierId)
      .maybeSingle<RfqBidRecord>();

    if (error) {
      console.error("listBidsForRfq: supplier query failed", {
        error,
        rfqId: normalizedRfqId,
        supplierId: normalizedSupplierId,
      });
      return { bids: [], error: "Unable to load bid." };
    }

    return {
      bids: data ? [data] : [],
      error: null,
    };
  }

  return { bids: [], error: null };
}

export async function acceptBid(
  rfqBidId: string,
  customerId: string,
): Promise<AcceptBidResult> {
  const normalizedBidId = rfqBidId?.trim();
  const normalizedCustomerId = customerId?.trim();

  if (!normalizedBidId || !normalizedCustomerId) {
    return { accepted: null, error: "Bid and customer are required." };
  }

  const bid = await getBidById(normalizedBidId);
  if (!bid) {
    return { accepted: null, error: "Bid not found." };
  }

  const rfq = await getRfqById(bid.rfq_id);
  if (!rfq || rfq.customer_id !== normalizedCustomerId) {
    return { accepted: null, error: "Not authorized to accept this bid." };
  }

  if (rfq.status === "awarded" && bid.status !== "accepted") {
    return {
      accepted: null,
      error: "RFQ already awarded. Decline the previous bid before switching.",
    };
  }

  const timestamp = new Date().toISOString();
  const { data: accepted, error } = await supabaseServer
    .from("rfq_bids")
    .update({
      status: "accepted",
      updated_at: timestamp,
    })
    .eq("id", normalizedBidId)
    .select("*")
    .single<RfqBidRecord>();

  if (error || !accepted) {
    console.error("acceptBid: update failed", { error, rfqBidId });
    return { accepted: null, error: "Unable to accept bid right now." };
  }

  const { error: rejectionError } = await supabaseServer
    .from("rfq_bids")
    .update({
      status: "rejected",
      updated_at: timestamp,
    })
    .eq("rfq_id", rfq.id)
    .neq("id", normalizedBidId);

  if (rejectionError) {
    console.error("acceptBid: failed to reject peer bids", {
      error: rejectionError,
      rfqId: rfq.id,
    });
  }

  const { error: rfqError } = await supabaseServer
    .from("rfqs")
    .update({
      status: "awarded",
      updated_at: timestamp,
    })
    .eq("id", rfq.id);

  if (rfqError) {
    console.error("acceptBid: failed to update rfq status", {
      error: rfqError,
      rfqId: rfq.id,
    });
  }

  await recordRfqEvent({
    rfqId: rfq.id,
    actorType: "customer",
    actorId: normalizedCustomerId,
    eventType: "bid_accepted",
    payload: {
      bid_id: accepted.id,
      supplier_id: accepted.supplier_id,
    },
  });

  return { accepted, error: null };
}

async function getExistingBid(rfqId: string, supplierId: string) {
  const { data, error } = await supabaseServer
    .from("rfq_bids")
    .select("*")
    .eq("rfq_id", rfqId)
    .eq("supplier_id", supplierId)
    .maybeSingle<RfqBidRecord>();

  if (error) {
    console.error("getExistingBid: lookup failed", { error, rfqId, supplierId });
    return null;
  }

  return data ?? null;
}

async function getRfqById(rfqId: string): Promise<RfqRecord | null> {
  const { data, error } = await supabaseServer
    .from("rfqs")
    .select("*")
    .eq("id", rfqId)
    .maybeSingle<RfqRecord>();

  if (error) {
    console.error("getRfqById: lookup failed", { error, rfqId });
    return null;
  }

  return data ?? null;
}

async function getBidById(bidId: string): Promise<RfqBidRecord | null> {
  const { data, error } = await supabaseServer
    .from("rfq_bids")
    .select("*")
    .eq("id", bidId)
    .maybeSingle<RfqBidRecord>();

  if (error) {
    console.error("getBidById: lookup failed", { error, bidId });
    return null;
  }

  return data ?? null;
}

async function verifySupplier(supplierId: string): Promise<boolean> {
  const { data, error } = await supabaseServer
    .from("suppliers")
    .select("id")
    .eq("id", supplierId)
    .maybeSingle();

  if (error) {
    console.error("verifySupplier: lookup failed", { error, supplierId });
    return false;
  }

  return Boolean(data?.id);
}

function normalizeNumber(value?: number | string | null): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  }
  return null;
}

function normalizeInteger(value?: number | string | null): number | null {
  const numeric = normalizeNumber(value);
  if (numeric === null) {
    return null;
  }
  return Math.round(numeric);
}

function normalizeCurrency(value?: string | null): string {
  if (typeof value !== "string") {
    return "USD";
  }
  const normalized = value.trim().toUpperCase();
  return normalized.length > 0 ? normalized : "USD";
}

function sanitizeNotes(value?: string | null): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
