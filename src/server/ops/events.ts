import { supabaseServer } from "@/lib/supabaseServer";
import {
  isMissingTableOrColumnError,
  serializeSupabaseError,
  warnOnce,
} from "@/server/admin/logging";
import { debugOnce } from "@/server/db/schemaErrors";

export type OpsEventType =
  | "destination_added"
  | "destinations_added"
  | "destination_status_updated"
  | "destination_submitted"
  | "destination_dispatch_started"
  | "kickoff_update_requested"
  | "kickoff_task_status_changed"
  | "customer_saved_search_interest"
  | "customer_intro_requested"
  | "customer_intro_handled"
  | "message_nudge_requested"
  | "search_alert_enabled"
  | "search_alert_disabled"
  | "search_alert_notified"
  | "outbound_email_generated"
  | "offer_upserted"
  | "offer_revised"
  | "offer_selected"
  | "offer_shortlisted"
  | "offer_unshortlisted"
  | "message_posted"
  | "supplier_join_requested"
  | "supplier_invited"
  | "provider_contacted"
  | "provider_verified"
  | "provider_unverified"
  | "provider_activated"
  | "provider_deactivated"
  | "provider_directory_visibility_changed"
  | "estimate_shown";

export type LogOpsEventInput = {
  quoteId: string;
  destinationId?: string | null;
  eventType: OpsEventType;
  payload?: Record<string, unknown> | null;
  dedupeKey?: string | null;
};

