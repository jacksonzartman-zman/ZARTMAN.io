"use server";

import { revalidatePath } from "next/cache";
import { getFormString, serializeActionError } from "@/lib/forms";
import { supabaseServer } from "@/lib/supabaseServer";
import { notifyOnNewQuoteMessage } from "@/server/quotes/notifications";
import { getServerAuthUser, requireAdminUser, requireUser } from "@/server/auth";
import {
  isMissingTableOrColumnError,
  serializeSupabaseError,
} from "@/server/admin/logging";
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
import { transitionQuoteStatus } from "@/server/quotes/transitionQuoteStatus";
import type { AwardBidFormState } from "./awardFormState";
import {
  requestSupplierCapacityUpdate,
  loadRecentCapacityUpdateRequest,
  isCapacityRequestSuppressed,
  type CapacityUpdateRequestReason,
} from "@/server/admin/capacityRequests";
import {
  AWARD_FEEDBACK_MAX_NOTES_LENGTH,
  isAwardFeedbackConfidence,
  isAwardFeedbackReason,
} from "@/lib/awardFeedback";
import { recordAwardFeedback } from "@/server/quotes/awardFeedback";
import {
  adminCreateQuotePart,
  adminUpdateQuotePartFiles,
  assertPartBelongsToQuote,
} from "@/server/admin/quoteParts";
import { appendFilesToQuoteUpload } from "@/server/quotes/uploadFiles";
import { MAX_UPLOAD_BYTES, formatMaxUploadSize } from "@/lib/uploads/uploadLimits";

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

export type AwardFeedbackFormState =
  | { status: "idle" }
  | { status: "success"; message: string }
  | { status: "error"; error: string; fieldErrors?: { reason?: string; notes?: string } };

const ADMIN_AWARD_FEEDBACK_GENERIC_ERROR =
  "We couldn't save award feedback. Please try again.";
const ADMIN_AWARD_FEEDBACK_REASON_ERROR = "Select a reason.";
const ADMIN_AWARD_FEEDBACK_NOTES_LENGTH_ERROR = `Notes must be ${AWARD_FEEDBACK_MAX_NOTES_LENGTH} characters or fewer.`;

