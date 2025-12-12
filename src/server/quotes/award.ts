import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabaseServer";
import { serializeActionError } from "@/lib/forms";
import { getCustomerByUserId, type CustomerRow } from "@/server/customers";
import { normalizeQuoteStatus } from "@/server/quotes/status";
import {
  isWinningBidStatus,
  normalizeBidStatus,
} from "@/lib/bids/status";
import { ensureQuoteProjectForWinner } from "@/server/quotes/projects";
import { dispatchWinnerNotification } from "@/server/quotes/winnerNotifications";

const CUSTOMER_AWARD_ALLOWED_STATUSES = new Set([
  "submitted",
  "in_review",
  "quoted",
  "approved",
]);

const WIN_STATUS_VALUES = ["won", "winner", "accepted", "approved"];
const BID_INELIGIBLE_STATUSES = new Set(["lost", "declined", "withdrawn"]);

export type AwardActorRole = "customer" | "admin";

export type AwardFailureReason =
  | "invalid_input"
  | "quote_not_found"
  | "access_denied"
  | "status_not_allowed"
  | "winner_exists"
  | "bid_not_found"
  | "bid_ineligible"
  | "missing_supplier"
  | "write_failed"
  | "unknown";

export type AwardResult = {
  ok: boolean;
  error?: string | null;
  reason?: AwardFailureReason;
  awardedBidId?: string | null;
  awardedSupplierId?: string | null;
  awardedAt?: string | null;
};

export type PerformAwardFlowInput = {
  quoteId: string;
  bidId: string;
  actorUserId: string;
  actorRole: AwardActorRole;
  actorEmail?: string | null;
  customerId?: string | null;
  customerEmail?: string | null;
  overrideEmail?: string | null;
};

type QuoteAwardRow = {
  id: string;
  status: string | null;
  email: string | null;
  customer_id: string | null;
  awarded_bid_id: string | null;
  awarded_supplier_id: string | null;
  awarded_at: string | null;
  awarded_by_user_id: string | null;
  awarded_by_role: string | null;
};

type SupplierBidAwardRow = {
  id: string;
  quote_id: string;
  supplier_id: string | null;
  status: string | null;
};

