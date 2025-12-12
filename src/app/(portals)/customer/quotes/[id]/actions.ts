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
import { requireUser } from "@/server/auth";
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
  email: string | null;
  status: string | null;
};

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
      .from("quotes_with_uploads")
      .select("id,email,status")
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

    const normalizedQuoteEmail = normalizeEmailInput(quoteRow.email ?? null);
    const normalizedCustomerEmail = normalizeEmailInput(customer.email);
    const normalizedUserEmail = normalizeEmailInput(user.email);

    const emailMatches =
      normalizedQuoteEmail !== null &&
      (normalizedCustomerEmail === normalizedQuoteEmail ||
        normalizedUserEmail === normalizedQuoteEmail);

    if (!emailMatches) {
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
      customer.email ??
      user.email ??
      normalizedQuoteEmail ??
      "customer@zartman.io";

    const result = await createQuoteMessage({
      quoteId: normalizedQuoteId,
      senderId: user.id,
      senderRole: "customer",
      body: trimmedBody,
      senderName,
      senderEmail,
    });

    if (!result.ok || !result.message) {
      console.error("[customer messages] insert failed", {
        quoteId: normalizedQuoteId,
        customerId: customer.id,
        error: result.error ?? result.reason,
      });
      return {
        ok: false,
        error: CUSTOMER_MESSAGE_GENERIC_ERROR,
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
      .from("quotes_with_uploads")
      .select("id,email")
      .eq("id", normalizedQuoteId)
      .maybeSingle<{ id: string; email: string | null }>();

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

    const normalizedQuoteEmail = normalizeEmailInput(quoteRow.email ?? null);
    const customerEmail = normalizeEmailInput(customer.email);
    const emailMatchesQuote =
      normalizedQuoteEmail !== null &&
      customerEmail !== null &&
      normalizedQuoteEmail === customerEmail;

    if (!emailMatchesQuote) {
      console.error("[customer projects] access denied", {
        quoteId: normalizedQuoteId,
        customerId,
        quoteEmail: quoteRow.email,
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

  try {
    const user = await requireUser({
      redirectTo: `/customer/quotes/${quoteId}`,
    });
    const customer = await getCustomerByUserId(user.id);
    const overrideEmail = normalizeEmailInput(
      getFormString(formData, "overrideEmail") ?? null,
    );

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
      overrideEmail,
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

    console.info("[customer award] success", {
      quoteId,
      bidId,
      userId: user.id,
      customerId: customer.id,
    });

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
      .from("quotes_with_uploads")
      .select("id,email")
      .eq("id", quoteId)
      .maybeSingle<{ id: string; email: string | null }>();

    if (error) {
      console.error("Bid decision action: quote lookup failed", {
        quoteId,
        error,
      });
    }

    if (!quote) {
      return { success: false, error: "Quote not found." };
    }

    const normalizedQuoteEmail = normalizeEmailInput(quote.email ?? null);
    const customerEmail = normalizeEmailInput(customer.email);
    const emailMatchesQuote =
      normalizedQuoteEmail !== null &&
      customerEmail !== null &&
      normalizedQuoteEmail === customerEmail;
    if (!emailMatchesQuote) {
      console.error("Bid decision action: access denied", {
        quoteId,
        customerId: customer.id,
        quoteEmail: quote.email,
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
