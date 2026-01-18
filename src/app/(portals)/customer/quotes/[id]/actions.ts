"use server";

import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabaseServer";
import { notifyOnNewQuoteMessage } from "@/server/quotes/notifications";
import { postQuoteMessage as postUnifiedQuoteMessage } from "@/server/messages/quoteMessages";
import { sendEmailToSupplierFromCustomer } from "@/server/quotes/emailPortalSend";
import { logOpsEvent } from "@/server/ops/events";
import type { QuoteMessageFormState } from "@/app/(portals)/components/QuoteMessagesThread.types";
import { normalizeEmailInput } from "@/app/(portals)/quotes/pageUtils";
import {
  acceptSupplierBidForQuote,
  declineSupplierBid,
} from "@/server/suppliers";
import { createAuthClient, getServerAuthUser } from "@/server/auth";
import { requireCustomerSessionOrRedirect } from "@/app/(portals)/customer/requireCustomerSessionOrRedirect";
import { getCustomerByUserId } from "@/server/customers";
import { getFormString, serializeActionError } from "@/lib/forms";
import { upsertQuoteProject } from "@/server/quotes/projects";
import { transitionQuoteStatus } from "@/server/quotes/transitionQuoteStatus";
import {
  customerCreateQuotePart,
  customerUpdateQuotePartFiles,
} from "@/server/customer/quoteParts";
import { customerAppendFilesToQuote } from "@/server/quotes/uploadFiles";
import { generateAiPartSuggestionsForQuote } from "@/server/quotes/aiPartsSuggestions";
import { MAX_UPLOAD_BYTES, formatMaxUploadSize } from "@/lib/uploads/uploadLimits";
import {
  buildUploadTargetForQuote,
  isAllowedQuoteUploadFileName,
  registerUploadedObjectsForQuote,
  type UploadTarget,
} from "@/server/quotes/uploadFiles";

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

export type SelectOfferActionState = {
  ok: boolean;
  error?: string | null;
  message?: string | null;
  selectedOfferId?: string | null;
};

export type ConfirmSelectionActionResult =
  | { ok: true; message: string }
  | { ok: false; error: string };

export type AwardBidAsCustomerResult =
  | { ok: true }
  | { ok: false; errorCode: string; message: string };

export type QuoteStatusTransitionState =
  | { ok: true; message: string }
  | { ok: false; error: string };

const CUSTOMER_STATUS_TRANSITION_ERROR =
  "We couldn’t update this RFQ right now. Please try again.";

const CUSTOMER_AWARD_BID_ERROR =
  "We couldn’t verify that bid. Refresh and try again.";
const CUSTOMER_AWARD_ACCESS_ERROR =
  "We couldn’t confirm your access to this quote.";
const CUSTOMER_AWARD_ALREADY_WON_ERROR =
  "A winning supplier has already been selected for this quote.";
const CUSTOMER_AWARD_GENERIC_ERROR =
  "We couldn’t update the winner. Please try again.";
const CUSTOMER_AWARD_SUCCESS_MESSAGE = "Winning supplier selected.";
const CUSTOMER_SELECT_OFFER_GENERIC_ERROR =
  "We couldn’t save your offer selection. Please try again.";
const CUSTOMER_SELECT_OFFER_ACCESS_ERROR =
  "We couldn’t confirm your access to this quote.";
const CUSTOMER_SELECT_OFFER_NOT_FOUND_ERROR =
  "That offer isn’t available for this RFQ.";
const CUSTOMER_SELECT_OFFER_SUCCESS_MESSAGE = "Offer selection saved.";
const CUSTOMER_CONFIRM_SELECTION_GENERIC_ERROR =
  "We couldn’t confirm your selection. Please try again.";
const CUSTOMER_CONFIRM_SELECTION_ACCESS_ERROR =
  "We couldn’t confirm your access to this quote.";
const CUSTOMER_CONFIRM_SELECTION_MISSING_OFFER_ERROR =
  "Select an offer before confirming.";
const CUSTOMER_CONFIRM_SELECTION_ALREADY_CONFIRMED_ERROR =
  "Selection is already confirmed for this quote.";
const CUSTOMER_CONFIRM_SELECTION_PO_LENGTH_ERROR =
  "PO number must be 100 characters or fewer.";
const CUSTOMER_CONFIRM_SELECTION_SHIP_TO_LENGTH_ERROR =
  "Ship-to details must be 2000 characters or fewer.";
const CUSTOMER_CONFIRM_SELECTION_INSPECTION_LENGTH_ERROR =
  "Inspection requirements must be 2000 characters or fewer.";