export async function performAwardFlow(
  params: PerformAwardFlowInput,
): Promise<AwardResult> {
  const quoteId = normalizeId(params.quoteId);
  const bidId = normalizeId(params.bidId);
  const actorUserId = normalizeId(params.actorUserId);
  const actorRole = params.actorRole === "admin" ? "admin" : params.actorRole === "customer" ? "customer" : null;
  const logContext = {
    quoteId: quoteId || null,
    bidId: bidId || null,
    actorRole,
    actorUserId: actorUserId || null,
  };

  if (!quoteId || !bidId || !actorUserId || !actorRole) {
    console.warn("[award] validation failed", {
      ...logContext,
      reason: "invalid_input",
    });
    return { ok: false, reason: "invalid_input", error: "Invalid quote or bid id." };
  }

  console.info("[award] start", logContext);

  const quote = await loadQuoteForAward(quoteId);
  if (!quote) {
    console.warn("[award] validation failed", {
      ...logContext,
      reason: "quote_not_found",
    });
    return { ok: false, reason: "quote_not_found", error: "Quote not found." };
  }

  if (quote.awarded_bid_id) {
    console.warn("[award] validation failed", {
      ...logContext,
      reason: "winner_exists",
    });
    return {
      ok: false,
      reason: "winner_exists",
      error: "A winning supplier has already been selected for this quote.",
    };
  }

  if (actorRole === "customer") {
    const allowed = await validateCustomerActor({
      actorUserId,
      actorEmail: params.actorEmail,
      customerId: params.customerId,
      customerEmail: params.customerEmail,
      overrideEmail: params.overrideEmail,
      quote,
    });

    if (!allowed.allowed) {
      console.warn("[award] validation failed", {
        ...logContext,
        reason: allowed.reason ?? "access_denied",
      });
      return {
        ok: false,
        reason: allowed.reason ?? "access_denied",
        error: allowed.message ?? "You don't have access to this quote.",
      };
    }

    const normalizedStatus = normalizeQuoteStatus(quote.status ?? undefined);
    if (!isCustomerAwardStatusAllowed(normalizedStatus)) {
      console.warn("[award] validation failed", {
        ...logContext,
        reason: "status_not_allowed",
        status: normalizedStatus,
      });
      return {
        ok: false,
        reason: "status_not_allowed",
        error: "This quote isn’t ready to select a winner yet.",
      };
    }
  }

  const bid = await loadBidForAward(bidId);
  if (!bid || bid.quote_id !== quoteId) {
    console.warn("[award] validation failed", {
      ...logContext,
      reason: "bid_not_found",
    });
    return { ok: false, reason: "bid_not_found", error: "We couldn’t verify that bid." };
  }

  const winningSupplierId = normalizeId(bid.supplier_id);
  if (!winningSupplierId) {
    console.error("[award] validation failed", {
      ...logContext,
      reason: "missing_supplier",
    });
    return {
      ok: false,
      reason: "missing_supplier",
      error: "We couldn’t verify the selected supplier for this bid.",
    };
  }

  const normalizedBidStatus = normalizeBidStatus(bid.status);
  if (isWinningBidStatus(normalizedBidStatus)) {
    console.warn("[award] validation failed", {
      ...logContext,
      reason: "winner_exists",
      bidStatus: normalizedBidStatus,
    });
    return {
      ok: false,
      reason: "winner_exists",
      error: "A winning supplier has already been selected for this quote.",
    };
  }

  if (normalizedBidStatus && BID_INELIGIBLE_STATUSES.has(normalizedBidStatus)) {
    console.warn("[award] validation failed", {
      ...logContext,
      reason: "bid_ineligible",
      bidStatus: normalizedBidStatus,
    });
    return {
      ok: false,
      reason: "bid_ineligible",
      error: "We couldn’t verify that bid.",
    };
  }

  const otherWinnerExists = await hasExistingWinner(quoteId, bidId);
  if (otherWinnerExists) {
    console.warn("[award] validation failed", {
      ...logContext,
      reason: "winner_exists",
    });
    return {
      ok: false,
      reason: "winner_exists",
      error: "A winning supplier has already been selected for this quote.",
    };
  }

  const rpcResult = await supabaseServer.rpc("award_bid_for_quote", {
    p_quote_id: quoteId,
    p_bid_id: bidId,
    p_actor_user_id: actorUserId,
    p_actor_role: actorRole,
  });

  if (rpcResult.error) {
    const failureReason = mapRpcErrorToReason(rpcResult.error.message);
    console.error("[award] write failed", {
      ...logContext,
      reason: failureReason,
      error: serializeActionError(rpcResult.error),
    });
    return {
      ok: false,
      reason: failureReason,
      error: "We couldn't update the award state. Please try again.",
    };
  }

  const awardedSnapshot = await loadQuoteAwardSnapshot(quoteId);
  const awardedAt =
    awardedSnapshot?.awarded_at ??
    quote.awarded_at ??
    new Date().toISOString();

  await ensureQuoteProjectForWinner({
    quoteId,
    winningSupplierId,
  });

  revalidateAwardedPaths(quoteId);
  void dispatchWinnerNotification({
    quoteId,
    bidId,
    caller: actorRole,
  });

  console.info("[award] success", {
    ...logContext,
    awardedBidId: bidId,
    winningSupplierId,
  });

  return {
    ok: true,
    awardedBidId: bidId,
    awardedSupplierId: winningSupplierId,
    awardedAt,
  };
}

async function loadQuoteForAward(quoteId: string): Promise<QuoteAwardRow | null> {
  try {
    const { data, error } = await supabaseServer
      .from("quotes")
      .select(
        "id,status,email,customer_id,awarded_bid_id,awarded_supplier_id,awarded_at,awarded_by_user_id,awarded_by_role",
      )
      .eq("id", quoteId)
      .maybeSingle<QuoteAwardRow>();

    if (error) {
      console.error("[award] quote lookup failed", {
        quoteId,
        error: serializeActionError(error),
      });
      return null;
    }

    return data ?? null;
  } catch (error) {
    console.error("[award] quote lookup crashed", {
      quoteId,
      error: serializeActionError(error),
    });
    return null;
  }
}

async function loadBidForAward(bidId: string): Promise<SupplierBidAwardRow | null> {
  try {
    const { data, error } = await supabaseServer
      .from("supplier_bids")
      .select("id,quote_id,supplier_id,status")
      .eq("id", bidId)
      .maybeSingle<SupplierBidAwardRow>();

    if (error) {
      console.error("[award] bid lookup failed", {
        bidId,
        error: serializeActionError(error),
      });
      return null;
    }

    return data ?? null;
  } catch (error) {
    console.error("[award] bid lookup crashed", {
      bidId,
      error: serializeActionError(error),
    });
    return null;
  }
}

