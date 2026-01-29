import { supabaseServer } from "@/lib/supabaseServer";
import { serializeSupabaseError } from "@/server/admin/logging";
import { hasColumns } from "@/server/db/schemaContract";
import { logOpsEvent } from "@/server/ops/events";
import { notifyQuoteSubscribersFirstOfferArrived } from "@/server/rfqs/offerArrivalNotifications";
import { parseRfqOfferStatus, type RfqOfferStatus } from "@/server/rfqs/offers";
import { emitRfqEvent, type RfqEventActorRole } from "@/server/rfqs/events";
import {
  findCustomerExclusionMatch,
  loadCustomerExclusions,
} from "@/server/customers/exclusions";

function normalizeId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeOptionalText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export type WriteRfqOfferResult =
  | { ok: true; offerId: string; wasRevision: boolean; triggeredFirstOfferNotification: boolean }
  | { ok: false; error: string; reason?: "customer_exclusion" };

type RfqOfferRowForCount = {
  id: string | null;
  status: string | null;
  provider_id: string | null;
};

/**
 * Canonical offer write path used by both:
 * - supplier-submitted offers (via provider token link)
 * - broker/admin inserted offers (manual/external)
 *
 * This function intentionally centralizes side-effects:
 * - destination status update (when destination is known)
 * - ops event logging
 * - first-offer "notify me" emails (best-effort)
 */
