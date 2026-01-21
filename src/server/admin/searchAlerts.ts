import { supabaseServer } from "@/lib/supabaseServer";
import { requireAdminUser } from "@/server/auth";
import { schemaGate } from "@/server/db/schemaContract";
import {
  handleMissingSupabaseSchema,
  isSupabaseRelationMarkedMissing,
  serializeSupabaseError,
  warnOnce,
} from "@/server/db/schemaErrors";

const WARN_PREFIX = "[admin search alerts]";
const SAVED_SEARCHES_RELATION = "saved_searches";
const ADMIN_QUOTES_INBOX_RELATION = "admin_quotes_inbox";
const OPS_EVENTS_RELATION = "ops_events";
const RECENT_WINDOW_DAYS = 7;
const DEFAULT_LIMIT = 250;

export const SEARCH_ALERTS_RECENT_WINDOW_DAYS = RECENT_WINDOW_DAYS;

export type AdminSearchAlertFilter = "recent" | "awaiting_offers" | "offers_received";

export type AdminSearchAlertRow = {
  quoteId: string;
  label: string;
  createdAt: string;
  lastViewedAt: string | null;
  customerName: string | null;
  customerEmail: string | null;
  company: string | null;
  status: string | null;
  fileName: string | null;
  uploadName: string | null;
  bidCount: number | null;
  notifiedAt: string | null;
};

export type AdminSearchAlertsResult =
  | {
      ok: true;
      supported: true;
      rows: AdminSearchAlertRow[];
      opsEventsSupported: boolean;
    }
  | { ok: true; supported: false; reason: "unsupported_schema" }
  | { ok: false; supported: false; reason: "unknown" };

type SavedSearchRow = {
  quote_id: string | null;
  label: string | null;
  created_at: string | null;
  last_viewed_at: string | null;
};

type AdminQuotesInboxRow = {
  id: string | null;
  status: string | null;
  customer_name: string | null;
  customer_email: string | null;
  company: string | null;
  file_name: string | null;
  upload_name: string | null;
  bid_count: number | null;
};

type OpsEventRow = {
  quote_id: string | null;
  created_at: string | null;
};

export async function loadAdminSearchAlertsQueue(args: {
  filter?: AdminSearchAlertFilter | null;
  limit?: number | null;
} = {}): Promise<AdminSearchAlertsResult> {
  await requireAdminUser();

  const filter = normalizeFilter(args.filter) ?? "recent";
  const limit = normalizeLimit(args.limit);

  if (isSupabaseRelationMarkedMissing(SAVED_SEARCHES_RELATION)) {
    return { ok: true, supported: false, reason: "unsupported_schema" };
  }

  const savedSearchesSupported = await schemaGate({
    enabled: true,
    relation: SAVED_SEARCHES_RELATION,
    requiredColumns: [
      "quote_id",
      "customer_id",
      "label",
      "created_at",
      "last_viewed_at",
      "search_alerts_enabled",
    ],
    warnPrefix: WARN_PREFIX,
    warnKey: "admin_search_alerts:saved_searches",
  });
  if (!savedSearchesSupported) {
    return { ok: true, supported: false, reason: "unsupported_schema" };
  }

  try {
    let query = supabaseServer
      .from(SAVED_SEARCHES_RELATION)
      .select("quote_id,label,created_at,last_viewed_at")
      .eq("search_alerts_enabled", true)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (filter === "recent") {
      query = query.gte("created_at", getSinceIso(RECENT_WINDOW_DAYS));
    }

    const { data, error } = await query.returns<SavedSearchRow[]>();
    if (error) {
      if (
        handleMissingSupabaseSchema({
          relation: SAVED_SEARCHES_RELATION,
          error,
          warnPrefix: WARN_PREFIX,
          warnKey: "admin_search_alerts:saved_searches_missing_schema",
        })
      ) {
        return { ok: true, supported: false, reason: "unsupported_schema" };
      }
      console.error("[admin search alerts] saved searches query failed", {
        error: serializeSupabaseError(error),
      });
      return { ok: false, supported: false, reason: "unknown" };
    }

    const savedSearches = (Array.isArray(data) ? data : [])
      .map((row) => normalizeSavedSearchRow(row))
      .filter((row): row is SavedSearchSummary => Boolean(row));

    if (savedSearches.length === 0) {
      return {
        ok: true,
        supported: true,
        rows: [],
        opsEventsSupported: false,
      };
    }

    const quoteIds = savedSearches.map((row) => row.quoteId);
    const [inboxResult, notifiedResult] = await Promise.all([
      loadAdminQuotesInboxRows(quoteIds),
      loadSearchAlertNotifiedEvents(quoteIds),
    ]);

    if (!inboxResult.supported) {
      return { ok: true, supported: false, reason: "unsupported_schema" };
    }

    const rows: AdminSearchAlertRow[] = savedSearches.map((search) => {
      const inbox = inboxResult.rowsById.get(search.quoteId) ?? null;
      const bidCount =
        typeof inbox?.bid_count === "number" && Number.isFinite(inbox.bid_count)
          ? inbox.bid_count
          : null;
      return {
        quoteId: search.quoteId,
        label: search.label,
        createdAt: search.createdAt,
        lastViewedAt: search.lastViewedAt,
        customerName: normalizeOptionalText(inbox?.customer_name),
        customerEmail: normalizeOptionalText(inbox?.customer_email),
        company: normalizeOptionalText(inbox?.company),
        status: normalizeOptionalText(inbox?.status),
        fileName: normalizeOptionalText(inbox?.file_name),
        uploadName: normalizeOptionalText(inbox?.upload_name),
        bidCount,
        notifiedAt: notifiedResult.eventsByQuoteId.get(search.quoteId) ?? null,
      };
    });

    const filteredRows = applyFilter(rows, filter);

    return {
      ok: true,
      supported: true,
      rows: filteredRows,
      opsEventsSupported: notifiedResult.supported,
    };
  } catch (error) {
    if (
      handleMissingSupabaseSchema({
        relation: SAVED_SEARCHES_RELATION,
        error,
        warnPrefix: WARN_PREFIX,
        warnKey: "admin_search_alerts:saved_searches_crash_missing_schema",
      })
    ) {
      return { ok: true, supported: false, reason: "unsupported_schema" };
    }
    console.error("[admin search alerts] load crashed", { error });
    return { ok: false, supported: false, reason: "unknown" };
  }
}

