import { supabaseServer } from "@/lib/supabaseServer";
import { loadSupplierById } from "./profile";
import type {
  SupplierBidInput,
  SupplierBidRow,
  SupplierBidStatus,
  SupplierBidWithContext,
  SupplierCapabilityRow,
  SupplierRow,
} from "./types";

const DEFAULT_CURRENCY = "USD";

export async function listSupplierBidsForQuote(
  quoteId: string,
): Promise<SupplierBidWithContext[]> {
  if (!quoteId) {
    return [];
  }

  try {
    const { data, error } = await supabaseServer
      .from("supplier_bids")
      .select("*")
      .eq("quote_id", quoteId)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("listSupplierBidsForQuote: query failed", {
        quoteId,
        error,
      });
      return [];
    }

    return enrichWithSupplierContext((data as SupplierBidRow[]) ?? []);
  } catch (error) {
    console.error("listSupplierBidsForQuote: unexpected error", {
      quoteId,
      error,
    });
    return [];
  }
}

export async function listSupplierBidsForSupplier(
  supplierId: string,
): Promise<SupplierBidWithContext[]> {
  if (!supplierId) {
    return [];
  }

  try {
    const { data, error } = await supabaseServer
      .from("supplier_bids")
      .select("*")
      .eq("supplier_id", supplierId)
      .order("updated_at", { ascending: false });

    if (error) {
      console.error("listSupplierBidsForSupplier: query failed", {
        supplierId,
        error,
      });
      return [];
    }

    return enrichWithSupplierContext((data as SupplierBidRow[]) ?? []);
  } catch (error) {
    console.error("listSupplierBidsForSupplier: unexpected error", {
      supplierId,
      error,
    });
    return [];
  }
}

export async function getSupplierBidForQuote(
  quoteId: string,
  supplierId: string,
): Promise<SupplierBidRow | null> {
  if (!quoteId || !supplierId) {
    return null;
  }

  try {
    const { data, error } = await supabaseServer
      .from("supplier_bids")
      .select("*")
      .eq("quote_id", quoteId)
      .eq("supplier_id", supplierId)
      .maybeSingle<SupplierBidRow>();

    if (error) {
      console.error("getSupplierBidForQuote: lookup failed", {
        quoteId,
        supplierId,
        error,
      });
      return null;
    }

    return data ?? null;
  } catch (error) {
    console.error("getSupplierBidForQuote: unexpected error", {
      quoteId,
      supplierId,
      error,
    });
    return null;
  }
}

