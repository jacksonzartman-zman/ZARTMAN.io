"use server";

import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabaseServer";
import {
  notifyOnNewQuoteMessage,
  notifyOnWinningBidSelected,
  type QuoteContactInfo,
  type QuoteWinningContext,
} from "@/server/quotes/notifications";
import { createQuoteMessage } from "@/server/quotes/messages";
import { normalizeEmailInput } from "@/app/(portals)/quotes/pageUtils";
import {
  acceptSupplierBidForQuote,
  declineSupplierBid,
} from "@/server/suppliers";
import { requireUser } from "@/server/auth";
import { getCustomerByUserId } from "@/server/customers";
import { markWinningBidForQuote } from "@/server/bids";
import { loadWinningBidNotificationContext } from "@/server/quotes/notificationContext";
import { getFormString, serializeActionError } from "@/lib/forms";
import { upsertQuoteProject } from "@/server/quotes/projects";

export type CustomerMessageFormState = {
  ok: boolean;
  error?: string;
  message?: string;
  fieldErrors?: {
    body?: string;
  };
};

export type CustomerProjectFormState = {
  ok: boolean;
  message?: string;
  error?: string;
  fieldErrors?: {
    poNumber?: string;
    targetShipDate?: string;
  };
};

export type BidDecisionActionState = {
  success: boolean;
  error: string | null;
};

export type CustomerSelectWinningBidState =
  | { ok: true; message: string }
  | { ok: false; error: string };

const CUSTOMER_MESSAGE_GENERIC_ERROR =
  "Unable to send your message right now. Please try again.";
const CUSTOMER_MESSAGE_EMPTY_ERROR = "Message can’t be empty.";
const CUSTOMER_MESSAGE_LENGTH_ERROR = "Message is too long. Try shortening or splitting it.";
const CUSTOMER_SELECT_WINNER_AUTH_ERROR =
  "You need to be signed in as the requesting customer to select a winner.";
const CUSTOMER_SELECT_WINNER_GENERIC_ERROR =
  "We couldn’t select that bid. Please try again.";
const CUSTOMER_SELECT_WINNER_SUCCESS_MESSAGE =
  "Winning supplier selected. Quote status updated to Won.";
const CUSTOMER_PROJECT_GENERIC_ERROR =
  "We couldn’t save your project details. Please retry.";
const CUSTOMER_PROJECT_SUCCESS_MESSAGE = "Project details saved.";
const CUSTOMER_PROJECT_PO_LENGTH_ERROR =
  "PO number must be 100 characters or fewer.";
const CUSTOMER_PROJECT_DATE_ERROR =
  "Enter a valid target ship date (YYYY-MM-DD).";
const DATE_INPUT_REGEX = /^\d{4}-\d{2}-\d{2}$/;

type QuoteRecipientRow = {
  id: string;
  email: string | null;
  customer_name: string | null;
  company: string | null;
  file_name: string | null;
};

type QuoteSelectionRow = QuoteRecipientRow & {
  status: string | null;
  price: number | string | null;
  currency: string | null;
};