function applyFilter(
  rows: AdminSearchAlertRow[],
  filter: AdminSearchAlertFilter,
): AdminSearchAlertRow[] {
  if (filter === "awaiting_offers") {
    return rows.filter((row) => row.bidCount === 0);
  }
  if (filter === "offers_received") {
    return rows.filter((row) => typeof row.bidCount === "number" && row.bidCount > 0);
  }
  return rows;
}

async function loadAdminQuotesInboxRows(
  quoteIds: string[],
): Promise<{ supported: boolean; rowsById: Map<string, AdminQuotesInboxRow> }> {
  const map = new Map<string, AdminQuotesInboxRow>();
  if (quoteIds.length === 0) {
    return { supported: true, rowsById: map };
  }

  if (isSupabaseRelationMarkedMissing(ADMIN_QUOTES_INBOX_RELATION)) {
    return { supported: false, rowsById: map };
  }

  const supported = await schemaGate({
    enabled: true,
    relation: ADMIN_QUOTES_INBOX_RELATION,
    requiredColumns: [
      "id",
      "status",
      "customer_name",
      "customer_email",
      "company",
      "file_name",
      "upload_name",
      "bid_count",
    ],
    warnPrefix: WARN_PREFIX,
    warnKey: "admin_search_alerts:admin_quotes_inbox",
  });
  if (!supported) {
    return { supported: false, rowsById: map };
  }

  try {
    const { data, error } = await supabaseServer
      .from(ADMIN_QUOTES_INBOX_RELATION)
      .select(
        "id,status,customer_name,customer_email,company,file_name,upload_name,bid_count",
      )
      .in("id", quoteIds)
      .returns<AdminQuotesInboxRow[]>();

    if (error) {
      if (
        handleMissingSupabaseSchema({
          relation: ADMIN_QUOTES_INBOX_RELATION,
          error,
          warnPrefix: WARN_PREFIX,
          warnKey: "admin_search_alerts:admin_quotes_inbox_missing_schema",
        })
      ) {
        return { supported: false, rowsById: map };
      }
      console.error("[admin search alerts] admin inbox query failed", {
        error: serializeSupabaseError(error),
      });
      return { supported: true, rowsById: map };
    }

    for (const row of Array.isArray(data) ? data : []) {
      const id = normalizeId(row?.id);
      if (!id) continue;
      map.set(id, row);
    }
  } catch (error) {
    if (
      handleMissingSupabaseSchema({
        relation: ADMIN_QUOTES_INBOX_RELATION,
        error,
        warnPrefix: WARN_PREFIX,
        warnKey: "admin_search_alerts:admin_quotes_inbox_crash_missing_schema",
      })
    ) {
      return { supported: false, rowsById: map };
    }
    console.error("[admin search alerts] admin inbox query crashed", {
      error,
    });
  }

  return { supported: true, rowsById: map };
}

