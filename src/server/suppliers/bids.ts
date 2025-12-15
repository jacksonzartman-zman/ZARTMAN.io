import { supabaseServer } from "@/lib/supabaseServer";
import {
  serializeSupabaseError,
  isMissingTableOrColumnError,
  logAdminQuotesError,
  logAdminQuotesInfo,
} from "@/server/admin/logging";
import {
  getSupplierApprovalStatus,
  isSupplierApproved,
  loadSupplierById,
} from "./profile";
import {
  logSupplierActivityQueryFailure,
  resolveSupplierActivityQuery,
} from "./activityLogging";
import type {
  SupplierActivityIdentity,
  SupplierActivityResult,
  SupplierBidInput,
  SupplierBidRow,
  SupplierBidStatus,
  SupplierBidWithContext,
  SupplierCapabilityRow,
  SupplierRow,
} from "./types";
import { approvalsEnabled } from "./flags";
import { QUOTE_UPDATE_ERROR, updateAdminQuote } from "@/server/admin/quotes";
import { emitQuoteEvent } from "@/server/quotes/events";

export type BidStatus =
  | "submitted"
  | "revised"
  | "withdrawn"
  | "won"
  | "lost";

export type BidRow = {
  id: string;
  quote_id: string;
  supplier_id: string;
  amount: number | null;
  currency: string | null;
  lead_time_days: number | null;
  notes: string | null;
  status: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export type BidLoaderResult<T> = {
  ok: boolean;
  data: T;
  error: string | null;
};

const BIDS_TABLE_NAME = "supplier_bids";
const BIDS_MISSING_SCHEMA_MESSAGE =
  "Bids are not available in this environment.";
const BIDS_GENERIC_ERROR_MESSAGE = "We had trouble loading bids.";
const BID_WINNER_GENERIC_ERROR_MESSAGE =
  "We couldn't select that bid. Please check logs and try again.";
const BID_SELECTION_COLUMNS =
  "id,quote_id,supplier_id,unit_price,currency,lead_time_days,notes,status,created_at,updated_at";

const DEFAULT_CURRENCY = "USD";

type MarkWinningBidParams = {
  quoteId: string;
  bidId: string;
};

type MarkWinningBidResult = {
  ok: boolean;
  error: string | null;
};

export async function loadBidsForQuote(
  quoteId: string,
): Promise<BidLoaderResult<BidRow[]>> {
  if (!quoteId) {
    return {
      ok: false,
      data: [],
      error: "Quote ID is required.",
    };
  }

  try {
    const { data, error } = await supabaseServer
      .from(BIDS_TABLE_NAME)
      .select(BID_SELECTION_COLUMNS)
      .eq("quote_id", quoteId)
      .order("created_at", { ascending: false });

    if (error) {
      const serialized = serializeSupabaseError(error);
      if (isMissingTableOrColumnError(error)) {
        console.warn("[bids] list missing schema", {
          quoteId,
          error: serialized,
        });
        return {
          ok: false,
          data: [],
          error: BIDS_MISSING_SCHEMA_MESSAGE,
        };
      }

      console.error("[bids] list query failed", {
        quoteId,
        error: serialized,
      });
      return {
        ok: false,
        data: [],
        error: BIDS_GENERIC_ERROR_MESSAGE,
      };
    }

    const rows =
      (Array.isArray(data) ? data : [])?.map((row) =>
        normalizeBidRow(row as SupplierBidRow),
      ) ?? [];

    return {
      ok: true,
      data: rows.filter((row): row is BidRow => Boolean(row)),
      error: null,
    };
  } catch (error) {
    const serialized = serializeSupabaseError(error);
    if (isMissingTableOrColumnError(error)) {
      console.warn("[bids] list missing schema", {
        quoteId,
        error: serialized,
      });
      return {
        ok: false,
        data: [],
        error: BIDS_MISSING_SCHEMA_MESSAGE,
      };
    }

    console.error("[bids] list crashed", {
      quoteId,
      error: serialized ?? error,
    });
    return {
      ok: false,
      data: [],
      error: BIDS_GENERIC_ERROR_MESSAGE,
    };
  }
}

export async function loadBidForSupplierAndQuote(
  supplierId: string,
  quoteId: string,
): Promise<BidLoaderResult<BidRow | null>> {
  if (!supplierId || !quoteId) {
    return {
      ok: false,
      data: null,
      error: "Supplier and quote are required.",
    };
  }

  try {
    const { data, error } = await supabaseServer
      .from(BIDS_TABLE_NAME)
      .select(BID_SELECTION_COLUMNS)
      .eq("quote_id", quoteId)
      .eq("supplier_id", supplierId)
      .maybeSingle<SupplierBidRow>();

    if (error) {
      const serialized = serializeSupabaseError(error);
      if (isMissingTableOrColumnError(error)) {
        console.warn("[bids] detail missing schema", {
          supplierId,
          quoteId,
          error: serialized,
        });
        return {
          ok: false,
          data: null,
          error: BIDS_MISSING_SCHEMA_MESSAGE,
        };
      }

      console.error("[bids] detail query failed", {
        supplierId,
        quoteId,
        error: serialized,
      });
      return {
        ok: false,
        data: null,
        error: BIDS_GENERIC_ERROR_MESSAGE,
      };
    }

    return {
      ok: true,
      data: normalizeBidRow(data),
      error: null,
    };
  } catch (error) {
    const serialized = serializeSupabaseError(error);
    if (isMissingTableOrColumnError(error)) {
      console.warn("[bids] detail missing schema", {
        supplierId,
        quoteId,
        error: serialized,
      });
      return {
        ok: false,
        data: null,
        error: BIDS_MISSING_SCHEMA_MESSAGE,
      };
    }

    console.error("[bids] detail crashed", {
      supplierId,
      quoteId,
      error: serialized ?? error,
    });
    return {
      ok: false,
      data: null,
      error: BIDS_GENERIC_ERROR_MESSAGE,
    };
  }
}

export async function markWinningBidForQuote(
  params: MarkWinningBidParams,
): Promise<MarkWinningBidResult> {
  const quoteId =
    typeof params?.quoteId === "string" ? params.quoteId.trim() : "";
  const bidId = typeof params?.bidId === "string" ? params.bidId.trim() : "";

  if (!quoteId || !bidId) {
    console.warn("[bids] winner selection missing identifiers", {
      quoteId,
      bidId,
    });
    return {
      ok: false,
      error: BID_WINNER_GENERIC_ERROR_MESSAGE,
    };
  }

  try {
    const {
      data: bidRow,
      error: bidError,
    } = await supabaseServer
      .from(BIDS_TABLE_NAME)
      .select(BID_SELECTION_COLUMNS)
      .eq("id", bidId)
      .maybeSingle<SupplierBidRow>();

    if (bidError) {
      const serialized = serializeSupabaseError(bidError);
      if (isMissingTableOrColumnError(bidError)) {
        console.warn("[bids] winner lookup missing schema", {
          quoteId,
          bidId,
          error: serialized,
        });
        return {
          ok: false,
          error: BIDS_MISSING_SCHEMA_MESSAGE,
        };
      }
      console.error("[bids] winner lookup failed", {
        quoteId,
        bidId,
        error: serialized,
      });
      return {
        ok: false,
        error: BID_WINNER_GENERIC_ERROR_MESSAGE,
      };
    }

    if (!bidRow || bidRow.quote_id !== quoteId) {
      console.warn("[bids] winner lookup mismatch", {
        quoteId,
        bidId,
        bidQuoteId: bidRow?.quote_id ?? null,
      });
      return {
        ok: false,
        error: BID_WINNER_GENERIC_ERROR_MESSAGE,
      };
    }

    const normalizedBid = normalizeBidRow(bidRow);
    if (!normalizedBid) {
      console.error("[bids] winner normalize failed", {
        quoteId,
        bidId,
      });
      return {
        ok: false,
        error: BID_WINNER_GENERIC_ERROR_MESSAGE,
      };
    }

    const now = new Date().toISOString();

    const { error: winError } = await supabaseServer
      .from(BIDS_TABLE_NAME)
      .update({
        status: "won",
        updated_at: now,
      })
      .eq("id", bidId);

    if (winError) {
      const serialized = serializeSupabaseError(winError);
      if (isMissingTableOrColumnError(winError)) {
        console.warn("[bids] winner update missing schema", {
          quoteId,
          bidId,
          error: serialized,
        });
        return {
          ok: false,
          error: BIDS_MISSING_SCHEMA_MESSAGE,
        };
      }
      console.error("[bids] winner update failed", {
        quoteId,
        bidId,
        error: serialized,
      });
      return {
        ok: false,
        error: BID_WINNER_GENERIC_ERROR_MESSAGE,
      };
    }

    const { error: loseError } = await supabaseServer
      .from(BIDS_TABLE_NAME)
      .update({
        status: "lost",
        updated_at: now,
      })
      .eq("quote_id", quoteId)
      .neq("id", bidId);

    if (loseError) {
      console.warn("[bids] losing peer bids failed", {
        quoteId,
        bidId,
        error: serializeSupabaseError(loseError),
      });
    }

    const price =
      typeof normalizedBid.amount === "number" &&
      Number.isFinite(normalizedBid.amount)
        ? normalizedBid.amount
        : null;
    const currency =
      typeof normalizedBid.currency === "string" &&
      normalizedBid.currency.trim().length > 0
        ? normalizedBid.currency.trim().toUpperCase()
        : DEFAULT_CURRENCY;

    const quoteResult = await updateAdminQuote(
      {
        quoteId,
        status: "won",
        price,
        currency,
      },
      { skipStatusNotifications: true },
    );

    if (!quoteResult.ok) {
      logAdminQuotesError("winner update failed", {
        quoteId,
        bidId,
        error: quoteResult.error,
      });
      return {
        ok: false,
        error: quoteResult.error ?? QUOTE_UPDATE_ERROR,
      };
    }

    logAdminQuotesInfo("winner update success", {
      quoteId,
      bidId,
      price,
      currency,
    });

    console.log("[bids] winner selected", {
      quoteId,
      bidId,
    });

    return {
      ok: true,
      error: null,
    };
  } catch (error) {
    const serialized = serializeSupabaseError(error);
    if (isMissingTableOrColumnError(error)) {
      console.warn("[bids] winner selection missing schema", {
        quoteId,
        bidId,
        error: serialized,
      });
      return {
        ok: false,
        error: BIDS_MISSING_SCHEMA_MESSAGE,
      };
    }
    console.error("[bids] winner selection crashed", {
      quoteId,
      bidId,
      error: serialized ?? error,
    });
    return {
      ok: false,
      error: BID_WINNER_GENERIC_ERROR_MESSAGE,
    };
  }
}

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
  args: SupplierActivityIdentity,
): Promise<SupplierActivityResult<SupplierBidWithContext[]>> {
  const supplierId = args.supplierId ?? null;
  const supplierEmail = normalizeEmail(args.supplierEmail);
  const logContext = {
    supplierId,
    supplierEmail,
    loader: "bids" as const,
  };

  if (!supplierId) {
    console.warn("[supplier activity] loading skipped", {
      ...logContext,
      error: "Missing supplier identity",
    });
    return {
      ok: false,
      data: [],
      error: "Missing supplier identity",
    };
  }

  console.log("[supplier activity] loading", logContext);

  try {
    const approvalsOn = approvalsEnabled();
    if (approvalsOn) {
      const supplier = await loadSupplierById(supplierId);
      if (!supplier) {
        console.warn("[supplier activity] loading skipped", {
          ...logContext,
          error: "Supplier profile missing",
        });
        return {
          ok: false,
          data: [],
          error: "Supplier profile missing",
        };
      }
      const approvalStatus = getSupplierApprovalStatus(supplier);
      if (!isSupplierApproved(supplier)) {
        console.log("[supplier activity] approvals gate active", {
          ...logContext,
          approvalStatus,
        });
        return {
          ok: true,
          data: [],
          approvalGate: {
            enabled: true,
            status: approvalStatus,
          },
        };
      }
    }

    const { data, error } = await supabaseServer
      .from("supplier_bids")
      .select("*")
      .eq("supplier_id", supplierId)
      .order("updated_at", { ascending: false });

    if (error) {
      logSupplierActivityQueryFailure({
        ...logContext,
        query: "supplier_bids",
        error,
      });
      return {
        ok: false,
        data: [],
        error: "Unable to load bids right now",
      };
    }

    const rows = await enrichWithSupplierContext((data as SupplierBidRow[]) ?? []);

    console.log("[supplier activity] quote query result", {
      ...logContext,
      count: rows.length,
    });

    return {
      ok: true,
      data: rows,
    };
  } catch (error) {
    logSupplierActivityQueryFailure({
      ...logContext,
      query: resolveSupplierActivityQuery(error, "supplier_bids"),
      error,
    });
    return {
      ok: false,
      data: [],
      error: "Unable to load bids right now",
    };
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

function normalizeBidRow(row?: SupplierBidRow | null): BidRow | null {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    quote_id: row.quote_id,
    supplier_id: row.supplier_id,
    amount: normalizeBidAmount(row.unit_price),
    currency: row.currency ?? null,
    lead_time_days:
      typeof row.lead_time_days === "number" && Number.isFinite(row.lead_time_days)
        ? row.lead_time_days
        : null,
    notes: row.notes ?? null,
    status: row.status ?? null,
    created_at: row.created_at ?? null,
    updated_at: row.updated_at ?? null,
  };
}

function normalizeBidAmount(
  value: number | string | null | undefined,
): number | null {
  const numeric = typeof value === "string" ? Number(value) : value;
  if (typeof numeric === "number" && Number.isFinite(numeric)) {
    return numeric;
  }
  return null;
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
        updated_at: new Date().toISOString(),
      })
      .eq("id", quoteId);

    if (error) {
      console.error("updateQuoteAssignedSupplier: quote update failed", {
        quoteId,
        supplierId: supplier.id,
        pgCode: error.code ?? null,
        pgMessage: error.message ?? null,
      });
      return;
    }

    // New invitation path: persist invite for supplier access gating.
    // Keep assigned_supplier_email as a back-compat fallback (legacy access + notifications).
    try {
      const { data: existingInvite, error: existingInviteError } =
        await supabaseServer
          .from("quote_invites")
          .select("id")
          .eq("quote_id", quoteId)
          .eq("supplier_id", supplier.id)
          .maybeSingle<{ id: string }>();
      if (existingInviteError && !isMissingTableOrColumnError(existingInviteError)) {
        console.warn("updateQuoteAssignedSupplier: invite lookup failed", {
          quoteId,
          supplierId: supplier.id,
          error: existingInviteError,
        });
      }
      const shouldEmitInviteEvent = !existingInvite;

      const { error: inviteError } = await supabaseServer
        .from("quote_invites")
        .upsert(
          {
            quote_id: quoteId,
            supplier_id: supplier.id,
          },
          { onConflict: "quote_id,supplier_id" },
        );

      if (inviteError) {
        console.error("updateQuoteAssignedSupplier: invite upsert failed", {
          quoteId,
          supplierId: supplier.id,
          error: inviteError,
        });
      } else if (shouldEmitInviteEvent) {
        void emitQuoteEvent({
          quoteId,
          eventType: "supplier_invited",
          actorRole: "system",
          metadata: {
            supplier_id: supplier.id,
            supplier_name: supplier.company_name ?? null,
            supplier_email: supplier.primary_email ?? null,
          },
        });
      }
    } catch (error) {
      console.error("updateQuoteAssignedSupplier: invite upsert crashed", {
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

function normalizeEmail(value?: string | null): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}
