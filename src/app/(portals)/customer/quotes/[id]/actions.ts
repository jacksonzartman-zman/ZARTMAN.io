"use server";

import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabaseServer";
import { notifyOnNewQuoteMessage } from "@/server/quotes/notifications";
import { createQuoteMessage } from "@/server/quotes/messages";
import type { QuoteMessageFormState } from "@/app/(portals)/components/QuoteMessagesThread.types";
import { normalizeEmailInput } from "@/app/(portals)/quotes/pageUtils";
import {
  acceptSupplierBidForQuote,
  declineSupplierBid,
} from "@/server/suppliers";
import { createAuthClient, requireUser } from "@/server/auth";
import { getCustomerByUserId } from "@/server/customers";
import { getFormString, serializeActionError } from "@/lib/forms";
import {
  ensureQuoteProjectForWinner,
  upsertQuoteProject,
} from "@/server/quotes/projects";
import {
  performAwardFlow,
  type AwardFailureReason,
} from "@/server/quotes/award";
import { normalizeQuoteStatus } from "@/server/quotes/status";
import { transitionQuoteStatus } from "@/server/quotes/transitionQuoteStatus";

export type { QuoteMessageFormState } from "@/app/(portals)/components/QuoteMessagesThread.types";

export type CustomerProjectFormState = {
  ok: boolean;
  message?: string;
  error?: string;
  fieldErrors?: {
    poNumber?: string;
    targetShipDate?: string;
    notes?: string;
  };
};

export type BidDecisionActionState = {
  success: boolean;
  error: string | null;
};

export type AwardActionState = {
  ok: boolean;
  error?: string | null;
  message?: string | null;
  selectedBidId?: string | null;
};

export type QuoteStatusTransitionState =
  | { ok: true; message: string }
  | { ok: false; error: string };

const CUSTOMER_STATUS_TRANSITION_ERROR =
  "We couldn’t update this RFQ right now. Please try again.";

const CUSTOMER_AWARD_BID_ERROR =
  "We couldn’t verify that bid. Refresh and try again.";
const CUSTOMER_AWARD_ACCESS_ERROR =
  "We couldn’t confirm your access to this quote.";
const CUSTOMER_AWARD_STATUS_ERROR =
  "This quote isn’t ready to select a winner yet.";
const CUSTOMER_AWARD_ALREADY_WON_ERROR =
  "A winning supplier has already been selected for this quote.";
const CUSTOMER_AWARD_GENERIC_ERROR =
  "We couldn’t update the winner. Please try again.";
const CUSTOMER_AWARD_SUCCESS_MESSAGE = "Winning supplier selected.";

const CUSTOMER_MESSAGE_GENERIC_ERROR =
  "Unable to send your message right now. Please try again.";
const CUSTOMER_MESSAGE_EMPTY_ERROR = "Message can’t be empty.";
const CUSTOMER_MESSAGE_LENGTH_ERROR = "Message is too long. Try shortening or splitting it.";
const CUSTOMER_PROJECT_GENERIC_ERROR =
  "We couldn’t save your project details. Please retry.";
const CUSTOMER_PROJECT_SUCCESS_MESSAGE = "Project details saved.";
const CUSTOMER_PROJECT_PO_LENGTH_ERROR =
  "PO number must be 100 characters or fewer.";
const CUSTOMER_PROJECT_DATE_ERROR =
  "Enter a valid target ship date (YYYY-MM-DD).";
const CUSTOMER_PROJECT_NOTES_LENGTH_ERROR =
  "Project notes must be 2000 characters or fewer.";
const DATE_INPUT_REGEX = /^\d{4}-\d{2}-\d{2}$/;

type CustomerMessageQuoteRow = {
  id: string;
  customer_id: string | null;
};

type CustomerOwnedQuoteRow = {
  id: string;
  customer_id: string | null;
  customer_email: string | null;
};

