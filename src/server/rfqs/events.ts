import { supabaseServer } from "@/lib/supabaseServer";
import {
  isMissingTableOrColumnError,
  serializeSupabaseError,
} from "@/server/admin/logging";

export type RfqEventActorRole = "admin" | "customer" | "supplier" | "system";

export type RfqEventType =
  | "rfq_created"
  | "quick_specs_updated"
  | "offer_created"
  | "offer_revised"
  | "offer_withdrawn"
  | "awarded"
  | "order_details_confirmed"
  | "kickoff_task_completed"
  | (string & {});

export type RfqEventRecord = {
  id: string;
  rfq_id: string;
  event_type: string;
  message: string | null;
  actor_role: RfqEventActorRole;
  actor_user_id: string | null;
  created_at: string;
};

export async function listRfqEventsForRfq(
  rfqId: string,
  options?: { limit?: number },
): Promise<{ ok: true; events: RfqEventRecord[] } | { ok: false; events: RfqEventRecord[]; error: string }> {
  const normalizedRfqId = normalizeId(rfqId);
  const limit =
    typeof options?.limit === "number" && Number.isFinite(options.limit)
      ? Math.max(1, Math.min(options.limit, 250))
      : 100;

  if (!normalizedRfqId) {
    return { ok: false, events: [], error: "rfqId is required" };
  }

  try {
    const { data, error } = await supabaseServer()
      .from("rfq_events")
      .select("id,rfq_id,event_type,message,actor_role,actor_user_id,created_at")
      .eq("rfq_id", normalizedRfqId)
      .order("created_at", { ascending: false })
      .limit(limit)
      .returns<RfqEventRecord[]>();

    if (error) {
      if (isMissingTableOrColumnError(error)) {
        return { ok: true, events: [] };
      }
      console.error("[rfq events] list failed", {
        rfqId: normalizedRfqId,
        error: serializeSupabaseError(error),
      });
      return { ok: false, events: [], error: "Unable to load RFQ events." };
    }

    return { ok: true, events: Array.isArray(data) ? data : [] };
  } catch (error) {
    if (isMissingTableOrColumnError(error)) {
      return { ok: true, events: [] };
    }
    console.error("[rfq events] list crashed", {
      rfqId: normalizedRfqId,
      error: serializeSupabaseError(error) ?? error,
    });
    return { ok: false, events: [], error: "Unable to load RFQ events." };
  }
}

export type EmitRfqEventInput = {
  rfqId: string;
  eventType: RfqEventType;
  message?: string | null;
  actorRole: RfqEventActorRole;
  actorUserId?: string | null;
  createdAt?: string | null;
};

export async function emitRfqEvent(
  input: EmitRfqEventInput,
  deps?: { client?: ReturnType<typeof supabaseServer> },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const rfqId = normalizeId(input.rfqId);
  const eventType = normalizeText(input.eventType);
  const actorRole = normalizeActorRole(input.actorRole);
  const message = normalizeOptionalText(input.message);

  if (!rfqId || !eventType || !actorRole) {
    return { ok: false, error: "invalid_input" };
  }

  const row = {
    rfq_id: rfqId,
    event_type: eventType,
    message,
    actor_role: actorRole,
    actor_user_id: normalizeId(input.actorUserId ?? null) || null,
    ...(input.createdAt ? { created_at: input.createdAt } : null),
  };

  try {
    const client = deps?.client ?? supabaseServer();
    const { error } = await client.from("rfq_events").insert(row);
    if (error) {
      if (isMissingTableOrColumnError(error)) {
        return { ok: false, error: "missing_schema" };
      }
      console.error("[rfq events] insert failed", {
        rfqId,
        eventType,
        actorRole,
        error: serializeSupabaseError(error),
      });
      return { ok: false, error: "write_failed" };
    }
    return { ok: true };
  } catch (error) {
    if (isMissingTableOrColumnError(error)) {
      return { ok: false, error: "missing_schema" };
    }
    console.error("[rfq events] insert crashed", {
      rfqId,
      eventType,
      actorRole,
      error: serializeSupabaseError(error) ?? error,
    });
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

function normalizeOptionalText(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value === "undefined") return null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
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

