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
    const { data, error } = await supabaseServer
      .from("quote_events")
      .select(
        "id,quote_id,event_type,actor_role,actor_user_id,actor_supplier_id,metadata,created_at",
      )
      .eq("quote_id", normalizedQuoteId)
      .order("created_at", { ascending: false })
      .limit(limit)
      .returns<QuoteEventRecord[]>();

    if (error) {
      if (!isMissingTableOrColumnError(error)) {
        console.error("[quote events] list failed", {
          quoteId: normalizedQuoteId,
          error: serializeSupabaseError(error),
        });
      }
      return { ok: false, events: [], error: "Unable to load quote events." };
    }

    return {
      ok: true,
      events: Array.isArray(data) ? data : [],
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

  const payload = {
    quote_id: quoteId,
    event_type: eventType,
    actor_role: actorRole,
    actor_user_id: normalizeId(input.actorUserId ?? null) || null,
    actor_supplier_id: normalizeId(input.actorSupplierId ?? null) || null,
    metadata: sanitizeMetadata(input.metadata),
    ...(input.createdAt ? { created_at: input.createdAt } : null),
  };

  try {
    const { error } = await supabaseServer.from("quote_events").insert(payload);
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

