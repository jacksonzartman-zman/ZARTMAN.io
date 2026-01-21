import type { QuoteEventActorRole, QuoteEventRecord } from "@/server/quotes/events";
import { formatQuoteEvent } from "@/lib/quoteEvents/formatQuoteEvent";

export type QuotePhase = "rfq" | "bidding" | "award" | "kickoff" | "execution";

export type QuoteTimelineEvent = {
  id: string;
  quoteId: string;
  occurredAt: string; // ISO
  phase: QuotePhase;
  type: string; // original event type
  actorLabel: string; // "Customer", "Supplier", "Admin", "System", or specific name if available
  title: string; // short human-readable title
  description?: string; // optional longer copy
};

type RawQuoteEvent = {
  id: string;
  quote_id: string;
  event_type: string;
  created_at: string;
  actor_role?: string | null;
  actor_name?: string | null;
  metadata?: Record<string, unknown> | null;
  payload?: Record<string, unknown> | null;
};

const MESSAGE_EVENT_TYPES = new Set<string>(["message_posted", "quote_message_posted"]);

const STATUS_CHANGE_EVENT_TYPES = new Set<string>([
  "submitted",
  "supplier_invited",
  "bid_received",
  "quote_awarded",
  "awarded",
  "quote_won",
  "bid_won",
  "kickoff_started",
  "kickoff_updated",
  "kickoff_completed",
  "kickoff_nudged",
  "quote_archived",
  "archived",
  "quote_reopened",
  "reopened",
]);

export function mapRawEventToTimelineEvent(
  raw: RawQuoteEvent,
  options: { copyVariant?: "rfq" | "search" } = {},
): QuoteTimelineEvent {
  const id = normalizeText(raw?.id) ?? "";
  const quoteId = normalizeText(raw?.quote_id) ?? "";
  const type = normalizeEventType(raw?.event_type);
  const occurredAt =
    typeof raw?.created_at === "string" && raw.created_at.trim()
      ? raw.created_at.trim()
      : new Date().toISOString();

  const metadata = isRecord(raw?.metadata) ? raw.metadata : {};
  const payload = isRecord(raw?.payload) ? raw.payload : null;

  // Reuse the existing quote_events -> UI-copy mapping for consistency across portals.
  const formatted = formatQuoteEvent(
    toQuoteEventRecord({
      id,
      quoteId,
      eventType: type,
      occurredAt,
      actorRole: raw?.actor_role,
      metadata,
      payload,
    }),
    options,
  );

  const actorLabel =
    formatted.actorLabel ??
    normalizeText(raw?.actor_name) ??
    formatActorRoleFallback(raw?.actor_role);

  const phase = inferPhase({
    eventType: type,
    formattedGroupKey: formatted.groupKey,
    metadata,
  });

  return {
    id,
    quoteId,
    occurredAt,
    phase,
    type,
    actorLabel,
    title: formatted.title,
    description: formatted.subtitle,
  };
}

export function groupTimelineEventsByPhase(
  events: QuoteTimelineEvent[],
): Record<QuotePhase, QuoteTimelineEvent[]> {
  const grouped: Record<QuotePhase, QuoteTimelineEvent[]> = {
    rfq: [],
    bidding: [],
    award: [],
    kickoff: [],
    execution: [],
  };

  for (const event of Array.isArray(events) ? events : []) {
    const phase = event?.phase;
    if (
      phase === "rfq" ||
      phase === "bidding" ||
      phase === "award" ||
      phase === "kickoff" ||
      phase === "execution"
    ) {
      grouped[phase].push(event);
    }
  }

  return grouped;
}

export function isMessageTimelineEvent(eventType: string): boolean {
  return MESSAGE_EVENT_TYPES.has(normalizeEventType(eventType));
}

export function isStatusChangeTimelineEvent(eventType: string): boolean {
  return STATUS_CHANGE_EVENT_TYPES.has(normalizeEventType(eventType));
}

function inferPhase(args: {
  eventType: string;
  formattedGroupKey: string;
  metadata: Record<string, unknown>;
}): QuotePhase {
  const type = normalizeEventType(args.eventType);

  // Explicit overrides for events that should appear in a specific phase,
  // even if their formatted group key would otherwise bucket them elsewhere.
  if (type === "change_request_created") {
    return "kickoff";
  }
  if (type === "change_request_resolved") {
    return "kickoff";
  }

  if (
    type === "submitted" ||
    type === "supplier_invited" ||
    type === "quote_reopened" ||
    type === "reopened" ||
    type === "quote_archived" ||
    type === "archived"
  ) {
    return "rfq";
  }

  if (type === "bid_received") {
    return "bidding";
  }

  if (type === "quote_awarded" || type === "awarded" || type === "quote_won" || type === "bid_won") {
    return "award";
  }

  if (
    type === "kickoff_started" ||
    type === "kickoff_updated" ||
    type === "kickoff_completed" ||
    type === "kickoff_nudged"
  ) {
    return "kickoff";
  }

  if (type === "capacity_updated" || type === "capacity_update_requested") {
    return "bidding";
  }

  if (MESSAGE_EVENT_TYPES.has(type)) {
    const status =
      readString(args.metadata, "quote_status") ??
      readString(args.metadata, "quoteStatus") ??
      readString(args.metadata, "status");
    const inferredFromStatus = inferPhaseFromQuoteStatus(status);
    return inferredFromStatus ?? "bidding";
  }

  // Fall back to the existing group key classification when possible.
  const groupKey = normalizeEventType(args.formattedGroupKey);
  if (groupKey === "rfq") return "rfq";
  if (groupKey === "bids") return "bidding";
  if (groupKey === "award") return "award";
  if (groupKey === "kickoff") return "kickoff";
  if (groupKey === "messages") return "bidding";

  return "execution";
}

function inferPhaseFromQuoteStatus(status: string | null): QuotePhase | null {
  const normalized = normalizeEventType(status ?? "");
  if (!normalized) return null;

  // These statuses are used across the app (`src/server/quotes/status.ts`).
  if (normalized === "submitted" || normalized === "in_review") return "rfq";
  if (normalized === "quoted" || normalized === "approved") return "bidding";
  if (normalized === "won") return "execution";
  if (normalized === "lost" || normalized === "cancelled") return "execution";
  if (normalized === "awarded") return "award";

  return null;
}

function toQuoteEventRecord(args: {
  id: string;
  quoteId: string;
  eventType: string;
  occurredAt: string;
  actorRole?: string | null;
  metadata: Record<string, unknown>;
  payload: Record<string, unknown> | null;
}): QuoteEventRecord {
  return {
    id: args.id,
    quote_id: args.quoteId,
    event_type: args.eventType,
    actor_role: normalizeActorRole(args.actorRole),
    actor_user_id: null,
    actor_supplier_id: null,
    metadata: args.metadata,
    payload: args.payload,
    created_at: args.occurredAt,
  };
}

function normalizeActorRole(value: unknown): QuoteEventActorRole {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (
    normalized === "admin" ||
    normalized === "customer" ||
    normalized === "supplier" ||
    normalized === "system"
  ) {
    return normalized;
  }
  return "system";
}

function formatActorRoleFallback(value: unknown): string {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (normalized === "customer") return "Customer";
  if (normalized === "supplier") return "Supplier";
  if (normalized === "admin") return "Admin";
  if (normalized === "system") return "System";
  return "Unknown";
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeEventType(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readString(
  metadata: Record<string, unknown>,
  key: string,
): string | null {
  const value = metadata[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

