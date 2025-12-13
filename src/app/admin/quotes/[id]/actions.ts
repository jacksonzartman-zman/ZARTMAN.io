"use server";

import { revalidatePath } from "next/cache";
import { getFormString, serializeActionError } from "@/lib/forms";
import { notifyOnNewQuoteMessage } from "@/server/quotes/notifications";
import { getServerAuthUser, requireAdminUser, requireUser } from "@/server/auth";
import {
  QUOTE_UPDATE_ERROR,
  updateAdminQuote,
  type AdminQuoteUpdateInput,
} from "@/server/admin/quotes";
import {
  ADMIN_QUOTE_UPDATE_AUTH_ERROR,
  ADMIN_QUOTE_UPDATE_ID_ERROR,
  ADMIN_QUOTE_UPDATE_SUCCESS_MESSAGE,
} from "@/server/admin/quotes/messages";
import {
  logAdminQuotesError,
  logAdminQuotesWarn,
} from "@/server/admin/quotes/logging";
import {
  createQuoteMessage,
  type QuoteMessageRecord,
} from "@/server/quotes/messages";
import type { QuoteMessageFormState } from "@/app/(portals)/components/QuoteMessagesThread.types";
import { upsertQuoteProject } from "@/server/quotes/projects";
import {
  performAwardFlow,
  type AwardFailureReason,
} from "@/server/quotes/award";
import { emitQuoteEvent } from "@/server/quotes/events";
import { normalizeQuoteStatus } from "@/server/quotes/status";
import type { AwardBidFormState } from "./awardFormState";

export type { AwardBidFormState } from "./awardFormState";

const ADMIN_AWARD_GENERIC_ERROR =
  "We couldn't update the award state. Please try again.";
const ADMIN_AWARD_BID_ERROR =
  "We couldn't verify that bid. Please retry.";
const ADMIN_AWARD_ALREADY_WON_ERROR =
  "A winning supplier has already been selected for this quote.";