async function hasExistingWinner(quoteId: string, bidId: string) {
  try {
    const { data, error } = await supabaseServer
      .from("supplier_bids")
      .select("id")
      .eq("quote_id", quoteId)
      .in("status", WIN_STATUS_VALUES)
      .limit(10);

    if (error) {
      console.error("[award] winner lookup failed", {
        quoteId,
        error: serializeActionError(error),
      });
      return false;
    }

    return (data ?? []).some((row) => row.id !== bidId);
  } catch (error) {
    console.error("[award] winner lookup crashed", {
      quoteId,
      error: serializeActionError(error),
    });
    return false;
  }
}

async function validateCustomerActor({
  actorUserId,
  actorEmail,
  customerId,
  customerEmail,
  overrideEmail,
  quote,
}: {
  actorUserId: string;
  actorEmail?: string | null;
  customerId?: string | null;
  customerEmail?: string | null;
  overrideEmail?: string | null;
  quote: QuoteAwardRow;
}): Promise<{
  allowed: boolean;
  reason?: AwardFailureReason;
  message?: string;
}> {
  let resolvedCustomer: CustomerRow | null = null;
  if (customerId || customerEmail) {
    resolvedCustomer = {
      id: customerId ?? "",
      user_id: actorUserId,
      email: customerEmail ?? actorEmail ?? "",
      company_name: null,
      created_at: "",
    };
  } else {
    resolvedCustomer = await getCustomerByUserId(actorUserId);
  }

  if (!resolvedCustomer) {
    return {
      allowed: false,
      reason: "access_denied",
      message: "Complete your profile before selecting a winner.",
    };
  }

  const quoteCustomerMatches =
    normalizeId(quote.customer_id) &&
    normalizeId(resolvedCustomer.id) &&
    quote.customer_id === resolvedCustomer.id;

  const normalizedQuoteEmail = normalizeEmail(quote.email);
  const emailCandidates = [
    normalizeEmail(resolvedCustomer.email),
    normalizeEmail(actorEmail),
    normalizeEmail(overrideEmail),
  ].filter((value): value is string => Boolean(value));

  const emailMatches =
    Boolean(normalizedQuoteEmail) &&
    emailCandidates.some((candidate) => candidate === normalizedQuoteEmail);

  if (!quoteCustomerMatches && !emailMatches) {
    return {
      allowed: false,
      reason: "access_denied",
      message: "You don't have access to this quote.",
    };
  }

  return { allowed: true };
}

function isCustomerAwardStatusAllowed(status?: string | null): boolean {
  if (!status) {
    return false;
  }
  return CUSTOMER_AWARD_ALLOWED_STATUSES.has(status);
}

async function loadQuoteAwardSnapshot(quoteId: string) {
  try {
    const { data, error } = await supabaseServer
      .from("quotes")
      .select("awarded_bid_id,awarded_supplier_id,awarded_at")
      .eq("id", quoteId)
      .maybeSingle<Pick<QuoteAwardRow, "awarded_bid_id" | "awarded_supplier_id" | "awarded_at">>();

    if (error) {
      console.error("[award] snapshot lookup failed", {
        quoteId,
        error: serializeActionError(error),
      });
      return null;
    }
    return data ?? null;
  } catch (error) {
    console.error("[award] snapshot lookup crashed", {
      quoteId,
      error: serializeActionError(error),
    });
    return null;
  }
}

function revalidateAwardedPaths(quoteId: string) {
  const paths = [
    "/customer",
    "/customer/quotes",
    `/customer/quotes/${quoteId}`,
    "/admin",
    "/admin/quotes",
    `/admin/quotes/${quoteId}`,
    "/supplier",
    "/supplier/quotes",
    `/supplier/quotes/${quoteId}`,
  ];

  paths.forEach((path) => {
    revalidatePath(path);
  });
}

function normalizeId(value?: string | null): string {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}

function normalizeEmail(value?: string | null): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function mapRpcErrorToReason(message?: string | null): AwardFailureReason {
  if (!message) {
    return "unknown";
  }
  const normalized = message.toLowerCase();
  if (normalized.includes("quote_already_awarded")) {
    return "winner_exists";
  }
  if (normalized.includes("quote_not_found")) {
    return "quote_not_found";
  }
  if (normalized.includes("bid_mismatch")) {
    return "bid_not_found";
  }
  if (normalized.includes("missing_supplier")) {
    return "missing_supplier";
  }
  return "write_failed";
}
