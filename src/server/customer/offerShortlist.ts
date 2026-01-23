import { supabaseServer } from "@/lib/supabaseServer";
import { schemaGate } from "@/server/db/schemaContract";
import {
  handleMissingSupabaseSchema,
  isSupabaseRelationMarkedMissing,
  serializeSupabaseError,
  warnOnce,
} from "@/server/db/schemaErrors";
import { listOpsEventsForQuote, logOpsEvent, type OpsEventRecord } from "@/server/ops/events";

const SAVED_SEARCHES_RELATION = "saved_searches";
const SAVED_SEARCHES_COLUMNS = [
  "quote_id",
  "customer_id",
  "label",
  "created_at",
  "last_viewed_at",
];
const SHORTLIST_COLUMN = "shortlisted_offer_ids";
const WARN_PREFIX = "[customer_offer_shortlist]";
const MAX_LABEL_LENGTH = 120;

type SavedSearchShortlistRow = {
  shortlisted_offer_ids: string[] | null;
  label: string | null;
};

export type OfferShortlistSource = "saved_searches" | "ops_events" | "none";

export type OfferShortlistSnapshot = {
  offerIds: string[];
  source: OfferShortlistSource;
};

export type OfferShortlistUpdateResult =
  | { ok: true; source: OfferShortlistSource; offerIds: string[] }
  | { ok: false; reason: "invalid" | "unsupported" | "unknown" };

export async function loadCustomerOfferShortlist(args: {
  customerId: string;
  quoteId: string;
  opsEvents?: OpsEventRecord[] | null;
}): Promise<OfferShortlistSnapshot> {
  const customerId = normalizeId(args.customerId);
  const quoteId = normalizeId(args.quoteId);
  if (!customerId || !quoteId) {
    return { offerIds: [], source: "none" };
  }

  const supported = await ensureSavedSearchShortlistSchema("select");
  if (supported && !isSupabaseRelationMarkedMissing(SAVED_SEARCHES_RELATION)) {
    try {
      const { data, error } = await supabaseServer()
        .from(SAVED_SEARCHES_RELATION)
        .select(SHORTLIST_COLUMN)
        .eq("customer_id", customerId)
        .eq("quote_id", quoteId)
        .maybeSingle<SavedSearchShortlistRow>();

      if (error) {
        if (
          handleMissingSupabaseSchema({
            relation: SAVED_SEARCHES_RELATION,
            error,
            warnPrefix: WARN_PREFIX,
            warnKey: "customer_offer_shortlist:select_missing_schema",
          })
        ) {
          return loadShortlistFromOpsEvents({ quoteId, opsEvents: args.opsEvents });
        }
        warnOnce(
          "customer_offer_shortlist:select_failed",
          `${WARN_PREFIX} select failed; falling back to ops events`,
          { code: serializeSupabaseError(error).code },
        );
        return loadShortlistFromOpsEvents({ quoteId, opsEvents: args.opsEvents });
      }

      const offerIds = normalizeOfferIdArray(data?.shortlisted_offer_ids);
      return { offerIds, source: "saved_searches" };
    } catch (error) {
      if (
        handleMissingSupabaseSchema({
          relation: SAVED_SEARCHES_RELATION,
          error,
          warnPrefix: WARN_PREFIX,
          warnKey: "customer_offer_shortlist:select_crash_missing_schema",
        })
      ) {
        return loadShortlistFromOpsEvents({ quoteId, opsEvents: args.opsEvents });
      }
      warnOnce(
        "customer_offer_shortlist:select_crash",
        `${WARN_PREFIX} select crashed; falling back to ops events`,
        { error: String(error) },
      );
      return loadShortlistFromOpsEvents({ quoteId, opsEvents: args.opsEvents });
    }
  }

  return loadShortlistFromOpsEvents({ quoteId, opsEvents: args.opsEvents });
}

