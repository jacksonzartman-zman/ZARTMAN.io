"use server";

import { revalidatePath } from "next/cache";
import { getFormString, serializeActionError } from "@/lib/forms";
import {
  notifyOnNewQuoteMessage,
  notifyOnWinningBidSelected,
} from "@/server/quotes/notifications";
import {
  loadQuoteContactInfo,
  loadQuoteWinningContext,
  loadWinningBidNotificationContext,
} from "@/server/quotes/notificationContext";
import { getServerAuthUser, requireUser } from "@/server/auth";
import {
  QUOTE_UPDATE_ERROR,
  updateAdminQuote,
  type AdminQuoteUpdateInput,
} from "@/server/admin/quotes";
import {
  ADMIN_QUOTE_UPDATE_AUTH_ERROR,
  ADMIN_QUOTE_UPDATE_ID_ERROR,
  ADMIN_QUOTE_UPDATE_SUCCESS_MESSAGE,
  ADMIN_SELECT_WINNING_BID_ERROR_MESSAGE,
  ADMIN_SELECT_WINNING_BID_SUCCESS_MESSAGE,
} from "@/server/admin/quotes/messages";
import {
  logAdminQuotesError,
  logAdminQuotesWarn,
} from "@/server/admin/quotes/logging";
import { markWinningBidForQuote } from "@/server/bids";
import {
  createQuoteMessage,
  type QuoteMessageRow,
} from "@/server/quotes/messages";