const CUSTOMER_MESSAGE_GENERIC_ERROR =
  "Unable to send your message right now. Please try again.";
const CUSTOMER_MESSAGE_EMPTY_ERROR = "Message can’t be empty.";
const CUSTOMER_MESSAGE_LENGTH_ERROR = "Message is too long. Try shortening or splitting it.";
const CUSTOMER_EMAIL_LENGTH_ERROR = "Email message is too long. Keep it under 5,000 characters.";
const CUSTOMER_EMAIL_DISABLED_ERROR = "Email not configured.";
const CUSTOMER_EMAIL_MISSING_RECIPIENT_ERROR = "Supplier email is missing for this quote.";
const CUSTOMER_EMAIL_SEND_FAILED_ERROR = "We couldn’t send that email right now. Please try again.";
const DEFAULT_MESSAGE_FORM_STATE: QuoteMessageFormState = {
  ok: true,
  message: null,
  error: null,
  fieldErrors: {},
};
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

type CustomerAwardQuoteRow = {
  id: string;
  customer_id: string | null;
};

type CustomerAwardBidRow = {
  id: string;
  quote_id: string;
  supplier_id: string | null;
};

type CustomerOfferQuoteRow = {
  id: string;
  customer_id: string | null;
  customer_email: string | null;
};

type CustomerOfferRow = {
  id: string;
  rfq_id: string | null;
  provider_id: string | null;
};

