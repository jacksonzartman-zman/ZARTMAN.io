"use server";

import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabaseServer";
import { createCustomerQuoteMessage } from "@/server/quotes/messages";
import { normalizeEmailInput } from "@/app/(portals)/quotes/pageUtils";

export type PostCustomerQuoteMessageState = {
  success: boolean;
  error: string | null;
  messageId?: string;
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