export async function archiveCustomerQuoteAction(
  quoteId: string,
  _prev: QuoteStatusTransitionState,
  _formData: FormData,
): Promise<QuoteStatusTransitionState> {
  const normalizedQuoteId = normalizeId(quoteId);
  if (!normalizedQuoteId) {
    return { ok: false, error: "Missing quote reference." };
  }

  try {
    const user = await requireUser({
      redirectTo: `/customer/quotes/${normalizedQuoteId}`,
    });
    const customer = await getCustomerByUserId(user.id);
    if (!customer) {
      return {
        ok: false,
        error: "Complete your profile before updating this RFQ.",
      };
    }

    const result = await transitionQuoteStatus({
      quoteId: normalizedQuoteId,
      action: "archive",
      actorRole: "customer",
      actorUserId: user.id,
      customerId: customer.id,
      customerEmail: customer.email,
    });

    if (!result.ok) {
      if (result.reason !== "transition_denied" && result.reason !== "access_denied") {
        console.error("[customer quote status] archive failed", {
          quoteId: normalizedQuoteId,
          customerId: customer.id,
          reason: result.reason,
          error: result.error,
        });
      }
      return {
        ok: false,
        error:
          result.reason === "transition_denied" || result.reason === "access_denied"
            ? result.error
            : CUSTOMER_STATUS_TRANSITION_ERROR,
      };
    }

    revalidatePath("/customer/quotes");
    revalidatePath(`/customer/quotes/${normalizedQuoteId}`);
    revalidatePath("/admin/quotes");
    revalidatePath(`/admin/quotes/${normalizedQuoteId}`);
    revalidatePath("/supplier");
    revalidatePath(`/supplier/quotes/${normalizedQuoteId}`);

    return { ok: true, message: "RFQ archived." };
  } catch (error) {
    console.error("[customer quote status] archive crashed", {
      quoteId: normalizedQuoteId,
      error: serializeActionError(error),
    });
    return { ok: false, error: CUSTOMER_STATUS_TRANSITION_ERROR };
  }
}

export async function reopenCustomerQuoteAction(
  quoteId: string,
  _prev: QuoteStatusTransitionState,
  _formData: FormData,
): Promise<QuoteStatusTransitionState> {
  const normalizedQuoteId = normalizeId(quoteId);
  if (!normalizedQuoteId) {
    return { ok: false, error: "Missing quote reference." };
  }

  try {
    const user = await requireUser({
      redirectTo: `/customer/quotes/${normalizedQuoteId}`,
    });
    const customer = await getCustomerByUserId(user.id);
    if (!customer) {
      return {
        ok: false,
        error: "Complete your profile before updating this RFQ.",
      };
    }

    const result = await transitionQuoteStatus({
      quoteId: normalizedQuoteId,
      action: "reopen",
      actorRole: "customer",
      actorUserId: user.id,
      customerId: customer.id,
      customerEmail: customer.email,
    });

    if (!result.ok) {
      if (result.reason !== "transition_denied" && result.reason !== "access_denied") {
        console.error("[customer quote status] reopen failed", {
          quoteId: normalizedQuoteId,
          customerId: customer.id,
          reason: result.reason,
          error: result.error,
        });
      }
      return {
        ok: false,
        error:
          result.reason === "transition_denied" || result.reason === "access_denied"
            ? result.error
            : CUSTOMER_STATUS_TRANSITION_ERROR,
      };
    }

    revalidatePath("/customer/quotes");
    revalidatePath(`/customer/quotes/${normalizedQuoteId}`);
    revalidatePath("/admin/quotes");
    revalidatePath(`/admin/quotes/${normalizedQuoteId}`);
    revalidatePath("/supplier");
    revalidatePath(`/supplier/quotes/${normalizedQuoteId}`);

    return { ok: true, message: "RFQ reopened." };
  } catch (error) {
    console.error("[customer quote status] reopen crashed", {
      quoteId: normalizedQuoteId,
      error: serializeActionError(error),
    });
    return { ok: false, error: CUSTOMER_STATUS_TRANSITION_ERROR };
  }
}

