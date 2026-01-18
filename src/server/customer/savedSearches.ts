import { supabaseServer } from "@/lib/supabaseServer";
import { schemaGate } from "@/server/db/schemaContract";
import {
  handleMissingSupabaseSchema,
  isSupabaseRelationMarkedMissing,
  serializeSupabaseError,
  warnOnce,
} from "@/server/db/schemaErrors";

const SAVED_SEARCHES_RELATION = "saved_searches";
const SAVED_SEARCHES_COLUMNS = [
  "quote_id",
  "customer_id",
  "label",
  "created_at",
  "last_viewed_at",
];
const WARN_PREFIX = "[customer_saved_searches]";
const MAX_LABEL_LENGTH = 120;

type SavedSearchRow = {
  quote_id: string | null;
  label: string | null;
  created_at: string | null;
  last_viewed_at: string | null;
};

type QuoteActivityRow = {
  id: string | null;
  updated_at: string | null;
  created_at: string | null;
};

export type SavedSearchListItem = {
  quoteId: string;
  label: string;
  createdAt: string;
  lastViewedAt: string | null;
  lastActivityAt: string | null;
};

export type SavedSearchListResult = {
  supported: boolean;
  searches: SavedSearchListItem[];
};

type SavedSearchMutationResult =
  | { ok: true }
  | { ok: false; reason: "invalid" | "unsupported" | "unknown" };

export async function listCustomerSavedSearches(customerId: string): Promise<SavedSearchListResult> {
  const id = normalizeId(customerId);
  if (!id) {
    return { supported: true, searches: [] };
  }

  const supported = await ensureSavedSearchesSchema("list");
  if (!supported || isSupabaseRelationMarkedMissing(SAVED_SEARCHES_RELATION)) {
    return { supported: false, searches: [] };
  }

  try {
    const { data, error } = await supabaseServer
      .from(SAVED_SEARCHES_RELATION)
      .select("quote_id,label,created_at,last_viewed_at")
      .eq("customer_id", id)
      .order("created_at", { ascending: false })
      .returns<SavedSearchRow[]>();

    if (error) {
      if (
        handleMissingSupabaseSchema({
          relation: SAVED_SEARCHES_RELATION,
          error,
          warnPrefix: WARN_PREFIX,
          warnKey: "customer_saved_searches:list_missing_schema",
        })
      ) {
        return { supported: false, searches: [] };
      }
      warnOnce(
        "customer_saved_searches:list_failed",
        `${WARN_PREFIX} list failed; returning empty`,
        { code: serializeSupabaseError(error).code },
      );
      return { supported: true, searches: [] };
    }

    const normalized = (Array.isArray(data) ? data : [])
      .map((row) => normalizeSavedSearchRow(row))
      .filter((row): row is SavedSearchListItem => Boolean(row));

    const quoteIds = normalized.map((row) => row.quoteId);
    const activityByQuoteId = await loadQuoteLastActivityById(quoteIds);

    return {
      supported: true,
      searches: normalized.map((row) => ({
        ...row,
        lastActivityAt: activityByQuoteId.get(row.quoteId) ?? null,
      })),
    };
  } catch (error) {
    if (
      handleMissingSupabaseSchema({
        relation: SAVED_SEARCHES_RELATION,
        error,
        warnPrefix: WARN_PREFIX,
        warnKey: "customer_saved_searches:list_crash_missing_schema",
      })
    ) {
      return { supported: false, searches: [] };
    }
    warnOnce(
      "customer_saved_searches:list_crash",
      `${WARN_PREFIX} list crashed; returning empty`,
      { error: String(error) },
    );
    return { supported: true, searches: [] };
  }
}