export type AdminQuotePartActionState =
  | { ok: true; message: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

const ADMIN_PART_GENERIC_ERROR = "We couldn't update parts right now. Please try again.";
const ADMIN_PART_LABEL_ERROR = "Enter a part name.";
const ADMIN_PART_FILES_GENERIC_ERROR =
  "We couldn't update part files right now. Please try again.";
const ADMIN_PART_DRAWING_UPLOAD_ERROR =
  "Couldn’t upload drawings; please try again.";

export async function submitAwardFeedbackAction(
  quoteId: string,
  _prevState: AwardFeedbackFormState,
  formData: FormData,
): Promise<AwardFeedbackFormState> {
  const normalizedQuoteId = typeof quoteId === "string" ? quoteId.trim() : "";
  const supplierIdRaw = getFormString(formData, "supplierId");
  const reasonRaw = getFormString(formData, "reason");
  const confidenceRaw = getFormString(formData, "confidence");
  const notesRaw = getFormString(formData, "notes");

  const supplierId = typeof supplierIdRaw === "string" ? supplierIdRaw.trim() : "";
  const reason = typeof reasonRaw === "string" ? reasonRaw.trim() : "";
  const confidence =
    typeof confidenceRaw === "string" && confidenceRaw.trim().length > 0
      ? confidenceRaw.trim()
      : null;
  const notes =
    typeof notesRaw === "string" && notesRaw.trim().length > 0
      ? notesRaw.trim()
      : null;

  if (!normalizedQuoteId || !supplierId) {
    return { status: "error", error: ADMIN_QUOTE_UPDATE_ID_ERROR };
  }

  if (!isAwardFeedbackReason(reason)) {
    return {
      status: "error",
      error: ADMIN_AWARD_FEEDBACK_REASON_ERROR,
      fieldErrors: { reason: ADMIN_AWARD_FEEDBACK_REASON_ERROR },
    };
  }

  if (notes && notes.length > AWARD_FEEDBACK_MAX_NOTES_LENGTH) {
    return {
      status: "error",
      error: ADMIN_AWARD_FEEDBACK_NOTES_LENGTH_ERROR,
      fieldErrors: { notes: ADMIN_AWARD_FEEDBACK_NOTES_LENGTH_ERROR },
    };
  }

  if (confidence && !isAwardFeedbackConfidence(confidence)) {
    // Treat as empty/invalid optional field; keep UX forgiving.
    // Server helper will normalize it to null anyway.
  }

  try {
    const adminUser = await requireAdminUser();

    const result = await recordAwardFeedback({
      quoteId: normalizedQuoteId,
      supplierId,
      reason,
      confidence: confidence && isAwardFeedbackConfidence(confidence) ? confidence : null,
      notes,
      actorUserId: adminUser.id,
      actorRole: "admin",
    });

    if (!result.ok) {
      return { status: "error", error: ADMIN_AWARD_FEEDBACK_GENERIC_ERROR };
    }

    revalidatePath(`/admin/quotes/${normalizedQuoteId}`);

    return {
      status: "success",
      message: result.skipped ? "Feedback already recorded." : "Feedback saved.",
    };
  } catch (error) {
    console.error("[admin award feedback] action crashed", {
      quoteId: normalizedQuoteId,
      supplierId,
      error: serializeActionError(error),
    });
    return { status: "error", error: ADMIN_AWARD_FEEDBACK_GENERIC_ERROR };
  }
}

export async function createQuotePartAction(
  quoteId: string,
  _prev: AdminQuotePartActionState,
  formData: FormData,
): Promise<AdminQuotePartActionState> {
  const normalizedQuoteId = typeof quoteId === "string" ? quoteId.trim() : "";
  if (!normalizedQuoteId) {
    return { ok: false, error: ADMIN_QUOTE_UPDATE_ID_ERROR };
  }

  const labelRaw = getFormString(formData, "label");
  const notesRaw = getFormString(formData, "notes");
  const label = typeof labelRaw === "string" ? labelRaw.trim() : "";
  const notes =
    typeof notesRaw === "string" && notesRaw.trim().length > 0
      ? notesRaw.trim()
      : null;

  if (!label) {
    return {
      ok: false,
      error: ADMIN_PART_LABEL_ERROR,
      fieldErrors: { label: ADMIN_PART_LABEL_ERROR },
    };
  }

  try {
    await requireAdminUser();
    await adminCreateQuotePart(normalizedQuoteId, { label, notes });

    revalidatePath(`/admin/quotes/${normalizedQuoteId}`);
    revalidatePath(`/customer/quotes/${normalizedQuoteId}`);
    revalidatePath(`/supplier/quotes/${normalizedQuoteId}`);

    return { ok: true, message: "Part added." };
  } catch (error) {
    console.error("[admin quote parts] create action crashed", {
      quoteId: normalizedQuoteId,
      error: serializeActionError(error),
    });
    return { ok: false, error: ADMIN_PART_GENERIC_ERROR };
  }
}

export async function updateQuotePartFilesAction(
  quoteId: string,
  quotePartId: string,
  _prev: AdminQuotePartActionState,
  formData: FormData,
): Promise<AdminQuotePartActionState> {
  const normalizedQuoteId = typeof quoteId === "string" ? quoteId.trim() : "";
  const normalizedPartId =
    typeof quotePartId === "string" ? quotePartId.trim() : "";
  if (!normalizedQuoteId || !normalizedPartId) {
    return { ok: false, error: ADMIN_QUOTE_UPDATE_ID_ERROR };
  }

  try {
    await requireAdminUser();

    const selectedRaw = formData.getAll("fileIds");
    const selected = new Set<string>();
    for (const value of selectedRaw) {
      if (typeof value === "string" && value.trim()) {
        selected.add(value.trim());
      }
    }

    const { data: existingRows, error: existingError } = await supabaseServer
      .from("quote_part_files")
      .select("quote_upload_file_id")
      .eq("quote_part_id", normalizedPartId)
      .returns<Array<{ quote_upload_file_id: string }>>();

    if (existingError) {
      if (!isMissingTableOrColumnError(existingError)) {
        console.error("[admin quote parts] load existing part files failed", {
          quoteId: normalizedQuoteId,
          quotePartId: normalizedPartId,
          error: serializeSupabaseError(existingError),
        });
      }
      return { ok: false, error: ADMIN_PART_FILES_GENERIC_ERROR };
    }

    const existing = new Set<string>();
    for (const row of existingRows ?? []) {
      if (typeof row?.quote_upload_file_id === "string" && row.quote_upload_file_id.trim()) {
        existing.add(row.quote_upload_file_id.trim());
      }
    }

    const addFileIds: string[] = [];
    for (const id of selected) {
      if (!existing.has(id)) addFileIds.push(id);
    }

    const removeFileIds: string[] = [];
    for (const id of existing) {
      if (!selected.has(id)) removeFileIds.push(id);
    }

    await adminUpdateQuotePartFiles({
      quoteId: normalizedQuoteId,
      quotePartId: normalizedPartId,
      addFileIds,
      removeFileIds,
      role: null,
    });

    revalidatePath(`/admin/quotes/${normalizedQuoteId}`);
    revalidatePath(`/customer/quotes/${normalizedQuoteId}`);
    revalidatePath(`/supplier/quotes/${normalizedQuoteId}`);

    return { ok: true, message: "Part files updated." };
  } catch (error) {
    console.error("[admin quote parts] update files action crashed", {
      quoteId: normalizedQuoteId,
      quotePartId: normalizedPartId,
      error: serializeActionError(error),
    });
    return { ok: false, error: ADMIN_PART_FILES_GENERIC_ERROR };
  }
}

export async function updateQuotePartFilesForQuoteAction(
  quoteId: string,
  prev: AdminQuotePartActionState,
  formData: FormData,
): Promise<AdminQuotePartActionState> {
  const partIdRaw = getFormString(formData, "quotePartId");
  const partId = typeof partIdRaw === "string" ? partIdRaw.trim() : "";
  return updateQuotePartFilesAction(quoteId, partId, prev, formData);
}

export async function adminUploadPartDrawingsAction(
  quoteId: string,
  partId: string,
  _prev: AdminQuotePartActionState,
  formData: FormData,
): Promise<AdminQuotePartActionState> {
  const normalizedQuoteId = typeof quoteId === "string" ? quoteId.trim() : "";
  const normalizedPartId = typeof partId === "string" ? partId.trim() : "";
  if (!normalizedQuoteId || !normalizedPartId) {
    return { ok: false, error: ADMIN_QUOTE_UPDATE_ID_ERROR };
  }

  try {
    await requireAdminUser();

    // Validate association up-front so we don't create orphaned uploads/files.
    await assertPartBelongsToQuote({
      quoteId: normalizedQuoteId,
      quotePartId: normalizedPartId,
    });

    const raw = formData.getAll("files");
    const files: File[] = [];
    for (const value of raw) {
      if (value instanceof File) {
        files.push(value);
      }
    }

    if (files.length === 0) {
      return {
        ok: false,
        error: "Select at least one drawing file to upload.",
        fieldErrors: { files: "Select at least one drawing file." },
      };
    }

    const tooLarge = files.filter((f) => f.size > MAX_UPLOAD_BYTES);
    if (tooLarge.length > 0) {
      const message = `Each file must be smaller than ${formatMaxUploadSize()}. Try splitting large ZIPs or compressing drawings.`;
      return {
        ok: false,
        error: message,
        fieldErrors: { files: message },
      };
    }

    const { uploadFileIds } = await appendFilesToQuoteUpload({
      quoteId: normalizedQuoteId,
      files,
    });

    await adminUpdateQuotePartFiles({
      quoteId: normalizedQuoteId,
      quotePartId: normalizedPartId,
      addFileIds: uploadFileIds,
      role: "drawing",
    });

    revalidatePath(`/admin/quotes/${normalizedQuoteId}`);
    revalidatePath(`/customer/quotes/${normalizedQuoteId}`);
    revalidatePath(`/supplier/quotes/${normalizedQuoteId}`);

    return { ok: true, message: "Drawings uploaded and attached." };
  } catch (error) {
    console.error("[admin quote parts] drawing upload action crashed", {
      quoteId: normalizedQuoteId,
      quotePartId: normalizedPartId,
      error: serializeActionError(error),
    });
    return { ok: false, error: ADMIN_PART_DRAWING_UPLOAD_ERROR };
  }
}

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

export type QuoteStatusTransitionState =
  | { ok: true; message: string }
  | { ok: false; error: string };

const ADMIN_STATUS_TRANSITION_ERROR =
  "We couldn't update this RFQ right now. Please try again.";

export async function archiveAdminQuoteAction(
  quoteId: string,
  _prev: QuoteStatusTransitionState,
  _formData: FormData,
): Promise<QuoteStatusTransitionState> {
  const normalizedQuoteId = typeof quoteId === "string" ? quoteId.trim() : "";
  if (!normalizedQuoteId) {
    return { ok: false, error: ADMIN_QUOTE_UPDATE_ID_ERROR };
  }

  try {
    const adminUser = await requireAdminUser();

    const result = await transitionQuoteStatus({
      quoteId: normalizedQuoteId,
      action: "archive",
      actorRole: "admin",
      actorUserId: adminUser.id,
    });

    if (!result.ok) {
      if (result.reason !== "transition_denied") {
        console.error("[admin quote status] archive failed", {
          quoteId: normalizedQuoteId,
          reason: result.reason,
          error: result.error,
        });
      }
      return {
        ok: false,
        error:
          result.reason === "transition_denied"
            ? result.error
            : ADMIN_STATUS_TRANSITION_ERROR,
      };
    }

    revalidatePath("/admin/quotes");
    revalidatePath(`/admin/quotes/${normalizedQuoteId}`);
    revalidatePath("/customer/quotes");
    revalidatePath(`/customer/quotes/${normalizedQuoteId}`);
    revalidatePath("/supplier");
    revalidatePath(`/supplier/quotes/${normalizedQuoteId}`);

    return { ok: true, message: "RFQ archived." };
  } catch (error) {
    console.error("[admin quote status] archive crashed", {
      quoteId: normalizedQuoteId,
      error: serializeActionError(error),
    });
    return { ok: false, error: ADMIN_STATUS_TRANSITION_ERROR };
  }
}

export async function reopenAdminQuoteAction(
  quoteId: string,
  _prev: QuoteStatusTransitionState,
  _formData: FormData,
): Promise<QuoteStatusTransitionState> {
  const normalizedQuoteId = typeof quoteId === "string" ? quoteId.trim() : "";
  if (!normalizedQuoteId) {
    return { ok: false, error: ADMIN_QUOTE_UPDATE_ID_ERROR };
  }

  try {
    const adminUser = await requireAdminUser();

    const result = await transitionQuoteStatus({
      quoteId: normalizedQuoteId,
      action: "reopen",
      actorRole: "admin",
      actorUserId: adminUser.id,
    });

    if (!result.ok) {
      if (result.reason !== "transition_denied") {
        console.error("[admin quote status] reopen failed", {
          quoteId: normalizedQuoteId,
          reason: result.reason,
          error: result.error,
        });
      }
      return {
        ok: false,
        error:
          result.reason === "transition_denied"
            ? result.error
            : ADMIN_STATUS_TRANSITION_ERROR,
      };
    }

    revalidatePath("/admin/quotes");
    revalidatePath(`/admin/quotes/${normalizedQuoteId}`);
    revalidatePath("/customer/quotes");
    revalidatePath(`/customer/quotes/${normalizedQuoteId}`);
    revalidatePath("/supplier");
    revalidatePath(`/supplier/quotes/${normalizedQuoteId}`);

    return { ok: true, message: "RFQ reopened." };
  } catch (error) {
    console.error("[admin quote status] reopen crashed", {
      quoteId: normalizedQuoteId,
      error: serializeActionError(error),
    });
    return { ok: false, error: ADMIN_STATUS_TRANSITION_ERROR };
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
    const user = await requireAdminUser();

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

export type AdminInviteSupplierState =
  | { ok: true; message: string }
  | { ok: false; error: string; fieldErrors?: { supplierEmail?: string } };

const ADMIN_INVITE_GENERIC_ERROR =
  "We couldn't invite that supplier right now. Please try again.";
const ADMIN_INVITE_EMAIL_ERROR = "Enter a valid supplier email.";
const ADMIN_INVITE_NOT_FOUND_ERROR =
  "We couldn’t find a supplier with that email.";

export async function inviteSupplierToQuoteAction(
  quoteId: string,
  _prev: AdminInviteSupplierState,
  formData: FormData,
): Promise<AdminInviteSupplierState> {
  const normalizedQuoteId = typeof quoteId === "string" ? quoteId.trim() : "";
  const emailInput = getFormString(formData, "supplierEmail");
  const supplierEmail = normalizeEmail(emailInput);

  if (!normalizedQuoteId) {
    return { ok: false, error: ADMIN_QUOTE_UPDATE_ID_ERROR };
  }

  if (!supplierEmail) {
    return {
      ok: false,
      error: ADMIN_INVITE_EMAIL_ERROR,
      fieldErrors: { supplierEmail: ADMIN_INVITE_EMAIL_ERROR },
    };
  }

  try {
    const adminUser = await requireAdminUser();

    const { data: supplier, error: supplierError } = await supabaseServer
      .from("suppliers")
      .select("id,company_name,primary_email")
      .eq("primary_email", supplierEmail)
      .maybeSingle<{
        id: string;
        company_name: string | null;
        primary_email: string | null;
      }>();

    if (supplierError || !supplier?.id) {
      return {
        ok: false,
        error: ADMIN_INVITE_NOT_FOUND_ERROR,
        fieldErrors: { supplierEmail: ADMIN_INVITE_NOT_FOUND_ERROR },
      };
    }

    const { data: existingInvite } = await supabaseServer
      .from("quote_invites")
      .select("id")
      .eq("quote_id", normalizedQuoteId)
      .eq("supplier_id", supplier.id)
      .maybeSingle<{ id: string }>();
    const isNewInvite = !existingInvite;

    const { error: inviteError } = await supabaseServer
      .from("quote_invites")
      .upsert(
        { quote_id: normalizedQuoteId, supplier_id: supplier.id },
        { onConflict: "quote_id,supplier_id" },
      );

    if (inviteError) {
      console.error("[admin invites] upsert failed", {
        quoteId: normalizedQuoteId,
        supplierId: supplier.id,
        error: inviteError,
      });
      return { ok: false, error: ADMIN_INVITE_GENERIC_ERROR };
    }

    // Back-compat: populate assigned supplier fields so legacy views/notifications still work.
    const { error: quoteUpdateError } = await supabaseServer
      .from("quotes")
      .update({
        assigned_supplier_email: supplier.primary_email ?? supplierEmail,
        updated_at: new Date().toISOString(),
      })
      .eq("id", normalizedQuoteId);

    if (quoteUpdateError) {
      console.error(
        "[admin invites] quote assignment update failed",
        {
          quoteId: normalizedQuoteId,
          supplierId: supplier.id,
          pgCode: quoteUpdateError.code ?? null,
          pgMessage: quoteUpdateError.message ?? null,
        },
      );
    }

    if (isNewInvite) {
      void emitQuoteEvent({
        quoteId: normalizedQuoteId,
        eventType: "supplier_invited",
        actorRole: "admin",
        actorUserId: adminUser.id,
        metadata: {
          supplier_id: supplier.id,
          supplier_name: supplier.company_name ?? supplier.primary_email ?? null,
          supplier_email: supplier.primary_email ?? supplierEmail,
        },
      });
    }

    revalidatePath(`/admin/quotes/${normalizedQuoteId}`);
    revalidatePath("/admin/quotes");
    revalidatePath("/supplier");
    revalidatePath(`/supplier/quotes/${normalizedQuoteId}`);

    return {
      ok: true,
      message: isNewInvite ? "Supplier invited." : "Supplier invite already exists.",
    };
  } catch (error) {
    console.error("[admin invites] action crashed", {
      quoteId: normalizedQuoteId,
      supplierEmail,
      error: serializeActionError(error),
    });
    return { ok: false, error: ADMIN_INVITE_GENERIC_ERROR };
  }
}

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;
  if (!trimmed.includes("@")) return null;
  return trimmed;
}

export type AdminCapacityUpdateRequestState =
  | { ok: true; message: string }
  | { ok: false; error: string }
  | { ok: false; reason: "recent_request_exists" };

const ADMIN_CAPACITY_REQUEST_OK = "Request sent";
const ADMIN_CAPACITY_REQUEST_ERROR =
  "We couldn't send that request right now.";

let didWarnCapacityRequestSuppressed = false;
let didWarnMissingCapacitySnapshotsSchemaForSuppression = false;

async function loadSupplierCapacityLastUpdatedAtForWeek(args: {
  supplierId: string;
  weekStartDate: string;
}): Promise<string | null> {
  const supplierId = typeof args?.supplierId === "string" ? args.supplierId.trim() : "";
  const weekStartDate =
    typeof args?.weekStartDate === "string" ? args.weekStartDate.trim() : "";
  if (!supplierId || !weekStartDate) return null;

  try {
    const { data, error } = await supabaseServer
      .from("supplier_capacity_snapshots")
      .select("created_at")
      .eq("supplier_id", supplierId)
      .eq("week_start_date", weekStartDate)
      .order("created_at", { ascending: false })
      .limit(1)
      .returns<Array<{ created_at: string }>>();

    if (error) {
      if (isMissingTableOrColumnError(error)) {
        if (!didWarnMissingCapacitySnapshotsSchemaForSuppression) {
          didWarnMissingCapacitySnapshotsSchemaForSuppression = true;
          console.warn("[capacity request] capacity snapshot lookup skipped (missing schema)", {
            supplierId,
            weekStartDate,
            error: serializeSupabaseError(error),
          });
        }
        return null;
      }

      console.error("[capacity request] capacity snapshot lookup failed", {
        supplierId,
        weekStartDate,
        error: serializeSupabaseError(error),
      });
      return null;
    }

    const createdAt =
      Array.isArray(data) && typeof data[0]?.created_at === "string" ? data[0].created_at : null;
    return createdAt;
  } catch (error) {
    if (isMissingTableOrColumnError(error)) {
      if (!didWarnMissingCapacitySnapshotsSchemaForSuppression) {
        didWarnMissingCapacitySnapshotsSchemaForSuppression = true;
        console.warn("[capacity request] capacity snapshot lookup crashed (missing schema)", {
          supplierId,
          weekStartDate,
          error: serializeSupabaseError(error),
        });
      }
      return null;
    }

    console.error("[capacity request] capacity snapshot lookup crashed", {
      supplierId,
      weekStartDate,
      error: serializeSupabaseError(error) ?? error,
    });
    return null;
  }
}

export async function requestCapacityUpdateAction(
  quoteId: string,
  supplierId: string,
  weekStartDate: string,
  reason: CapacityUpdateRequestReason,
  _prev: AdminCapacityUpdateRequestState,
  _formData: FormData,
): Promise<AdminCapacityUpdateRequestState> {
  const normalizedQuoteId = typeof quoteId === "string" ? quoteId.trim() : "";
  const normalizedSupplierId =
    typeof supplierId === "string" ? supplierId.trim() : "";
  const normalizedWeekStartDate =
    typeof weekStartDate === "string" ? weekStartDate.trim() : "";

  if (!normalizedQuoteId || !normalizedSupplierId || !normalizedWeekStartDate) {
    return { ok: false, error: ADMIN_QUOTE_UPDATE_ID_ERROR };
  }

  try {
    const adminUser = await requireAdminUser();

    const [recentRequest, supplierCapacityLastUpdatedAt] = await Promise.all([
      loadRecentCapacityUpdateRequest({
        supplierId: normalizedSupplierId,
        weekStartDate: normalizedWeekStartDate,
        lookbackDays: 7,
      }),
      loadSupplierCapacityLastUpdatedAtForWeek({
        supplierId: normalizedSupplierId,
        weekStartDate: normalizedWeekStartDate,
      }),
    ]);

    const suppressed = isCapacityRequestSuppressed({
      requestCreatedAt: recentRequest.createdAt,
      supplierLastUpdatedAt: supplierCapacityLastUpdatedAt,
    });

    if (suppressed) {
      if (!didWarnCapacityRequestSuppressed) {
        didWarnCapacityRequestSuppressed = true;
        console.warn("[capacity request] suppressed due to recent request", {
          quoteId: normalizedQuoteId,
          supplierId: normalizedSupplierId,
          weekStartDate: normalizedWeekStartDate,
          requestCreatedAt: recentRequest.createdAt,
          supplierCapacityLastUpdatedAt,
        });
      }
      return { ok: false, reason: "recent_request_exists" };
    }

    // Fire-and-forget semantics: do not block UI on insert success.
    void requestSupplierCapacityUpdate({
      quoteId: normalizedQuoteId,
      supplierId: normalizedSupplierId,
      weekStartDate: normalizedWeekStartDate,
      reason,
      actorUserId: adminUser.id,
    });

    revalidatePath(`/admin/quotes/${normalizedQuoteId}`);
    revalidatePath(`/supplier/quotes/${normalizedQuoteId}`);

    return { ok: true, message: ADMIN_CAPACITY_REQUEST_OK };
  } catch (error) {
    console.error("[admin capacity request] action crashed", {
      quoteId: normalizedQuoteId,
      supplierId: normalizedSupplierId,
      weekStartDate: normalizedWeekStartDate,
      reason,
      error: serializeActionError(error),
    });
    return { ok: false, error: ADMIN_CAPACITY_REQUEST_ERROR };
  }
}