export async function postQuoteMessage(
  quoteId: string,
  _prevState: QuoteMessageFormState,
  formData: FormData,
): Promise<QuoteMessageFormState> {
  const normalizedQuoteId = normalizeId(quoteId);
  const redirectPath = normalizedQuoteId
    ? `/customer/quotes/${normalizedQuoteId}`
    : "/customer/quotes";

  if (!normalizedQuoteId) {
    return { ok: false, error: "Missing quote reference." };
  }

  const bodyValue = formData.get("body");
  if (typeof bodyValue !== "string") {
    return {
      ok: false,
      error: CUSTOMER_MESSAGE_EMPTY_ERROR,
      fieldErrors: { body: CUSTOMER_MESSAGE_EMPTY_ERROR },
    };
  }

  const trimmedBody = bodyValue.trim();
  if (trimmedBody.length === 0) {
    return {
      ok: false,
      error: CUSTOMER_MESSAGE_EMPTY_ERROR,
      fieldErrors: { body: CUSTOMER_MESSAGE_EMPTY_ERROR },
    };
  }

  if (trimmedBody.length > 2000) {
    return {
      ok: false,
      error: CUSTOMER_MESSAGE_LENGTH_ERROR,
      fieldErrors: { body: CUSTOMER_MESSAGE_LENGTH_ERROR },
    };
  }

  try {
    const user = await requireUser({ redirectTo: redirectPath });
    const customer = await getCustomerByUserId(user.id);
    if (!customer) {
      return {
        ok: false,
        error: "Complete your profile before posting messages.",
      };
    }

    const { data: quoteRow, error: quoteError } = await supabaseServer
      .from("quotes")
      .select("id,customer_id")
      .eq("id", normalizedQuoteId)
      .maybeSingle<CustomerMessageQuoteRow>();

    if (quoteError) {
      console.error("[customer messages] quote lookup failed", {
        quoteId: normalizedQuoteId,
        error: serializeActionError(quoteError),
      });
      return {
        ok: false,
        error: "Quote not found.",
      };
    }

    if (!quoteRow) {
      console.warn("[customer messages] quote missing", {
        quoteId: normalizedQuoteId,
      });
      return { ok: false, error: "Quote not found." };
    }

    const normalizedQuoteCustomerId =
      typeof quoteRow.customer_id === "string" ? quoteRow.customer_id.trim() : "";
    if (!normalizedQuoteCustomerId || normalizedQuoteCustomerId !== customer.id) {
      console.warn("[customer messages] access denied", {
        quoteId: normalizedQuoteId,
        customerId: customer.id,
        userId: user.id,
      });
      return {
        ok: false,
        error: "You don't have access to this quote.",
      };
    }

    const senderName =
      customer.company_name ??
      customer.email ??
      user.email ??
      "Customer";
    const senderEmail =
      customer.email ?? user.email ?? normalizeEmailInput(customer.email) ?? "customer@zartman.io";

    const supabase = createAuthClient();
    const result = await createQuoteMessage({
      quoteId: normalizedQuoteId,
      senderId: user.id,
      senderRole: "customer",
      body: trimmedBody,
      senderName,
      senderEmail,
      supabase,
    });

    if (!result.ok || !result.message) {
      const log = result.reason === "unauthorized" ? console.warn : console.error;
      log("[customer messages] insert failed", {
        quoteId: normalizedQuoteId,
        customerId: customer.id,
        error: result.error ?? result.reason,
      });
      return {
        ok: false,
        error:
          result.reason === "unauthorized"
            ? "You don't have access to this quote."
            : CUSTOMER_MESSAGE_GENERIC_ERROR,
      };
    }

    revalidatePath(`/customer/quotes/${normalizedQuoteId}`);
    revalidatePath(`/admin/quotes/${normalizedQuoteId}`);
    revalidatePath(`/supplier/quotes/${normalizedQuoteId}`);

    void notifyOnNewQuoteMessage(result.message);

    console.log("[customer messages] insert success", {
      quoteId: normalizedQuoteId,
      customerId: customer.id,
      messageId: result.message.id,
    });

    return {
      ok: true,
      message: "Message sent.",
    };
  } catch (error) {
    console.error("[customer messages] insert crashed", {
      quoteId: normalizedQuoteId,
      error: serializeActionError(error),
    });
    return {
      ok: false,
      error: CUSTOMER_MESSAGE_GENERIC_ERROR,
    };
  }
}