export async function updateCustomerOfferShortlist(args: {
  customerId: string;
  quoteId: string;
  offerId: string;
  shortlisted: boolean;
  providerId?: string | null;
  label?: string | null;
}): Promise<OfferShortlistUpdateResult> {
  const customerId = normalizeId(args.customerId);
  const quoteId = normalizeId(args.quoteId);
  const offerId = normalizeId(args.offerId);
  if (!customerId || !quoteId || !offerId) {
    return { ok: false, reason: "invalid" };
  }

  const supported = await ensureSavedSearchShortlistSchema("upsert");
  if (supported && !isSupabaseRelationMarkedMissing(SAVED_SEARCHES_RELATION)) {
    const result = await upsertSavedSearchShortlist({
      customerId,
      quoteId,
      offerId,
      shortlisted: Boolean(args.shortlisted),
      label: normalizeLabel(args.label),
    });
    if (result.ok) {
      return { ok: true, source: "saved_searches", offerIds: result.offerIds };
    }
    if (result.reason === "unsupported") {
      // Fall through to ops-event fallback.
    } else if (result.reason === "unknown") {
      warnOnce(
        "customer_offer_shortlist:upsert_failed",
        `${WARN_PREFIX} upsert failed; falling back to ops events`,
      );
    }
  }

  await logOpsEvent({
    quoteId,
    eventType: args.shortlisted ? "offer_shortlisted" : "offer_unshortlisted",
    payload: {
      offer_id: offerId,
      provider_id: normalizeId(args.providerId ?? null) || undefined,
      shortlisted: Boolean(args.shortlisted),
    },
  });

  return {
    ok: true,
    source: "ops_events",
    offerIds: args.shortlisted ? [offerId] : [],
  };
}

async function upsertSavedSearchShortlist(args: {
  customerId: string;
  quoteId: string;
  offerId: string;
  shortlisted: boolean;
  label: string;
}): Promise<{ ok: true; offerIds: string[] } | { ok: false; reason: "unsupported" | "unknown" }> {
  const shortlistRow = await readSavedSearchShortlist({
    customerId: args.customerId,
    quoteId: args.quoteId,
  });

  if (!shortlistRow.ok) {
    return { ok: false, reason: shortlistRow.reason };
  }

  const existing = shortlistRow.offerIds;
  const nextSet = new Set(existing);
  if (args.shortlisted) {
    nextSet.add(args.offerId);
  } else {
    nextSet.delete(args.offerId);
  }
  const nextOfferIds = Array.from(nextSet);

  const hasRow = shortlistRow.hasRow;
  const label =
    args.label || shortlistRow.label || buildSavedSearchFallbackLabel(args.quoteId);

  if (!hasRow && !args.shortlisted && nextOfferIds.length === 0) {
    return { ok: true, offerIds: nextOfferIds };
  }

  const payload = {
    customer_id: args.customerId,
    quote_id: args.quoteId,
    label,
    last_viewed_at: new Date().toISOString(),
    [SHORTLIST_COLUMN]: nextOfferIds,
  };

  try {
    if (hasRow) {
      const { error } = await supabaseServer()
        .from(SAVED_SEARCHES_RELATION)
        .update({ [SHORTLIST_COLUMN]: nextOfferIds, last_viewed_at: payload.last_viewed_at })
        .eq("customer_id", args.customerId)
        .eq("quote_id", args.quoteId);

      if (error) {
        if (
          handleMissingSupabaseSchema({
            relation: SAVED_SEARCHES_RELATION,
            error,
            warnPrefix: WARN_PREFIX,
            warnKey: "customer_offer_shortlist:update_missing_schema",
          })
        ) {
          return { ok: false, reason: "unsupported" };
        }
        warnOnce(
          "customer_offer_shortlist:update_failed",
          `${WARN_PREFIX} update failed`,
          { code: serializeSupabaseError(error).code },
        );
        return { ok: false, reason: "unknown" };
      }

      return { ok: true, offerIds: nextOfferIds };
    }

    const { error } = await supabaseServer().from(SAVED_SEARCHES_RELATION).insert(payload);
    if (error) {
      if (
        handleMissingSupabaseSchema({
          relation: SAVED_SEARCHES_RELATION,
          error,
          warnPrefix: WARN_PREFIX,
          warnKey: "customer_offer_shortlist:insert_missing_schema",
        })
      ) {
        return { ok: false, reason: "unsupported" };
      }
      warnOnce(
        "customer_offer_shortlist:insert_failed",
        `${WARN_PREFIX} insert failed`,
        { code: serializeSupabaseError(error).code },
      );
      return { ok: false, reason: "unknown" };
    }

    return { ok: true, offerIds: nextOfferIds };
  } catch (error) {
    if (
      handleMissingSupabaseSchema({
        relation: SAVED_SEARCHES_RELATION,
        error,
        warnPrefix: WARN_PREFIX,
        warnKey: "customer_offer_shortlist:upsert_crash_missing_schema",
      })
    ) {
      return { ok: false, reason: "unsupported" };
    }
    warnOnce(
      "customer_offer_shortlist:upsert_crash",
      `${WARN_PREFIX} upsert crashed`,
      { error: String(error) },
    );
    return { ok: false, reason: "unknown" };
  }
}

async function readSavedSearchShortlist(args: {
  customerId: string;
  quoteId: string;
}): Promise<
  | { ok: true; offerIds: string[]; hasRow: boolean; label: string }
  | { ok: false; reason: "unsupported" | "unknown" }
