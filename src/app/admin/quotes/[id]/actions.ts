"use server";

import { revalidatePath } from "next/cache";
import { getFormString, serializeActionError } from "@/lib/forms";
import { supabaseServer } from "@/lib/supabaseServer";
import { notifyOnNewQuoteMessage } from "@/server/quotes/notifications";
import {
  getServerAuthUser,
  requireAdminUser,
  requireUser,
  UnauthorizedError,
} from "@/server/auth";
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
import { postQuoteMessage as postUnifiedQuoteMessage } from "@/server/messages/quoteMessages";
import type { QuoteMessageRecord } from "@/server/quotes/messages";
import type { QuoteMessageFormState } from "@/app/(portals)/components/QuoteMessagesThread.types";
import { upsertQuoteProject } from "@/server/quotes/projects";
import {
  performAwardFlow,
  type AwardFailureReason,
} from "@/server/quotes/award";
import { emitQuoteEvent } from "@/server/quotes/events";
import { emitRfqEvent } from "@/server/rfqs/events";
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
import { logOpsEvent } from "@/server/ops/events";
import {
  getEligibleProvidersForQuote,
  resolveProviderEligibilityCriteriaForQuote,
} from "@/server/providers/eligibility";
import { parseRfqOfferStatus } from "@/server/rfqs/offers";
import {
  buildDestinationOutboundEmail,
  buildDestinationWebFormInstructions,
} from "@/server/rfqs/outboundEmail";
import { buildAwardEmail } from "@/server/quotes/awardEmail";
import type { RfqDestinationStatus } from "@/server/rfqs/destinations";
import { DESTINATION_STATUS_VALUES } from "@/lib/rfq/destinationStatus";
import { MAX_UPLOAD_BYTES, formatMaxUploadSize } from "@/lib/uploads/uploadLimits";
import { hasColumns, schemaGate } from "@/server/db/schemaContract";
import {
  ensureDefaultKickoffTasksForQuote,
  updateKickoffTaskStatusAction,
  type QuoteKickoffTaskStatus,
} from "@/server/quotes/kickoffTasks";
import { deriveProviderQuoteMismatch } from "@/lib/provider/quoteMismatch";
import { writeRfqOffer } from "@/server/rfqs/writeRfqOffer";
import {
  findCustomerExclusionMatch,
  loadCustomerExclusions,
} from "@/server/customers/exclusions";

export type { AwardBidFormState } from "./awardFormState";

const ADMIN_AWARD_GENERIC_ERROR =
  "We couldn't update the award state. Please try again.";
const ADMIN_AWARD_BID_ERROR =
  "We couldn't verify that bid. Please retry.";
const ADMIN_AWARD_ALREADY_WON_ERROR =
  "A winning supplier has already been selected for this quote.";
const ADMIN_AWARD_PROVIDER_GENERIC_ERROR =
  "We couldn't record the awarded provider. Please try again.";
const ADMIN_AWARD_PROVIDER_ALREADY_SET_ERROR =
  "This quote was already awarded. Refresh to see the latest state.";
const ADMIN_AWARD_PROVIDER_ID_ERROR = "Select a provider.";
const ADMIN_AWARD_PROVIDER_OFFER_MISMATCH_ERROR =
  "Selected offer does not belong to this provider.";
const ADMIN_AWARD_PROVIDER_OFFER_NOT_FOUND_ERROR =
  "We couldn't verify that offer. Please retry.";
const ADMIN_AWARD_PROVIDER_NOTES_LENGTH_ERROR =
  "Notes must be 2000 characters or fewer.";

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

export type AwardProviderFormState =
  | { status: "idle" }
  | { status: "success"; message: string }
  | {
      status: "error";
      error: string;
      fieldErrors?: { providerId?: string; offerId?: string; awardNotes?: string };
    };

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
const ADMIN_QUOTE_CONFIDENCE_SCORE_ERROR =
  "Confidence score must be between 0 and 100.";