export async function submitCustomerQuoteProjectAction(
  quoteId: string,
  _prev: CustomerProjectFormState,
  formData: FormData,
): Promise<CustomerProjectFormState> {
  let normalizedQuoteId = "";
  let customerId: string | null = null;

  try {
    normalizedQuoteId = typeof quoteId === "string" ? quoteId.trim() : "";
    const redirectPath = normalizedQuoteId
      ? `/customer/quotes/${normalizedQuoteId}`
      : "/customer/quotes";

    if (!normalizedQuoteId) {
      return { ok: false, error: "Missing quote reference." };
    }

    const user = await requireUser({ redirectTo: redirectPath });
    const customer = await getCustomerByUserId(user.id);

    if (!customer) {
      console.error("[customer projects] access denied (missing profile)", {
        quoteId: normalizedQuoteId,
        userId: user.id,
      });
      return {
        ok: false,
        error: "Complete your profile before updating project details.",
      };
    }

    customerId = customer.id;

    const { data: quoteRow, error: quoteError } = await supabaseServer
      .from("quotes")
      .select("id,customer_id,customer_email")
      .eq("id", normalizedQuoteId)
      .maybeSingle<CustomerOwnedQuoteRow>();

    if (quoteError) {
      console.error("[customer projects] quote lookup failed", {
        quoteId: normalizedQuoteId,
        customerId,
        error: serializeActionError(quoteError),
      });
      return { ok: false, error: CUSTOMER_PROJECT_GENERIC_ERROR };
    }

    if (!quoteRow) {
      return { ok: false, error: "Quote not found." };
    }

    const quoteCustomerId = typeof quoteRow.customer_id === "string" ? quoteRow.customer_id.trim() : "";
    const customerIdMatches = Boolean(customerId) && Boolean(quoteCustomerId) && customerId === quoteCustomerId;

    const normalizedQuoteCustomerEmail = normalizeEmailInput(quoteRow.customer_email ?? null);
    const customerEmail = normalizeEmailInput(customer.email);
    const customerEmailMatches =
      normalizedQuoteCustomerEmail !== null &&
      customerEmail !== null &&
      normalizedQuoteCustomerEmail === customerEmail;

    if (!customerIdMatches && !customerEmailMatches) {
      console.error("[customer projects] access denied", {
        quoteId: normalizedQuoteId,
        customerId,
        quoteCustomerId: quoteCustomerId || null,
        quoteCustomerEmail: quoteRow.customer_email,
        customerEmail,
      });
      return {
        ok: false,
        error: "You do not have access to update this project.",
      };
    }

    const poNumberValue = getFormString(formData, "poNumber");
    const poNumber =
      typeof poNumberValue === "string" && poNumberValue.trim().length > 0
        ? poNumberValue.trim()
        : null;

    if (poNumber && poNumber.length > 100) {
      return {
        ok: false,
        error: CUSTOMER_PROJECT_PO_LENGTH_ERROR,
        fieldErrors: { poNumber: CUSTOMER_PROJECT_PO_LENGTH_ERROR },
      };
    }

    const targetShipDateValue = getFormString(formData, "targetShipDate");
    const targetShipDate =
      typeof targetShipDateValue === "string" &&
      targetShipDateValue.trim().length > 0
        ? targetShipDateValue.trim()
        : null;

    if (targetShipDate && !DATE_INPUT_REGEX.test(targetShipDate)) {
      return {
        ok: false,
        error: CUSTOMER_PROJECT_DATE_ERROR,
        fieldErrors: { targetShipDate: CUSTOMER_PROJECT_DATE_ERROR },
      };
    }

    const notesValue = getFormString(formData, "notes");
    const notes =
      typeof notesValue === "string" && notesValue.trim().length > 0
        ? notesValue.trim()
        : null;

    if (notes && notes.length > 2000) {
      return {
        ok: false,
        error: CUSTOMER_PROJECT_NOTES_LENGTH_ERROR,
        fieldErrors: { notes: CUSTOMER_PROJECT_NOTES_LENGTH_ERROR },
      };
    }

    const result = await upsertQuoteProject({
      quoteId: normalizedQuoteId,
      poNumber,
      targetShipDate,
      notes,
    });

    if (!result.ok) {
      console.error("[customer projects] upsert failed", {
        quoteId: normalizedQuoteId,
        customerId,
        error: result.error,
      });
      return { ok: false, error: CUSTOMER_PROJECT_GENERIC_ERROR };
    }

    revalidatePath(`/customer/quotes/${normalizedQuoteId}`);
    revalidatePath(`/admin/quotes/${normalizedQuoteId}`);
    revalidatePath(`/supplier/quotes/${normalizedQuoteId}`);

    return {
      ok: true,
      message: CUSTOMER_PROJECT_SUCCESS_MESSAGE,
    };
  } catch (error) {
    console.error("[customer projects] upsert crashed", {
      quoteId: normalizedQuoteId || quoteId,
      customerId,
      error: serializeActionError(error),
    });
    return { ok: false, error: CUSTOMER_PROJECT_GENERIC_ERROR };
  }
}

