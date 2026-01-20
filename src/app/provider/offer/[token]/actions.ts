"use server";

import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabaseServer";
import { getFormString, serializeActionError } from "@/lib/forms";
import { getDestinationByOfferToken } from "@/server/rfqs/destinations";
import { logOpsEvent } from "@/server/ops/events";
import {
  isMissingTableOrColumnError,
  serializeSupabaseError,
} from "@/server/admin/logging";

export type ProviderOfferActionState = {
  ok: boolean;
  message?: string | null;
  error?: string | null;
  submittedAt?: string | null;
  wasRevision?: boolean;
  fieldErrors?: {
    price?: string;
    leadTimeDays?: string;
    confidenceScore?: string;
    assumptions?: string;
    notes?: string;
  };
};

const OFFER_RECEIVED_SUCCESS =
  "Offer received. The requester will review and follow up if needed.";
const OFFER_UPDATED_SUCCESS = "Offer updated.";
const OFFER_SUBMIT_ERROR = "We couldn’t submit your offer right now. Please try again.";
const OFFER_INVALID_TOKEN_ERROR =
  "This offer link is invalid or expired. Ask the Zartman team for a new link.";
const OFFER_VALIDATION_ERROR = "Please review the highlighted fields.";
const OFFER_PRICE_ERROR = "Enter a valid price.";
const OFFER_LEAD_TIME_ERROR = "Enter a lead time in days.";
const OFFER_CONFIDENCE_ERROR = "Confidence must be between 0 and 100.";
const OFFER_TEXT_LENGTH_ERROR = "Keep this under 2,000 characters.";
const MAX_TEXT_LENGTH = 2000;
const ACTIVE_DESTINATION_STATUSES = new Set(["queued", "sent", "submitted", "viewed", "quoted"]);

export async function submitOfferViaTokenAction(
  _prevState: ProviderOfferActionState,
  formData: FormData,
): Promise<ProviderOfferActionState> {
  const token = getFormString(formData, "token");
  const tokenContext = await getDestinationByOfferToken(token ?? "");

  if (
    !tokenContext ||
    !ACTIVE_DESTINATION_STATUSES.has(tokenContext.destination.status) ||
    tokenContext.destination.provider_id !== tokenContext.provider.id
  ) {
    return { ok: false, error: OFFER_INVALID_TOKEN_ERROR };
  }

  const priceRaw = getFormString(formData, "price");
  const leadTimeRaw = getFormString(formData, "leadTimeDays");
  const confidenceRaw = getFormString(formData, "confidenceScore");
  const assumptionsRaw = getFormString(formData, "assumptions");
  const notesRaw = getFormString(formData, "notes");

  const fieldErrors: ProviderOfferActionState["fieldErrors"] = {};

  const price = normalizeOptionalNumber(priceRaw);
  if (price === null || price <= 0) {
    fieldErrors.price = OFFER_PRICE_ERROR;
  }

  const leadTimeDays = normalizeOptionalInteger(leadTimeRaw);
  if (leadTimeDays === null || leadTimeDays <= 0) {
    fieldErrors.leadTimeDays = OFFER_LEAD_TIME_ERROR;
  }

  const confidenceScore = normalizeOptionalInteger(confidenceRaw);
  if (hasNonEmptyString(confidenceRaw) && confidenceScore === null) {
    fieldErrors.confidenceScore = OFFER_CONFIDENCE_ERROR;
  }
  if (
    typeof confidenceScore === "number" &&
    (confidenceScore < 0 || confidenceScore > 100)
  ) {
    fieldErrors.confidenceScore = OFFER_CONFIDENCE_ERROR;
  }

  const assumptions = normalizeOptionalText(assumptionsRaw);
  const notes = normalizeOptionalText(notesRaw);
  if (assumptions && assumptions.length > MAX_TEXT_LENGTH) {
    fieldErrors.assumptions = OFFER_TEXT_LENGTH_ERROR;
  }
  if (notes && notes.length > MAX_TEXT_LENGTH) {
    fieldErrors.notes = OFFER_TEXT_LENGTH_ERROR;
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, error: OFFER_VALIDATION_ERROR, fieldErrors };
  }

  try {
    const existingOffer = await loadExistingOfferSnapshot({
      rfqId: tokenContext.destination.rfq_id,
      providerId: tokenContext.provider.id,
      destinationId: tokenContext.destination.id,
    });
    const hadExistingOffer = Boolean(existingOffer?.id);
    const submittedAt = new Date().toISOString();

    const payload: Record<string, unknown> = {
      rfq_id: tokenContext.destination.rfq_id,
      provider_id: tokenContext.provider.id,
      destination_id: tokenContext.destination.id,
      currency: "USD",
      total_price: price,
      lead_time_days_min: leadTimeDays,
      lead_time_days_max: leadTimeDays,
      status: "received",
      received_at: submittedAt,
    };

    assignIfDefined(payload, "assumptions", assumptions);
    assignIfDefined(payload, "notes", notes);
    assignIfDefined(payload, "confidence_score", confidenceScore);

    const { data, error } = await supabaseServer
      .from("rfq_offers")
      .upsert(payload, { onConflict: "rfq_id,provider_id" })
      .select("id")
      .maybeSingle<{ id: string }>();

    if (error) {
      if (isMissingTableOrColumnError(error)) {
        return { ok: false, error: OFFER_SUBMIT_ERROR };
      }
      console.error("[provider offer] upsert failed", {
        rfqId: tokenContext.destination.rfq_id,
        providerId: tokenContext.provider.id,
        error: serializeSupabaseError(error),
      });
      return { ok: false, error: OFFER_SUBMIT_ERROR };
    }

    if (!data?.id) {
      return { ok: false, error: OFFER_SUBMIT_ERROR };
    }

    const { error: destinationError } = await supabaseServer
      .from("rfq_destinations")
      .update({
        status: "quoted",
        last_status_at: submittedAt,
        error_message: null,
      })
      .eq("id", tokenContext.destination.id)
      .eq("rfq_id", tokenContext.destination.rfq_id)
      .eq("provider_id", tokenContext.provider.id);

    if (destinationError && !isMissingTableOrColumnError(destinationError)) {
      console.error("[provider offer] destination status update failed", {
        destinationId: tokenContext.destination.id,
        rfqId: tokenContext.destination.rfq_id,
        error: serializeSupabaseError(destinationError),
      });
    }

    await logOpsEvent({
      quoteId: tokenContext.destination.rfq_id,
      destinationId: tokenContext.destination.id,
      eventType: hadExistingOffer ? "offer_revised" : "offer_upserted",
      payload: {
        provider_id: tokenContext.provider.id,
        status: "received",
        offer_id: data.id,
        source: "provider_token",
      },
    });

    revalidatePath("/admin/quotes");
    revalidatePath(`/admin/quotes/${tokenContext.destination.rfq_id}`);
    revalidatePath("/admin/ops/inbox");
    revalidatePath(`/customer/quotes/${tokenContext.destination.rfq_id}`);

    return {
      ok: true,
      message: hadExistingOffer ? OFFER_UPDATED_SUCCESS : OFFER_RECEIVED_SUCCESS,
      submittedAt,
      wasRevision: hadExistingOffer,
    };
  } catch (error) {
    console.error("[provider offer] action crashed", {
      tokenPresent: Boolean(token),
      error: serializeActionError(error),
    });
    return { ok: false, error: OFFER_SUBMIT_ERROR };
  }
}