export async function saveCustomerSearch(input: {
  customerId: string;
  quoteId: string;
  label: string;
}): Promise<SavedSearchMutationResult> {
  const customerId = normalizeId(input.customerId);
  const quoteId = normalizeId(input.quoteId);
  const label = normalizeLabel(input.label);

  if (!customerId || !quoteId || !label) {
    return { ok: false, reason: "invalid" };
  }

  const supported = await ensureSavedSearchesSchema("upsert");
  if (!supported || isSupabaseRelationMarkedMissing(SAVED_SEARCHES_RELATION)) {
    return { ok: false, reason: "unsupported" };
  }

  try {
    const { error } = await supabaseServer.from(SAVED_SEARCHES_RELATION).upsert(
      {
        customer_id: customerId,
        quote_id: quoteId,
        label,
        last_viewed_at: new Date().toISOString(),
      },
      { onConflict: "customer_id,quote_id" },
    );

    if (error) {
      if (
        handleMissingSupabaseSchema({
          relation: SAVED_SEARCHES_RELATION,
          error,
          warnPrefix: WARN_PREFIX,
          warnKey: "customer_saved_searches:upsert_missing_schema",
        })
      ) {
        return { ok: false, reason: "unsupported" };
      }
      warnOnce(
        "customer_saved_searches:upsert_failed",
        `${WARN_PREFIX} upsert failed`,
        { code: serializeSupabaseError(error).code },
      );
      return { ok: false, reason: "unknown" };
    }

    return { ok: true };
  } catch (error) {
    if (
      handleMissingSupabaseSchema({
        relation: SAVED_SEARCHES_RELATION,
        error,
        warnPrefix: WARN_PREFIX,
        warnKey: "customer_saved_searches:upsert_crash_missing_schema",
      })
    ) {
      return { ok: false, reason: "unsupported" };
    }
    warnOnce(
      "customer_saved_searches:upsert_crash",
      `${WARN_PREFIX} upsert crashed`,
      { error: String(error) },
    );
    return { ok: false, reason: "unknown" };
  }
}

export async function renameCustomerSavedSearch(input: {
  customerId: string;
  quoteId: string;
  label: string;
}): Promise<SavedSearchMutationResult> {
  const customerId = normalizeId(input.customerId);
  const quoteId = normalizeId(input.quoteId);
  const label = normalizeLabel(input.label);

  if (!customerId || !quoteId || !label) {
    return { ok: false, reason: "invalid" };
  }

  const supported = await ensureSavedSearchesSchema("rename");
  if (!supported || isSupabaseRelationMarkedMissing(SAVED_SEARCHES_RELATION)) {
    return { ok: false, reason: "unsupported" };
  }

  try {
    const { error } = await supabaseServer
      .from(SAVED_SEARCHES_RELATION)
      .update({ label })
      .eq("customer_id", customerId)
      .eq("quote_id", quoteId);

    if (error) {
      if (
        handleMissingSupabaseSchema({
          relation: SAVED_SEARCHES_RELATION,
          error,
          warnPrefix: WARN_PREFIX,
          warnKey: "customer_saved_searches:rename_missing_schema",
        })
      ) {
        return { ok: false, reason: "unsupported" };
      }
      warnOnce(
        "customer_saved_searches:rename_failed",
        `${WARN_PREFIX} rename failed`,
        { code: serializeSupabaseError(error).code },
      );
      return { ok: false, reason: "unknown" };
    }

    return { ok: true };
  } catch (error) {
    if (
      handleMissingSupabaseSchema({
        relation: SAVED_SEARCHES_RELATION,
        error,
        warnPrefix: WARN_PREFIX,
        warnKey: "customer_saved_searches:rename_crash_missing_schema",
      })
    ) {
      return { ok: false, reason: "unsupported" };
    }
    warnOnce(
      "customer_saved_searches:rename_crash",
      `${WARN_PREFIX} rename crashed`,
      { error: String(error) },
    );
    return { ok: false, reason: "unknown" };
  }
}

export async function deleteCustomerSavedSearch(input: {
  customerId: string;
  quoteId: string;
}): Promise<SavedSearchMutationResult> {
  const customerId = normalizeId(input.customerId);
  const quoteId = normalizeId(input.quoteId);

  if (!customerId || !quoteId) {
    return { ok: false, reason: "invalid" };
  }

  const supported = await ensureSavedSearchesSchema("delete");
  if (!supported || isSupabaseRelationMarkedMissing(SAVED_SEARCHES_RELATION)) {
    return { ok: false, reason: "unsupported" };
  }

  try {
    const { error } = await supabaseServer
      .from(SAVED_SEARCHES_RELATION)
      .delete()
      .eq("customer_id", customerId)
      .eq("quote_id", quoteId);

    if (error) {
      if (
        handleMissingSupabaseSchema({
          relation: SAVED_SEARCHES_RELATION,
          error,
          warnPrefix: WARN_PREFIX,
          warnKey: "customer_saved_searches:delete_missing_schema",
        })
      ) {
        return { ok: false, reason: "unsupported" };
      }
      warnOnce(
        "customer_saved_searches:delete_failed",
        `${WARN_PREFIX} delete failed`,
        { code: serializeSupabaseError(error).code },
      );
      return { ok: false, reason: "unknown" };
    }

    return { ok: true };
  } catch (error) {
    if (
      handleMissingSupabaseSchema({
        relation: SAVED_SEARCHES_RELATION,
        error,
        warnPrefix: WARN_PREFIX,
        warnKey: "customer_saved_searches:delete_crash_missing_schema",
      })
    ) {
      return { ok: false, reason: "unsupported" };
    }
    warnOnce(
      "customer_saved_searches:delete_crash",
      `${WARN_PREFIX} delete crashed`,
      { error: String(error) },
    );
    return { ok: false, reason: "unknown" };
  }
}