async function loadSearchAlertNotifiedEvents(
  quoteIds: string[],
): Promise<{ supported: boolean; eventsByQuoteId: Map<string, string> }> {
  const map = new Map<string, string>();
  if (quoteIds.length === 0) {
    return { supported: false, eventsByQuoteId: map };
  }

  if (isSupabaseRelationMarkedMissing(OPS_EVENTS_RELATION)) {
    return { supported: false, eventsByQuoteId: map };
  }

  const supported = await schemaGate({
    enabled: true,
    relation: OPS_EVENTS_RELATION,
    requiredColumns: ["quote_id", "event_type", "created_at"],
    warnPrefix: WARN_PREFIX,
    warnKey: "admin_search_alerts:ops_events",
  });
  if (!supported) {
    return { supported: false, eventsByQuoteId: map };
  }

  try {
    const { data, error } = await supabaseServer
      .from(OPS_EVENTS_RELATION)
      .select("quote_id,created_at")
      .eq("event_type", "search_alert_notified")
      .in("quote_id", quoteIds)
      .order("created_at", { ascending: false })
      .returns<OpsEventRow[]>();

    if (error) {
      if (
        handleMissingSupabaseSchema({
          relation: OPS_EVENTS_RELATION,
          error,
          warnPrefix: WARN_PREFIX,
          warnKey: "admin_search_alerts:ops_events_missing_schema",
        })
      ) {
        return { supported: false, eventsByQuoteId: map };
      }
      warnOnce(
        "admin_search_alerts:ops_events_failed",
        `${WARN_PREFIX} ops events query failed`,
        { code: serializeSupabaseError(error).code },
      );
      return { supported: true, eventsByQuoteId: map };
    }

    for (const row of Array.isArray(data) ? data : []) {
      const quoteId = normalizeId(row?.quote_id);
      const createdAt = normalizeOptionalText(row?.created_at);
      if (!quoteId || !createdAt) continue;
      if (!map.has(quoteId)) {
        map.set(quoteId, createdAt);
      }
    }
  } catch (error) {
    if (
      handleMissingSupabaseSchema({
        relation: OPS_EVENTS_RELATION,
        error,
        warnPrefix: WARN_PREFIX,
        warnKey: "admin_search_alerts:ops_events_crash_missing_schema",
      })
    ) {
      return { supported: false, eventsByQuoteId: map };
    }
    warnOnce(
      "admin_search_alerts:ops_events_crash",
      `${WARN_PREFIX} ops events query crashed`,
      { error: String(error) },
    );
  }

  return { supported: true, eventsByQuoteId: map };
}

type SavedSearchSummary = {
  quoteId: string;
  label: string;
  createdAt: string;
  lastViewedAt: string | null;
};

function normalizeSavedSearchRow(row: SavedSearchRow): SavedSearchSummary | null {
  const quoteId = normalizeId(row?.quote_id);
  if (!quoteId) return null;
  const label =
    normalizeOptionalText(row?.label) || `Search ${quoteId.slice(0, 6).toUpperCase()}`;
  const createdAt = normalizeOptionalText(row?.created_at) ?? new Date().toISOString();
  const lastViewedAt = normalizeOptionalText(row?.last_viewed_at);
  return {
    quoteId,
    label,
    createdAt,
    lastViewedAt: lastViewedAt ?? null,
  };
}

function normalizeFilter(value: unknown): AdminSearchAlertFilter | null {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (raw === "recent") return "recent";
  if (raw === "awaiting_offers" || raw === "awaiting-offers" || raw === "awaiting") {
    return "awaiting_offers";
  }
  if (raw === "offers_received" || raw === "offers-received" || raw === "offers") {
    return "offers_received";
  }
  return null;
}

function normalizeLimit(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(1, Math.min(Math.floor(value), 500));
  }
  return DEFAULT_LIMIT;
}

function normalizeId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeOptionalText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function getSinceIso(days: number): string {
  const normalized = Math.max(1, Math.floor(days));
  return new Date(Date.now() - normalized * 24 * 60 * 60 * 1000).toISOString();
}