export async function submitProviderOfferAction(
  prevState: ProviderOfferActionState,
  formData: FormData,
): Promise<ProviderOfferActionState> {
  return submitOfferViaTokenAction(prevState, formData);
}

function normalizeOptionalNumber(value: unknown): number | null {
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

function normalizeOptionalInteger(value: unknown): number | null {
  const normalized = normalizeOptionalNumber(value);
  if (normalized === null) return null;
  return Number.isInteger(normalized) ? normalized : null;
}

function normalizeOptionalText(value: unknown): string | null | undefined {
  if (typeof value === "undefined") return undefined;
  if (value === null) return null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
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

type ExistingOfferSnapshot = {
  id: string | null;
  received_at: string | null;
  destination_id: string | null;
};

async function loadExistingOfferSnapshot(args: {
  rfqId: string;
  providerId: string;
  destinationId?: string | null;
}): Promise<ExistingOfferSnapshot | null> {
  const rfqId = normalizeId(args.rfqId);
  const providerId = normalizeId(args.providerId);
  const destinationId = normalizeId(args.destinationId);
  if (!rfqId || !providerId) return null;

  const selectFields = "id,received_at,destination_id";

  try {
    if (destinationId) {
      const { data, error } = await supabaseServer
        .from("rfq_offers")
        .select(selectFields)
        .eq("destination_id", destinationId)
        .maybeSingle<ExistingOfferSnapshot>();

      if (error) {
        if (!isMissingTableOrColumnError(error)) {
          console.warn("[provider offer] existing offer lookup failed", {
            rfqId,
            providerId,
            destinationId,
            error: serializeSupabaseError(error),
          });
        }
      } else if (data?.id) {
        return data;
      }
    }

    let compositeQuery = supabaseServer
      .from("rfq_offers")
      .select(selectFields)
      .eq("rfq_id", rfqId)
      .eq("provider_id", providerId);

    if (destinationId) {
      compositeQuery = compositeQuery.eq("destination_id", destinationId);
    }

    const { data, error } = await compositeQuery.maybeSingle<ExistingOfferSnapshot>();

    if (error) {
      if (isMissingTableOrColumnError(error)) {
        if (destinationId) {
          const { data: fallbackData } = await supabaseServer
            .from("rfq_offers")
            .select(selectFields)
            .eq("rfq_id", rfqId)
            .eq("provider_id", providerId)
            .maybeSingle<ExistingOfferSnapshot>();
          if (fallbackData?.id) return fallbackData;
        }
        return null;
      }
      console.warn("[provider offer] existing offer lookup failed", {
        rfqId,
        providerId,
        destinationId,
        error: serializeSupabaseError(error),
      });
      return null;
    }

    if (!data?.id && destinationId) {
      const { data: fallbackData } = await supabaseServer
        .from("rfq_offers")
        .select(selectFields)
        .eq("rfq_id", rfqId)
        .eq("provider_id", providerId)
        .maybeSingle<ExistingOfferSnapshot>();
      if (fallbackData?.id) return fallbackData;
    }

    if (!data?.id) return null;
    return data;
  } catch (error) {
    if (isMissingTableOrColumnError(error)) {
      return null;
    }
    console.warn("[provider offer] existing offer lookup crashed", {
      rfqId,
      providerId,
      destinationId,
      error: serializeSupabaseError(error) ?? error,
    });
    return null;
  }
}

function normalizeId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
