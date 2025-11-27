"use server";

import { revalidatePath } from "next/cache";
import { getCurrentSession } from "@/server/auth";
import {
  QUOTE_UPDATE_ERROR,
  updateAdminQuote,
  type AdminQuoteUpdateInput,
} from "@/server/admin/quotes";
import { logAdminQuotesError } from "@/server/admin/logging";
import { createAdminQuoteMessage } from "@/server/quotes/messages";

export type AdminQuoteUpdateState =
  | { ok: true; message: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

export const initialAdminQuoteUpdateState: AdminQuoteUpdateState = {
  ok: true,
  message: "",
};

const ADMIN_QUOTE_UPDATE_AUTH_ERROR =
  "You must be signed in to update this quote.";
const ADMIN_QUOTE_UPDATE_ID_ERROR =
  "We couldn't determine which quote to update.";
const ADMIN_QUOTE_UPDATE_SUCCESS_MESSAGE = "Quote updated.";

export async function submitAdminQuoteUpdateAction(
  quoteId: string,
  _prevState: AdminQuoteUpdateState,
  formData: FormData,
): Promise<AdminQuoteUpdateState> {
  try {
    const session = await getCurrentSession();
    if (!session || !session.user) {
      return { ok: false, error: ADMIN_QUOTE_UPDATE_AUTH_ERROR };
    }

    const normalizedQuoteId =
      typeof quoteId === "string" ? quoteId.trim() : "";

    if (!normalizedQuoteId) {
      return { ok: false, error: ADMIN_QUOTE_UPDATE_ID_ERROR };
    }

    const payload: AdminQuoteUpdateInput = {
      quoteId: normalizedQuoteId,
      status: getFormString(formData, "status"),
      price: getFormString(formData, "price"),
      currency: getFormString(formData, "currency"),
      targetDate: getFormString(formData, "targetDate"),
      dfmNotes: getFormString(formData, "dfmNotes"),
      internalNotes: getFormString(formData, "internalNotes"),
    };

    const result = await updateAdminQuote(payload);

    if (!result.ok) {
      return { ok: false, error: result.error };
    }

    revalidatePath("/admin/quotes");
    revalidatePath(`/admin/quotes/${normalizedQuoteId}`);

    return {
      ok: true,
      message: ADMIN_QUOTE_UPDATE_SUCCESS_MESSAGE,
    };
  } catch (error) {
    logAdminQuotesError("update action crashed", {
      quoteId,
      error: serializeActionError(error),
    });
    return { ok: false, error: QUOTE_UPDATE_ERROR };
  }
}

function getFormString(
  formData: FormData,
  key: string,
): string | null | undefined {
  const value = formData.get(key);
  if (typeof value === "string") {
    return value;
  }
  return undefined;
}

function serializeActionError(error: unknown) {
  if (error instanceof Error) {
    return {
      message: error.message,
      stack: error.stack,
      name: error.name,
    };
  }
  return error ?? null;
}

export type PostQuoteMessageActionState = {
  success: boolean;
  error: string | null;
  messageId?: string;
};

const GENERIC_ERROR_MESSAGE =
  "Unable to send message right now. Please try again.";

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
    // Soft-fail to keep the quote page responsive even if Supabase hiccups.
    const { data, error } = await createAdminQuoteMessage({
      quoteId,
      body,
    });

    if (error || !data) {
      console.error("postQuoteMessageAction: failed to persist message", {
        quoteId,
        error,
      });
      return { success: false, error: GENERIC_ERROR_MESSAGE };
    }

    revalidatePath(`/admin/quotes/${quoteId}`);
    return { success: true, error: null, messageId: data.id };
  } catch (error) {
    console.error("postQuoteMessageAction: unexpected error", {
      quoteId,
      error,
    });
    return { success: false, error: GENERIC_ERROR_MESSAGE };
  }
}