export async function acceptSupplierBidAction(
  _prev: BidDecisionActionState,
  formData: FormData,
): Promise<BidDecisionActionState> {
  return handleBidDecision(formData, "accept");
}

export async function declineSupplierBidAction(
  _prev: BidDecisionActionState,
  formData: FormData,
): Promise<BidDecisionActionState> {
  return handleBidDecision(formData, "decline");
}

export async function awardQuoteToBidAction(
  _prev: AwardActionState,
  formData: FormData,
): Promise<AwardActionState> {
  const quoteId = normalizeId(getFormString(formData, "quoteId"));
  const bidId = normalizeId(getFormString(formData, "bidId"));

  if (!quoteId || !bidId) {
    console.warn("[customer award] missing identifiers", {
      quoteId,
      bidId,
    });
    return { ok: false, error: CUSTOMER_AWARD_BID_ERROR };
  }

  return awardCustomerBid(quoteId, bidId);
}

export async function awardCustomerBid(
  quoteId: string,
  bidId: string,
): Promise<AwardActionState> {
  try {
    const user = await requireUser({
      redirectTo: `/customer/quotes/${quoteId}`,
    });
    const customer = await getCustomerByUserId(user.id);

    if (!customer) {
      return {
        ok: false,
        error: CUSTOMER_AWARD_ACCESS_ERROR,
      };
    }

    const result = await performAwardFlow({
      quoteId,
      bidId,
      actorRole: "customer",
      actorUserId: user.id,
      actorEmail: user.email ?? null,
      customerId: customer.id,
      customerEmail: customer.email,
    });

    if (!result.ok) {
      const message = mapCustomerAwardError(result.reason);
      console.error("[customer award] failed", {
        quoteId,
        bidId,
        userId: user.id,
        customerId: customer.id,
        reason: result.reason,
        error: result.error,
      });
      return {
        ok: false,
        error: message ?? CUSTOMER_AWARD_GENERIC_ERROR,
      };
    }

    return {
      ok: true,
      selectedBidId: bidId,
      message: CUSTOMER_AWARD_SUCCESS_MESSAGE,
    };
  } catch (error) {
    console.error("[customer award] form state crashed", {
      quoteId,
      bidId,
      error: serializeActionError(error),
    });
    return { ok: false, error: CUSTOMER_AWARD_GENERIC_ERROR };
  }
}