export async function touchCustomerSavedSearch(input: {
  customerId: string;
  quoteId: string;
}): Promise<void> {
  const customerId = normalizeId(input.customerId);
  const quoteId = normalizeId(input.quoteId);
  if (!customerId || !quoteId) {
    return;
  }

  const supported = await ensureSavedSearchesSchema("touch");
  if (!supported || isSupabaseRelationMarkedMissing(SAVED_SEARCHES_RELATION)) {
    return;
  }

  try {
    const { error } = await supabaseServer
      .from(SAVED_SEARCHES_RELATION)
      .update({ last_viewed_at: new Date().toISOString() })
      .eq("customer_id", customerId)
      .eq("quote_id", quoteId);

    if (error) {
      handleMissingSupabaseSchema({
        relation: SAVED_SEARCHES_RELATION,
        error,
        warnPrefix: WARN_PREFIX,
        warnKey: "customer_saved_searches:touch_missing_schema",
      });
    }
  } catch (error) {
    handleMissingSupabaseSchema({
      relation: SAVED_SEARCHES_RELATION,
      error,
      warnPrefix: WARN_PREFIX,
      warnKey: "customer_saved_searches:touch_crash_missing_schema",
    });
  }
}

async function loadQuoteLastActivityById(quoteIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const ids = quoteIds.map((id) => normalizeId(id)).filter(Boolean);
  if (ids.length === 0) {
    return map;
  }

  try {
    const { data, error } = await supabaseServer
      .from("quotes")
      .select("id,updated_at,created_at")
      .in("id", ids)
      .returns<QuoteActivityRow[]>();

    if (error) {
      warnOnce(
        "customer_saved_searches:quote_activity_failed",
        `${WARN_PREFIX} quote activity lookup failed`,
        { code: serializeSupabaseError(error).code },
      );
      return map;
    }

    for (const row of data ?? []) {
      const id = normalizeId(row.id);
      const lastActivityAt = maxIsoTimestamp([row.updated_at, row.created_at]);
      if (id && lastActivityAt) {
        map.set(id, lastActivityAt);
      }
    }
  } catch (error) {
    warnOnce(
      "customer_saved_searches:quote_activity_crash",
      `${WARN_PREFIX} quote activity lookup crashed`,
      { error: String(error) },
    );
  }

  return map;
}

function normalizeSavedSearchRow(row: SavedSearchRow): SavedSearchListItem | null {
  const quoteId = normalizeId(row?.quote_id);
  if (!quoteId) return null;

  const label =
    normalizeLabel(row?.label) ||
    `Search ${quoteId.slice(0, 6).toUpperCase()}`;
  const createdAt =
    typeof row?.created_at === "string" && row.created_at.trim().length > 0
      ? row.created_at
      : new Date().toISOString();
  const lastViewedAt =
    typeof row?.last_viewed_at === "string" && row.last_viewed_at.trim().length > 0
      ? row.last_viewed_at
      : null;

  return {
    quoteId,
    label,
    createdAt,
    lastViewedAt,
    lastActivityAt: null,
  };
}

async function ensureSavedSearchesSchema(warnKey: string): Promise<boolean> {
  const hasSchema = await schemaGate({
    enabled: true,
    relation: SAVED_SEARCHES_RELATION,
    requiredColumns: SAVED_SEARCHES_COLUMNS,
    warnPrefix: WARN_PREFIX,
    warnKey: `customer_saved_searches:${warnKey}`,
  });
  if (!hasSchema) {
    warnOnce(
      `customer_saved_searches:${warnKey}:missing`,
      `${WARN_PREFIX} missing relation; skipping`,
    );
  }
  return hasSchema;
}

function normalizeId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeLabel(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  return trimmed.length > MAX_LABEL_LENGTH ? trimmed.slice(0, MAX_LABEL_LENGTH) : trimmed;
}

function maxIsoTimestamp(values: Array<string | null | undefined>): string | null {
  let best: string | null = null;
  for (const value of values) {
    if (typeof value !== "string" || !value.trim()) continue;
    if (!best || value > best) {
      best = value;
    }
  }
  return best;
}