export async function createOrUpdateBid(
  input: SupplierBidInput,
): Promise<SupplierBidRow | null> {
  const { quoteId, supplierId } = input;
  if (!quoteId || !supplierId) {
    throw new Error("quoteId and supplierId are required");
  }

  try {
    const existing = await getSupplierBidForQuote(quoteId, supplierId);
    const payload = buildBidPayload(input);

    if (existing) {
      const { data, error } = await supabaseServer
        .from("supplier_bids")
        .update({
          ...payload,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id)
        .select("*")
        .maybeSingle<SupplierBidRow>();

      if (error) {
        console.error("createOrUpdateBid: update failed", {
          quoteId,
          supplierId,
          error,
        });
        return null;
      }

      return data ?? null;
    }

    const { data, error } = await supabaseServer
      .from("supplier_bids")
      .insert({
        ...payload,
        quote_id: quoteId,
        supplier_id: supplierId,
        status: "pending",
      })
      .select("*")
      .single<SupplierBidRow>();

    if (error) {
      console.error("createOrUpdateBid: insert failed", {
        quoteId,
        supplierId,
        error,
      });
      return null;
    }

    return data ?? null;
  } catch (error) {
    console.error("createOrUpdateBid: unexpected error", {
      quoteId,
      supplierId,
      error,
    });
    throw error;
  }
}

export async function updateSupplierBidStatus(
  bidId: string,
  status: SupplierBidStatus,
): Promise<SupplierBidRow | null> {
  if (!bidId) {
    return null;
  }

  try {
    const { data, error } = await supabaseServer
      .from("supplier_bids")
      .update({
        status,
        updated_at: new Date().toISOString(),
      })
      .eq("id", bidId)
      .select("*")
      .maybeSingle<SupplierBidRow>();

    if (error) {
      console.error("updateSupplierBidStatus: update failed", {
        bidId,
        status,
        error,
      });
      return null;
    }

    return data ?? null;
  } catch (error) {
    console.error("updateSupplierBidStatus: unexpected error", {
      bidId,
      status,
      error,
    });
    return null;
  }
}

export async function acceptSupplierBidForQuote(bidId: string, quoteId: string) {
  if (!bidId || !quoteId) {
    throw new Error("bidId and quoteId are required");
  }

  try {
    const targetBid = await getBidById(bidId);
    if (!targetBid || targetBid.quote_id !== quoteId) {
      console.error("acceptSupplierBidForQuote: mismatched bid/quote", {
        bidId,
        quoteId,
      });
      return { accepted: null };
    }

    const now = new Date().toISOString();
    const { data: accepted, error: acceptError } = await supabaseServer
      .from("supplier_bids")
      .update({
        status: "accepted",
        updated_at: now,
      })
      .eq("id", bidId)
      .select("*")
      .maybeSingle<SupplierBidRow>();

    if (acceptError || !accepted) {
      console.error("acceptSupplierBidForQuote: accept update failed", {
        bidId,
        quoteId,
        error: acceptError,
      });
      return { accepted: null };
    }

    const { error: declineError } = await supabaseServer
      .from("supplier_bids")
      .update({
        status: "declined",
        updated_at: now,
      })
      .eq("quote_id", quoteId)
      .neq("id", bidId);

    if (declineError) {
      console.error("acceptSupplierBidForQuote: declining peers failed", {
        quoteId,
        error: declineError,
      });
    }

    const supplier = await loadSupplierById(accepted.supplier_id);
    if (supplier) {
      await updateQuoteAssignedSupplier(quoteId, supplier);
    }

    return { accepted };
  } catch (error) {
    console.error("acceptSupplierBidForQuote: unexpected error", {
      bidId,
      quoteId,
      error,
    });
    throw error;
  }
}

export async function declineSupplierBid(
  bidId: string,
  quoteId?: string,
): Promise<SupplierBidRow | null> {
  if (!bidId) {
    return null;
  }

  try {
    const bid = await getBidById(bidId);
    if (!bid) {
      return null;
    }

    const { data, error } = await supabaseServer
      .from("supplier_bids")
      .update({
        status: "declined",
        updated_at: new Date().toISOString(),
      })
      .eq("id", bidId)
      .select("*")
      .maybeSingle<SupplierBidRow>();

    if (error) {
      console.error("declineSupplierBid: update failed", {
        bidId,
        error,
      });
      return null;
    }

    if (quoteId && bid.status === "accepted") {
      // When the accepted bid is declined, clear the assignment so another supplier can be chosen.
      await supabaseServer
        .from("quotes")
        .update({
          assigned_supplier_email: null,
          assigned_supplier_name: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", quoteId);
    }

    return data ?? null;
  } catch (error) {
    console.error("declineSupplierBid: unexpected error", {
      bidId,
      quoteId,
      error,
    });
    return null;
  }
}

async function getBidById(bidId: string): Promise<SupplierBidRow | null> {
  if (!bidId) {
    return null;
  }

  const { data, error } = await supabaseServer
    .from("supplier_bids")
    .select("*")
    .eq("id", bidId)
    .maybeSingle<SupplierBidRow>();

  if (error) {
    console.error("getBidById: lookup failed", { bidId, error });
    return null;
  }

  return data ?? null;
}

async function enrichWithSupplierContext(
  bids: SupplierBidRow[],
): Promise<SupplierBidWithContext[]> {
  if (bids.length === 0) {
    return [];
  }

  const supplierIds = Array.from(
    new Set(bids.map((bid) => bid.supplier_id).filter(Boolean)),
  );

  const [suppliers, capabilities] = await Promise.all([
    selectSuppliersByIds(supplierIds),
    selectCapabilitiesBySupplierIds(supplierIds),
  ]);

  const supplierById = new Map<string, SupplierRow>();
  suppliers.forEach((supplier) => supplierById.set(supplier.id, supplier));

  const certsBySupplier = new Map<string, string[]>();
  capabilities.forEach((capability) => {
    const list = certsBySupplier.get(capability.supplier_id) ?? [];
    const certs = (capability.certifications ?? []).filter(
      (cert): cert is string => typeof cert === "string" && cert.trim().length > 0,
    );
    certs.forEach((cert) => {
      if (!list.includes(cert)) {
        list.push(cert);
      }
    });
    certsBySupplier.set(capability.supplier_id, list);
  });

  return bids.map((bid) => ({
    ...bid,
    supplier: supplierById.get(bid.supplier_id) ?? null,
    certifications: certsBySupplier.get(bid.supplier_id) ?? [],
  }));
}

async function selectSuppliersByIds(
  supplierIds: string[],
): Promise<SupplierRow[]> {
  if (supplierIds.length === 0) {
    return [];
  }

  const { data, error } = await supabaseServer
    .from("suppliers")
    .select("*")
    .in("id", supplierIds);

  if (error) {
    console.error("selectSuppliersByIds: query failed", {
      supplierIds,
      error,
    });
    return [];
  }

  return (data as SupplierRow[]) ?? [];
}

async function selectCapabilitiesBySupplierIds(
  supplierIds: string[],
): Promise<SupplierCapabilityRow[]> {
  if (supplierIds.length === 0) {
    return [];
  }

  const { data, error } = await supabaseServer
    .from("supplier_capabilities")
    .select("*")
    .in("supplier_id", supplierIds);

  if (error) {
    console.error("selectCapabilitiesBySupplierIds: query failed", {
      supplierIds,
      error,
    });
    return [];
  }

  return (data as SupplierCapabilityRow[]) ?? [];
}

function buildBidPayload(input: SupplierBidInput) {
  const unitPrice =
    typeof input.unitPrice === "string"
      ? Number(input.unitPrice)
      : input.unitPrice;
  const normalizedUnitPrice =
    typeof unitPrice === "number" && Number.isFinite(unitPrice)
      ? unitPrice
      : null;
  const leadTime =
    typeof input.leadTimeDays === "string"
      ? Number.parseInt(input.leadTimeDays, 10)
      : input.leadTimeDays;
  const normalizedLeadTime =
    typeof leadTime === "number" && Number.isFinite(leadTime)
      ? leadTime
      : null;

  return {
    unit_price: normalizedUnitPrice,
    currency:
      typeof input.currency === "string" && input.currency.trim().length > 0
        ? input.currency.trim().toUpperCase()
        : DEFAULT_CURRENCY,
    lead_time_days: normalizedLeadTime,
    notes:
      typeof input.notes === "string" && input.notes.trim().length > 0
        ? input.notes.trim()
        : null,
    supplier_id: input.supplierId,
    quote_id: input.quoteId,
  };
}

async function updateQuoteAssignedSupplier(
  quoteId: string,
  supplier: SupplierRow,
) {
  try {
    const { error } = await supabaseServer
      .from("quotes")
      .update({
        assigned_supplier_email: supplier.primary_email,
        assigned_supplier_name: supplier.company_name,
        updated_at: new Date().toISOString(),
      })
      .eq("id", quoteId);

    if (error) {
      console.error("updateQuoteAssignedSupplier: quote update failed", {
        quoteId,
        supplierId: supplier.id,
        error,
      });
    }
  } catch (error) {
    console.error("updateQuoteAssignedSupplier: unexpected error", {
      quoteId,
      supplierId: supplier.id,
      error,
    });
  }
}
