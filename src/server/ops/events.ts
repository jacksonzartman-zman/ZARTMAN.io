import { supabaseServer } from "@/lib/supabaseServer";
import {
  isMissingTableOrColumnError,
  serializeSupabaseError,
  warnOnce,
} from "@/server/admin/logging";

export type OpsEventType =
  | "destination_added"
  | "destination_status_updated"
  | "outbound_email_generated"
  | "offer_upserted"
  | "offer_selected";

export type LogOpsEventInput = {
  quoteId: string;
  destinationId?: string | null;
  eventType: OpsEventType;
  payload?: Record<string, unknown> | null;
};

const OPS_EVENTS_TABLE = "ops_events";

export async function logOpsEvent(input: LogOpsEventInput): Promise<void> {
  const quoteId = normalizeId(input.quoteId);
  const destinationId = normalizeOptionalId(input.destinationId);
  const eventType = normalizeEventType(input.eventType);
  if (!quoteId || !eventType) {
    return;
  }

  const payload = sanitizePayload(input.payload);

  try {
    const { error } = await supabaseServer.from(OPS_EVENTS_TABLE).insert({
      quote_id: quoteId,
      destination_id: destinationId ?? null,
      event_type: eventType,
      payload,
    });

    if (error) {
      if (isMissingTableOrColumnError(error)) {
        const serialized = serializeSupabaseError(error);
        warnOnce("ops_events:missing_schema", "[ops events] missing schema; skipping", {
          code: serialized?.code ?? null,
          message: serialized?.message ?? null,
        });
        return;
      }

      console.warn("[ops events] insert failed", {
        quoteId,
        destinationId,
        eventType,
        error: serializeSupabaseError(error) ?? error,
      });
    }
  } catch (error) {
    if (isMissingTableOrColumnError(error)) {
      const serialized = serializeSupabaseError(error);
      warnOnce("ops_events:missing_schema", "[ops events] missing schema; skipping", {
        code: serialized?.code ?? null,
        message: serialized?.message ?? null,
      });
      return;
    }

    console.warn("[ops events] insert crashed", {
      quoteId,
      destinationId,
      eventType,
      error: serializeSupabaseError(error) ?? error,
    });
  }
}

function normalizeId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeOptionalId(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  return null;
}

function normalizeEventType(value: unknown): OpsEventType | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim() as OpsEventType;
  if (!normalized) return null;
  return normalized;
}

function sanitizePayload(payload: Record<string, unknown> | null | undefined) {
  if (!payload || typeof payload !== "object") {
    return {};
  }
  const entries = Object.entries(payload).filter(([, value]) => typeof value !== "undefined");
  return entries.length > 0 ? Object.fromEntries(entries) : {};
}