export type UpsertRfqOfferState =
  | { ok: true; message: string; offerId: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

export type GenerateDestinationEmailActionResult =
  | { ok: true; subject: string; body: string }
  | { ok: false; error: string };

export type GenerateDestinationWebFormInstructionsActionResult =
  | { ok: true; url: string; instructions: string }
  | { ok: false; error: string };

export type GenerateAwardEmailActionResult =
  | { ok: true; subject: string; body: string }
  | { ok: false; error: string };

const ADMIN_RFQ_OFFER_GENERIC_ERROR =
  "We couldn't save this offer right now. Please try again.";
const ADMIN_RFQ_OFFER_AUTH_ERROR = "You must be signed in to update offers.";
const ADMIN_RFQ_OFFER_ID_ERROR = "We couldn't determine which RFQ to update.";
const ADMIN_RFQ_OFFER_PROVIDER_ERROR = "Select a provider.";
const ADMIN_RFQ_OFFER_STATUS_ERROR = "Select a valid offer status.";
const ADMIN_RFQ_OFFER_CONFIDENCE_ERROR =
  "Confidence score must be between 0 and 100.";
const ADMIN_RFQ_OFFER_VALIDATION_ERROR =
  "Check the offer details and try again.";
const ADMIN_RFQ_OFFER_NUMBER_ERROR = "Enter a valid number.";
const ADMIN_RFQ_OFFER_INTEGER_ERROR = "Enter a whole number.";
const ADMIN_RFQ_OFFER_LEAD_TIME_RANGE_ERROR =
  "Lead time min must be less than or equal to max.";
const ADMIN_DESTINATIONS_GENERIC_ERROR =
  "We couldn't update destinations right now. Please try again.";
const ADMIN_DESTINATIONS_INPUT_ERROR = "Select at least one provider.";
const ADMIN_DESTINATIONS_MISMATCH_OVERRIDE_ERROR =
  "Mismatch selected. Add a short override reason to continue.";
const ADMIN_DESTINATION_STATUS_ERROR = "Select a valid destination status.";
const ADMIN_DESTINATION_SUBMITTED_NOTES_ERROR =
  "Add at least 5 characters of notes for web form submissions.";
const ADMIN_DESTINATION_SUBMITTED_SCHEMA_ERROR =
  "Submission tracking isn't enabled in this environment yet.";
const ADMIN_DESTINATION_SUBMITTED_ERROR =
  "We couldn't mark this destination as submitted right now. Please try again.";
const ADMIN_DESTINATION_EMAIL_ERROR =
  "We couldn't generate this RFQ email right now. Please try again.";
const ADMIN_DESTINATION_WEB_FORM_ERROR =
  "We couldn't generate the RFQ instructions right now. Please try again.";
const ADMIN_AWARD_EMAIL_ERROR =
  "We couldn't generate the award email right now. Please try again.";

export type CreateExternalOfferResult =
  | { ok: true; offerId: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

const EXTERNAL_OFFER_GENERIC_ERROR =
  "We couldn’t add this external offer right now. Please try again.";
const EXTERNAL_OFFER_VALIDATION_ERROR = "Please review the highlighted fields.";
const EXTERNAL_OFFER_PRICE_ERROR = "Enter a valid price greater than 0.";
const EXTERNAL_OFFER_LEAD_TIME_ERROR = "Enter a lead time in days greater than 0.";
const EXTERNAL_OFFER_SOURCE_TYPE_ERROR = "Select a valid source type.";

const EXTERNAL_OFFER_PROCESS_OPTIONS = new Set([
  "CNC",
  "3DP",
  "Sheet Metal",
  "Injection Molding",
]);

const EXTERNAL_OFFER_SOURCE_TYPES = new Set(["manual", "marketplace", "network"]);

export async function createExternalOfferAction(args: {
  quoteId: string;
  price: number;
  leadTimeDays: number;
  process?: string | null;
  notes?: string | null;
  sourceType?: string | null;
  sourceName?: string | null;
  internalCost?: number | null;
  sourceUrl?: string | null;
  internalNotes?: string | null;
}): Promise<CreateExternalOfferResult> {
  const quoteId = normalizeIdInput(args.quoteId);
  if (!quoteId) {
    return { ok: false, error: ADMIN_QUOTE_UPDATE_ID_ERROR };
  }

  try {
    await requireAdminUser();
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return { ok: false, error: ADMIN_RFQ_OFFER_AUTH_ERROR };
    }
    throw error;
  }

  const price =
    typeof args.price === "number" && Number.isFinite(args.price) ? args.price : NaN;
  const leadTimeDaysRaw =
    typeof args.leadTimeDays === "number" && Number.isFinite(args.leadTimeDays)
      ? args.leadTimeDays
      : NaN;
  const leadTimeDays = Number.isInteger(leadTimeDaysRaw) ? leadTimeDaysRaw : NaN;
  const processRaw = typeof args.process === "string" ? args.process.trim() : "";
  const notesRaw = typeof args.notes === "string" ? args.notes.trim() : "";
  const sourceTypeRaw = typeof args.sourceType === "string" ? args.sourceType.trim() : "";
  const sourceNameRaw = typeof args.sourceName === "string" ? args.sourceName.trim() : "";
  const internalNotesRaw = typeof args.internalNotes === "string" ? args.internalNotes.trim() : "";
  const sourceUrlRaw = typeof args.sourceUrl === "string" ? args.sourceUrl.trim() : "";
  const internalCostRaw = typeof args.internalCost === "number" ? args.internalCost : null;

  const fieldErrors: Record<string, string> = {};
  if (!Number.isFinite(price) || price <= 0) {
    fieldErrors.price = EXTERNAL_OFFER_PRICE_ERROR;
  }
  if (!Number.isFinite(leadTimeDays) || leadTimeDays <= 0) {
    fieldErrors.leadTimeDays = EXTERNAL_OFFER_LEAD_TIME_ERROR;
  }
  if (sourceTypeRaw && !EXTERNAL_OFFER_SOURCE_TYPES.has(sourceTypeRaw)) {
    fieldErrors.sourceType = EXTERNAL_OFFER_SOURCE_TYPE_ERROR;
  }
  if (processRaw && !EXTERNAL_OFFER_PROCESS_OPTIONS.has(processRaw)) {
    fieldErrors.process = "Select a valid process.";
  }
  if (notesRaw.length > 2000) {
    fieldErrors.notes = "Notes must be 2000 characters or fewer.";
  }
  if (sourceNameRaw.length > 200) {
    fieldErrors.sourceName = "Source name must be 200 characters or fewer.";
  }
  if (internalNotesRaw.length > 5000) {
    fieldErrors.internalNotes = "Internal notes must be 5000 characters or fewer.";
  }
  if (sourceUrlRaw.length > 5000) {
    fieldErrors.sourceUrl = "Source URL must be 5000 characters or fewer.";
  }
  if (internalCostRaw !== null) {
    if (!Number.isFinite(internalCostRaw) || internalCostRaw < 0) {
      fieldErrors.internalCost = "Enter a valid internal cost (0 or greater).";
    }
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, error: EXTERNAL_OFFER_VALIDATION_ERROR, fieldErrors };
  }

  try {
    const now = new Date().toISOString();

    const extraOfferColumns: Record<string, unknown> = {};

    // Optional provenance metadata (schema-gated).
    try {
      // Back-compat: older environments used admin_* columns for internal-only metadata.
      const supportsLegacyExternalMeta = await hasColumns("rfq_offers", [
        "admin_source_type",
        "admin_source_name",
        "process",
      ]);
      if (supportsLegacyExternalMeta) {
        if (sourceTypeRaw) extraOfferColumns.admin_source_type = sourceTypeRaw;
        if (sourceNameRaw) extraOfferColumns.admin_source_name = sourceNameRaw;
        if (processRaw) extraOfferColumns.process = processRaw;
      }
    } catch {
      // ignore
    }

    // Optional internal tracking fields (schema-gated).
    try {
      const supportsInternalTracking = await hasColumns("rfq_offers", [
        "internal_cost",
        "internal_shipping_cost",
        "internal_notes",
        "source_url",
      ]);
      if (supportsInternalTracking) {
        if (internalCostRaw !== null) extraOfferColumns.internal_cost = internalCostRaw;
        if (internalNotesRaw) extraOfferColumns.internal_notes = internalNotesRaw;
        if (sourceUrlRaw) extraOfferColumns.source_url = sourceUrlRaw;
      }
    } catch {
      // ignore
    }

    const result = await writeRfqOffer({
      rfqId: quoteId,
      providerId: null, // external/broker offers are not tied to internal suppliers
      destinationId: null,
      currency: "USD",
      totalPrice: price,
      leadTimeDaysMin: leadTimeDays,
      leadTimeDaysMax: leadTimeDays,
      status: "quoted",
      receivedAt: now,
      notes: notesRaw || null,
      sourceType: sourceTypeRaw || null,
      sourceName: sourceNameRaw || null,
      extraOfferColumns,
      actorSource: "admin_external_offer",
      deps: { client: supabaseServer() },
    });

    if (!result.ok) {
      if (result.reason === "customer_exclusion") {
        return { ok: false, error: result.error };
      }
      return { ok: false, error: EXTERNAL_OFFER_GENERIC_ERROR };
    }

    revalidatePath("/admin/quotes");
    revalidatePath(`/admin/quotes/${quoteId}`);
    revalidatePath("/admin/ops/inbox");
    revalidatePath("/rfq");
    revalidatePath(`/customer/quotes/${quoteId}`);
    revalidatePath("/customer/quotes");

    return { ok: true, offerId: result.offerId };
  } catch (error) {
    console.error("[admin external offer] action crashed", {
      quoteId,
      error: serializeActionError(error),
    });
    return { ok: false, error: EXTERNAL_OFFER_GENERIC_ERROR };
  }
}

export type CustomerExclusionRow = {
  id: string;
  customer_id: string;
  excluded_provider_id: string | null;
  excluded_source_name: string | null;
  reason: string | null;
  created_at: string | null;
};

export type CustomerExclusionActionResult =
  | { ok: true }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

const CUSTOMER_EXCLUSION_GENERIC_ERROR =
  "We couldn’t update exclusions right now. Please try again.";

