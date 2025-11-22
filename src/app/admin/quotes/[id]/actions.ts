"use server";

import { revalidatePath } from "next/cache";
import { createAdminQuoteMessage } from "@/server/quotes/messages";

export type PostQuoteMessageActionState = {
  success: boolean;
  error?: string;
  messageId?: string;
};

export const INITIAL_POST_QUOTE_MESSAGE_STATE: PostQuoteMessageActionState = {
  success: false,
};

const GENERIC_ERROR_MESSAGE = "Unable to send message right now. Please try again.";

export async function postQuoteMessageAction(
  _prevState: PostQuoteMessageActionState,
  formData: FormData,
): Promise<PostQuoteMessageActionState> {
  const rawQuoteId = formData.get("quote_id");
  const rawBody = formData.get("body");

  if (typeof rawQuoteId !== "string" || rawQuoteId.trim().length === 0) {
    return {
      success: false,
      error: "Missing quote reference. Refresh and try again.",
    };
  }

  if (typeof rawBody !== "string") {
    return {
      success: false,
      error: "Enter a message before sending.",
    };
  }

  const quoteId = rawQuoteId.trim();
  const body = rawBody.trim();

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
    const { data, error } = await createAdminQuoteMessage({
      quoteId,
      body,
    });

    if (error || !data) {
      return { success: false, error: GENERIC_ERROR_MESSAGE };
    }

    revalidatePath(`/admin/quotes/${quoteId}`);
    return { success: true, messageId: data.id };
  } catch (error) {
    console.error("postQuoteMessageAction error", error);
    return { success: false, error: GENERIC_ERROR_MESSAGE };
  }
}