export type AdminQuoteUpdateState =
  | { ok: true; message: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

export type AdminSelectWinningBidState =
  | { ok: true; message: string }
  | { ok: false; error: string };

export type AdminMessageFormState = {
  ok: boolean;
  error?: string;
  message?: string;
  fieldErrors?: {
    body?: string;
  };
};

export async function submitAdminQuoteUpdateAction(
  quoteId: string,
  _prevState: AdminQuoteUpdateState,
  formData: FormData,
): Promise<AdminQuoteUpdateState> {
  try {
    const { user } = await getServerAuthUser();
    if (!user) {
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
      logAdminQuotesWarn("update action validation failed", {
        quoteId: normalizedQuoteId,
        error: result.error ?? null,
      });
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

export async function submitSelectWinningBidAction(
  quoteId: string,
  _prevState: AdminSelectWinningBidState,
  formData: FormData,
): Promise<AdminSelectWinningBidState> {
  let normalizedQuoteId = "";
  let selectedBidId: string | null = null;

  try {
    console.log("[admin bids] select winner invoked", { quoteId });

    const { user } = await getServerAuthUser();
    if (!user) {
      logAdminQuotesWarn("select winner auth failed", { quoteId });
      return { ok: false, error: ADMIN_QUOTE_UPDATE_AUTH_ERROR };
    }

    normalizedQuoteId = typeof quoteId === "string" ? quoteId.trim() : "";

    if (!normalizedQuoteId) {
      logAdminQuotesWarn("select winner missing quote id", { quoteId });
      return { ok: false, error: ADMIN_QUOTE_UPDATE_ID_ERROR };
    }

    const bidId = getFormString(formData, "bidId");
    if (typeof bidId !== "string" || bidId.trim().length === 0) {
      logAdminQuotesWarn("select winner missing bid id", {
        quoteId: normalizedQuoteId,
      });
      return { ok: false, error: ADMIN_SELECT_WINNING_BID_ERROR_MESSAGE };
    }

    const trimmedBidId = bidId.trim();
    selectedBidId = trimmedBidId;

    const result = await markWinningBidForQuote({
      quoteId: normalizedQuoteId,
      bidId: trimmedBidId,
    });

    if (!result.ok) {
      logAdminQuotesError("select winner failed", {
        quoteId: normalizedQuoteId,
        bidId: trimmedBidId,
        error: result.error ?? null,
      });
      return {
        ok: false,
        error: result.error ?? ADMIN_SELECT_WINNING_BID_ERROR_MESSAGE,
      };
    }

    revalidatePath("/admin");
    revalidatePath("/admin/quotes");
    revalidatePath(`/admin/quotes/${normalizedQuoteId}`);
    revalidatePath("/customer");
    revalidatePath(`/customer/quotes/${normalizedQuoteId}`);
    revalidatePath("/supplier");
    revalidatePath(`/supplier/quotes/${normalizedQuoteId}`);

    void dispatchAdminWinnerNotification(
      normalizedQuoteId,
      trimmedBidId,
    );

    console.log("[admin bids] select winner success", {
      quoteId: normalizedQuoteId,
      bidId: trimmedBidId,
    });

    return {
      ok: true,
      message: ADMIN_SELECT_WINNING_BID_SUCCESS_MESSAGE,
    };
  } catch (error) {
    const serialized = serializeActionError(error);
    logAdminQuotesError("select winner action crashed", {
      quoteId: normalizedQuoteId || quoteId,
      bidId: selectedBidId,
      error: serialized,
    });
    return { ok: false, error: ADMIN_SELECT_WINNING_BID_ERROR_MESSAGE };
  }
}

const ADMIN_MESSAGE_GENERIC_ERROR =
  "Unable to send message right now. Please try again.";
const ADMIN_MESSAGE_EMPTY_ERROR = "Message can’t be empty.";
const ADMIN_MESSAGE_LENGTH_ERROR =
  "Message is too long. Try shortening or splitting it.";

export async function submitAdminQuoteMessageAction(
  quoteId: string,
  _prevState: AdminMessageFormState,
  formData: FormData,
): Promise<AdminMessageFormState> {
  const normalizedQuoteId =
    typeof quoteId === "string" ? quoteId.trim() : "";
  const redirectPath = normalizedQuoteId
    ? `/admin/quotes/${normalizedQuoteId}`
    : "/admin/quotes";

  if (!normalizedQuoteId) {
    return {
      ok: false,
      error: ADMIN_QUOTE_UPDATE_ID_ERROR,
    };
  }

  const bodyValue = formData.get("body");
  if (typeof bodyValue !== "string") {
    return {
      ok: false,
      error: ADMIN_MESSAGE_EMPTY_ERROR,
      fieldErrors: { body: ADMIN_MESSAGE_EMPTY_ERROR },
    };
  }

  const trimmedBody = bodyValue.trim();
  if (trimmedBody.length === 0) {
    return {
      ok: false,
      error: ADMIN_MESSAGE_EMPTY_ERROR,
      fieldErrors: { body: ADMIN_MESSAGE_EMPTY_ERROR },
    };
  }

  if (trimmedBody.length > 2000) {
    return {
      ok: false,
      error: ADMIN_MESSAGE_LENGTH_ERROR,
      fieldErrors: { body: ADMIN_MESSAGE_LENGTH_ERROR },
    };
  }

  try {
    const user = await requireUser({ redirectTo: redirectPath });

    console.log("[admin messages] create start", {
      quoteId: normalizedQuoteId,
      userId: user.id,
    });

    const result = await createQuoteMessage({
      quoteId: normalizedQuoteId,
      body: trimmedBody,
      authorType: "admin",
      authorName: "Zartman.io",
      authorEmail: user.email ?? "admin@zartman.io",
    });

    if (!result.ok || !result.data) {
      console.error("[admin messages] create failed", {
        quoteId: normalizedQuoteId,
        userId: user.id,
        error: result.error,
      });
      return {
        ok: false,
        error: ADMIN_MESSAGE_GENERIC_ERROR,
      };
    }

    revalidatePath(`/admin/quotes/${normalizedQuoteId}`);
    revalidatePath(`/customer/quotes/${normalizedQuoteId}`);

    if (result.data) {
      void dispatchAdminMessageNotification(
        normalizedQuoteId,
        result.data,
      );
    }

    console.log("[admin messages] create success", {
      quoteId: normalizedQuoteId,
      userId: user.id,
      messageId: result.data.id,
    });

    return {
      ok: true,
      message: "Reply posted.",
    };
  } catch (error) {
    console.error("[admin messages] create crashed", {
      quoteId: normalizedQuoteId,
      error: serializeActionError(error),
    });
    return {
      ok: false,
      error: ADMIN_MESSAGE_GENERIC_ERROR,
    };
  }
}

async function dispatchAdminMessageNotification(
  quoteId: string,
  message: QuoteMessageRow,
) {
  try {
    const contact = await loadQuoteContactInfo(quoteId);
    if (!contact) {
      console.warn("[admin messages] notification skipped", {
        quoteId,
        messageId: message.id,
        reason: "missing-quote-context",
      });
      return;
    }
    await notifyOnNewQuoteMessage(message, contact);
  } catch (error) {
    console.error("[admin messages] notification failed", {
      quoteId,
      messageId: message.id,
      error: serializeActionError(error),
    });
  }
}

async function dispatchAdminWinnerNotification(
  quoteId: string,
  bidId: string,
) {
  try {
    const [quoteContext, winnerContext] = await Promise.all([
      loadQuoteWinningContext(quoteId),
      loadWinningBidNotificationContext(bidId),
    ]);

    if (!quoteContext || !winnerContext) {
      console.warn("[admin bids] winner notification skipped", {
        quoteId,
        bidId,
        reason: !quoteContext
          ? "missing-quote-context"
          : "missing-bid-context",
      });
      return;
    }

    await notifyOnWinningBidSelected({
      quote: quoteContext,
      winningBid: winnerContext.winningBid,
      supplier: winnerContext.supplier,
      customerEmail: quoteContext.email ?? null,
    });
  } catch (error) {
    console.error("[admin bids] winner notification failed", {
      quoteId,
      bidId,
      error: serializeActionError(error),
    });
  }
}
