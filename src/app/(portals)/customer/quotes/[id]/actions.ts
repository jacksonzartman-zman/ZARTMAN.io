"use server";

import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabaseServer";
import { createCustomerQuoteMessage } from "@/server/quotes/messages";
import { normalizeEmailInput } from "@/app/(portals)/quotes/pageUtils";
import {
  acceptSupplierBidForQuote,
  declineSupplierBid,
} from "@/server/suppliers";

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
};

export async function postCustomerQuoteMessageAction(
  _prevState: PostCustomerQuoteMessageState,
  formData: FormData,
): Promise<PostCustomerQuoteMessageState> {
  const rawQuoteId = formData.get("quote_id");
  const rawBody = formData.get("body");
  const rawEmail = formData.get("identity_email");
  const rawAuthorName = formData.get("author_name");

  if (typeof rawQuoteId !== "string" || rawQuoteId.trim().length === 0) {
    return { success: false, error: "Missing quote reference." };
  }

  if (typeof rawBody !== "string") {
    return { success: false, error: "Enter a message before sending." };
  }

  if (typeof rawEmail !== "string") {
    return { success: false, error: "Provide your email to continue." };
  }

  const quoteId = rawQuoteId.trim();
  const body = rawBody.trim();
  const identityEmail = normalizeEmailInput(rawEmail);
  const authorName =
    typeof rawAuthorName === "string"
      ? rawAuthorName.trim().slice(0, 120)
      : null;

  if (!identityEmail) {
    return {
      success: false,
      error: "Provide a valid email address to continue.",
    };
  }

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
      if (!normalizedQuoteEmail || normalizedQuoteEmail !== identityEmail) {
        console.error("Customer post action: access denied", {
          quoteId,
          identityEmail,
          quoteEmail: quote.email,
        });
      return {
        success: false,
        error: "You do not have access to post on this quote.",
      };
    }

    const { data, error } = await createCustomerQuoteMessage({
      quoteId,
      body,
      authorName: authorName || quote.customer_name || "Customer",
      authorEmail: identityEmail,
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
  const rawEmail = formData.get("identity_email");

  if (typeof rawBidId !== "string" || rawBidId.trim().length === 0) {
    return { success: false, error: "Missing bid reference." };
  }

  if (typeof rawQuoteId !== "string" || rawQuoteId.trim().length === 0) {
    return { success: false, error: "Missing quote reference." };
  }

  if (typeof rawEmail !== "string") {
    return { success: false, error: "Provide your email to continue." };
  }

  const bidId = rawBidId.trim();
  const quoteId = rawQuoteId.trim();
  const identityEmail = normalizeEmailInput(rawEmail);

  if (!identityEmail) {
    return {
      success: false,
      error: "Provide a valid email address.",
    };
  }

  try {
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
    if (!normalizedQuoteEmail || normalizedQuoteEmail !== identityEmail) {
      console.error("Bid decision action: access denied", {
        quoteId,
        identityEmail,
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