export async function addCustomerExclusionAction(args: {
  quoteId: string;
  customerId: string;
  excludedProviderId?: string | null;
  excludedSourceName?: string | null;
  reason?: string | null;
}): Promise<CustomerExclusionActionResult> {
  const quoteId = normalizeIdInput(args.quoteId);
  const customerId = normalizeIdInput(args.customerId);
  const excludedProviderId = normalizeIdInput(args.excludedProviderId);
  const excludedSourceName =
    typeof args.excludedSourceName === "string" ? args.excludedSourceName.trim() : "";
  const reason = typeof args.reason === "string" ? args.reason.trim() : "";

  if (!quoteId || !customerId) {
    return { ok: false, error: CUSTOMER_EXCLUSION_GENERIC_ERROR };
  }

  try {
    await requireAdminUser();
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return { ok: false, error: ADMIN_RFQ_OFFER_AUTH_ERROR };
    }
    throw error;
  }

  const fieldErrors: Record<string, string> = {};
  if (excludedSourceName.length > 200) {
    fieldErrors.excludedSourceName = "Source name must be 200 characters or fewer.";
  }
  if (reason.length > 500) {
    fieldErrors.reason = "Reason must be 500 characters or fewer.";
  }
  if (!excludedProviderId && excludedSourceName.length === 0) {
    const message = "Select a provider or enter a source name.";
    fieldErrors.excludedProviderId = message;
    fieldErrors.excludedSourceName = message;
  }
  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, error: "Please review the highlighted fields.", fieldErrors };
  }

  try {
    const payload: Record<string, unknown> = {
      customer_id: customerId,
      excluded_provider_id: excludedProviderId || null,
      excluded_source_name: excludedSourceName || null,
      reason: reason || null,
    };

    const { error } = await supabaseServer().from("customer_exclusions").insert(payload);
    if (error) {
      const serialized = serializeSupabaseError(error);
      if (serialized.code === "23505") {
        return { ok: false, error: "That exclusion already exists." };
      }
      if (!isMissingTableOrColumnError(error)) {
        console.error("[customer exclusions] insert failed", {
          quoteId,
          customerId,
          error: serialized,
        });
      }
      return { ok: false, error: CUSTOMER_EXCLUSION_GENERIC_ERROR };
    }

    revalidatePath(`/admin/quotes/${quoteId}`);
    return { ok: true };
  } catch (error) {
    console.error("[customer exclusions] insert crashed", {
      quoteId,
      customerId,
      error: serializeActionError(error),
    });
    return { ok: false, error: CUSTOMER_EXCLUSION_GENERIC_ERROR };
  }
}

export async function removeCustomerExclusionAction(args: {
  quoteId: string;
  customerId: string;
  exclusionId: string;
}): Promise<CustomerExclusionActionResult> {
  const quoteId = normalizeIdInput(args.quoteId);
  const customerId = normalizeIdInput(args.customerId);
  const exclusionId = normalizeIdInput(args.exclusionId);

  if (!quoteId || !customerId || !exclusionId) {
    return { ok: false, error: CUSTOMER_EXCLUSION_GENERIC_ERROR };
  }

  try {
    await requireAdminUser();
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return { ok: false, error: ADMIN_RFQ_OFFER_AUTH_ERROR };
    }
    throw error;
  }

  try {
    const { error } = await supabaseServer()
      .from("customer_exclusions")
      .delete()
      .eq("id", exclusionId)
      .eq("customer_id", customerId);

    if (error) {
      if (!isMissingTableOrColumnError(error)) {
        console.error("[customer exclusions] delete failed", {
          quoteId,
          customerId,
          exclusionId,
          error: serializeSupabaseError(error) ?? error,
        });
      }
      return { ok: false, error: CUSTOMER_EXCLUSION_GENERIC_ERROR };
    }

    revalidatePath(`/admin/quotes/${quoteId}`);
    return { ok: true };
  } catch (error) {
    console.error("[customer exclusions] delete crashed", {
      quoteId,
      customerId,
      exclusionId,
      error: serializeActionError(error),
    });
    return { ok: false, error: CUSTOMER_EXCLUSION_GENERIC_ERROR };
  }
}

