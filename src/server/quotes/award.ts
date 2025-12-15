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
import { loadSupplierById } from "@/server/suppliers/profile";
import { emitQuoteEvent } from "@/server/quotes/events";
import { ensureKickoffTasksForQuote } from "@/server/quotes/kickoffTasks";

const CUSTOMER_AWARD_ALLOWED_STATUSES = new Set([
  "submitted",
  "in_review",
  "quoted",
  "approved",
]);

const WIN_STATUS_VALUES = ["won", "winner", "accepted", "approved"];
const BID_INELIGIBLE_STATUSES = new Set(["lost", "declined", "withdrawn"]);

export type AwardActorRole = "customer" | "admin";

let hasLoggedAwardRpcLegacyFallback = false;

export type AwardFailureReason =
  | "invalid_input"
  | "quote_lookup_failed"
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
  customer_email: string | null;
  assigned_supplier_email: string | null;
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

  const quoteLookup = await loadQuoteForAward(quoteId);
  if (quoteLookup.error) {
    console.warn("[award] validation failed", {
      ...logContext,
      reason: "quote_lookup_failed",
    });
    return {
      ok: false,
      reason: "quote_lookup_failed",
      error: "Quote not found.",
    };
  }

  const quote = quoteLookup.quote;
  if (!quote) {
    console.warn("[award] validation failed", {
      ...logContext,
      reason: "quote_not_found",
    });
    return { ok: false, reason: "quote_not_found", error: "Quote not found." };
  }

  // Defensive invariant: older databases may have quotes marked as won without
  // having quotes.awarded_* populated (legacy award RPC). We only attempt a
  // best-effort backfill after validating the actor can access this quote.
  const normalizedQuoteStatus = normalizeQuoteStatus(quote.status ?? undefined);

  // Idempotency: awarding the same bid twice should be a no-op success.
  if (quote.awarded_bid_id && quote.awarded_bid_id === bidId) {
    // Backfill audit fields if the award was written by an older RPC signature.
    try {
      await ensureAwardAuditFields({
        quoteId,
        actorUserId,
        actorRole,
      });
    } catch (error) {
      console.warn("[award] audit backfill failed (no-op award)", {
        ...logContext,
        error: serializeActionError(error),
      });
    }

    // If the quote is already awarded, kickoff tasks should already exist, but
    // we keep this safe and idempotent in case a previous run crashed mid-flow.
    try {
      await ensureKickoffTasksForQuote(quoteId, {
        actorRole,
        actorUserId,
      });
    } catch (error) {
      console.warn("[award] kickoff ensure failed (no-op award)", {
        ...logContext,
        error: serializeActionError(error),
      });
    }
    return {
      ok: true,
      awardedBidId: bidId,
      awardedSupplierId: quote.awarded_supplier_id ?? null,
      awardedAt: quote.awarded_at ?? null,
    };
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
      return {
        ok: false,
        reason: allowed.reason ?? "access_denied",
        error: allowed.message ?? "You don't have access to this quote.",
      };
    }

    if (!isCustomerAwardStatusAllowed(normalizedQuoteStatus)) {
      console.warn("[award] validation failed", {
        ...logContext,
        reason: "status_not_allowed",
        status: normalizedQuoteStatus,
      });
      return {
        ok: false,
        reason: "status_not_allowed",
        error: "This quote isn’t ready to select a winner yet.",
      };
    }
  }

  if (
    normalizedQuoteStatus &&
    WIN_STATUS_VALUES.includes(normalizedQuoteStatus) &&
    hasMissingAwardFields(quote)
  ) {
    console.warn("[award] invariant violated; quote is won but missing awarded_* fields", {
      ...logContext,
      status: normalizedQuoteStatus,
      awardedBidId: quote.awarded_bid_id ?? null,
      awardedSupplierId: quote.awarded_supplier_id ?? null,
      awardedAt: quote.awarded_at ?? null,
    });

    try {
      const backfilled = await backfillAwardFieldsFromBid({
        quoteId,
        bidId,
        actorRole,
        actorUserId,
        logContext,
      });

      if (backfilled?.awarded_bid_id && backfilled.awarded_bid_id === bidId) {
        try {
          await ensureAwardAuditFields({
            quoteId,
            actorUserId,
            actorRole,
          });
        } catch (error) {
          console.warn("[award] audit backfill failed (invariant backfill)", {
            ...logContext,
            error: serializeActionError(error),
          });
        }

        return {
          ok: true,
          awardedBidId: backfilled.awarded_bid_id ?? bidId,
          awardedSupplierId: backfilled.awarded_supplier_id ?? null,
          awardedAt: backfilled.awarded_at ?? null,
        };
      }
    } catch (error) {
      console.warn("[award] invariant backfill attempt failed", {
        ...logContext,
        error: serializeActionError(error),
      });
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

  // Prefer the new RPC signature (with actor params) but safely fall back to the
  // legacy signature on production databases that haven't been migrated yet.
  let usedLegacyRpcSignature = false;
  let rpcResult = await supabaseServer.rpc("award_bid_for_quote", {
    p_quote_id: quoteId,
    p_bid_id: bidId,
    p_actor_user_id: actorUserId,
    p_actor_role: actorRole,
  });

  if (rpcResult.error && isAwardRpcSignatureMismatch(rpcResult.error)) {
    if (!hasLoggedAwardRpcLegacyFallback) {
      hasLoggedAwardRpcLegacyFallback = true;
      console.info("[award] rpc signature mismatch; falling back to legacy signature", {
        ...logContext,
        code: (rpcResult.error as { code?: string | null })?.code ?? null,
        message: (rpcResult.error as { message?: string | null })?.message ?? null,
      });
    }

    usedLegacyRpcSignature = true;
    rpcResult = await supabaseServer.rpc("award_bid_for_quote", {
      // Legacy signature expects only these named params.
      p_bid_id: bidId,
      p_quote_id: quoteId,
    });
  }

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

  // Ensure audit fields are set even if the legacy RPC signature was used.
  try {
    await ensureAwardAuditFields({
      quoteId,
      actorUserId,
      actorRole,
    });
  } catch (error) {
    console.warn("[award] audit backfill failed", {
      ...logContext,
      error: serializeActionError(error),
    });
  }

  if (usedLegacyRpcSignature) {
    try {
      await backfillAwardFieldsFromBid({
        quoteId,
        bidId,
        actorRole,
        actorUserId,
        logContext,
      });
    } catch (error) {
      console.warn("[award] award fields backfill failed after legacy rpc", {
        ...logContext,
        error: serializeActionError(error),
      });
    }
  }

  // Defense-in-depth: even if the RPC returns success, ensure the quote is
  // "won" and has awarded_* fields populated (idempotent; does not overwrite an
  // existing award). This protects against legacy/overridden DB functions.
  const finalized = await ensureQuoteWonAndAwarded({
    quoteId,
    bidId,
    winningSupplierId,
    actorRole,
    actorUserId,
    logContext,
  });
  if (!finalized) {
    console.error("[award] finalization failed; refusing to proceed with downstream kickoff", {
      ...logContext,
      reason: "write_failed",
    });
    return {
      ok: false,
      reason: "write_failed",
      error: "We couldn't finalize the award state. Please try again.",
    };
  }

  const awardedSnapshot = await loadQuoteAwardSnapshot(quoteId);
  const awardedAt =
    awardedSnapshot?.awarded_at ??
    quote.awarded_at ??
    new Date().toISOString();

  const supplier = await loadSupplierById(winningSupplierId);
  void emitQuoteEvent({
    quoteId,
    eventType: "awarded",
    actorRole,
    actorUserId,
    metadata: {
      bid_id: bidId,
      supplier_id: winningSupplierId,
      supplier_name: supplier?.company_name ?? supplier?.primary_email ?? null,
      awarded_by_role: actorRole,
    },
    createdAt: awardedAt,
  });

  // Auto-start supplier kickoff checklist immediately on award (idempotent).
  // Best-effort: kickoff initialization should not block a successful award.
  try {
    await ensureKickoffTasksForQuote(quoteId, {
      actorRole,
      actorUserId,
    });
  } catch (error) {
    console.warn("[award] kickoff ensure failed", {
      ...logContext,
      error: serializeActionError(error),
    });
  }

  await ensureQuoteProjectForWinner({
    quoteId,
    winningSupplierId,
  });

  revalidateAwardedPaths(quoteId);
  void dispatchWinnerNotification({
    quoteId,
    bidId,
    caller: actorRole,
    actorUserId,
  });

  return {
    ok: true,
    awardedBidId: bidId,
    awardedSupplierId: winningSupplierId,
    awardedAt,
  };
}

async function loadQuoteForAward(
  quoteId: string,
): Promise<{ quote: QuoteAwardRow | null; error: unknown | null }> {
  try {
    const { data, error } = await supabaseServer
      .from("quotes")
      .select(
        "id,status,customer_email,assigned_supplier_email,customer_id,awarded_bid_id,awarded_supplier_id,awarded_at,awarded_by_user_id,awarded_by_role",
      )
      .eq("id", quoteId)
      .maybeSingle<QuoteAwardRow>();

    if (error) {
      console.error("[award] quote lookup failed", {
        quoteId,
        pgCode: (error as { code?: string | null })?.code ?? null,
        message: (error as { message?: string | null })?.message ?? null,
        error: serializeActionError(error),
      });
      return { quote: null, error };
    }

    return { quote: data ?? null, error: null };
  } catch (error) {
    console.error("[award] quote lookup crashed", {
      quoteId,
      error: serializeActionError(error),
    });
    return { quote: null, error };
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
    console.warn("[customer award] validation failed", {
      quoteId: quote.id ?? null,
      actorUserId: actorUserId || null,
      actorRole: "customer",
      resolvedCustomerId: null,
      quoteCustomerId: quote.customer_id ?? null,
      quoteCustomerEmail: quote.customer_email ?? null,
      sessionEmail: actorEmail ?? null,
      reason: "access_denied",
    });
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

  const normalizedQuoteEmail = normalizeEmail(quote.customer_email);
  const emailCandidates = [
    normalizeEmail(resolvedCustomer.email),
    normalizeEmail(actorEmail),
    normalizeEmail(overrideEmail),
  ].filter((value): value is string => Boolean(value));

  const emailMatches =
    Boolean(normalizedQuoteEmail) &&
    emailCandidates.some((candidate) => candidate === normalizedQuoteEmail);

  if (!quoteCustomerMatches && !emailMatches) {
    console.warn("[customer award] validation failed", {
      quoteId: quote.id ?? null,
      actorUserId: actorUserId || null,
      actorRole: "customer",
      resolvedCustomerId: resolvedCustomer.id ?? null,
      quoteCustomerId: quote.customer_id ?? null,
      quoteCustomerEmail: quote.customer_email ?? null,
      sessionEmail: actorEmail ?? null,
      reason: "access_denied",
    });
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

type QuoteAwardStateSnapshot = Pick<
  QuoteAwardRow,
  "status" | "awarded_bid_id" | "awarded_supplier_id" | "awarded_at"
>;

async function loadQuoteAwardStateSnapshot(
  quoteId: string,
): Promise<QuoteAwardStateSnapshot | null> {
  try {
    const { data, error } = await supabaseServer
      .from("quotes")
      .select("status,awarded_bid_id,awarded_supplier_id,awarded_at")
      .eq("id", quoteId)
      .maybeSingle<QuoteAwardStateSnapshot>();

    if (error) {
      console.error("[award] state snapshot lookup failed", {
        quoteId,
        error: serializeActionError(error),
      });
      return null;
    }
    return data ?? null;
  } catch (error) {
    console.error("[award] state snapshot lookup crashed", {
      quoteId,
      error: serializeActionError(error),
    });
    return null;
  }
}

function hasCompleteAward(snapshot: QuoteAwardStateSnapshot | null): boolean {
  if (!snapshot) return false;
  return (
    Boolean(normalizeId(snapshot.awarded_bid_id)) &&
    Boolean(normalizeId(snapshot.awarded_supplier_id)) &&
    Boolean(normalizeId(snapshot.awarded_at))
  );
}

async function ensureQuoteWonAndAwarded({
  quoteId,
  bidId,
  winningSupplierId,
  actorRole,
  actorUserId,
  logContext,
}: {
  quoteId: string;
  bidId: string;
  winningSupplierId: string;
  actorRole: AwardActorRole;
  actorUserId: string;
  logContext: Record<string, unknown>;
}): Promise<boolean> {
  const before = await loadQuoteAwardStateSnapshot(quoteId);
  if (!before) {
    return false;
  }

  const existingAwardedBidId = normalizeId(before.awarded_bid_id);
  if (existingAwardedBidId && existingAwardedBidId !== bidId) {
    console.warn("[award] finalization aborted; quote already awarded to different bid", {
      ...logContext,
      existingAwardedBidId,
    });
    return false;
  }

  if (!hasCompleteAward(before)) {
    try {
      const backfilled = await backfillAwardFieldsFromBid({
        quoteId,
        bidId,
        actorRole,
        actorUserId,
        logContext,
      });
      if (!backfilled || !normalizeId(backfilled.awarded_bid_id)) {
        return false;
      }
    } catch (error) {
      console.warn("[award] finalization backfill failed", {
        ...logContext,
        error: serializeActionError(error),
      });
      return false;
    }
  }

  const after = await loadQuoteAwardStateSnapshot(quoteId);
  if (!hasCompleteAward(after)) {
    console.warn("[award] finalization failed; missing award fields after backfill", {
      ...logContext,
      awardedBidId: after?.awarded_bid_id ?? null,
      awardedSupplierId: after?.awarded_supplier_id ?? null,
      awardedAt: after?.awarded_at ?? null,
    });
    return false;
  }

  const normalizedStatus = normalizeQuoteStatus(after?.status ?? undefined);
  if (normalizedStatus !== "won") {
    const { error } = await supabaseServer
      .from("quotes")
      .update({
        status: "won",
        updated_at: new Date().toISOString(),
      })
      .eq("id", quoteId);

    if (error) {
      console.warn("[award] finalization failed; unable to set quote to won", {
        ...logContext,
        error: serializeActionError(error),
      });
      return false;
    }
  }

  // Sanity check: ensure the awarded supplier matches the selected bid.
  if (normalizeId(after?.awarded_supplier_id) !== winningSupplierId) {
    console.warn("[award] finalization warning; awarded supplier mismatch", {
      ...logContext,
      winningSupplierId,
      awardedSupplierId: after?.awarded_supplier_id ?? null,
    });
    return false;
  }

  return true;
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

function isAwardRpcSignatureMismatch(error: unknown): boolean {
  const code = (error as { code?: string | null })?.code ?? null;
  if (code === "PGRST202") {
    return true;
  }

  const message = (error as { message?: string | null })?.message ?? "";
  return (
    typeof message === "string" &&
    message.includes("Could not find function public.award_bid_for_quote(")
  );
}

function hasMissingAwardFields(quote: QuoteAwardRow): boolean {
  return (
    !normalizeId(quote.awarded_bid_id) ||
    !normalizeId(quote.awarded_supplier_id) ||
    !normalizeId(quote.awarded_at)
  );
}

async function backfillAwardFieldsFromBid({
  quoteId,
  bidId,
  actorRole,
  actorUserId,
  logContext,
}: {
  quoteId: string;
  bidId: string;
  actorRole: AwardActorRole;
  actorUserId: string;
  logContext: Record<string, unknown>;
}): Promise<Pick<QuoteAwardRow, "awarded_bid_id" | "awarded_supplier_id" | "awarded_at"> | null> {
  const bid = await loadBidForAward(bidId);
  if (!bid || bid.quote_id !== quoteId) {
    console.warn("[award] award backfill skipped; bid mismatch", {
      ...logContext,
      bidQuoteId: bid?.quote_id ?? null,
    });
    return null;
  }

  const supplierId = normalizeId(bid.supplier_id);
  if (!supplierId) {
    console.warn("[award] award backfill skipped; missing supplier id on bid", {
      ...logContext,
    });
    return null;
  }

  const { data: quoteSnapshot, error: snapshotError } = await supabaseServer
    .from("quotes")
    .select("awarded_bid_id,awarded_supplier_id,awarded_at")
    .eq("id", quoteId)
    .maybeSingle<Pick<QuoteAwardRow, "awarded_bid_id" | "awarded_supplier_id" | "awarded_at">>();

  if (snapshotError) {
    console.warn("[award] award backfill snapshot failed", {
      ...logContext,
      error: serializeActionError(snapshotError),
    });
    return null;
  }

  const existing = quoteSnapshot ?? null;
  const existingBidId = normalizeId(existing?.awarded_bid_id ?? null);
  const existingSupplierId = normalizeId(existing?.awarded_supplier_id ?? null);
  const existingAwardedAt = normalizeId(existing?.awarded_at ?? null);

  if (existingBidId && existingBidId !== bidId) {
    console.warn("[award] award backfill aborted; quote already has different awarded_bid_id", {
      ...logContext,
      existingBidId,
    });
    return existing;
  }

  if (existingSupplierId && existingSupplierId !== supplierId) {
    console.warn("[award] award backfill aborted; quote already has different awarded_supplier_id", {
      ...logContext,
      existingSupplierId,
      supplierId,
    });
    return existing;
  }

  const targetBidId = existingBidId || bidId;
  const targetSupplierId = existingSupplierId || supplierId;
  const targetAwardedAt = existingAwardedAt || new Date().toISOString();

  const needsUpdate = !existingBidId || !existingSupplierId || !existingAwardedAt;
  if (!needsUpdate) {
    return existing;
  }

  // Keep award integrity trigger compatible: write all awarded_* together, even
  // when only one field is missing.
  const { data: updated, error: updateError } = await supabaseServer
    .from("quotes")
    .update({
      awarded_bid_id: targetBidId,
      awarded_supplier_id: targetSupplierId,
      awarded_at: targetAwardedAt,
    })
    .eq("id", quoteId)
    .select("awarded_bid_id,awarded_supplier_id,awarded_at")
    .maybeSingle<Pick<QuoteAwardRow, "awarded_bid_id" | "awarded_supplier_id" | "awarded_at">>();

  if (updateError) {
    console.warn("[award] award backfill update failed", {
      ...logContext,
      actorRole,
      actorUserId,
      error: serializeActionError(updateError),
    });
    return null;
  }

  return updated ?? null;
}

async function ensureAwardAuditFields({
  quoteId,
  actorUserId,
  actorRole,
}: {
  quoteId: string;
  actorUserId: string;
  actorRole: AwardActorRole;
}): Promise<void> {
  const { data, error } = await supabaseServer
    .from("quotes")
    .select("awarded_by_user_id,awarded_by_role")
    .eq("id", quoteId)
    .maybeSingle<Pick<QuoteAwardRow, "awarded_by_user_id" | "awarded_by_role">>();

  if (error) {
    throw error;
  }

  const update: Partial<Pick<QuoteAwardRow, "awarded_by_user_id" | "awarded_by_role">> =
    {};
  if (!normalizeId(data?.awarded_by_user_id ?? null)) {
    update.awarded_by_user_id = actorUserId;
  }
  if (!normalizeId(data?.awarded_by_role ?? null)) {
    update.awarded_by_role = actorRole;
  }

  if (Object.keys(update).length === 0) {
    return;
  }

  const updateResult = await supabaseServer
    .from("quotes")
    .update(update)
    .eq("id", quoteId);

  if (updateResult.error) {
    throw updateResult.error;
  }
}
