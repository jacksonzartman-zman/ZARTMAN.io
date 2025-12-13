import { supabaseServer } from "@/lib/supabaseServer";
import {
  isMissingTableOrColumnError,
  serializeSupabaseError,
} from "@/server/admin/logging";

export type QuoteEventActorRole = "admin" | "customer" | "supplier" | "system";

export type QuoteEventType =
  | "submitted"
  | "bid_received"
  | "awarded"
  | "reopened"
  | "archived"
  | "kickoff_updated"
  | "message_posted"
  | (string & {});

export type QuoteEventRecord = {
  id: string;
  quote_id: string;
  event_type: string;
  actor_role: QuoteEventActorRole;
  actor_user_id: string | null;
  actor_supplier_id: string | null;
  metadata: Record<string, unknown>;
  /**
   * Back-compat shim: some environments historically stored event context in a
   * `payload` jsonb column. `metadata` is canonical; treat `payload` as optional.
   */
  payload?: Record<string, unknown> | null;
  created_at: string;
};

export type ListQuoteEventsResult =
  | { ok: true; events: QuoteEventRecord[]; error: null }
  | { ok: false; events: QuoteEventRecord[]; error: string };

export async function listQuoteEventsForQuote(
  quoteId: string,
  options?: { limit?: number },
): Promise<ListQuoteEventsResult> {
  const normalizedQuoteId = normalizeId(quoteId);
  const limit =
    typeof options?.limit === "number" && Number.isFinite(options.limit)
      ? Math.max(1, Math.min(options.limit, 250))
      : 75;

  if (!normalizedQuoteId) {
    return { ok: false, events: [], error: "quoteId is required" };
  }

  try {
    type QuoteEventRow = Omit<QuoteEventRecord, "metadata" | "payload"> & {
      metadata?: unknown;
      payload?: unknown;
    };

    const baseColumns =
      "id,quote_id,event_type,actor_role,actor_user_id,actor_supplier_id,created_at";
    const runSelect = (columns: string) =>
      supabaseServer
        .from("quote_events")
        .select(columns)
        .eq("quote_id", normalizedQuoteId)
        .order("created_at", { ascending: false })
        .limit(limit)
        .returns<QuoteEventRow[]>();

    // Prefer selecting both in environments that have the shim.
    let data: QuoteEventRow[] | null = null;
    let error: unknown = null;

    const attemptWithPayload = await runSelect(`${baseColumns},metadata,payload`);
    if (!attemptWithPayload.error) {
      data = attemptWithPayload.data ?? [];
    } else if (isMissingTableOrColumnError(attemptWithPayload.error)) {
      // If `payload` is missing, retry with metadata-only (canonical schema).
      const attemptMetadataOnly = await runSelect(`${baseColumns},metadata`);
      if (!attemptMetadataOnly.error) {
        data = attemptMetadataOnly.data ?? [];
      } else if (isMissingTableOrColumnError(attemptMetadataOnly.error)) {
        // If `metadata` is missing (older schema), retry with payload-only.
        const attemptPayloadOnly = await runSelect(`${baseColumns},payload`);
        if (!attemptPayloadOnly.error) {
          data = attemptPayloadOnly.data ?? [];
        } else {
          error = attemptPayloadOnly.error;
        }
      } else {
        error = attemptMetadataOnly.error;
      }
    } else {
      error = attemptWithPayload.error;
    }

    if (error) {
      if (!isMissingTableOrColumnError(error)) {
        console.error("[quote events] list failed", {
          quoteId: normalizedQuoteId,
          error: serializeSupabaseError(error),
        });
      }
      return { ok: false, events: [], error: "Unable to load quote events." };
    }

    const events: QuoteEventRecord[] = (Array.isArray(data) ? data : []).map(
      (row) => {
        const metadata =
          isRecord(row.metadata)
            ? (row.metadata as Record<string, unknown>)
            : isRecord(row.payload)
              ? (row.payload as Record<string, unknown>)
              : {};
        const payload = isRecord(row.payload)
          ? (row.payload as Record<string, unknown>)
          : null;
        return {
          id: row.id,
          quote_id: row.quote_id,
          event_type: row.event_type,
          actor_role: row.actor_role,
          actor_user_id: row.actor_user_id,
          actor_supplier_id: row.actor_supplier_id,
          metadata,
          payload,
          created_at: row.created_at,
        };
      },
    );

    return {
      ok: true,
      events,
      error: null,
    };
  } catch (error) {
    if (!isMissingTableOrColumnError(error)) {
      console.error("[quote events] list crashed", {
        quoteId: normalizedQuoteId,
        error: serializeSupabaseError(error) ?? error,
      });
    }
    return { ok: false, events: [], error: "Unable to load quote events." };
  }
}

export type EmitQuoteEventInput = {
  quoteId: string;
  eventType: QuoteEventType;
  actorRole: QuoteEventActorRole;
  actorUserId?: string | null;
  actorSupplierId?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt?: string | null;
};

export async function emitQuoteEvent(
  input: EmitQuoteEventInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const quoteId = normalizeId(input.quoteId);
  const eventType = normalizeText(input.eventType);
  const actorRole = normalizeActorRole(input.actorRole);

  if (!quoteId || !eventType || !actorRole) {
    return { ok: false, error: "invalid_input" };
  }

  const row = {
    quote_id: quoteId,
    event_type: eventType,
    actor_role: actorRole,
    actor_user_id: normalizeId(input.actorUserId ?? null) || null,
    actor_supplier_id: normalizeId(input.actorSupplierId ?? null) || null,
    metadata: sanitizeMetadata(input.metadata),
    ...(input.createdAt ? { created_at: input.createdAt } : null),
  };

  try {
    const { error } = await supabaseServer.from("quote_events").insert(row);
    if (error) {
      if (!isMissingTableOrColumnError(error)) {
        console.error("[quote events] insert failed", {
          quoteId,
          eventType,
          actorRole,
          error: serializeSupabaseError(error),
        });
      }
      return { ok: false, error: "write_failed" };
    }
    return { ok: true };
  } catch (error) {
    if (!isMissingTableOrColumnError(error)) {
      console.error("[quote events] insert crashed", {
        quoteId,
        eventType,
        actorRole,
        error: serializeSupabaseError(error) ?? error,
      });
    }
    return { ok: false, error: "write_failed" };
  }
}

function normalizeId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeText(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : "";
}

function normalizeActorRole(value: unknown): QuoteEventActorRole | null {
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

function sanitizeMetadata(
  value: unknown,
): Record<string, unknown> {
  if (!value || typeof value !== "object") {
    return {};
  }
  if (Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