export type OpsEventRecord = {
  id: string;
  quote_id: string | null;
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
const OPS_EVENT_DEDUPE_KEYS = new Set<string>();

type OpsEventInsertArgs = {
  quoteId: string | null;
  destinationId: string | null;
  eventType: OpsEventType;
  payload: Record<string, unknown>;
  context?: Record<string, unknown>;
  logLabel: string;
};

function queueOpsEventInsert(args: OpsEventInsertArgs) {
  const context = sanitizePayload({
    quoteId: args.quoteId,
    destinationId: args.destinationId,
    eventType: args.eventType,
    ...(args.context ?? {}),
  });

  try {
    void (async () => {
      try {
        const { error } = await supabaseServer.from(OPS_EVENTS_TABLE).insert({
          quote_id: args.quoteId,
          destination_id: args.destinationId,
          event_type: args.eventType,
          payload: args.payload,
        });

        if (!error) return;
        logOpsEventInsertError(error, args.logLabel, context);
      } catch (error) {
        logOpsEventInsertError(error, args.logLabel, context);
      }
    })();
  } catch (error) {
    logOpsEventInsertError(error, args.logLabel, context);
  }
}

function logOpsEventInsertError(error: unknown, label: string, context: Record<string, unknown>) {
  if (isMissingTableOrColumnError(error)) {
    const serialized = serializeSupabaseError(error);
    warnOnce("ops_events:missing_schema", "[ops events] missing schema; skipping", {
      code: serialized?.code ?? null,
      message: serialized?.message ?? null,
    });
    return;
  }

  if (isOpsEventsEventTypeConstraintViolation(error)) {
    const serialized = serializeSupabaseError(error);
    // Schema drift case: app is trying to write a new event_type, but the DB check constraint
    // hasn't been migrated yet. Treat as a quiet no-op (single warning per process).
    warnOnce(
      "ops_events:unsupported_event_type",
      "[ops events] unsupported event type; skipping",
      {
        code: serialized?.code ?? null,
        message: serialized?.message ?? null,
      },
    );
    return;
  }

  console.debug(`[ops events] ${label}`, {
    ...context,
    error: serializeSupabaseError(error) ?? error,
  });
}

function isOpsEventsEventTypeConstraintViolation(error: unknown): boolean {
  const serialized = serializeSupabaseError(error);
  const code = typeof serialized?.code === "string" ? serialized.code : "";
  if (code !== "23514") {
    return false;
  }

  const blob = `${serialized?.message ?? ""} ${serialized?.details ?? ""} ${serialized?.hint ?? ""}`
    .toLowerCase()
    .trim();
  if (!blob) {
    return true;
  }

  return blob.includes("ops_events_event_type_check") || blob.includes("check constraint");
}

function shouldSkipEstimateShown(args: {
  quoteId: string;
  eventType: OpsEventType;
  dedupeKey?: string | null;
}): boolean {
  if (args.eventType !== "estimate_shown") {
    return false;
  }
  const sessionKey = normalizeOptionalId(args.dedupeKey);
  if (!sessionKey) {
    return false;
  }

  const key = `${args.eventType}:${args.quoteId}:${sessionKey}`;
  if (OPS_EVENT_DEDUPE_KEYS.has(key)) {
    debugOnce(
      `ops_events:estimate_shown:dedupe:${key}`,
      "[ops events] estimate_shown deduped",
      {
        quoteId: args.quoteId,
      },
    );
    return true;
  }

  OPS_EVENT_DEDUPE_KEYS.add(key);
  return false;
}

export async function logOpsEvent(input: LogOpsEventInput): Promise<void> {
  const quoteId = normalizeId(input.quoteId);
  const destinationId = normalizeOptionalId(input.destinationId);
  const eventType = normalizeEventType(input.eventType);
  if (!quoteId || !eventType) {
    return;
  }

  const payload = sanitizePayload(input.payload);
  if (shouldSkipEstimateShown({ quoteId, eventType, dedupeKey: input.dedupeKey })) {
    return;
  }

  queueOpsEventInsert({
    quoteId,
    destinationId: destinationId ?? null,
    eventType,
    payload,
    logLabel: "insert failed",
    context: { source: "logOpsEvent" },
  });
}

export type SupplierJoinOpsEventInput = {
  email: string;
  supplierSlug?: string | null;
  source?: string | null;
};

export async function logSupplierJoinOpsEvent(
  input: SupplierJoinOpsEventInput,
): Promise<void> {
  const email = normalizeEmail(input.email);
  const eventType = normalizeEventType("supplier_join_requested");
  if (!email || !eventType) {
    return;
  }

  const supplierSlug = normalizeOptionalId(input.supplierSlug) ?? undefined;
  const source = normalizeOptionalId(input.source) ?? undefined;
  const payload = sanitizePayload({
    email,
    supplier_slug: supplierSlug,
    source,
  });

  queueOpsEventInsert({
    quoteId: null,
    destinationId: null,
    eventType,
    payload,
    logLabel: "supplier join insert failed",
    context: {
      email,
      source: "logSupplierJoinOpsEvent",
    },
  });
}

export type SupplierInvitedOpsEventInput = {
  email?: string | null;
  website?: string | null;
  supplierName: string;
  note?: string | null;
  needsResearch?: boolean;
  customerId?: string | null;
  customerEmail?: string | null;
  userId?: string | null;
  providerId?: string | null;
};

export async function logSupplierInvitedOpsEvent(
  input: SupplierInvitedOpsEventInput,
): Promise<void> {
  const email = normalizeEmail(input.email);
  const website = normalizeWebsite(input.website);
  const supplierName = normalizeText(input.supplierName);
  const eventType = normalizeEventType("supplier_invited");
  if (!eventType) {
    return;
  }

  const payload = sanitizePayload({
    email: email ?? undefined,
    supplier_email: email ?? undefined,
    supplier_website: website ?? undefined,
    supplier_name: supplierName || undefined,
    note: normalizeOptionalText(input.note) ?? undefined,
    needs_research: input.needsResearch ? true : undefined,
    customer_id: normalizeOptionalId(input.customerId) ?? undefined,
    customer_email: normalizeEmail(input.customerEmail) ?? undefined,
    user_id: normalizeOptionalId(input.userId) ?? undefined,
    provider_id: normalizeOptionalId(input.providerId) ?? undefined,
  });

  queueOpsEventInsert({
    quoteId: null,
    destinationId: null,
    eventType,
    payload,
    logLabel: "supplier invite insert failed",
    context: {
      email,
      source: "logSupplierInvitedOpsEvent",
    },
  });
}

export type ProviderContactedOpsEventInput = {
  providerId: string;
  providerName?: string | null;
  providerEmail?: string | null;
};

export async function logProviderContactedOpsEvent(
  input: ProviderContactedOpsEventInput,
): Promise<void> {
  const providerId = normalizeOptionalId(input.providerId);
  const eventType = normalizeEventType("provider_contacted");
  if (!providerId || !eventType) {
    return;
  }

  const payload = sanitizePayload({
    provider_id: providerId,
    provider_name: normalizeOptionalText(input.providerName) ?? undefined,
    provider_email: normalizeEmail(input.providerEmail) ?? undefined,
  });

  queueOpsEventInsert({
    quoteId: null,
    destinationId: null,
    eventType,
    payload,
    logLabel: "provider contacted insert failed",
    context: {
      providerId,
      source: "logProviderContactedOpsEvent",
    },
  });
}

export type ProviderStatusOpsEventInput = {
  providerId: string;
  eventType:
    | "provider_verified"
    | "provider_unverified"
    | "provider_activated"
    | "provider_deactivated";
  snapshot?: Record<string, unknown> | null;
};

export async function logProviderStatusOpsEvent(
  input: ProviderStatusOpsEventInput,
): Promise<void> {
  const providerId = normalizeOptionalId(input.providerId);
  const eventType = normalizeEventType(input.eventType);
  if (!providerId || !eventType) {
    return;
  }

  const payload = sanitizePayload({
    provider_id: providerId,
    ...(input.snapshot ?? {}),
  });

  queueOpsEventInsert({
    quoteId: null,
    destinationId: null,
    eventType,
    payload,
    logLabel: "provider status insert failed",
    context: {
      providerId,
      source: "logProviderStatusOpsEvent",
    },
  });
}

export type ProviderDirectoryVisibilityOpsEventInput = {
  providerId: string;
  showInDirectory: boolean;
  reason?: string | null;
};

export async function logProviderDirectoryVisibilityEvent(
  input: ProviderDirectoryVisibilityOpsEventInput,
): Promise<void> {
  const providerId = normalizeOptionalId(input.providerId);
  const eventType = normalizeEventType("provider_directory_visibility_changed");
  if (!providerId || !eventType) {
    return;
  }

  const payload = sanitizePayload({
    provider_id: providerId,
    show_in_directory: input.showInDirectory,
    reason: normalizeOptionalText(input.reason) ?? undefined,
  });

  queueOpsEventInsert({
    quoteId: null,
    destinationId: null,
    eventType,
    payload,
    logLabel: "provider directory visibility insert failed",
    context: {
      providerId,
      source: "logProviderDirectoryVisibilityEvent",
    },
  });
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

export async function listOpsEventsForProvider(
  providerId: string,
  options?: { limit?: number },
): Promise<ListOpsEventsResult> {
  const normalizedProviderId = normalizeId(providerId);
  const limit = normalizeLimit(options?.limit);

  if (!normalizedProviderId) {
    return { ok: false, events: [], error: "providerId is required" };
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
      .filter("payload->>provider_id", "eq", normalizedProviderId)
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
      console.error("[ops events] list provider events failed", {
        providerId: normalizedProviderId,
        error: serializeSupabaseError(error) ?? error,
      });
      return { ok: false, events: [], error: "Unable to load ops events." };
    }

    const events: OpsEventRecord[] = (Array.isArray(data) ? data : [])
      .map((row) => normalizeOpsEventRow(row, { requireQuoteId: false }))
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
    console.error("[ops events] list provider events crashed", {
      providerId: normalizedProviderId,
      error: serializeSupabaseError(error) ?? error,
    });
    return { ok: false, events: [], error: "Unable to load ops events." };
  }
}

function normalizeId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function normalizeWebsite(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) return null;
  const hasScheme = /^https?:\/\//i.test(trimmed);
  const candidate = hasScheme ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeOptionalText(value: unknown): string | null {
  const normalized = normalizeText(value);
  return normalized.length > 0 ? normalized : null;
}

export function buildOpsEventSessionKey(input: {
  userId: string;
  lastSignInAt?: string | null;
}): string {
  const userId = normalizeId(input.userId);
  if (!userId) {
    return "";
  }
  const sessionStamp = normalizeOptionalText(input.lastSignInAt);
  return sessionStamp ? `${userId}:${sessionStamp}` : userId;
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

function normalizeOpsEventRow(
  row: {
    id: string | null;
    quote_id: string | null;
    destination_id: string | null;
    event_type: string | null;
    payload: unknown;
    created_at: string | null;
  },
  options?: { requireQuoteId?: boolean },
): OpsEventRecord | null {
  const id = normalizeId(row?.id);
  const quoteId = normalizeOptionalId(row?.quote_id);
  const eventType = normalizeEventType(row?.event_type);
  const requireQuoteId = options?.requireQuoteId ?? true;
  if (!id || !eventType) {
    return null;
  }
  if (requireQuoteId && !quoteId) {
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
