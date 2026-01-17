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

export type OpsEventRecord = {
  id: string;
  quote_id: string;
  destination_id: string | null;
  event_type: OpsEventType;
  payload: Record<string, unknown>;
  created_at: string;
};

export type ListOpsEventsResult =
  | { ok: true; events: OpsEventRecord[]; error: null }
  | { ok: false; events: OpsEventRecord[]; error: string };

const OPS_EVENTS_TABLE = "ops_events";
const OPS_EVENTS_SELECT = "id,quote_id,destination_id,event_type,payload,created_at";

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

export async function listOpsEventsForQuote(
  quoteId: string,
  options?: { limit?: number },
): Promise<ListOpsEventsResult> {
  const normalizedQuoteId = normalizeId(quoteId);
  const limit = normalizeLimit(options?.limit);

  if (!normalizedQuoteId) {
    return { ok: false, events: [], error: "quoteId is required" };
  }

  try {
    type OpsEventRow = {
      id: string | null;
      quote_id: string | null;
      destination_id: string | null;
      event_type: string | null;
      payload: unknown;
      created_at: string | null;
    };

    const { data, error } = await supabaseServer
      .from(OPS_EVENTS_TABLE)
      .select(OPS_EVENTS_SELECT)
      .eq("quote_id", normalizedQuoteId)
      .order("created_at", { ascending: false })
      .limit(limit)
      .returns<OpsEventRow[]>();

    if (error) {
      if (isMissingTableOrColumnError(error)) {
        const serialized = serializeSupabaseError(error);
        warnOnce("ops_events:missing_schema", "[ops events] missing schema; skipping", {
          code: serialized?.code ?? null,
          message: serialized?.message ?? null,
        });
        return { ok: true, events: [], error: null };
      }
      console.error("[ops events] list failed", {
        quoteId: normalizedQuoteId,
        error: serializeSupabaseError(error) ?? error,
      });
      return { ok: false, events: [], error: "Unable to load ops events." };
    }

    const events: OpsEventRecord[] = (Array.isArray(data) ? data : [])
      .map((row) => normalizeOpsEventRow(row))
      .filter((event): event is OpsEventRecord => Boolean(event));

    return { ok: true, events, error: null };
  } catch (error) {
    if (isMissingTableOrColumnError(error)) {
      const serialized = serializeSupabaseError(error);
      warnOnce("ops_events:missing_schema", "[ops events] missing schema; skipping", {
        code: serialized?.code ?? null,
        message: serialized?.message ?? null,
      });
      return { ok: true, events: [], error: null };
    }
    console.error("[ops events] list crashed", {
      quoteId: normalizedQuoteId,
      error: serializeSupabaseError(error) ?? error,
    });
    return { ok: false, events: [], error: "Unable to load ops events." };
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

function normalizeLimit(limit: unknown): number {
  if (typeof limit !== "number" || !Number.isFinite(limit)) {
    return 20;
  }
  return Math.max(1, Math.min(Math.floor(limit), 100));
}

function sanitizePayload(payload: Record<string, unknown> | null | undefined) {
  if (!payload || typeof payload !== "object") {
    return {};
  }
  const entries = Object.entries(payload).filter(([, value]) => typeof value !== "undefined");
  return entries.length > 0 ? Object.fromEntries(entries) : {};
}

function normalizeOpsEventRow(row: {
  id: string | null;
  quote_id: string | null;
  destination_id: string | null;
  event_type: string | null;
  payload: unknown;
  created_at: string | null;
}): OpsEventRecord | null {
  const id = normalizeId(row?.id);
  const quoteId = normalizeId(row?.quote_id);
  const eventType = normalizeEventType(row?.event_type);
  if (!id || !quoteId || !eventType) {
    return null;
  }

  return {
    id,
    quote_id: quoteId,
    destination_id: normalizeOptionalId(row?.destination_id),
    event_type: eventType,
    payload: normalizePayload(row?.payload),
    created_at: row?.created_at ?? new Date().toISOString(),
  };
}

function normalizePayload(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
