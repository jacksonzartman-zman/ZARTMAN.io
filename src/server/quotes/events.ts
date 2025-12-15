import { supabaseServer } from "@/lib/supabaseServer";
import {
  isMissingTableOrColumnError,
  serializeSupabaseError,
} from "@/server/admin/logging";

export type QuoteEventActorRole = "admin" | "customer" | "supplier" | "system";

export type QuoteEventType =
  | "submitted"
  | "supplier_invited"
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

export type GetQuoteEventsForTimelineInput = {
  quoteId: string;
  actorRole: QuoteEventActorRole;
  actorUserId: string | null;
};

export type GetQuoteEventsForTimelineResult =
  | { ok: true; events: QuoteEventRecord[]; error: null }
  | { ok: false; events: QuoteEventRecord[]; error: string };

const QUOTE_EVENTS_TABLE = "quote_events";
const QUOTE_EVENTS_BASE_COLUMNS =
  "id,quote_id,event_type,actor_role,actor_user_id,actor_supplier_id,created_at";

/**
 * Shared server fetch for quote timeline events across portals.
 *
 * IMPORTANT: This uses the service-role Supabase client, so we MUST implement
 * audience filtering here (customers/suppliers must not see admin-only events).
 */
export async function getQuoteEventsForTimeline(
  input: GetQuoteEventsForTimelineInput,
): Promise<GetQuoteEventsForTimelineResult> {
  const quoteId = normalizeId(input?.quoteId);
  const actorRole = normalizeActorRole(input?.actorRole) ?? "system";
  const actorUserId = normalizeId(input?.actorUserId ?? null) || null;

  if (!quoteId) {
    return { ok: false, events: [], error: "quoteId is required" };
  }

  try {
    type QuoteEventRow = Omit<QuoteEventRecord, "metadata" | "payload"> & {
      metadata?: unknown;
      payload?: unknown;
    };

    const selectAttempt = (columns: string) =>
      supabaseServer
        .from(QUOTE_EVENTS_TABLE)
        .select(columns)
        .eq("quote_id", quoteId)
        .order("created_at", { ascending: false })
        .limit(250)
        .returns<QuoteEventRow[]>();

    let data: QuoteEventRow[] | null = null;
    let error: unknown = null;

    // Prefer selecting both in environments that have the shim.
    const attemptWithPayload = await selectAttempt(
      `${QUOTE_EVENTS_BASE_COLUMNS},metadata,payload`,
    );
    if (!attemptWithPayload.error) {
      data = (attemptWithPayload.data ?? []) as QuoteEventRow[];
    } else if (isMissingTableOrColumnError(attemptWithPayload.error)) {
      const attemptMetadataOnly = await selectAttempt(
        `${QUOTE_EVENTS_BASE_COLUMNS},metadata`,
      );
      if (!attemptMetadataOnly.error) {
        data = (attemptMetadataOnly.data ?? []) as QuoteEventRow[];
      } else if (isMissingTableOrColumnError(attemptMetadataOnly.error)) {
        const attemptPayloadOnly = await selectAttempt(
          `${QUOTE_EVENTS_BASE_COLUMNS},payload`,
        );
        if (!attemptPayloadOnly.error) {
          data = (attemptPayloadOnly.data ?? []) as QuoteEventRow[];
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
      const serialized = serializeSupabaseError(error);
      // Failure-only logging, per spec.
      console.error("[quote timeline] load failed", {
        quoteId,
        actorRole,
        table: QUOTE_EVENTS_TABLE,
        select: `${QUOTE_EVENTS_BASE_COLUMNS},metadata[,payload]`,
        pgCode: (serialized as { code?: string | null })?.code ?? null,
        message: (serialized as { message?: string | null })?.message ?? null,
      });
      return { ok: false, events: [], error: "Unable to load quote timeline." };
    }

    const rawEvents: QuoteEventRecord[] = (Array.isArray(data) ? data : []).map(
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

    const supplierContext =
      actorRole === "supplier" && actorUserId
        ? await loadSupplierContextForUser(actorUserId)
        : null;

    const events = filterAndSanitizeTimelineEvents(rawEvents, {
      actorRole,
      supplierId: supplierContext?.supplierId ?? null,
      supplierEmail: supplierContext?.supplierEmail ?? null,
    });

    return { ok: true, events, error: null };
  } catch (error) {
    const serialized = serializeSupabaseError(error);
    console.error("[quote timeline] load crashed", {
      quoteId,
      actorRole,
      table: QUOTE_EVENTS_TABLE,
      select: `${QUOTE_EVENTS_BASE_COLUMNS},metadata[,payload]`,
      pgCode: (serialized as { code?: string | null })?.code ?? null,
      message: (serialized as { message?: string | null })?.message ?? null,
    });
    return { ok: false, events: [], error: "Unable to load quote timeline." };
  }
}

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

type SupplierContext = {
  supplierId: string;
  supplierEmail: string | null;
};

async function loadSupplierContextForUser(
  userId: string,
): Promise<SupplierContext | null> {
  const normalizedUserId = normalizeId(userId);
  if (!normalizedUserId) return null;
  try {
    const { data, error } = await supabaseServer
      .from("suppliers")
      .select("id,primary_email")
      .eq("user_id", normalizedUserId)
      .maybeSingle<{ id: string; primary_email: string | null }>();
    if (error || !data?.id) {
      return null;
    }
    return {
      supplierId: data.id,
      supplierEmail:
        typeof data.primary_email === "string" && data.primary_email.trim()
          ? data.primary_email.trim().toLowerCase()
          : null,
    };
  } catch {
    return null;
  }
}

function normalizeEventType(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function filterAndSanitizeTimelineEvents(
  events: QuoteEventRecord[],
  viewer: {
    actorRole: QuoteEventActorRole;
    supplierId: string | null;
    supplierEmail: string | null;
  },
): QuoteEventRecord[] {
  const role = (viewer.actorRole ?? "system").toString().trim().toLowerCase();

  if (role === "admin") {
    return events;
  }

  // Keep customer timeline strictly limited to "safe" quote lifecycle events.
  const allowedForCustomer = new Set<string>([
    "submitted",
    "supplier_invited",
    "bid_received",
    "awarded",
    "kickoff_started",
    "kickoff_completed",
    "kickoff_updated",
    "quote_archived",
    "quote_reopened",
    "archived",
    "reopened",
    "quote_won",
    "bid_won",
  ]);

  if (role === "customer") {
    return events.filter((event) =>
      allowedForCustomer.has(normalizeEventType(event.event_type)),
    );
  }

  if (role === "supplier") {
    // Suppliers can see the customer-safe events plus supplier-scoped operational updates
    // (these must never leak across suppliers).
    const allowedForSupplier = new Set<string>([
      ...Array.from(allowedForCustomer),
      "capacity_updated",
    ]);
    const supplierId = normalizeId(viewer.supplierId) || null;
    const supplierEmail =
      typeof viewer.supplierEmail === "string" ? viewer.supplierEmail : null;

    return events
      .filter((event) =>
        allowedForSupplier.has(normalizeEventType(event.event_type)),
      )
      .filter((event) => {
        const type = normalizeEventType(event.event_type);
        const metadata = isRecord(event.metadata) ? event.metadata : {};
        const metaSupplierId = normalizeId(metadata["supplier_id"]) || null;
        const metaSupplierEmail =
          typeof metadata["supplier_email"] === "string"
            ? metadata["supplier_email"].trim().toLowerCase()
            : null;
        const actorSupplierId = normalizeId(event.actor_supplier_id) || null;

        // Supplier-specific events should not leak other suppliers.
        if (
          type === "supplier_invited" ||
          type === "bid_received" ||
          type === "kickoff_updated" ||
          type === "bid_won" ||
          type === "capacity_updated"
        ) {
          if (!supplierId && !supplierEmail) return false;
          return (
            (supplierId && (metaSupplierId === supplierId || actorSupplierId === supplierId)) ||
            (supplierEmail && metaSupplierEmail === supplierEmail)
          );
        }

        // Award is safe to show, but redact winner identity if not this supplier.
        if (type === "awarded" || type === "quote_won") {
          return true;
        }

        return true;
      })
      .map((event) => redactEventForSupplierViewer(event, supplierId));
  }

  // Unknown viewer role: safest fallback.
  return events.filter((event) => {
    const type = normalizeEventType(event.event_type);
    return (
      type === "submitted" ||
      type === "awarded" ||
      type === "kickoff_started" ||
      type === "kickoff_updated" ||
      type === "quote_archived" ||
      type === "quote_reopened" ||
      type === "archived" ||
      type === "reopened"
    );
  });
}

function redactEventForSupplierViewer(
  event: QuoteEventRecord,
  supplierId: string | null,
): QuoteEventRecord {
  const type = normalizeEventType(event.event_type);
  if (!event.metadata || typeof event.metadata !== "object" || Array.isArray(event.metadata)) {
    return event;
  }
  const metadata = event.metadata as Record<string, unknown>;

  if (type !== "awarded" && type !== "quote_won") {
    return event;
  }

  const metaSupplierId = normalizeId(metadata["supplier_id"]) || null;
  const isViewerWinner = Boolean(supplierId) && metaSupplierId === supplierId;
  if (isViewerWinner) {
    return event;
  }

  const redacted = { ...metadata };
  delete redacted["supplier_name"];
  delete redacted["supplier_email"];
  delete redacted["supplier_id"];
  delete redacted["bid_id"];

  return { ...event, metadata: redacted };
}