> {
  try {
    const { data, error } = await supabaseServer()
      .from(SAVED_SEARCHES_RELATION)
      .select(`label,${SHORTLIST_COLUMN}`)
      .eq("customer_id", args.customerId)
      .eq("quote_id", args.quoteId)
      .maybeSingle<SavedSearchShortlistRow>();

    if (error) {
      if (
        handleMissingSupabaseSchema({
          relation: SAVED_SEARCHES_RELATION,
          error,
          warnPrefix: WARN_PREFIX,
          warnKey: "customer_offer_shortlist:lookup_missing_schema",
        })
      ) {
        return { ok: false, reason: "unsupported" };
      }
      warnOnce(
        "customer_offer_shortlist:lookup_failed",
        `${WARN_PREFIX} lookup failed`,
        { code: serializeSupabaseError(error).code },
      );
      return { ok: false, reason: "unknown" };
    }

    if (!data) {
      return { ok: true, offerIds: [], hasRow: false, label: "" };
    }

    return {
      ok: true,
      offerIds: normalizeOfferIdArray(data.shortlisted_offer_ids),
      hasRow: true,
      label: normalizeLabel(data.label),
    };
  } catch (error) {
    if (
      handleMissingSupabaseSchema({
        relation: SAVED_SEARCHES_RELATION,
        error,
        warnPrefix: WARN_PREFIX,
        warnKey: "customer_offer_shortlist:lookup_crash_missing_schema",
      })
    ) {
      return { ok: false, reason: "unsupported" };
    }
    warnOnce(
      "customer_offer_shortlist:lookup_crash",
      `${WARN_PREFIX} lookup crashed`,
      { error: String(error) },
    );
    return { ok: false, reason: "unknown" };
  }
}

async function loadShortlistFromOpsEvents(args: {
  quoteId: string;
  opsEvents?: OpsEventRecord[] | null;
}): Promise<OfferShortlistSnapshot> {
  const quoteId = normalizeId(args.quoteId);
  if (!quoteId) {
    return { offerIds: [], source: "none" };
  }

  if (Array.isArray(args.opsEvents)) {
    return {
      offerIds: deriveOfferShortlistFromOpsEvents(args.opsEvents),
      source: "ops_events",
    };
  }

  const result = await listOpsEventsForQuote(quoteId, { limit: 100 });
  if (!result.ok) {
    return { offerIds: [], source: "ops_events" };
  }

  return {
    offerIds: deriveOfferShortlistFromOpsEvents(result.events),
    source: "ops_events",
  };
}

export function deriveOfferShortlistFromOpsEvents(events: OpsEventRecord[]): string[] {
  if (!Array.isArray(events) || events.length === 0) {
    return [];
  }

  const sorted = [...events].sort((a, b) => {
    const aMs = Date.parse(a.created_at);
    const bMs = Date.parse(b.created_at);
    if (Number.isFinite(aMs) && Number.isFinite(bMs) && aMs !== bMs) {
      return bMs - aMs;
    }
    return a.id.localeCompare(b.id);
  });

  const shortlistByOffer = new Map<string, boolean>();
  for (const event of sorted) {
    const offerId = readOfferId(event.payload);
    if (!offerId || shortlistByOffer.has(offerId)) continue;

    if (event.event_type === "offer_shortlisted") {
      shortlistByOffer.set(offerId, true);
      continue;
    }
    if (event.event_type === "offer_unshortlisted") {
      shortlistByOffer.set(offerId, false);
    }
  }

  return Array.from(shortlistByOffer.entries())
    .filter(([, value]) => value)
    .map(([offerId]) => offerId);
}

async function ensureSavedSearchShortlistSchema(warnKey: string): Promise<boolean> {
  const requiredColumns = [...SAVED_SEARCHES_COLUMNS, SHORTLIST_COLUMN];
  return schemaGate({
    enabled: true,
    relation: SAVED_SEARCHES_RELATION,
    requiredColumns,
    warnPrefix: WARN_PREFIX,
    warnKey: `customer_offer_shortlist:${warnKey}`,
  });
}

function normalizeId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeOfferIdArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const entries = value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean);
  return Array.from(new Set(entries));
}

function normalizeLabel(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  return trimmed.length > MAX_LABEL_LENGTH ? trimmed.slice(0, MAX_LABEL_LENGTH) : trimmed;
}

function buildSavedSearchFallbackLabel(quoteId: string): string {
  if (!quoteId) {
    return "Saved search";
  }
  return `Search ${quoteId.slice(0, 6).toUpperCase()}`;
}

function readOfferId(payload: Record<string, unknown>): string {
  const raw = payload?.offer_id ?? payload?.offerId ?? null;
  return normalizeId(raw);
}

