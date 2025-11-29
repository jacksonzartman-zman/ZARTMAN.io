"use server";

import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabaseServer";
import { createCustomerQuoteMessage } from "@/server/quotes/messages";
import { normalizeEmailInput } from "@/app/(portals)/quotes/pageUtils";
import {
  acceptSupplierBidForQuote,
  declineSupplierBid,
} from "@/server/suppliers";
import { requireUser } from "@/server/auth";
import { getCustomerByUserId } from "@/server/customers";
import { markWinningBidForQuote } from "@/server/bids";
import { getFormString, serializeActionError } from "@/lib/forms";

export type PostCustomerQuoteMessageState = {
  success: boolean;
  error: string | null;
  messageId?: string;
};

export type BidDecisionActionState = {
  success: boolean;
  error: string | null;
};

export type CustomerSelectWinningBidState =
  | { ok: true; message: string }
  | { ok: false; error: string };

const GENERIC_ERROR =
  "Unable to send your message right now. Please try again.";
const CUSTOMER_SELECT_WINNER_AUTH_ERROR =
  "You need to be signed in as the requesting customer to select a winner.";
const CUSTOMER_SELECT_WINNER_GENERIC_ERROR =
  "We couldn’t select that bid. Please try again.";
const CUSTOMER_SELECT_WINNER_SUCCESS_MESSAGE =
  "Winning supplier selected. Quote status updated to Won.";

type QuoteRecipientRow = {
  id: string;
  email: string | null;
  customer_name: string | null;
};

export async function postCustomerQuoteMessageAction(
  _prevState: PostCustomerQuoteMessageState,
  formData: FormData,
): Promise<PostCustomerQuoteMessageState> {
  const rawQuoteId = formData.get("quote_id");
  const rawBody = formData.get("body");
  const rawAuthorName = formData.get("author_name");

  if (typeof rawQuoteId !== "string" || rawQuoteId.trim().length === 0) {
    return { success: false, error: "Missing quote reference." };
  }

  if (typeof rawBody !== "string") {
    return { success: false, error: "Enter a message before sending." };
  }

  const quoteId = rawQuoteId.trim();
  const body = rawBody.trim();
  const authorName =
    typeof rawAuthorName === "string"
      ? rawAuthorName.trim().slice(0, 120)
      : null;

  if (body.length === 0) {
    return {
      success: false,
      error: "Enter a message before sending.",
    };
  }

  if (body.length > 2000) {
    return {
      success: false,
      error: "Message is too long. Keep it under 2,000 characters.",
    };
  }

    try {
    const user = await requireUser({ redirectTo: `/customer/quotes/${quoteId}` });
    const customer = await getCustomerByUserId(user.id);
    if (!customer) {
      return {
        success: false,
        error: "Complete your profile before posting messages.",
      };
    }

    const { data: quote, error: quoteError } = await supabaseServer
      .from("quotes_with_uploads")
      .select("id,email,customer_name")
      .eq("id", quoteId)
      .maybeSingle<QuoteRecipientRow>();

    if (quoteError) {
      console.error("Customer post action: quote lookup failed", quoteError);
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
        console.error("Customer post action: access denied", {
          quoteId,
        customerId: customer.id,
          quoteEmail: quote.email,
        });
      return {
        success: false,
        error: "You do not have access to post on this quote.",
      };
    }

    const authorEmail =
      customer.email ?? user.email ?? normalizedQuoteEmail ?? "customer@zartman.io";

    const { data, error } = await createCustomerQuoteMessage({
      quoteId,
      body,
      authorName: authorName || quote.customer_name || customer.company_name || "Customer",
      authorEmail,
    });

    if (error || !data) {
      console.error("Customer post action: failed to create message", {
        quoteId,
        error,
      });
      return { success: false, error: GENERIC_ERROR };
    }

    revalidatePath(`/customer/quotes/${quoteId}`);
    return { success: true, error: null, messageId: data.id };
  } catch (error) {
    console.error("Customer post action: unexpected error", error);
    return { success: false, error: GENERIC_ERROR };
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
      .select("id,email")
      .eq("id", normalizedQuoteId)
      .maybeSingle<{ id: string; email: string | null }>();

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