export async function writeRfqOffer(args: {
  rfqId: string;
  providerId: string | null;
  destinationId?: string | null;
  currency?: string;
  totalPrice: number;
  leadTimeDaysMin: number;
  leadTimeDaysMax: number;
  status: RfqOfferStatus;
  receivedAt?: string;
  assumptions?: string | null;
  notes?: string | null;
  confidenceScore?: number | null;
  qualityRiskFlags?: string[];
  /**
   * Optional actor identity for RFQ event log.
   * (Not required for token-based supplier submissions.)
   */
  actorRole?: RfqEventActorRole;
  actorUserId?: string | null;
  /**
   * Optional metadata used to label external/broker offers, when supported by schema.
   */
  sourceType?: string | null;
  sourceName?: string | null;
  /**
   * Additional columns to include on write (schema-gated by caller).
   * Base columns in this function always win if the same key exists.
   */
  extraOfferColumns?: Record<string, unknown>;
  /**
   * Included in ops log payload.
   * Examples: "provider_token", "admin_external_offer"
   */
  actorSource: string;
  deps?: {
    client?: ReturnType<typeof supabaseServer>;
    logOps?: typeof logOpsEvent;
    notifyFirstOffer?: typeof notifyQuoteSubscribersFirstOfferArrived;
  };
}): Promise<WriteRfqOfferResult> {
  const rfqId = normalizeId(args.rfqId);
  const providerId = normalizeId(args.providerId) || null;
  const destinationId = normalizeId(args.destinationId) || null;
  const status = parseRfqOfferStatus(args.status) ?? "received";

  if (!rfqId) return { ok: false, error: "Missing RFQ id." };
  if (!Number.isFinite(args.totalPrice) || args.totalPrice <= 0) {
    return { ok: false, error: "Invalid offer price." };
  }
  if (!Number.isFinite(args.leadTimeDaysMin) || args.leadTimeDaysMin <= 0) {
    return { ok: false, error: "Invalid lead time." };
  }
  if (!Number.isFinite(args.leadTimeDaysMax) || args.leadTimeDaysMax <= 0) {
    return { ok: false, error: "Invalid lead time." };
  }

  const client = args.deps?.client ?? supabaseServer();
  const logOps = args.deps?.logOps ?? logOpsEvent;
  const notifyFirstOffer = args.deps?.notifyFirstOffer ?? notifyQuoteSubscribersFirstOfferArrived;

  const now = (() => {
    const receivedAt = normalizeId(args.receivedAt);
    return receivedAt || new Date().toISOString();
  })();

  const supportsSourceColumns = await (async () => {
    const sourceType = normalizeOptionalText(args.sourceType);
    const sourceName = normalizeOptionalText(args.sourceName);
    if (!sourceType && !sourceName) return false;
    try {
      return await hasColumns("rfq_offers", ["source_type", "source_name"]);
    } catch {
      return false;
    }
  })();

  // Enforce customer exclusions (best-effort schema gate: fail open on lookup errors).
  try {
    const { data: quoteRow, error: quoteError } = await client
      .from("quotes")
      .select("customer_id")
      .eq("id", rfqId)
      .maybeSingle<{ customer_id: string | null }>();

    if (!quoteError) {
      const customerId = normalizeId(quoteRow?.customer_id) || null;
      if (customerId) {
        const exclusions = await loadCustomerExclusions(customerId, { client });
        const match = findCustomerExclusionMatch({
          exclusions,
          providerId,
          sourceName: normalizeOptionalText(args.sourceName),
        });

        if (match) {
          const detail =
            match.kind === "provider"
              ? `provider ${match.providerId}`
              : `source “${match.sourceName}”`;
          return {
            ok: false,
            reason: "customer_exclusion",
            error: `This customer excludes offers from ${detail}.`,
          };
        }
      }
    } else {
      // Best-effort; don't block write if quote lookup fails.
      console.warn("[rfq offer write] customer exclusion quote lookup failed (best-effort)", {
        rfqId,
        error: serializeSupabaseError(quoteError),
      });
    }
  } catch (error) {
    console.warn("[rfq offer write] customer exclusion check crashed (best-effort)", {
      rfqId,
      error: serializeSupabaseError(error) ?? error,
    });
  }

  // Determine whether this write represents the first non-withdrawn offer.
  // Also used to infer whether a provider-scoped upsert is a revision.
  let existingNonWithdrawnCount = 0;
  let hadExistingProviderOffer = false;
  try {
    const { data, error } = await client
      .from("rfq_offers")
      .select("id,status,provider_id")
      .eq("rfq_id", rfqId)
      .returns<RfqOfferRowForCount[]>();

    if (!error) {
      const rows = Array.isArray(data) ? data : [];
      existingNonWithdrawnCount = rows.filter((row) => {
        const normalized = typeof row?.status === "string" ? row.status.trim().toLowerCase() : "";
        return normalized !== "withdrawn";
      }).length;

      if (providerId) {
        hadExistingProviderOffer = rows.some((row) => normalizeId(row?.provider_id) === providerId);
      }
    } else {
      // Best-effort; don't block write on count lookup.
      console.warn("[rfq offer write] offer pre-count lookup failed (best-effort)", {
        rfqId,
        error: serializeSupabaseError(error),
      });
    }
  } catch (error) {
    console.warn("[rfq offer write] offer pre-count lookup crashed (best-effort)", {
      rfqId,
      error: serializeSupabaseError(error) ?? error,
    });
  }

  const basePayload: Record<string, unknown> = {
    rfq_id: rfqId,
    provider_id: providerId,
    destination_id: destinationId,
    currency: typeof args.currency === "string" && args.currency.trim() ? args.currency.trim() : "USD",
    total_price: args.totalPrice,
    lead_time_days_min: Math.trunc(args.leadTimeDaysMin),
    lead_time_days_max: Math.trunc(args.leadTimeDaysMax),
    status,
    received_at: now,
    assumptions: normalizeOptionalText(args.assumptions),
    notes: normalizeOptionalText(args.notes),
    confidence_score:
      typeof args.confidenceScore === "number" && Number.isFinite(args.confidenceScore)
        ? Math.trunc(args.confidenceScore)
        : args.confidenceScore === null
          ? null
          : undefined,
    quality_risk_flags: Array.isArray(args.qualityRiskFlags) ? args.qualityRiskFlags : [],
  };

  if (supportsSourceColumns) {
    basePayload.source_type = normalizeOptionalText(args.sourceType);
    basePayload.source_name = normalizeOptionalText(args.sourceName);
  }

  const extra = args.extraOfferColumns && typeof args.extraOfferColumns === "object" ? args.extraOfferColumns : {};
  const payload = { ...extra, ...basePayload };

  try {
    const offerId = await (async (): Promise<string | null> => {
      if (providerId) {
        const { data, error } = await client
          .from("rfq_offers")
          .upsert(payload, { onConflict: "rfq_id,provider_id" })
          .select("id")
          .maybeSingle<{ id: string }>();
        if (error || !data?.id) {
          console.error("[rfq offer write] upsert failed", {
            rfqId,
            providerId,
            error: serializeSupabaseError(error),
          });
          return null;
        }
        return data.id;
      }

      const { data, error } = await client
        .from("rfq_offers")
        .insert(payload)
        .select("id")
        .maybeSingle<{ id: string }>();

      if (error || !data?.id) {
        console.error("[rfq offer write] insert failed", {
          rfqId,
          error: serializeSupabaseError(error),
        });
        return null;
      }
      return data.id;
    })();

    if (!offerId) {
      return { ok: false, error: "We couldn’t save this offer right now." };
    }

    if (destinationId) {
      try {
        const { error: destinationError } = await client
          .from("rfq_destinations")
          .update({
            status: "quoted",
            last_status_at: now,
            error_message: null,
          })
          .eq("id", destinationId)
          .eq("rfq_id", rfqId);

        if (destinationError) {
          console.warn("[rfq offer write] destination update failed (best-effort)", {
            rfqId,
            destinationId,
            error: serializeSupabaseError(destinationError),
          });
        }
      } catch (error) {
        console.warn("[rfq offer write] destination update crashed (best-effort)", {
          rfqId,
          destinationId,
          error: serializeSupabaseError(error) ?? error,
        });
      }
    }

    const wasRevision = Boolean(providerId) && hadExistingProviderOffer;
    try {
      await logOps({
        quoteId: rfqId,
        destinationId: destinationId || undefined,
        eventType: wasRevision ? "offer_revised" : "offer_upserted",
        payload: {
          provider_id: providerId,
          status,
          offer_id: offerId,
          source: args.actorSource,
        },
      });
    } catch (error) {
      console.warn("[rfq offer write] ops log failed (best-effort)", {
        rfqId,
        offerId,
        error: serializeSupabaseError(error) ?? error,
      });
    }

    // Best-effort RFQ event log (admin timeline).
    try {
      const actorRole =
        normalizeActorRole(args.actorRole) ?? inferActorRoleFromSource(args.actorSource);
      const actorUserId = normalizeId(args.actorUserId) || null;
      const eventType =
        status === "withdrawn"
          ? "offer_withdrawn"
          : wasRevision
            ? "offer_revised"
            : "offer_created";

      void emitRfqEvent(
        {
          rfqId,
          eventType,
          actorRole,
          actorUserId,
          createdAt: now,
        },
        { client },
      );
    } catch {
      // Best-effort: never block offer writes.
    }

    const triggeredFirstOfferNotification =
      existingNonWithdrawnCount === 0 && status !== "withdrawn";
    if (triggeredFirstOfferNotification) {
      try {
        void notifyFirstOffer({ quoteId: rfqId, offerId });
      } catch {
        // Best-effort; ignore.
      }
    }

    return { ok: true, offerId, wasRevision, triggeredFirstOfferNotification };
  } catch (error) {
    console.error("[rfq offer write] crashed", {
      rfqId,
      providerId,
      error: serializeSupabaseError(error) ?? error,
    });
    return { ok: false, error: "We couldn’t save this offer right now." };
  }
}

function normalizeActorRole(value: unknown): RfqEventActorRole | null {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (
    normalized === "admin" ||
    normalized === "customer" ||
    normalized === "supplier" ||
    normalized === "system"
  ) {
    return normalized;
  }
  return null;
}

function inferActorRoleFromSource(source: unknown): RfqEventActorRole {
  const normalized = typeof source === "string" ? source.trim().toLowerCase() : "";
  if (normalized.includes("provider")) return "supplier";
  if (normalized.includes("admin")) return "admin";
  return "system";
}