export async function submitCustomerQuoteMessageAction(
  quoteId: string,
  _prevState: CustomerMessageFormState,
  formData: FormData,
): Promise<CustomerMessageFormState> {
  const normalizedQuoteId =
    typeof quoteId === "string" ? quoteId.trim() : "";
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

    const { data: quote, error: quoteError } = await supabaseServer
      .from("quotes_with_uploads")
      .select("id,email,customer_name,company,file_name")
      .eq("id", normalizedQuoteId)
      .maybeSingle<QuoteRecipientRow>();

    if (quoteError) {
      console.error("[customer messages] quote lookup failed", {
        quoteId: normalizedQuoteId,
        error: serializeActionError(quoteError),
      });
    }

    if (!quote) {
      return { ok: false, error: "Quote not found." };
    }

    const normalizedQuoteEmail = normalizeEmailInput(quote.email ?? null);
    const customerEmail = normalizeEmailInput(customer.email);
    const emailMatchesQuote =
      normalizedQuoteEmail !== null &&
      customerEmail !== null &&
      normalizedQuoteEmail === customerEmail;

    if (!emailMatchesQuote) {
      console.error("[customer messages] access denied", {
        quoteId: normalizedQuoteId,
        customerId: customer.id,
        quoteEmail: quote.email,
      });
      return {
        ok: false,
        error: "You do not have access to post on this quote.",
      };
    }

    console.log("[customer messages] create start", {
      quoteId: normalizedQuoteId,
      customerId: customer.id,
    });

    const result = await createQuoteMessage({
      quoteId: normalizedQuoteId,
      body: trimmedBody,
      authorType: "customer",
      authorName:
        quote.customer_name ??
        customer.company_name ??
        customer.email ??
        "Customer",
      authorEmail:
        customer.email ??
        user.email ??
        normalizedQuoteEmail ??
        "customer@zartman.io",
    });

    if (!result.ok || !result.data) {
      console.error("[customer messages] create failed", {
        quoteId: normalizedQuoteId,
        customerId: customer.id,
        error: result.error,
      });
      return {
        ok: false,
        error: CUSTOMER_MESSAGE_GENERIC_ERROR,
      };
    }

    revalidatePath(`/customer/quotes/${normalizedQuoteId}`);

    if (quote) {
      const contact = toQuoteContactInfo(quote);
      void notifyOnNewQuoteMessage(result.data, contact);
    }

    console.log("[customer messages] create success", {
      quoteId: normalizedQuoteId,
      customerId: customer.id,
      messageId: result.data.id,
    });

    return {
      ok: true,
      message: "Message sent.",
    };
  } catch (error) {
    console.error("[customer messages] create crashed", {
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

    const result = await upsertQuoteProject({
      quoteId: normalizedQuoteId,
      poNumber,
      targetShipDate,
      notes: null,
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

export async function submitCustomerSelectWinningBidAction(
  quoteId: string,
  _prev: CustomerSelectWinningBidState,
  formData: FormData,
): Promise<CustomerSelectWinningBidState> {
  let normalizedQuoteId = "";
  let customerId: string | null = null;
  let selectedBidId: string | null = null;

  try {
    normalizedQuoteId = typeof quoteId === "string" ? quoteId.trim() : "";
    const redirectPath = normalizedQuoteId
      ? `/customer/quotes/${normalizedQuoteId}`
      : "/customer/quotes";
    const user = await requireUser({ redirectTo: redirectPath });
    const customer = await getCustomerByUserId(user.id);

    if (!customer) {
      console.error("[customer decisions] select winner failed", {
        quoteId: normalizedQuoteId || quoteId,
        bidId: null,
        customerId: null,
        reason: "missing-customer-profile",
      });
      return { ok: false, error: CUSTOMER_SELECT_WINNER_AUTH_ERROR };
    }

    customerId = customer.id;

    if (!normalizedQuoteId) {
      console.error("[customer decisions] select winner failed", {
        quoteId,
        bidId: null,
        customerId,
        reason: "missing-quote-id",
      });
      return { ok: false, error: CUSTOMER_SELECT_WINNER_GENERIC_ERROR };
    }

    const bidId = getFormString(formData, "bidId");
    if (typeof bidId !== "string" || bidId.trim().length === 0) {
      console.error("[customer decisions] select winner failed", {
        quoteId: normalizedQuoteId,
        bidId,
        customerId,
        reason: "missing-bid-id",
      });
      return {
        ok: false,
        error: "Select a supplier bid before awarding the quote.",
      };
    }

    const trimmedBidId = bidId.trim();
    selectedBidId = trimmedBidId;

    const { data: quoteRow, error } = await supabaseServer
      .from("quotes_with_uploads")
      .select("id,email,customer_name,company,file_name,status,price,currency")
      .eq("id", normalizedQuoteId)
      .maybeSingle<QuoteSelectionRow>();

    if (error) {
      console.error("[customer decisions] select winner failed", {
        quoteId: normalizedQuoteId,
        bidId: trimmedBidId,
        customerId,
        reason: "quote-lookup-error",
        error: serializeActionError(error),
      });
      return { ok: false, error: CUSTOMER_SELECT_WINNER_GENERIC_ERROR };
    }

    if (!quoteRow) {
      console.error("[customer decisions] select winner failed", {
        quoteId: normalizedQuoteId,
        bidId: trimmedBidId,
        customerId,
        reason: "quote-not-found",
      });
      return { ok: false, error: "Quote not found. Refresh and try again." };
    }

    const normalizedQuoteEmail = normalizeEmailInput(quoteRow.email ?? null);
    const customerEmail = normalizeEmailInput(customer.email);
    const emailMatchesQuote =
      normalizedQuoteEmail !== null &&
      customerEmail !== null &&
      normalizedQuoteEmail === customerEmail;

    if (!emailMatchesQuote) {
      console.error("[customer decisions] select winner failed", {
        quoteId: normalizedQuoteId,
        bidId: trimmedBidId,
        customerId,
        reason: "access-denied",
      });
      return { ok: false, error: CUSTOMER_SELECT_WINNER_AUTH_ERROR };
    }

    console.log("[customer decisions] select winner invoked", {
      quoteId: normalizedQuoteId,
      bidId: trimmedBidId,
      customerId,
    });

    const result = await markWinningBidForQuote({
      quoteId: normalizedQuoteId,
      bidId: trimmedBidId,
    });

    if (!result.ok) {
      console.error("[customer decisions] select winner failed", {
        quoteId: normalizedQuoteId,
        bidId: trimmedBidId,
        customerId,
        reason: "mark-winning-bid",
        error: result.error,
      });
      return {
        ok: false,
        error: result.error ?? CUSTOMER_SELECT_WINNER_GENERIC_ERROR,
      };
    }

    revalidatePath("/admin");
    revalidatePath("/admin/quotes");
    revalidatePath(`/admin/quotes/${normalizedQuoteId}`);
    revalidatePath("/customer");
    revalidatePath(`/customer/quotes/${normalizedQuoteId}`);
    revalidatePath("/supplier");
    revalidatePath(`/supplier/quotes/${normalizedQuoteId}`);

    if (quoteRow) {
      void triggerWinnerNotifications(quoteRow, trimmedBidId);
    }

    console.log("[customer decisions] select winner success", {
      quoteId: normalizedQuoteId,
      bidId: trimmedBidId,
      customerId,
    });

    return { ok: true, message: CUSTOMER_SELECT_WINNER_SUCCESS_MESSAGE };
  } catch (error) {
    console.error("[customer decisions] select winner failed", {
      quoteId: normalizedQuoteId || quoteId,
      bidId: selectedBidId,
      customerId,
      reason: "unexpected-error",
      error: serializeActionError(error),
    });
    return { ok: false, error: CUSTOMER_SELECT_WINNER_GENERIC_ERROR };
  }
}

async function triggerWinnerNotifications(
  quoteRow: QuoteSelectionRow,
  bidId: string,
) {
  try {
    const winnerContext = await loadWinningBidNotificationContext(bidId);
    if (!winnerContext) {
      return;
    }

    const quoteContext = toQuoteWinningContext(quoteRow);
    await notifyOnWinningBidSelected({
      quote: quoteContext,
      winningBid: winnerContext.winningBid,
      supplier: winnerContext.supplier,
      customerEmail: quoteContext.email ?? null,
    });
  } catch (error) {
    console.error("[customer decisions] winning bid notification failed", {
      quoteId: quoteRow.id,
      bidId,
      error: serializeActionError(error),
    });
  }
}

function toQuoteContactInfo(row: QuoteRecipientRow): QuoteContactInfo {
  return {
    id: row.id,
    email: row.email,
    customer_name: row.customer_name,
    company: row.company,
    file_name: row.file_name,
  };
}

function toQuoteWinningContext(row: QuoteSelectionRow): QuoteWinningContext {
  return {
    ...toQuoteContactInfo(row),
    status: row.status,
    price: row.price,
    currency: row.currency,
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