type CustomerSelectionConfirmQuoteRow = {
  id: string;
  customer_id: string | null;
  customer_email: string | null;
  selected_offer_id: string | null;
  selection_confirmed_at: string | null;
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
    const user = await requireCustomerSessionOrRedirect(`/customer/quotes/${normalizedQuoteId}`);
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
    const user = await requireCustomerSessionOrRedirect(`/customer/quotes/${normalizedQuoteId}`);
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

  const sendViaEmail = (() => {
    const v = formData.get("sendViaEmail");
    if (typeof v !== "string") return false;
    const normalized = v.trim().toLowerCase();
    return normalized === "1" || normalized === "true" || normalized === "on" || normalized === "yes";
  })();

  if (sendViaEmail) {
    if (trimmedBody.length > 5000) {
      return {
        ok: false,
        error: CUSTOMER_EMAIL_LENGTH_ERROR,
        fieldErrors: { body: CUSTOMER_EMAIL_LENGTH_ERROR },
      };
    }
  } else if (trimmedBody.length > 2000) {
    return {
      ok: false,
      error: CUSTOMER_MESSAGE_LENGTH_ERROR,
      fieldErrors: { body: CUSTOMER_MESSAGE_LENGTH_ERROR },
    };
  }

  try {
    const user = await requireCustomerSessionOrRedirect(redirectPath);
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

    if (sendViaEmail) {
      const attachmentFileIds = formData
        .getAll("attachmentFileIds")
        .map((v) => (typeof v === "string" ? v.trim() : ""))
        .filter(Boolean)
        .slice(0, 5);

      const emailResult = await sendEmailToSupplierFromCustomer({
        quoteId: normalizedQuoteId,
        customerId: customer.id,
        message: trimmedBody,
        attachmentFileIds: attachmentFileIds.length > 0 ? attachmentFileIds : undefined,
      });

      if (!emailResult.ok) {
        const message =
          emailResult.error === "missing_recipient"
            ? CUSTOMER_EMAIL_MISSING_RECIPIENT_ERROR
            : emailResult.error === "disabled" || emailResult.error === "unsupported"
              ? CUSTOMER_EMAIL_DISABLED_ERROR
              : CUSTOMER_EMAIL_SEND_FAILED_ERROR;
        return { ok: false, error: message, fieldErrors: {} };
      }

      revalidatePath(`/customer/quotes/${normalizedQuoteId}`);
      revalidatePath(`/admin/quotes/${normalizedQuoteId}`);
      revalidatePath(`/supplier/quotes/${normalizedQuoteId}`);

      return {
        ok: true,
        message:
          emailResult.attachmentsSent > 0
            ? `Email sent. (${emailResult.attachmentsSent} attachment${emailResult.attachmentsSent === 1 ? "" : "s"})`
            : "Email sent.",
      };
    }

    const result = await postUnifiedQuoteMessage({
      quoteId: normalizedQuoteId,
      message: trimmedBody,
      authorRole: "customer",
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

export async function postQuoteMessageSimple(
  quoteId: string,
  formData: FormData,
): Promise<QuoteMessageFormState> {
  return postQuoteMessage(quoteId, DEFAULT_MESSAGE_FORM_STATE, formData);
}

export async function postCustomerQuoteMessageAction(
  quoteId: string,
  formData: FormData,
): Promise<void> {
  await postQuoteMessage(quoteId, DEFAULT_MESSAGE_FORM_STATE, formData);
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

    const user = await requireCustomerSessionOrRedirect(redirectPath);
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

export async function selectOfferAction(
  _prev: SelectOfferActionState,
  formData: FormData,
): Promise<SelectOfferActionState> {
  const quoteId = normalizeId(getFormString(formData, "quoteId"));
  const offerId = normalizeId(getFormString(formData, "offerId"));

  if (!quoteId || !offerId) {
    return { ok: false, error: CUSTOMER_SELECT_OFFER_GENERIC_ERROR };
  }

  try {
    const user = await requireCustomerSessionOrRedirect(`/customer/quotes/${quoteId}`);
    const customer = await getCustomerByUserId(user.id);
    if (!customer) {
      return { ok: false, error: CUSTOMER_SELECT_OFFER_ACCESS_ERROR };
    }

    const { data: quoteRow, error: quoteError } = await supabaseServer
      .from("quotes")
      .select("id,customer_id,customer_email")
      .eq("id", quoteId)
      .maybeSingle<CustomerOfferQuoteRow>();

    if (quoteError) {
      console.error("[customer offer select] quote lookup failed", {
        quoteId,
        error: serializeActionError(quoteError),
      });
      return { ok: false, error: CUSTOMER_SELECT_OFFER_GENERIC_ERROR };
    }

    if (!quoteRow) {
      return { ok: false, error: "Quote not found." };
    }

    const quoteCustomerId = normalizeId(quoteRow.customer_id ?? null);
    const customerIdMatches =
      Boolean(quoteCustomerId) && quoteCustomerId === customer.id;
    const normalizedQuoteEmail = normalizeEmailInput(quoteRow.customer_email ?? null);
    const normalizedCustomerEmail = normalizeEmailInput(customer.email);
    const customerEmailMatches =
      Boolean(normalizedQuoteEmail) &&
      Boolean(normalizedCustomerEmail) &&
      normalizedQuoteEmail === normalizedCustomerEmail;

    if (!customerIdMatches && !customerEmailMatches) {
      console.warn("[customer offer select] access denied", {
        quoteId,
        userId: user.id,
        customerId: customer.id,
      });
      return { ok: false, error: CUSTOMER_SELECT_OFFER_ACCESS_ERROR };
    }

    const { data: offerRow, error: offerError } = await supabaseServer
      .from("rfq_offers")
      .select("id,rfq_id,provider_id")
      .eq("id", offerId)
      .maybeSingle<CustomerOfferRow>();

    if (offerError) {
      console.error("[customer offer select] offer lookup failed", {
        quoteId,
        offerId,
        error: serializeActionError(offerError),
      });
      return { ok: false, error: CUSTOMER_SELECT_OFFER_GENERIC_ERROR };
    }

    if (!offerRow || offerRow.rfq_id !== quoteId) {
      return { ok: false, error: CUSTOMER_SELECT_OFFER_NOT_FOUND_ERROR };
    }

    const providerId = normalizeId(offerRow.provider_id ?? null);
    if (!providerId) {
      return { ok: false, error: CUSTOMER_SELECT_OFFER_NOT_FOUND_ERROR };
    }

    const { error: updateError } = await supabaseServer
      .from("quotes")
      .update({
        selected_provider_id: providerId,
        selected_offer_id: offerId,
        selected_at: new Date().toISOString(),
      })
      .eq("id", quoteId);

    if (updateError) {
      console.error("[customer offer select] update failed", {
        quoteId,
        offerId,
        error: serializeActionError(updateError),
      });
      return { ok: false, error: CUSTOMER_SELECT_OFFER_GENERIC_ERROR };
    }

    await logOpsEvent({
      quoteId,
      eventType: "offer_selected",
      payload: {
        offer_id: offerId,
        provider_id: providerId,
      },
    });

    revalidatePath(`/customer/quotes/${quoteId}`);

    return {
      ok: true,
      selectedOfferId: offerId,
      message: CUSTOMER_SELECT_OFFER_SUCCESS_MESSAGE,
    };
  } catch (error) {
    console.error("[customer offer select] crashed", {
      quoteId,
      offerId,
      error: serializeActionError(error),
    });
    return { ok: false, error: CUSTOMER_SELECT_OFFER_GENERIC_ERROR };
  }
}

export async function confirmSelectionAction(args: {
  quoteId: string;
  poNumber?: string | null;
  shipTo?: string | null;
  inspectionRequirements?: string | null;
}): Promise<ConfirmSelectionActionResult> {
  const quoteId = normalizeId(args.quoteId);
  if (!quoteId) {
    return { ok: false, error: CUSTOMER_CONFIRM_SELECTION_GENERIC_ERROR };
  }

  const poNumber = normalizeOptionalText(args.poNumber);
  const shipTo = normalizeOptionalText(args.shipTo);
  const inspectionRequirements = normalizeOptionalText(args.inspectionRequirements);

  if (poNumber && poNumber.length > 100) {
    return { ok: false, error: CUSTOMER_CONFIRM_SELECTION_PO_LENGTH_ERROR };
  }
  if (shipTo && shipTo.length > 2000) {
    return { ok: false, error: CUSTOMER_CONFIRM_SELECTION_SHIP_TO_LENGTH_ERROR };
  }
  if (inspectionRequirements && inspectionRequirements.length > 2000) {
    return { ok: false, error: CUSTOMER_CONFIRM_SELECTION_INSPECTION_LENGTH_ERROR };
  }

  try {
    const user = await requireCustomerSessionOrRedirect(`/customer/quotes/${quoteId}`);
    const customer = await getCustomerByUserId(user.id);
    if (!customer) {
      return { ok: false, error: CUSTOMER_CONFIRM_SELECTION_ACCESS_ERROR };
    }

    const { data: quoteRow, error: quoteError } = await supabaseServer
      .from("quotes")
      .select("id,customer_id,customer_email,selected_offer_id,selection_confirmed_at")
      .eq("id", quoteId)
      .maybeSingle<CustomerSelectionConfirmQuoteRow>();

    if (quoteError) {
      console.error("[customer selection confirm] quote lookup failed", {
        quoteId,
        error: serializeActionError(quoteError),
      });
      return { ok: false, error: CUSTOMER_CONFIRM_SELECTION_GENERIC_ERROR };
    }

    if (!quoteRow) {
      return { ok: false, error: "Quote not found." };
    }

    const quoteCustomerId = normalizeId(quoteRow.customer_id ?? null);
    const customerIdMatches = Boolean(quoteCustomerId) && quoteCustomerId === customer.id;
    const normalizedQuoteEmail = normalizeEmailInput(quoteRow.customer_email ?? null);
    const normalizedCustomerEmail = normalizeEmailInput(customer.email);
    const customerEmailMatches =
      Boolean(normalizedQuoteEmail) &&
      Boolean(normalizedCustomerEmail) &&
      normalizedQuoteEmail === normalizedCustomerEmail;

    if (!customerIdMatches && !customerEmailMatches) {
      console.warn("[customer selection confirm] access denied", {
        quoteId,
        userId: user.id,
        customerId: customer.id,
      });
      return { ok: false, error: CUSTOMER_CONFIRM_SELECTION_ACCESS_ERROR };
    }

    const selectedOfferId = normalizeId(quoteRow.selected_offer_id ?? null);
    if (!selectedOfferId) {
      return { ok: false, error: CUSTOMER_CONFIRM_SELECTION_MISSING_OFFER_ERROR };
    }

    if (quoteRow.selection_confirmed_at) {
      return { ok: false, error: CUSTOMER_CONFIRM_SELECTION_ALREADY_CONFIRMED_ERROR };
    }

    const { error: updateError } = await supabaseServer
      .from("quotes")
      .update({
        po_number: poNumber,
        ship_to: shipTo,
        inspection_requirements: inspectionRequirements,
        selection_confirmed_at: new Date().toISOString(),
      })
      .eq("id", quoteId);

    if (updateError) {
      console.error("[customer selection confirm] update failed", {
        quoteId,
        error: serializeActionError(updateError),
      });
      return { ok: false, error: CUSTOMER_CONFIRM_SELECTION_GENERIC_ERROR };
    }

    revalidatePath(`/customer/quotes/${quoteId}`);

    return { ok: true, message: "Selection confirmed." };
  } catch (error) {
    console.error("[customer selection confirm] crashed", {
      quoteId,
      error: serializeActionError(error),
    });
    return { ok: false, error: CUSTOMER_CONFIRM_SELECTION_GENERIC_ERROR };
  }
}

export async function awardBidAsCustomerAction(
  quoteId: string,
  bidId: string,
): Promise<AwardBidAsCustomerResult> {
  const normalizedQuoteId = normalizeId(quoteId);
  const normalizedBidId = normalizeId(bidId);
  if (!normalizedQuoteId || !normalizedBidId) {
    return { ok: false, errorCode: "invalid_input", message: CUSTOMER_AWARD_BID_ERROR };
  }

  try {
    const user = await requireCustomerSessionOrRedirect(`/customer/quotes/${normalizedQuoteId}`);
    const customer = await getCustomerByUserId(user.id);
    if (!customer) {
      return { ok: false, errorCode: "access_denied", message: CUSTOMER_AWARD_ACCESS_ERROR };
    }

    // Strict ownership: awarding is only allowed when quotes.customer_id matches
    // the authenticated customer's profile.
    const { data: quoteRow, error: quoteError } = await supabaseServer
      .from("quotes")
      .select("id,customer_id")
      .eq("id", normalizedQuoteId)
      .maybeSingle<CustomerAwardQuoteRow>();

    if (quoteError) {
      console.error("[customer award] quote lookup failed", {
        quoteId: normalizedQuoteId,
        customerId: customer.id,
        error: serializeActionError(quoteError),
      });
      return { ok: false, errorCode: "quote_lookup_failed", message: CUSTOMER_AWARD_GENERIC_ERROR };
    }

    if (!quoteRow) {
      return { ok: false, errorCode: "quote_not_found", message: "Quote not found." };
    }

    const quoteCustomerId =
      typeof quoteRow.customer_id === "string" ? quoteRow.customer_id.trim() : "";
    if (!quoteCustomerId || quoteCustomerId !== customer.id) {
      console.warn("[customer award] access denied", {
        quoteId: normalizedQuoteId,
        userId: user.id,
        customerId: customer.id,
        quoteCustomerId: quoteCustomerId || null,
      });
      return { ok: false, errorCode: "access_denied", message: CUSTOMER_AWARD_ACCESS_ERROR };
    }

    const rpcResult = await supabaseServer.rpc("award_bid_for_quote", {
      p_quote_id: normalizedQuoteId,
      p_bid_id: normalizedBidId,
      p_actor_user_id: user.id,
      p_actor_role: "customer",
    });

    if (rpcResult.error) {
      const message = (rpcResult.error.message ?? "").toLowerCase();
      const errorCode =
        message.includes("quote_already_awarded")
          ? "already_awarded"
          : message.includes("quote_not_found")
            ? "quote_not_found"
            : message.includes("bid_mismatch")
              ? "bid_not_found"
              : message.includes("missing_supplier")
                ? "missing_supplier"
                : "write_failed";

      return {
        ok: false,
        errorCode,
        message:
          errorCode === "already_awarded"
            ? CUSTOMER_AWARD_ALREADY_WON_ERROR
            : CUSTOMER_AWARD_GENERIC_ERROR,
      };
    }

    // Best-effort: load bid -> supplier id so we can emit timeline + kickoff
    // via the canonical server finalization path.
    const { data: bidRow, error: bidError } = await supabaseServer
      .from("supplier_bids")
      .select("id,quote_id,supplier_id")
      .eq("id", normalizedBidId)
      .maybeSingle<CustomerAwardBidRow>();

    if (bidError) {
      console.error("[customer award] bid lookup failed after rpc", {
        quoteId: normalizedQuoteId,
        bidId: normalizedBidId,
        error: serializeActionError(bidError),
      });
    }

    const supplierId =
      bidRow && bidRow.quote_id === normalizedQuoteId && typeof bidRow.supplier_id === "string"
        ? bidRow.supplier_id.trim()
        : "";

    if (supplierId) {
      const { finalizeAwardAfterRpc } = await import("@/server/quotes/award");
      const finalized = await finalizeAwardAfterRpc({
        quoteId: normalizedQuoteId,
        bidId: normalizedBidId,
        winningSupplierId: supplierId,
        actorRole: "customer",
        actorUserId: user.id,
        revalidate: false,
      });

      if (!finalized.ok) {
        return { ok: false, errorCode: finalized.reason, message: finalized.error };
      }
    }

    revalidatePath(`/customer/quotes/${normalizedQuoteId}`);
    revalidatePath(`/admin/quotes/${normalizedQuoteId}`);
    // Supplier portal paths are not supplier-scoped; this is best-effort.
    revalidatePath(`/supplier/quotes/${normalizedQuoteId}`);
    if (!supplierId) {
      revalidatePath("/supplier/quotes");
    }

    return { ok: true };
  } catch (error) {
    console.error("[customer award] crashed", {
      quoteId: normalizedQuoteId,
      bidId: normalizedBidId,
      error: serializeActionError(error),
    });
    return { ok: false, errorCode: "unknown", message: CUSTOMER_AWARD_GENERIC_ERROR };
  }
}

export async function awardCustomerBid(
  quoteId: string,
  bidId: string,
): Promise<AwardActionState> {
  const normalizedQuoteId = normalizeId(quoteId);
  const normalizedBidId = normalizeId(bidId);
  const result = await awardBidAsCustomerAction(normalizedQuoteId, normalizedBidId);
  if (!result.ok) {
    return { ok: false, error: result.message };
  }
  return {
    ok: true,
    selectedBidId: normalizedBidId,
    message: CUSTOMER_AWARD_SUCCESS_MESSAGE,
  };
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
    const user = await requireCustomerSessionOrRedirect(`/customer/quotes/${quoteId}`);
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

function normalizeOptionalText(value?: string | null): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export type CustomerPartFormState = {
  status: "idle" | "success" | "error";
  message?: string;
};

export async function generateAiPartSuggestionsAction(
  quoteId: string,
  prevState: CustomerPartFormState,
  _formData: FormData,
): Promise<CustomerPartFormState> {
  const normalizedQuoteId = normalizeId(quoteId);
  if (!normalizedQuoteId) {
    return { status: "error", message: "Missing quote reference." };
  }

  const { user, error } = await getServerAuthUser({ quiet: true });
  if (error || !user) {
    return { status: "error", message: "You must be signed in to use AI suggestions." };
  }

  try {
    const result = await generateAiPartSuggestionsForQuote(normalizedQuoteId);
    if (result.modelVersion === "error") {
      return {
        status: "error",
        message:
          "Could not generate AI suggestions right now. You can still use manual grouping.",
      };
    }

    revalidatePath(`/customer/quotes/${normalizedQuoteId}`);
    return { status: "success", message: "AI suggestions updated." };
  } catch (e) {
    console.error("[customer parts] AI suggestions failed", e);
    return {
      status: "error",
      message: "Could not generate AI suggestions. You can still use manual grouping.",
    };
  }
}

export async function customerCreateQuotePartAction(
  quoteId: string,
  _prevState: CustomerPartFormState,
  formData: FormData,
): Promise<CustomerPartFormState> {
  const normalizedQuoteId = normalizeId(quoteId);
  if (!normalizedQuoteId) {
    return { status: "error", message: "Missing quote reference." };
  }

  const { user, error } = await getServerAuthUser({ quiet: true });
  if (error || !user) {
    return { status: "error", message: "You must be signed in to edit parts." };
  }

  const label = String(formData.get("label") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim() || null;

  if (!label) {
    return { status: "error", message: "Part name is required." };
  }

  try {
    await customerCreateQuotePart(
      normalizedQuoteId,
      { label, notes },
      { userId: user.id, email: user.email ?? null },
    );
    revalidatePath(`/customer/quotes/${normalizedQuoteId}`);
    return { status: "success", message: "Part added." };
  } catch (e) {
    console.error("[customer parts] create failed", e);
    return {
      status: "error",
      message: "Could not add part. Please try again.",
    };
  }
}

export async function customerUpdateQuotePartFilesAction(
  quoteId: string,
  _prevState: CustomerPartFormState,
  formData: FormData,
): Promise<CustomerPartFormState> {
  const normalizedQuoteId = normalizeId(quoteId);
  if (!normalizedQuoteId) {
    return { status: "error", message: "Missing quote reference." };
  }

  const { user, error } = await getServerAuthUser({ quiet: true });
  if (error || !user) {
    return { status: "error", message: "You must be signed in to edit parts." };
  }

  const quotePartId = String(formData.get("quotePartId") ?? "").trim();
  if (!quotePartId) {
    return { status: "error", message: "Missing part ID." };
  }

  // Expect form inputs like file-[id]=on for checked files
  const selectedFileIds = Array.from(formData.keys())
    .filter((k) => k.startsWith("file-"))
    .map((k) => k.replace("file-", ""))
    .map((id) => id.trim())
    .filter(Boolean);

  try {
    // Compute a diff server-side so customers can detach files too.
    const supabase = createAuthClient();
    const { data: existingRows, error: existingError } = await supabase
      .from("quote_part_files")
      .select("quote_upload_file_id")
      .eq("quote_part_id", quotePartId)
      .returns<Array<{ quote_upload_file_id: string }>>();

    const selected = new Set(selectedFileIds);
    const existing = new Set<string>();
    if (!existingError) {
      for (const row of existingRows ?? []) {
        const id = normalizeId(row?.quote_upload_file_id);
        if (id) existing.add(id);
      }
    } else {
      console.warn("[customer parts] existing links lookup failed; will only add", {
        quoteId: normalizedQuoteId,
        quotePartId,
        error: serializeActionError(existingError),
      });
    }

    const addFileIds: string[] = [];
    const removeFileIds: string[] = [];
    if (!existingError) {
      for (const id of selected) {
        if (!existing.has(id)) addFileIds.push(id);
      }
      for (const id of existing) {
        if (!selected.has(id)) removeFileIds.push(id);
      }
    } else {
      addFileIds.push(...selectedFileIds);
    }

    await customerUpdateQuotePartFiles({
      quoteId: normalizedQuoteId,
      quotePartId,
      addFileIds,
      removeFileIds,
    });

    revalidatePath(`/customer/quotes/${normalizedQuoteId}`);
    return { status: "success", message: "Part files updated." };
  } catch (e) {
    console.error("[customer parts] update files failed", e);
    return {
      status: "error",
      message: "Could not update part files. Please try again.",
    };
  }
}

export type CustomerUploadsFormState = {
  status: "idle" | "success" | "error";
  message?: string;
};

export type CustomerUploadTarget = {
  storagePath: string;
  bucketId: string;
  fileName: string;
  mimeType: string | null;
  sizeBytes: number;
};

type CustomerFileMeta = {
  fileName: string;
  sizeBytes: number;
  mimeType: string | null;
};

function parseCustomerFilesMeta(formData: FormData): CustomerFileMeta[] {
  const json = formData.get("filesMeta");
  if (typeof json !== "string" || json.trim().length === 0) {
    return [];
  }
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((row) => {
        if (!row || typeof row !== "object") return null;
        const fileName =
          "fileName" in row && typeof (row as any).fileName === "string"
            ? (row as any).fileName
            : "";
        const sizeBytes =
          "sizeBytes" in row && typeof (row as any).sizeBytes === "number"
            ? (row as any).sizeBytes
            : NaN;
        const mimeType =
          "mimeType" in row && typeof (row as any).mimeType === "string"
            ? ((row as any).mimeType as string)
            : null;
        const trimmed = fileName.trim();
        if (!trimmed) return null;
        if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) return null;
        return { fileName: trimmed, sizeBytes, mimeType };
      })
      .filter((v): v is CustomerFileMeta => Boolean(v));
  } catch {
    return [];
  }
}

export async function getUploadTargetsForCustomerQuote(
  quoteId: string,
  _prevState: CustomerUploadsFormState,
  formData: FormData,
): Promise<
  | { status: "success"; targets: CustomerUploadTarget[] }
  | CustomerUploadsFormState
> {
  const normalizedQuoteId = normalizeId(quoteId);
  if (!normalizedQuoteId) {
    return { status: "error", message: "Missing quote reference." };
  }

  const { user, error } = await getServerAuthUser({ quiet: true });
  if (error || !user) {
    return { status: "error", message: "You must be signed in to upload files." };
  }

  // Reuse the same access check as the existing customer upload pipeline.
  const supabase = createAuthClient();
  const customer = await getCustomerByUserId(user.id);
  if (!customer) {
    return { status: "error", message: "Complete your profile before uploading files." };
  }

  const { data: quoteRow, error: quoteError } = await supabase
    .from("quotes")
    .select("id,customer_id,customer_email")
    .eq("id", normalizedQuoteId)
    .maybeSingle<{ id: string; customer_id: string | null; customer_email: string | null }>();

  if (quoteError || !quoteRow?.id) {
    return { status: "error", message: "Quote not found." };
  }

  const quoteCustomerId = normalizeId(quoteRow.customer_id ?? null);
  const customerIdMatches = Boolean(quoteCustomerId && quoteCustomerId === customer.id);
  const quoteCustomerEmail = normalizeEmailInput(quoteRow.customer_email ?? null);
  const customerEmail = normalizeEmailInput(customer.email);
  const customerEmailMatches = Boolean(
    quoteCustomerEmail && customerEmail && quoteCustomerEmail === customerEmail,
  );
  if (!customerIdMatches && !customerEmailMatches) {
    return { status: "error", message: "You do not have access to this quote." };
  }

  const filesMeta = parseCustomerFilesMeta(formData);
  if (filesMeta.length === 0) {
    return { status: "error", message: "No files selected." };
  }

  const tooLarge = filesMeta.filter((f) => f.sizeBytes > MAX_UPLOAD_BYTES);
  if (tooLarge.length > 0) {
    return {
      status: "error",
      message: `Each file must be smaller than ${formatMaxUploadSize()}.`,
    };
  }

  const unsupported = filesMeta.filter((f) => !isAllowedQuoteUploadFileName(f.fileName));
  if (unsupported.length > 0) {
    return {
      status: "error",
      message: "One or more files are not a supported type.",
    };
  }

  const targets = filesMeta.map((file) =>
    buildUploadTargetForQuote({
      quoteId: normalizedQuoteId,
      fileName: file.fileName,
      sizeBytes: file.sizeBytes,
      mimeType: file.mimeType,
    }),
  );

  return {
    status: "success",
    targets: targets.map((t) => ({
      storagePath: t.storagePath,
      bucketId: t.bucketId,
      fileName: t.originalFileName,
      mimeType: t.mimeType,
      sizeBytes: t.sizeBytes,
    })),
  };
}

export async function registerUploadedFilesForCustomerQuote(
  quoteId: string,
  _prevState: CustomerUploadsFormState,
  formData: FormData,
): Promise<CustomerUploadsFormState> {
  const normalizedQuoteId = normalizeId(quoteId);
  if (!normalizedQuoteId) {
    return { status: "error", message: "Missing quote reference." };
  }

  const { user, error } = await getServerAuthUser({ quiet: true });
  if (error || !user) {
    return { status: "error", message: "You must be signed in to upload files." };
  }

  try {
    const json = formData.get("targets");
    if (typeof json !== "string" || json.trim().length === 0) {
      return { status: "error", message: "Missing upload targets." };
    }

    const parsed = JSON.parse(json) as CustomerUploadTarget[];
    const targets: UploadTarget[] = Array.isArray(parsed)
      ? parsed.map((t) => ({
          storagePath: t.storagePath,
          bucketId: t.bucketId,
          originalFileName: t.fileName,
          mimeType: t.mimeType,
          sizeBytes: t.sizeBytes,
        }))
      : [];

    if (targets.length === 0) {
      return { status: "error", message: "Missing upload targets." };
    }

    await registerUploadedObjectsForQuote({
      quoteId: normalizedQuoteId,
      targets,
    });

    revalidatePath(`/customer/quotes/${normalizedQuoteId}`);
    revalidatePath(`/admin/quotes/${normalizedQuoteId}`);
    revalidatePath(`/supplier/quotes/${normalizedQuoteId}`);
    return { status: "success", message: "Files uploaded." };
  } catch (e) {
    console.error("[customer uploads] registerUploadedFilesForCustomerQuote failed", e);
    return {
      status: "error",
      message: "We could not register these files. Please try again.",
    };
  }
}

export async function customerUploadQuoteFilesAction(
  quoteId: string,
  _prevState: CustomerUploadsFormState,
  formData: FormData,
): Promise<CustomerUploadsFormState> {
  const normalizedQuoteId = normalizeId(quoteId);
  if (!normalizedQuoteId) {
    return { status: "error", message: "Missing quote reference." };
  }

  const { user, error } = await getServerAuthUser({ quiet: true });
  if (error || !user) {
    return { status: "error", message: "You must be signed in to upload files." };
  }

  const files = formData.getAll("files").filter(
    (v): v is File => v instanceof File && v.size > 0,
  );

  if (files.length === 0) {
    return { status: "error", message: "Please choose at least one file to upload." };
  }

  const tooLarge = files.filter((f) => f.size > MAX_UPLOAD_BYTES);
  if (tooLarge.length > 0) {
    return {
      status: "error",
      message: `Each file must be smaller than ${formatMaxUploadSize()}. Try splitting large ZIPs or compressing drawings.`,
    };
  }

  try {
    await customerAppendFilesToQuote({
      quoteId: normalizedQuoteId,
      files,
      customerUserId: user.id,
      customerEmail: user.email ?? null,
    });

    revalidatePath(`/customer/quotes/${normalizedQuoteId}`);
    revalidatePath(`/admin/quotes/${normalizedQuoteId}`);
    revalidatePath(`/supplier/quotes/${normalizedQuoteId}`);
    return { status: "success", message: "Files uploaded." };
  } catch (e) {
    console.error("[customer uploads] append files failed", e);
    return {
      status: "error",
      message: "Could not upload files. Please try again.",
    };
  }
}