export async function updateAdminKickoffTaskAction(args: {
  quoteId: string;
  taskKey: string;
  status: QuoteKickoffTaskStatus;
  blockedReason?: string | null;
  title?: string;
  description?: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const quoteId = normalizeIdInput(args.quoteId);
  const taskKey = normalizeIdInput(args.taskKey);
  const status = args.status;
  const blockedReason =
    args.blockedReason === null
      ? null
      : typeof args.blockedReason === "string"
        ? args.blockedReason
        : undefined;
  const title = typeof args.title === "string" ? args.title : undefined;
  const description =
    typeof args.description === "undefined"
      ? undefined
      : args.description === null
        ? null
        : typeof args.description === "string"
          ? args.description
          : undefined;

  if (!quoteId || !taskKey) {
    return { ok: false, error: ADMIN_QUOTE_UPDATE_ID_ERROR };
  }

  try {
    await requireAdminUser();
    // Ensure tasks exist (idempotent) so edits don't race older awards.
    await ensureDefaultKickoffTasksForQuote(quoteId);

    const result = await updateKickoffTaskStatusAction({
      quoteId,
      taskKey,
      status,
      blockedReason,
      title,
      description,
    });

    if (!result.ok) {
      return { ok: false, error: "We couldn’t update kickoff tasks. Please try again." };
    }

    revalidatePath(`/admin/quotes/${quoteId}`);
    revalidatePath(`/supplier/quotes/${quoteId}`);
    revalidatePath(`/customer/quotes/${quoteId}`);

    return { ok: true };
  } catch (error) {
    console.error("[admin kickoff review] update crashed", {
      quoteId,
      taskKey,
      error: serializeActionError(error),
    });
    return { ok: false, error: "We couldn’t update kickoff tasks. Please try again." };
  }
}

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

    const { data: existingRows, error: existingError } = await supabaseServer()
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

export async function awardProviderForQuoteAction(
  quoteId: string,
  _prevState: AwardProviderFormState,
  formData: FormData,
): Promise<AwardProviderFormState> {
  const normalizedQuoteId = typeof quoteId === "string" ? quoteId.trim() : "";
  const providerIdRaw = getFormString(formData, "providerId");
  const offerIdRaw = getFormString(formData, "offerId");
  const notesRaw = getFormString(formData, "awardNotes");

  const providerId = typeof providerIdRaw === "string" ? providerIdRaw.trim() : "";
  const offerId =
    typeof offerIdRaw === "string" && offerIdRaw.trim().length > 0
      ? offerIdRaw.trim()
      : null;
  const awardNotes =
    typeof notesRaw === "string" && notesRaw.trim().length > 0 ? notesRaw.trim() : null;

  if (!normalizedQuoteId) {
    return { status: "error", error: ADMIN_QUOTE_UPDATE_ID_ERROR };
  }
  if (!providerId) {
    return {
      status: "error",
      error: ADMIN_AWARD_PROVIDER_ID_ERROR,
      fieldErrors: { providerId: ADMIN_AWARD_PROVIDER_ID_ERROR },
    };
  }
  if (awardNotes && awardNotes.length > 2000) {
    return {
      status: "error",
      error: ADMIN_AWARD_PROVIDER_NOTES_LENGTH_ERROR,
      fieldErrors: { awardNotes: ADMIN_AWARD_PROVIDER_NOTES_LENGTH_ERROR },
    };
  }

  try {
    const adminUser = await requireAdminUser();

    const schemaReady = await schemaGate({
      enabled: true,
      relation: "quotes",
      requiredColumns: [
        "id",
        "awarded_at",
        "awarded_by_user_id",
        "awarded_by_role",
        "awarded_provider_id",
        "awarded_offer_id",
        "award_notes",
      ],
      warnPrefix: "[admin award provider]",
      warnKey: "admin_award_provider:quotes_missing_schema",
    });
    if (!schemaReady) {
      return { status: "error", error: ADMIN_AWARD_PROVIDER_GENERIC_ERROR };
    }

    const { data: existing, error: existingError } = await supabaseServer()
      .from("quotes")
      .select(
        "id,awarded_bid_id,awarded_supplier_id,awarded_at,awarded_provider_id,awarded_offer_id",
      )
      .eq("id", normalizedQuoteId)
      .maybeSingle<{
        id: string;
        awarded_bid_id: string | null;
        awarded_supplier_id: string | null;
        awarded_at: string | null;
        awarded_provider_id: string | null;
        awarded_offer_id: string | null;
      }>();

    if (existingError) {
      if (!isMissingTableOrColumnError(existingError)) {
        console.error("[admin award provider] quote lookup failed", {
          quoteId: normalizedQuoteId,
          error: serializeSupabaseError(existingError),
        });
      }
      return { status: "error", error: ADMIN_AWARD_PROVIDER_GENERIC_ERROR };
    }
    if (!existing?.id) {
      return { status: "error", error: ADMIN_QUOTE_UPDATE_ID_ERROR };
    }

    const alreadyAwardedToBid =
      Boolean((existing.awarded_bid_id ?? "").trim()) ||
      Boolean((existing.awarded_supplier_id ?? "").trim());
    if (alreadyAwardedToBid) {
      return { status: "error", error: ADMIN_AWARD_PROVIDER_ALREADY_SET_ERROR };
    }

    const existingProviderId =
      typeof existing.awarded_provider_id === "string" ? existing.awarded_provider_id.trim() : "";
    const existingOfferId =
      typeof existing.awarded_offer_id === "string" ? existing.awarded_offer_id.trim() : "";

    // Idempotency: if already awarded to the same provider/offer, treat as success.
    if (
      existingProviderId &&
      existingProviderId === providerId &&
      (offerId ? existingOfferId === offerId : !existingOfferId)
    ) {
      return { status: "success", message: "Award already recorded." };
    }

    if (offerId) {
      const offerSchemaReady = await schemaGate({
        enabled: true,
        relation: "rfq_offers",
        requiredColumns: ["id", "rfq_id", "provider_id"],
        warnPrefix: "[admin award provider]",
        warnKey: "admin_award_provider:offers_missing_schema",
      });
      if (!offerSchemaReady) {
        return { status: "error", error: ADMIN_AWARD_PROVIDER_OFFER_NOT_FOUND_ERROR };
      }

      const { data: offer, error: offerError } = await supabaseServer()
        .from("rfq_offers")
        .select("id,rfq_id,provider_id")
        .eq("id", offerId)
        .maybeSingle<{ id: string; rfq_id: string | null; provider_id: string | null }>();

      if (offerError) {
        if (!isMissingTableOrColumnError(offerError)) {
          console.error("[admin award provider] offer lookup failed", {
            quoteId: normalizedQuoteId,
            offerId,
            error: serializeSupabaseError(offerError),
          });
        }
        return { status: "error", error: ADMIN_AWARD_PROVIDER_OFFER_NOT_FOUND_ERROR };
      }

      if (!offer?.id || offer.rfq_id !== normalizedQuoteId) {
        return { status: "error", error: ADMIN_AWARD_PROVIDER_OFFER_NOT_FOUND_ERROR };
      }
      const offerProviderId = typeof offer.provider_id === "string" ? offer.provider_id.trim() : "";
      if (!offerProviderId) {
        return { status: "error", error: ADMIN_AWARD_PROVIDER_OFFER_NOT_FOUND_ERROR };
      }
      if (offerProviderId !== providerId) {
        return {
          status: "error",
          error: ADMIN_AWARD_PROVIDER_OFFER_MISMATCH_ERROR,
          fieldErrors: { offerId: ADMIN_AWARD_PROVIDER_OFFER_MISMATCH_ERROR },
        };
      }
    }

    const now = new Date().toISOString();
    const awardedAt =
      typeof existing.awarded_at === "string" && existing.awarded_at.trim().length > 0
        ? existing.awarded_at
        : now;

    const { error: updateError } = await supabaseServer()
      .from("quotes")
      .update({
        status: "won",
        awarded_at: awardedAt,
        awarded_by_user_id: adminUser.id,
        awarded_by_role: "admin",
        awarded_provider_id: providerId,
        awarded_offer_id: offerId,
        award_notes: awardNotes,
        updated_at: now,
      })
      .eq("id", normalizedQuoteId);

    if (updateError) {
      if (!isMissingTableOrColumnError(updateError)) {
        console.error("[admin award provider] update failed", {
          quoteId: normalizedQuoteId,
          providerId,
          offerId,
          error: serializeSupabaseError(updateError),
        });
      }
      return { status: "error", error: ADMIN_AWARD_PROVIDER_GENERIC_ERROR };
    }

    // Phase 18.2.1: ensure quote-level kickoff tasks exist immediately after award.
    // Best-effort: do not block award if schema isn't migrated yet.
    try {
      await ensureDefaultKickoffTasksForQuote(normalizedQuoteId);
    } catch (error) {
      console.warn("[admin award provider] kickoff task seed skipped (best-effort)", {
        quoteId: normalizedQuoteId,
        error: serializeActionError(error),
      });
    }

    // Best-effort timeline event; do not block award.
    void emitQuoteEvent({
      quoteId: normalizedQuoteId,
      eventType: "quote_awarded",
      actorRole: "admin",
      actorUserId: adminUser.id,
      metadata: {
        provider_id: providerId,
        offer_id: offerId ?? null,
        award_notes: awardNotes ?? null,
        awarded_by_role: "admin",
      },
      createdAt: awardedAt,
    });

    // Best-effort RFQ event log.
    void emitRfqEvent({
      rfqId: normalizedQuoteId,
      eventType: "awarded",
      actorRole: "admin",
      actorUserId: adminUser.id,
      createdAt: awardedAt,
    });

    revalidatePath("/admin/quotes");
    revalidatePath(`/admin/quotes/${normalizedQuoteId}`);
    revalidatePath("/customer/quotes");
    revalidatePath(`/customer/quotes/${normalizedQuoteId}`);
    revalidatePath("/supplier/quotes");
    revalidatePath(`/supplier/quotes/${normalizedQuoteId}`);

    return { status: "success", message: "Award recorded." };
  } catch (error) {
    console.error("[admin award provider] action crashed", {
      quoteId: normalizedQuoteId,
      providerId,
      offerId,
      error: serializeActionError(error),
    });
    return { status: "error", error: ADMIN_AWARD_PROVIDER_GENERIC_ERROR };
  }
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

    const confidenceScoreRaw = getFormString(formData, "confidenceScore");
    const confidenceScoreInput =
      typeof confidenceScoreRaw === "string" ? confidenceScoreRaw.trim() : "";
    const confidenceScore =
      confidenceScoreInput.length > 0 ? Number(confidenceScoreInput) : null;

    if (
      confidenceScore !== null &&
      (!Number.isFinite(confidenceScore) ||
        confidenceScore < 0 ||
        confidenceScore > 100)
    ) {
      return { ok: false, error: ADMIN_QUOTE_CONFIDENCE_SCORE_ERROR };
    }

    const payload: AdminQuoteUpdateInput = {
      quoteId: normalizedQuoteId,
      status: getFormString(formData, "status"),
      price: getFormString(formData, "price"),
      confidenceScore,
      currency: getFormString(formData, "currency"),
      targetDate: getFormString(formData, "targetDate"),
      dfmNotes: getFormString(formData, "dfmNotes"),
      internalNotes: getFormString(formData, "internalNotes"),
      opsStatus: getFormString(formData, "opsStatus"),
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

export async function upsertRfqOffer(
  rfqId: string,
  _prevState: UpsertRfqOfferState,
  formData: FormData,
): Promise<UpsertRfqOfferState> {
  try {
    try {
      await requireAdminUser();
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        return { ok: false, error: ADMIN_RFQ_OFFER_AUTH_ERROR };
      }
      throw error;
    }

    const normalizedRfqId = normalizeIdInput(rfqId);
    if (!normalizedRfqId) {
      return { ok: false, error: ADMIN_RFQ_OFFER_ID_ERROR };
    }

    const providerId = normalizeIdInput(getFormString(formData, "providerId"));
    if (!providerId) {
      return {
        ok: false,
        error: ADMIN_RFQ_OFFER_PROVIDER_ERROR,
        fieldErrors: { providerId: ADMIN_RFQ_OFFER_PROVIDER_ERROR },
      };
    }

    // Customer exclusions: block saving offers for excluded providers (admin sees clear error).
    try {
      const { data: quoteRow, error: quoteError } = await supabaseServer()
        .from("quotes")
        .select("customer_id")
        .eq("id", normalizedRfqId)
        .maybeSingle<{ customer_id: string | null }>();
      if (!quoteError) {
        const customerId = normalizeIdInput(quoteRow?.customer_id);
        if (customerId) {
          const exclusions = await loadCustomerExclusions(customerId);
          const match = findCustomerExclusionMatch({
            exclusions,
            providerId,
            sourceName: null,
          });
          if (match?.kind === "provider") {
            const message = "This customer excludes offers from the selected provider.";
            return {
              ok: false,
              error: message,
              fieldErrors: { providerId: message },
            };
          }
        }
      }
    } catch {
      // Best-effort: do not crash admin offer editor if exclusion lookup fails.
    }

    const statusInput = getFormString(formData, "status");
    const status =
      typeof statusInput === "string" && statusInput.trim().length > 0
        ? parseRfqOfferStatus(statusInput)
        : "received";
    if (!status) {
      return {
        ok: false,
        error: ADMIN_RFQ_OFFER_STATUS_ERROR,
        fieldErrors: { status: ADMIN_RFQ_OFFER_STATUS_ERROR },
      };
    }

    const payload: Record<string, unknown> = {
      rfq_id: normalizedRfqId,
      provider_id: providerId,
      currency: normalizeCurrency(getFormString(formData, "currency")) ?? "USD",
      status,
      quality_risk_flags: normalizeRiskFlags(formData),
    };

    const destinationId = normalizeOptionalId(getFormString(formData, "destinationId"));
    const assumptions = normalizeOptionalText(getFormString(formData, "assumptions"));
    const totalPriceRaw = getFormString(formData, "totalPrice");
    const unitPriceRaw = getFormString(formData, "unitPrice");
    const toolingPriceRaw = getFormString(formData, "toolingPrice");
    const shippingPriceRaw = getFormString(formData, "shippingPrice");
    const leadTimeMinRaw = getFormString(formData, "leadTimeDaysMin");
    const leadTimeMaxRaw = getFormString(formData, "leadTimeDaysMax");
    const confidenceRaw = getFormString(formData, "confidenceScore");

    const totalPrice = normalizeOptionalNumber(totalPriceRaw);
    const unitPrice = normalizeOptionalNumber(unitPriceRaw);
    const toolingPrice = normalizeOptionalNumber(toolingPriceRaw);
    const shippingPrice = normalizeOptionalNumber(shippingPriceRaw);
    const leadTimeMin = normalizeOptionalInteger(leadTimeMinRaw);
    const leadTimeMax = normalizeOptionalInteger(leadTimeMaxRaw);
    const confidenceScore = normalizeOptionalInteger(confidenceRaw);

    const fieldErrors: Record<string, string> = {};
    if (hasNonEmptyString(totalPriceRaw) && totalPrice === null) {
      fieldErrors.totalPrice = ADMIN_RFQ_OFFER_NUMBER_ERROR;
    }
    if (hasNonEmptyString(unitPriceRaw) && unitPrice === null) {
      fieldErrors.unitPrice = ADMIN_RFQ_OFFER_NUMBER_ERROR;
    }
    if (hasNonEmptyString(toolingPriceRaw) && toolingPrice === null) {
      fieldErrors.toolingPrice = ADMIN_RFQ_OFFER_NUMBER_ERROR;
    }
    if (hasNonEmptyString(shippingPriceRaw) && shippingPrice === null) {
      fieldErrors.shippingPrice = ADMIN_RFQ_OFFER_NUMBER_ERROR;
    }
    if (hasNonEmptyString(leadTimeMinRaw) && leadTimeMin === null) {
      fieldErrors.leadTimeDaysMin = ADMIN_RFQ_OFFER_INTEGER_ERROR;
    }
    if (hasNonEmptyString(leadTimeMaxRaw) && leadTimeMax === null) {
      fieldErrors.leadTimeDaysMax = ADMIN_RFQ_OFFER_INTEGER_ERROR;
    }
    if (hasNonEmptyString(confidenceRaw) && confidenceScore === null) {
      fieldErrors.confidenceScore = ADMIN_RFQ_OFFER_CONFIDENCE_ERROR;
    }
    if (
      typeof confidenceScore === "number" &&
      (confidenceScore < 0 || confidenceScore > 100)
    ) {
      fieldErrors.confidenceScore = ADMIN_RFQ_OFFER_CONFIDENCE_ERROR;
    }
    if (
      typeof leadTimeMin === "number" &&
      typeof leadTimeMax === "number" &&
      leadTimeMin > leadTimeMax
    ) {
      fieldErrors.leadTimeDaysMin = ADMIN_RFQ_OFFER_LEAD_TIME_RANGE_ERROR;
      fieldErrors.leadTimeDaysMax = ADMIN_RFQ_OFFER_LEAD_TIME_RANGE_ERROR;
    }

    if (Object.keys(fieldErrors).length > 0) {
      return {
        ok: false,
        error: ADMIN_RFQ_OFFER_VALIDATION_ERROR,
        fieldErrors,
      };
    }

    const receivedAt = normalizeOptionalTimestamp(getFormString(formData, "receivedAt"));

    assignIfDefined(payload, "destination_id", destinationId);
    assignIfDefined(payload, "assumptions", assumptions);
    assignIfDefined(payload, "total_price", totalPrice);
    assignIfDefined(payload, "unit_price", unitPrice);
    assignIfDefined(payload, "tooling_price", toolingPrice);
    assignIfDefined(payload, "shipping_price", shippingPrice);
    assignIfDefined(payload, "lead_time_days_min", leadTimeMin);
    assignIfDefined(payload, "lead_time_days_max", leadTimeMax);
    assignIfDefined(payload, "confidence_score", confidenceScore);
    assignIfDefined(payload, "received_at", receivedAt);

    const { data, error } = await supabaseServer()
      .from("rfq_offers")
      .upsert(payload, { onConflict: "rfq_id,provider_id" })
      .select("id")
      .maybeSingle<{ id: string }>();

    if (error) {
      if (isMissingTableOrColumnError(error)) {
        return { ok: false, error: ADMIN_RFQ_OFFER_GENERIC_ERROR };
      }
      console.error("[admin rfq offers] upsert failed", {
        rfqId: normalizedRfqId,
        providerId,
        error: serializeSupabaseError(error) ?? error,
      });
      return { ok: false, error: ADMIN_RFQ_OFFER_GENERIC_ERROR };
    }

    if (!data?.id) {
      return { ok: false, error: ADMIN_RFQ_OFFER_GENERIC_ERROR };
    }

    if (destinationId) {
      const now = new Date().toISOString();
      const { error: destinationError } = await supabaseServer()
        .from("rfq_destinations")
        .update({
          status: "quoted",
          last_status_at: now,
          error_message: null,
        })
        .eq("id", destinationId)
        .eq("rfq_id", normalizedRfqId);

      if (destinationError) {
        if (isMissingTableOrColumnError(destinationError)) {
          return { ok: false, error: ADMIN_DESTINATIONS_GENERIC_ERROR };
        }
        console.error("[admin rfq destinations] offer status update failed", {
          rfqId: normalizedRfqId,
          destinationId,
          error: serializeSupabaseError(destinationError),
        });
        return { ok: false, error: ADMIN_DESTINATIONS_GENERIC_ERROR };
      }
    }

    await logOpsEvent({
      quoteId: normalizedRfqId,
      destinationId,
      eventType: "offer_upserted",
      payload: {
        provider_id: providerId,
        status,
        offer_id: data.id,
      },
    });

    revalidatePath("/admin/quotes");
    revalidatePath(`/admin/quotes/${normalizedRfqId}`);

    return { ok: true, message: "Offer saved.", offerId: data.id };
  } catch (error) {
    console.error("[admin rfq offers] action crashed", {
      rfqId,
      error: serializeActionError(error),
    });
    return { ok: false, error: ADMIN_RFQ_OFFER_GENERIC_ERROR };
  }
}

export async function generateDestinationEmailAction(args: {
  quoteId: string;
  destinationId: string;
}): Promise<GenerateDestinationEmailActionResult> {
  const quoteId = normalizeIdInput(args.quoteId);
  const destinationId = normalizeIdInput(args.destinationId);
  if (!quoteId || !destinationId) {
    return { ok: false, error: ADMIN_QUOTE_UPDATE_ID_ERROR };
  }

  try {
    await requireAdminUser();
    const result = await buildDestinationOutboundEmail({ quoteId, destinationId });
    if (!result.ok) {
      return { ok: false, error: result.error };
    }

    await logOpsEvent({
      quoteId,
      destinationId,
      eventType: "outbound_email_generated",
      payload: {
        provider_id: result.providerId,
      },
    });

    return { ok: true, subject: result.subject, body: result.body };
  } catch (error) {
    console.error("[admin rfq email] action crashed", {
      quoteId,
      destinationId,
      error: serializeActionError(error),
    });
    return { ok: false, error: ADMIN_DESTINATION_EMAIL_ERROR };
  }
}

export async function generateDestinationWebFormInstructionsAction(args: {
  destinationId: string;
}): Promise<GenerateDestinationWebFormInstructionsActionResult> {
  const destinationId = normalizeIdInput(args.destinationId);
  if (!destinationId) {
    return { ok: false, error: ADMIN_QUOTE_UPDATE_ID_ERROR };
  }

  try {
    await requireAdminUser();
    const result = await buildDestinationWebFormInstructions({ destinationId });
    if (!result.ok) {
      return { ok: false, error: result.error };
    }

    return {
      ok: true,
      url: result.url ?? "",
      instructions: result.instructions,
    };
  } catch (error) {
    console.error("[admin rfq web form] action crashed", {
      destinationId,
      error: serializeActionError(error),
    });
    return { ok: false, error: ADMIN_DESTINATION_WEB_FORM_ERROR };
  }
}

export async function generateAwardEmailAction(args: {
  quoteId: string;
}): Promise<GenerateAwardEmailActionResult> {
  const quoteId = normalizeIdInput(args.quoteId);
  if (!quoteId) {
    return { ok: false, error: ADMIN_QUOTE_UPDATE_ID_ERROR };
  }

  try {
    await requireAdminUser();
    const result = await buildAwardEmail({ quoteId });
    if (!result.ok) {
      return { ok: false, error: result.error };
    }

    return { ok: true, subject: result.subject, body: result.body };
  } catch (error) {
    console.error("[admin award email] action crashed", {
      quoteId,
      error: serializeActionError(error),
    });
    return { ok: false, error: ADMIN_AWARD_EMAIL_ERROR };
  }
}

export type AddDestinationsActionResult =
  | { ok: true; message: string; addedCount: number; skippedCount: number }
  | { ok: false; error: string };

export type UpdateDestinationStatusActionResult =
  | { ok: true; message: string }
  | { ok: false; error: string };

export type MarkDestinationSubmittedActionResult =
  | { ok: true; message: string }
  | { ok: false; error: string };

const DESTINATION_STATUSES: ReadonlySet<string> = new Set([
  "draft",
  ...DESTINATION_STATUS_VALUES,
]);

function isRfqDestinationStatus(value: string): value is RfqDestinationStatus {
  return DESTINATION_STATUSES.has(value);
}

export async function addDestinationsAction(args: {
  quoteId: string;
  providerIds: string[];
  mismatchOverrideReason?: string | null;
}): Promise<AddDestinationsActionResult> {
  const normalizedQuoteId = normalizeIdInput(args.quoteId);
  const providerIds = Array.isArray(args.providerIds) ? args.providerIds : [];
  const mismatchOverrideReason =
    typeof args.mismatchOverrideReason === "string" ? args.mismatchOverrideReason.trim() : "";
  const normalizedProviders = providerIds
    .map((providerId) => normalizeIdInput(providerId))
    .filter(Boolean);
  const uniqueProviders = Array.from(new Set(normalizedProviders));

  if (!normalizedQuoteId) {
    return { ok: false, error: ADMIN_QUOTE_UPDATE_ID_ERROR };
  }
  if (uniqueProviders.length === 0) {
    return { ok: false, error: ADMIN_DESTINATIONS_INPUT_ERROR };
  }

  try {
    await requireAdminUser();

    const criteria = await resolveProviderEligibilityCriteriaForQuote(normalizedQuoteId);

    // Mismatch guardrails (process/material): if clearly a mismatch, require override reason.
    // NOTE: material requirements are not currently available for quotes, but this is wired
    // for extension via deriveProviderQuoteMismatch().
    let mismatchReasonsByProviderId = new Map<string, string[]>();
    try {
      const [supportsProcesses, supportsMaterials] = await Promise.all([
        hasColumns("providers", ["processes"]),
        hasColumns("providers", ["materials"]),
      ]);
      const selectColumns = [
        "id",
        supportsProcesses ? "processes" : null,
        supportsMaterials ? "materials" : null,
      ]
        .filter(Boolean)
        .join(",");
      const { data } = await supabaseServer()
        .from("providers")
        .select(selectColumns)
        .in("id", uniqueProviders)
        .returns<Array<{ id: string; processes?: string[] | null; materials?: string[] | null }>>();
      const rows = Array.isArray(data) ? data : [];
      for (const row of rows) {
        const providerId = normalizeIdInput(row?.id);
        if (!providerId) continue;
        const mismatch = deriveProviderQuoteMismatch({
          quoteProcess: criteria.process ?? null,
          quoteMaterialRequirements: null,
          providerProcesses: row?.processes ?? null,
          providerMaterials: row?.materials ?? null,
        });
        if (mismatch.isMismatch) {
          mismatchReasonsByProviderId.set(providerId, mismatch.mismatchReasons);
        }
      }
    } catch (error) {
      console.warn("[admin rfq destinations] mismatch evaluation skipped", {
        quoteId: normalizedQuoteId,
        error: serializeActionError(error),
      });
      mismatchReasonsByProviderId = new Map();
    }

    const mismatchedProviderIds = uniqueProviders.filter((providerId) =>
      mismatchReasonsByProviderId.has(providerId),
    );
    const overrideReasonPresent = mismatchOverrideReason.length > 0;
    if (mismatchedProviderIds.length > 0 && !overrideReasonPresent) {
      return { ok: false, error: ADMIN_DESTINATIONS_MISMATCH_OVERRIDE_ERROR };
    }

    const { data: existingRows, error: existingError } = await supabaseServer()
      .from("rfq_destinations")
      .select("provider_id")
      .eq("rfq_id", normalizedQuoteId)
      .in("provider_id", uniqueProviders)
      .returns<Array<{ provider_id: string | null }>>();

    if (existingError) {
      if (isMissingTableOrColumnError(existingError)) {
        return { ok: false, error: ADMIN_DESTINATIONS_GENERIC_ERROR };
      }
      console.error("[admin rfq destinations] lookup failed", {
        quoteId: normalizedQuoteId,
        error: serializeSupabaseError(existingError),
      });
      return { ok: false, error: ADMIN_DESTINATIONS_GENERIC_ERROR };
    }

    const existingProviderIds = new Set(
      (existingRows ?? [])
        .map((row) => normalizeIdInput(row.provider_id))
        .filter(Boolean),
    );

    const now = new Date().toISOString();
    const supportsDestinationNotes = await hasColumns("rfq_destinations", ["notes"]);
    const newRows = uniqueProviders
      .filter((providerId) => !existingProviderIds.has(providerId))
      .map((providerId) => {
        const mismatchReasons = mismatchReasonsByProviderId.get(providerId) ?? [];
        const shouldAttachNotes = supportsDestinationNotes && mismatchReasons.length > 0;
        return {
          rfq_id: normalizedQuoteId,
          provider_id: providerId,
          status: "queued",
          last_status_at: now,
          error_message: null,
          ...(shouldAttachNotes ? { notes: mismatchOverrideReason || null } : {}),
        };
      });

    if (newRows.length > 0) {
      const { error: insertError } = await supabaseServer()
        .from("rfq_destinations")
        .upsert(newRows, {
          onConflict: "rfq_id,provider_id",
          ignoreDuplicates: true,
        });

      if (insertError) {
        if (isMissingTableOrColumnError(insertError)) {
          return { ok: false, error: ADMIN_DESTINATIONS_GENERIC_ERROR };
        }
        console.error("[admin rfq destinations] insert failed", {
          quoteId: normalizedQuoteId,
          providers: uniqueProviders,
          error: serializeSupabaseError(insertError),
        });
        return { ok: false, error: ADMIN_DESTINATIONS_GENERIC_ERROR };
      }
    }

    if (newRows.length > 0) {
      try {
        const eligibility = await getEligibleProvidersForQuote(normalizedQuoteId, criteria);
        const criteriaPayload = Object.fromEntries(
          Object.entries({
            process: criteria.process ?? undefined,
            ship_to_state: criteria.shipToState ?? undefined,
            ship_to_country: criteria.shipToCountry ?? undefined,
            ship_to_postal_code: criteria.shipToPostalCode ?? undefined,
            quantity: typeof criteria.quantity === "number" ? criteria.quantity : undefined,
          }).filter(([, value]) => typeof value !== "undefined"),
        );
        await logOpsEvent({
          quoteId: normalizedQuoteId,
          eventType: "destinations_added",
          payload: {
            criteria: criteriaPayload,
            eligible_count: eligibility.eligibleProviderIds.length,
            chosen_provider_ids: uniqueProviders,
          },
        });
      } catch (error) {
        console.warn("[admin rfq destinations] routing snapshot failed", {
          quoteId: normalizedQuoteId,
          error: serializeActionError(error),
        });
      }
      await Promise.all(
        newRows.map((row) =>
          logOpsEvent({
            quoteId: normalizedQuoteId,
            eventType: "destination_added",
            payload: {
              provider_id: row.provider_id,
            },
          }),
        ),
      );

      const mismatchEventRows = newRows.filter(
        (row) => (mismatchReasonsByProviderId.get(row.provider_id) ?? []).length > 0,
      );
      await Promise.all(
        mismatchEventRows.map((row) =>
          logOpsEvent({
            quoteId: normalizedQuoteId,
            eventType: "destination_added_with_mismatch",
            payload: {
              quote_id: normalizedQuoteId,
              provider_id: row.provider_id,
              mismatch_reasons: mismatchReasonsByProviderId.get(row.provider_id) ?? [],
              override_reason_present: overrideReasonPresent,
            },
          }),
        ),
      );
    }

    revalidatePath(`/admin/quotes/${normalizedQuoteId}`);

    const addedCount = newRows.length;
    const skippedCount = uniqueProviders.length - addedCount;
    const message =
      addedCount === 0
        ? "All selected providers are already destinations."
        : skippedCount > 0
          ? `Added ${addedCount} destination${addedCount === 1 ? "" : "s"}; ${skippedCount} already existed.`
          : `Added ${addedCount} destination${addedCount === 1 ? "" : "s"}.`;

    return { ok: true, message, addedCount, skippedCount };
  } catch (error) {
    console.error("[admin rfq destinations] add crashed", {
      quoteId: normalizedQuoteId,
      error: serializeActionError(error),
    });
    return { ok: false, error: ADMIN_DESTINATIONS_GENERIC_ERROR };
  }
}

export async function updateDestinationStatusAction(args: {
  destinationId: string;
  status: RfqDestinationStatus;
  errorMessage?: string | null;
}): Promise<UpdateDestinationStatusActionResult> {
  const destinationId = normalizeIdInput(args.destinationId);
  const status = normalizeDestinationStatus(args.status);
  if (!destinationId) {
    return { ok: false, error: ADMIN_QUOTE_UPDATE_ID_ERROR };
  }
  if (!status) {
    return { ok: false, error: ADMIN_DESTINATION_STATUS_ERROR };
  }

  try {
    await requireAdminUser();

    const { data: destination, error: destinationError } = await supabaseServer()
      .from("rfq_destinations")
      .select("id,rfq_id,sent_at,status,provider_id")
      .eq("id", destinationId)
      .maybeSingle<{
        id: string;
        rfq_id: string | null;
        sent_at: string | null;
        status: string | null;
        provider_id: string | null;
      }>();

    if (destinationError) {
      if (isMissingTableOrColumnError(destinationError)) {
        return { ok: false, error: ADMIN_DESTINATIONS_GENERIC_ERROR };
      }
      console.error("[admin rfq destinations] load failed", {
        destinationId,
        error: serializeSupabaseError(destinationError),
      });
      return { ok: false, error: ADMIN_DESTINATIONS_GENERIC_ERROR };
    }

    if (!destination?.id) {
      return { ok: false, error: ADMIN_DESTINATIONS_GENERIC_ERROR };
    }

    const now = new Date().toISOString();
    const payload: Record<string, unknown> = {
      status,
      last_status_at: now,
    };

    if (status === "sent" && !destination.sent_at) {
      payload.sent_at = now;
    }

    if (status === "error") {
      const trimmed =
        typeof args.errorMessage === "string" ? args.errorMessage.trim() : "";
      payload.error_message = trimmed || "Error noted.";
    } else {
      payload.error_message = null;
    }

    const { error: updateError } = await supabaseServer()
      .from("rfq_destinations")
      .update(payload)
      .eq("id", destinationId);

    if (updateError) {
      if (isMissingTableOrColumnError(updateError)) {
        return { ok: false, error: ADMIN_DESTINATIONS_GENERIC_ERROR };
      }
      console.error("[admin rfq destinations] update failed", {
        destinationId,
        status,
        error: serializeSupabaseError(updateError),
      });
      return { ok: false, error: ADMIN_DESTINATIONS_GENERIC_ERROR };
    }

    const rfqId = normalizeIdInput(destination.rfq_id);
    const providerId = normalizeIdInput(destination.provider_id);
    const previousStatus = normalizeDestinationStatus(destination.status);

    if (rfqId) {
      await logOpsEvent({
        quoteId: rfqId,
        destinationId,
        eventType: "destination_status_updated",
        payload: {
          status_from: previousStatus ?? null,
          status_to: status,
          provider_id: providerId || null,
        },
      });
    }

    if (rfqId) {
      revalidatePath(`/admin/quotes/${rfqId}`);
      revalidatePath("/admin/ops/inbox");
    }

    return { ok: true, message: "Destination updated." };
  } catch (error) {
    console.error("[admin rfq destinations] update crashed", {
      destinationId,
      status: args.status,
      error: serializeActionError(error),
    });
    return { ok: false, error: ADMIN_DESTINATIONS_GENERIC_ERROR };
  }
}

export async function markDestinationSubmittedAction(args: {
  destinationId: string;
  notes?: string | null;
  dispatchMode?: string | null;
}): Promise<MarkDestinationSubmittedActionResult> {
  const destinationId = normalizeIdInput(args.destinationId);
  const notes = typeof args.notes === "string" ? args.notes.trim() : "";
  const dispatchMode =
    typeof args.dispatchMode === "string" ? args.dispatchMode.trim().toLowerCase() : "";
  const requiresNotes = dispatchMode === "web_form";
  if (!destinationId) {
    return { ok: false, error: ADMIN_QUOTE_UPDATE_ID_ERROR };
  }
  if (requiresNotes && notes.length < 5) {
    return { ok: false, error: ADMIN_DESTINATION_SUBMITTED_NOTES_ERROR };
  }

  try {
    const adminUser = await requireAdminUser();
    const schemaReady = await schemaGate({
      enabled: true,
      relation: "rfq_destinations",
      requiredColumns: [
        "id",
        "rfq_id",
        "provider_id",
        "status",
        "last_status_at",
        "submitted_at",
        "submitted_notes",
        "submitted_by",
      ],
      warnPrefix: "[admin rfq destinations]",
      warnKey: "admin_rfqs:destination_submitted_missing_schema",
    });
    if (!schemaReady) {
      return { ok: false, error: ADMIN_DESTINATION_SUBMITTED_SCHEMA_ERROR };
    }

    const { data: destination, error: destinationError } = await supabaseServer()
      .from("rfq_destinations")
      .select("id,rfq_id,provider_id,status")
      .eq("id", destinationId)
      .maybeSingle<{
        id: string;
        rfq_id: string | null;
        provider_id: string | null;
        status: string | null;
      }>();

    if (destinationError) {
      if (isMissingTableOrColumnError(destinationError)) {
        return { ok: false, error: ADMIN_DESTINATION_SUBMITTED_SCHEMA_ERROR };
      }
      console.error("[admin rfq destinations] submitted lookup failed", {
        destinationId,
        error: serializeSupabaseError(destinationError),
      });
      return { ok: false, error: ADMIN_DESTINATION_SUBMITTED_ERROR };
    }

    if (!destination?.id) {
      return { ok: false, error: ADMIN_DESTINATION_SUBMITTED_ERROR };
    }

    const now = new Date().toISOString();
    const submittedBy = normalizeIdInput(adminUser.id);
    const submittedNotes = notes.length > 0 ? notes : null;
    const payload: Record<string, unknown> = {
      status: "submitted",
      last_status_at: now,
      submitted_at: now,
      submitted_notes: submittedNotes,
      submitted_by: submittedBy || null,
      error_message: null,
    };

    const { error: updateError } = await supabaseServer()
      .from("rfq_destinations")
      .update(payload)
      .eq("id", destinationId);

    if (updateError) {
      if (isMissingTableOrColumnError(updateError)) {
        return { ok: false, error: ADMIN_DESTINATION_SUBMITTED_SCHEMA_ERROR };
      }
      console.error("[admin rfq destinations] submitted update failed", {
        destinationId,
        error: serializeSupabaseError(updateError),
      });
      return { ok: false, error: ADMIN_DESTINATION_SUBMITTED_ERROR };
    }

    const rfqId = normalizeIdInput(destination.rfq_id);
    const providerId = normalizeIdInput(destination.provider_id);
    if (rfqId) {
      await logOpsEvent({
        quoteId: rfqId,
        destinationId,
        eventType: "destination_submitted",
        payload: {
          provider_id: providerId || null,
          destination_id: destinationId,
          quote_id: rfqId,
          notes_length: notes.length,
        },
      });
      revalidatePath(`/admin/quotes/${rfqId}`);
      revalidatePath("/admin/ops/inbox");
    }

    return { ok: true, message: "Destination marked submitted." };
  } catch (error) {
    console.error("[admin rfq destinations] submitted action crashed", {
      destinationId,
      error: serializeActionError(error),
    });
    return { ok: false, error: ADMIN_DESTINATION_SUBMITTED_ERROR };
  }
}

function normalizeDestinationStatus(value: unknown): RfqDestinationStatus | null {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return isRfqDestinationStatus(normalized) ? normalized : null;
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
    const result = await postUnifiedQuoteMessage({
      quoteId: normalizedQuoteId,
      message: trimmedBody,
      authorRole: "admin",
    });

    if (!result.ok || !result.message) {
      console.error("[admin messages] create failed", {
        quoteId: normalizedQuoteId,
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

    const { data: supplier, error: supplierError } = await supabaseServer()
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

    const { data: existingInvite } = await supabaseServer()
      .from("quote_invites")
      .select("id")
      .eq("quote_id", normalizedQuoteId)
      .eq("supplier_id", supplier.id)
      .maybeSingle<{ id: string }>();
    const isNewInvite = !existingInvite;

    const { error: inviteError } = await supabaseServer()
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
    const { error: quoteUpdateError } = await supabaseServer()
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

function normalizeIdInput(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeOptionalId(value: unknown): string | null | undefined {
  if (typeof value === "undefined") return undefined;
  if (value === null) return null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeOptionalText(value: unknown): string | null | undefined {
  if (typeof value === "undefined") return undefined;
  if (value === null) return null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeCurrency(value: unknown): string | null | undefined {
  if (typeof value === "undefined") return undefined;
  if (value === null) return null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.toUpperCase() : null;
}

function normalizeOptionalNumber(value: unknown): number | null | undefined {
  if (typeof value === "undefined") return undefined;
  if (value === null) return null;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeOptionalInteger(value: unknown): number | null | undefined {
  const normalized = normalizeOptionalNumber(value);
  if (typeof normalized === "undefined" || normalized === null) {
    return normalized;
  }
  return Number.isInteger(normalized) ? normalized : null;
}

function normalizeOptionalTimestamp(value: unknown): string | null | undefined {
  if (typeof value === "undefined") return undefined;
  if (value === null) return null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsedMs = Date.parse(trimmed);
  if (!Number.isFinite(parsedMs)) return null;
  return new Date(parsedMs).toISOString();
}

function normalizeRiskFlags(formData: FormData): string[] {
  const rawValues = formData.getAll("qualityRiskFlags");
  const flags = rawValues.flatMap((value) => {
    if (typeof value !== "string") return [];
    return value.split(",").map((segment) => segment.trim());
  });
  return Array.from(new Set(flags.filter((flag) => flag.length > 0)));
}

function assignIfDefined(
  target: Record<string, unknown>,
  key: string,
  value: unknown,
): void {
  if (typeof value !== "undefined") {
    target[key] = value;
  }
}

function hasNonEmptyString(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
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
    const { data, error } = await supabaseServer()
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

