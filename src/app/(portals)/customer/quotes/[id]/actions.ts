"use server";

import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabaseServer";
import { createCustomerQuoteMessage } from "@/server/quotes/messages";
import { normalizeEmailInput } from "@/app/(portals)/quotes/pageUtils";
import {
  acceptSupplierBidForQuote,
  declineSupplierBid,
} from "@/server/suppliers";
import { requireSession } from "@/server/auth";
import { getCustomerByUserId } from "@/server/customers";

export type PostCustomerQuoteMessageState = {
  success: boolean;
  error: string | null;
  messageId?: string;
};

export type BidDecisionActionState = {
  success: boolean;
  error: string | null;
};

const GENERIC_ERROR =
  "Unable to send your message right now. Please try again.";

type QuoteRecipientRow = {
  id: string;
  email: string | null;
  customer_name: string | null;
  customer_id: string | null;
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
    const session = await requireSession({ redirectTo: `/customer/quotes/${quoteId}` });
    const customer = await getCustomerByUserId(session.user.id);
    if (!customer) {
      return {
        success: false,
        error: "Complete your profile before posting messages.",
      };
    }

      const { data: quote, error: quoteError } = await supabaseServer
        .from("quotes_with_uploads")
      .select("id,email,customer_name,customer_id")
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
    const ownsQuote =
      (quote.customer_id && quote.customer_id === customer.id) ||
      (!quote.customer_id &&
        normalizedQuoteEmail &&
        customerEmail &&
        normalizedQuoteEmail === customerEmail);
    if (!ownsQuote) {
        console.error("Customer post action: access denied", {
          quoteId,
        customerId: customer.id,
          quoteEmail: quote.email,
        quoteCustomerId: quote.customer_id,
        });
      return {
        success: false,
        error: "You do not have access to post on this quote.",
      };
    }

    const authorEmail =
      customer.email ??
      session.user.email ??
      normalizedQuoteEmail ??
      "customer@zartman.io";

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
    const session = await requireSession({ redirectTo: `/customer/quotes/${quoteId}` });
    const customer = await getCustomerByUserId(session.user.id);
    if (!customer) {
      return {
        success: false,
        error: "Complete your profile before managing bids.",
      };
    }

    const { data: quote, error } = await supabaseServer
      .from("quotes_with_uploads")
      .select("id,email,customer_id")
      .eq("id", quoteId)
      .maybeSingle<{ id: string; email: string | null; customer_id: string | null }>();

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
    const ownsQuote =
      (quote.customer_id && quote.customer_id === customer.id) ||
      (!quote.customer_id &&
        normalizedQuoteEmail &&
        customerEmail &&
        normalizedQuoteEmail === customerEmail);
    if (!ownsQuote) {
      console.error("Bid decision action: access denied", {
        quoteId,
        customerId: customer.id,
        quoteEmail: quote.email,
        quoteCustomerId: quote.customer_id,
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