export type AdminQuoteUpdateState =
  | { ok: true; message: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

export type AdminProjectFormState = {
  ok: boolean;
  message?: string;
  error?: string;
  fieldErrors?: {
    poNumber?: string;
    targetShipDate?: string;
    notes?: string;
  };
};

export async function awardBidFormAction(
  _prevState: AwardBidFormState,
  formData: FormData,
): Promise<AwardBidFormState> {
  const quoteIdRaw = getFormString(formData, "quoteId");
  const bidIdRaw = getFormString(formData, "bidId");

  const normalizedQuoteId =
    typeof quoteIdRaw === "string" ? quoteIdRaw.trim() : "";
  const normalizedBidId = typeof bidIdRaw === "string" ? bidIdRaw.trim() : "";

  if (!normalizedQuoteId || !normalizedBidId) {
    console.warn("[admin award] missing identifiers", {
      quoteId: normalizedQuoteId || quoteIdRaw || null,
      bidId: normalizedBidId || bidIdRaw || null,
    });
    return {
      status: "error",
      error: ADMIN_AWARD_GENERIC_ERROR,
    };
  }

  const adminUser = await requireAdminUser();

  const result = await performAwardFlow({
    quoteId: normalizedQuoteId,
    bidId: normalizedBidId,
    actorRole: "admin",
    actorUserId: adminUser.id,
    actorEmail: adminUser.email ?? null,
  });

  if (!result.ok) {
    const message = mapAdminAwardError(result.reason);
    console.error("[admin award] form error", {
      quoteId: normalizedQuoteId,
      bidId: normalizedBidId,
      reason: result.reason,
      error: result.error,
    });
    return {
      status: "error",
      error: message ?? ADMIN_AWARD_GENERIC_ERROR,
    };
  }

  return {
    status: "success",
    message: "Winner recorded.",
  };
}

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

    const nextStatus = normalizeQuoteStatus(payload.status ?? undefined);
    if (nextStatus === "in_review") {
      void emitQuoteEvent({
        quoteId: normalizedQuoteId,
        eventType: "reopened",
        actorRole: "admin",
        actorUserId: user.id,
        metadata: {
          status: nextStatus,
        },
      });
    } else if (nextStatus === "cancelled") {
      void emitQuoteEvent({
        quoteId: normalizedQuoteId,
        eventType: "archived",
        actorRole: "admin",
        actorUserId: user.id,
        metadata: {
          status: nextStatus,
        },
      });
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

const ADMIN_MESSAGE_GENERIC_ERROR =
  "Unable to send message right now. Please try again.";
const ADMIN_MESSAGE_EMPTY_ERROR = "Message can’t be empty.";
const ADMIN_MESSAGE_LENGTH_ERROR =
  "Message is too long. Try shortening or splitting it.";
const ADMIN_PROJECT_GENERIC_ERROR =
  "Unable to update project details right now.";
const ADMIN_PROJECT_SUCCESS_MESSAGE = "Project details updated.";
const ADMIN_PROJECT_PO_LENGTH_ERROR =
  "PO number must be 100 characters or fewer.";
const ADMIN_PROJECT_DATE_ERROR =
  "Enter a valid target ship date (YYYY-MM-DD).";
const ADMIN_PROJECT_NOTES_LENGTH_ERROR =
  "Internal notes must be 2000 characters or fewer.";
const ADMIN_PROJECT_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export type { QuoteMessageFormState } from "@/app/(portals)/components/QuoteMessagesThread.types";

export async function postQuoteMessage(
  quoteId: string,
  _prevState: QuoteMessageFormState,
  formData: FormData,
): Promise<QuoteMessageFormState> {
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

    const result = await createQuoteMessage({
      quoteId: normalizedQuoteId,
      senderId: user.id,
      senderRole: "admin",
      body: trimmedBody,
      senderName: "Zartman.io",
      senderEmail: user.email ?? "admin@zartman.io",
    });

    if (!result.ok || !result.message) {
      console.error("[admin messages] create failed", {
        quoteId: normalizedQuoteId,
        userId: user.id,
        error: result.error ?? result.reason,
      });
      return {
        ok: false,
        error: ADMIN_MESSAGE_GENERIC_ERROR,
      };
    }

    revalidatePath(`/admin/quotes/${normalizedQuoteId}`);
    revalidatePath(`/customer/quotes/${normalizedQuoteId}`);

    if (result.message) {
      void dispatchAdminMessageNotification(
        normalizedQuoteId,
        result.message,
      );
    }

    console.log("[admin messages] create success", {
      quoteId: normalizedQuoteId,
      userId: user.id,
      messageId: result.message.id,
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

export async function submitAdminQuoteProjectAction(
  quoteId: string,
  _prev: AdminProjectFormState,
  formData: FormData,
): Promise<AdminProjectFormState> {
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

    const poNumberValue = getFormString(formData, "poNumber");
    const poNumber =
      typeof poNumberValue === "string" && poNumberValue.trim().length > 0
        ? poNumberValue.trim()
        : null;

    if (poNumber && poNumber.length > 100) {
      return {
        ok: false,
        error: ADMIN_PROJECT_PO_LENGTH_ERROR,
        fieldErrors: { poNumber: ADMIN_PROJECT_PO_LENGTH_ERROR },
      };
    }

    const targetShipDateValue = getFormString(formData, "targetShipDate");
    const targetShipDate =
      typeof targetShipDateValue === "string" &&
      targetShipDateValue.trim().length > 0
        ? targetShipDateValue.trim()
        : null;

    if (targetShipDate && !ADMIN_PROJECT_DATE_REGEX.test(targetShipDate)) {
      return {
        ok: false,
        error: ADMIN_PROJECT_DATE_ERROR,
        fieldErrors: { targetShipDate: ADMIN_PROJECT_DATE_ERROR },
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
        error: ADMIN_PROJECT_NOTES_LENGTH_ERROR,
        fieldErrors: { notes: ADMIN_PROJECT_NOTES_LENGTH_ERROR },
      };
    }

    console.log("[admin projects] update invoked", {
      quoteId: normalizedQuoteId,
      hasPoNumber: Boolean(poNumber),
      hasTargetDate: Boolean(targetShipDate),
    });

    const result = await upsertQuoteProject({
      quoteId: normalizedQuoteId,
      poNumber,
      targetShipDate,
      notes,
    });

    if (!result.ok) {
      console.error("[admin projects] update failed", {
        quoteId: normalizedQuoteId,
        error: result.error,
      });
      return { ok: false, error: ADMIN_PROJECT_GENERIC_ERROR };
    }

    revalidatePath(`/admin/quotes/${normalizedQuoteId}`);
    revalidatePath(`/customer/quotes/${normalizedQuoteId}`);
    revalidatePath(`/supplier/quotes/${normalizedQuoteId}`);

    return {
      ok: true,
      message: ADMIN_PROJECT_SUCCESS_MESSAGE,
    };
  } catch (error) {
    console.error("[admin projects] update crashed", {
      quoteId,
      error: serializeActionError(error),
    });
    return { ok: false, error: ADMIN_PROJECT_GENERIC_ERROR };
  }
}

async function dispatchAdminMessageNotification(
  quoteId: string,
  message: QuoteMessageRecord,
) {
  try {
    await notifyOnNewQuoteMessage(message);
  } catch (error) {
    console.error("[admin messages] notification failed", {
      quoteId,
      messageId: message.id,
      error: serializeActionError(error),
    });
  }
}

function mapAdminAwardError(
  reason?: AwardFailureReason,
): string {
  switch (reason) {
    case "invalid_input":
    case "bid_not_found":
    case "bid_ineligible":
      return ADMIN_AWARD_BID_ERROR;
    case "winner_exists":
      return ADMIN_AWARD_ALREADY_WON_ERROR;
    default:
      return ADMIN_AWARD_GENERIC_ERROR;
  }
}