async function handleBidDecision(formData: FormData, mode: "accept" | "decline") {
  const rawBidId = formData.get("bid_id");
  const rawQuoteId = formData.get("quote_id");

  if (typeof rawBidId !== "string" || rawBidId.trim().length === 0) {
    return { success: false, error: "Missing bid reference." };
  }

  if (typeof rawQuoteId !== "string" || rawQuoteId.trim().length === 0) {
    return { success: false, error: "Missing quote reference." };
  }

  const bidId = rawBidId.trim();
  const quoteId = rawQuoteId.trim();

  try {
    const user = await requireUser({ redirectTo: `/customer/quotes/${quoteId}` });
    const customer = await getCustomerByUserId(user.id);
    if (!customer) {
      return {
        success: false,
        error: "Complete your profile before managing bids.",
      };
    }

    const { data: quote, error } = await supabaseServer
      .from("quotes")
      .select("id,customer_id,customer_email")
      .eq("id", quoteId)
      .maybeSingle<CustomerOwnedQuoteRow>();

    if (error) {
      console.error("Bid decision action: quote lookup failed", {
        quoteId,
        error,
      });
    }

    if (!quote) {
      return { success: false, error: "Quote not found." };
    }

    const quoteCustomerId = typeof quote.customer_id === "string" ? quote.customer_id.trim() : "";
    const normalizedCustomerId = typeof customer.id === "string" ? customer.id.trim() : "";
    const customerIdMatches =
      Boolean(quoteCustomerId) && Boolean(normalizedCustomerId) && quoteCustomerId === normalizedCustomerId;

    const normalizedQuoteCustomerEmail = normalizeEmailInput(quote.customer_email ?? null);
    const customerEmail = normalizeEmailInput(customer.email);
    const customerEmailMatches =
      normalizedQuoteCustomerEmail !== null &&
      customerEmail !== null &&
      normalizedQuoteCustomerEmail === customerEmail;

    if (!customerIdMatches && !customerEmailMatches) {
      console.error("Bid decision action: access denied", {
        quoteId,
        customerId: customer.id,
        quoteCustomerId: quoteCustomerId || null,
        quoteCustomerEmail: quote.customer_email,
        mode,
      });
      return {
        success: false,
        error: "You do not have permission to update this bid.",
      };
    }

    if (mode === "accept") {
      const { accepted } = await acceptSupplierBidForQuote(bidId, quoteId);
      if (!accepted) {
        return {
          success: false,
          error: "Unable to accept this bid right now.",
        };
      }
    } else {
      const declined = await declineSupplierBid(bidId, quoteId);
      if (!declined) {
        return {
          success: false,
          error: "Unable to decline this bid right now.",
        };
      }
    }

    revalidatePath(`/customer/quotes/${quoteId}`);
    revalidatePath(`/supplier/quotes/${quoteId}`);
    revalidatePath(`/supplier`);
    revalidatePath(`/admin/quotes/${quoteId}`);

    return { success: true, error: null };
  } catch (error) {
    console.error("Bid decision action: unexpected error", {
      quoteId,
      bidId,
      mode,
      error,
    });
    return {
      success: false,
      error: "Unable to update the bid. Please try again.",
    };
  }
}

function normalizeId(value?: string | null): string {
  return typeof value === "string" ? value.trim() : "";
}

function mapCustomerAwardError(
  reason?: AwardFailureReason,
): string {
  switch (reason) {
    case "invalid_input":
    case "bid_not_found":
    case "bid_ineligible":
      return CUSTOMER_AWARD_BID_ERROR;
    case "access_denied":
      return CUSTOMER_AWARD_ACCESS_ERROR;
    case "status_not_allowed":
      return CUSTOMER_AWARD_STATUS_ERROR;
    case "winner_exists":
      return CUSTOMER_AWARD_ALREADY_WON_ERROR;
    default:
      return CUSTOMER_AWARD_GENERIC_ERROR;
  }
}
