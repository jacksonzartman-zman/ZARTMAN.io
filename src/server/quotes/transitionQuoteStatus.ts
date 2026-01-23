import { supabaseServer } from "@/lib/supabaseServer";
import { emitQuoteEvent } from "@/server/quotes/events";
import { normalizeQuoteStatus, type QuoteStatus } from "@/server/quotes/status";
import { formatQuoteId } from "@/app/(portals)/quotes/pageUtils";
import {
  canTransitionQuoteStatus,
  normalizeTargetStatus,
  type QuoteStatusAction,
} from "@/server/quotes/statusTransitions";

export type TransitionQuoteStatusInput = {
  quoteId: string;
  action: QuoteStatusAction;
  actorRole: "admin" | "customer";
  actorUserId: string;
  customerId?: string | null;
  customerEmail?: string | null;
};

export type TransitionQuoteStatusResult =
  | { ok: true; fromStatus: QuoteStatus; toStatus: QuoteStatus }
  | { ok: false; reason: "invalid_input" | "not_found" | "access_denied" | "transition_denied" | "write_failed"; error: string };

type QuoteRow = {
  id: string;
  status: string | null;
  customer_id: string | null;
  customer_email: string | null;
  assigned_supplier_email: string | null;
  awarded_bid_id: string | null;
  awarded_supplier_id: string | null;
  awarded_at: string | null;
};

export async function transitionQuoteStatus(
  input: TransitionQuoteStatusInput,
): Promise<TransitionQuoteStatusResult> {
  const quoteId = normalizeId(input.quoteId);
  const actorUserId = normalizeId(input.actorUserId);
  const actorRole = (input.actorRole ?? "").toString().trim().toLowerCase();
  const isCustomer = actorRole === "customer";
  const entityLabel = isCustomer ? "search request" : "RFQ";
  const quoteRef = isCustomer && quoteId ? ` (Quote ID ${formatQuoteId(quoteId)})` : "";

  if (!quoteId || !actorUserId || (actorRole !== "admin" && actorRole !== "customer")) {
    return {
      ok: false,
      reason: "invalid_input",
      error: "Missing quote reference.",
    };
  }

  const action = input.action;
  const targetStatus = normalizeTargetStatus(action);

  try {
    const { data: quote, error: quoteError } = await supabaseServer()
      .from("quotes")
      .select(
        "id,status,customer_id,customer_email,assigned_supplier_email,awarded_bid_id,awarded_supplier_id,awarded_at",
      )
      .eq("id", quoteId)
      .maybeSingle<QuoteRow>();

    if (quoteError) {
      console.error("[quote status] lookup failed", {
        quoteId,
        actorRole,
        action,
        pg: {
          code: quoteError.code ?? null,
          message: quoteError.message ?? null,
        },
      });
      return {
        ok: false,
        reason: "write_failed",
        error: isCustomer
          ? `Unable to update this ${entityLabel} right now${quoteRef}. Refresh to try again.`
          : `Unable to update this ${entityLabel} right now.`,
      };
    }

    if (!quote) {
      return {
        ok: false,
        reason: "not_found",
        error: isCustomer
          ? `We couldn’t find that ${entityLabel}${quoteRef}. Double-check the link and try again.`
          : `${entityLabel} not found.`,
      };
    }

    const fromStatus = normalizeQuoteStatus(quote.status);

    if (actorRole === "customer") {
      const customerId = normalizeId(input.customerId ?? null);
      const customerEmail = normalizeEmail(input.customerEmail ?? null);
      const quoteCustomerId = normalizeId(quote.customer_id ?? null);
      const quoteCustomerEmail = normalizeEmail(quote.customer_email ?? null);

      const customerIdMatches = Boolean(customerId) && customerId === quoteCustomerId;
      const customerEmailMatches =
        Boolean(customerEmail) &&
        Boolean(quoteCustomerEmail) &&
        customerEmail === quoteCustomerEmail;

      if (!customerIdMatches && !customerEmailMatches) {
        console.warn("[quote status] access denied", {
          quoteId,
          actorRole,
          action,
          customerId: customerId || null,
          quoteCustomerId: quoteCustomerId || null,
          customerEmail: customerEmail || null,
          quoteCustomerEmail: quoteCustomerEmail || null,
        });
        return {
          ok: false,
          reason: "access_denied",
          error: `You do not have access to update this ${entityLabel}${quoteRef}.`,
        };
      }
    }

    if (!canTransitionQuoteStatus(fromStatus, targetStatus, actorRole)) {
      console.warn("[quote status] transition denied", {
        quoteId,
        actorRole,
        action,
        fromStatus,
        toStatus: targetStatus,
      });
      return {
        ok: false,
        reason: "transition_denied",
        error: `That action isn't available for this ${entityLabel}${quoteRef}.`,
      };
    }

    // Defense-in-depth: prevent any future code from moving a quote to "won"
    // without an award. The canonical path for "won" is the award flow.
    if (targetStatus === "won") {
      const hasAward =
        Boolean(normalizeId(quote.awarded_bid_id)) &&
        Boolean(normalizeId(quote.awarded_supplier_id)) &&
        Boolean(normalizeId(quote.awarded_at));
      if (!hasAward) {
        console.warn("[quote status] blocked transition to won without award", {
          quoteId,
          actorRole,
          action,
          fromStatus,
          toStatus: targetStatus,
          awardedBidId: quote.awarded_bid_id ?? null,
          awardedSupplierId: quote.awarded_supplier_id ?? null,
          awardedAt: quote.awarded_at ?? null,
        });
        return {
          ok: false,
          reason: "transition_denied",
          error:
            `This ${entityLabel} can’t be marked won until a winning supplier is awarded. Use the award action instead.`,
        };
      }
    }

    const { error: updateError } = await supabaseServer()
      .from("quotes")
      .update({
        status: targetStatus,
        updated_at: new Date().toISOString(),
      })
      .eq("id", quoteId);

    if (updateError) {
      console.error("[quote status] update failed", {
        quoteId,
        actorRole,
        action,
        fromStatus,
        toStatus: targetStatus,
        error: updateError,
      });
      return {
        ok: false,
        reason: "write_failed",
        error: isCustomer
          ? `Unable to update this ${entityLabel} right now${quoteRef}. Refresh to try again.`
          : `Unable to update this ${entityLabel} right now.`,
      };
    }

    const eventType = action === "archive" ? "quote_archived" : "quote_reopened";

    // Best-effort audit emission.
    void emitQuoteEvent({
      quoteId,
      eventType,
      actorRole: actorRole === "admin" ? "admin" : "customer",
      actorUserId,
      metadata: {
        fromStatus,
        toStatus: targetStatus,
      },
    });

    return { ok: true, fromStatus, toStatus: targetStatus };
  } catch (error) {
    console.error("[quote status] transition crashed", {
      quoteId,
      actorRole,
      action,
      error,
    });
    return {
      ok: false,
      reason: "write_failed",
      error: isCustomer
        ? `Unable to update this ${entityLabel} right now${quoteRef}. Refresh to try again.`
        : `Unable to update this ${entityLabel} right now.`,
    };
  }
}

function normalizeId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeEmail(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim().toLowerCase();
  if (!trimmed || !trimmed.includes("@")) return "";
  return trimmed;
}
