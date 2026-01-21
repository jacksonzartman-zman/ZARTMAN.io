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
const SAVED_SEARCHES_ALERT_COLUMN = "search_alerts_enabled";
const WARN_PREFIX = "[customer_saved_searches]";
const MAX_LABEL_LENGTH = 120;

type SavedSearchRow = {
  quote_id: string | null;
  label: string | null;
  created_at: string | null;
  last_viewed_at: string | null;
};

type SavedSearchAlertRow = {
  search_alerts_enabled: boolean | null;
};

type QuoteActivityRow = {
  id: string | null;
  updated_at: string | null;
  created_at: string | null;
};

type QuoteSummaryRow = {
  id: string | null;
  upload_id: string | null;
  target_date: string | null;
};

type UploadSummaryRow = {
  id: string | null;
  manufacturing_process: string | null;
  quantity: string | null;
};

type DestinationSummaryRow = {
  rfq_id: string | null;
  provider_id: string | null;
};

type ProviderLocationRow = {
  id: string | null;
  country: string | null;
};

export type SavedSearchSummary = {
  process: string | null;
  quantity: string | null;
  needBy: string | null;
  locations: string[];
};

type SavedSearchQuoteSummary = {
  process: string | null;
  quantity: string | null;
  needBy: string | null;
};

export type SavedSearchListItem = {
  quoteId: string;
  label: string;
  createdAt: string;
  lastViewedAt: string | null;
  lastActivityAt: string | null;
  summary: SavedSearchSummary;
};

export type SavedSearchListResult = {
  supported: boolean;
  searches: SavedSearchListItem[];
};

export type SavedSearchAlertPreference = {
  supported: boolean;
  enabled: boolean;
  hasRow: boolean;
};

type SavedSearchMutationResult =
  | { ok: true }
  | { ok: false; reason: "invalid" | "unsupported" | "unknown" };

type SavedSearchAlertMutationResult =
  | { ok: true; stored: boolean }
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
    const [activityByQuoteId, summaryByQuoteId] = await Promise.all([
      loadQuoteLastActivityById(quoteIds),
      loadSavedSearchSummaries(quoteIds),
    ]);

    return {
      supported: true,
      searches: normalized.map((row) => ({
        ...row,
        lastActivityAt: activityByQuoteId.get(row.quoteId) ?? null,
        summary: summaryByQuoteId.get(row.quoteId) ?? row.summary,
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

export async function getCustomerSearchAlertPreference(input: {
  customerId: string;
  quoteId: string;
}): Promise<SavedSearchAlertPreference> {
  const customerId = normalizeId(input.customerId);
  const quoteId = normalizeId(input.quoteId);
  if (!customerId || !quoteId) {
    return { supported: false, enabled: false, hasRow: false };
  }

  const supported = await ensureSavedSearchAlertsSchema("alerts_select");
  if (!supported || isSupabaseRelationMarkedMissing(SAVED_SEARCHES_RELATION)) {
    return { supported: false, enabled: false, hasRow: false };
  }

  try {
    const { data, error } = await supabaseServer
      .from(SAVED_SEARCHES_RELATION)
      .select("search_alerts_enabled")
      .eq("customer_id", customerId)
      .eq("quote_id", quoteId)
      .maybeSingle<SavedSearchAlertRow>();

    if (error) {
      if (
        handleMissingSupabaseSchema({
          relation: SAVED_SEARCHES_RELATION,
          error,
          warnPrefix: WARN_PREFIX,
          warnKey: "customer_saved_searches:alerts_select_missing_schema",
        })
      ) {
        return { supported: false, enabled: false, hasRow: false };
      }
      warnOnce(
        "customer_saved_searches:alerts_select_failed",
        `${WARN_PREFIX} alerts lookup failed; defaulting disabled`,
        { code: serializeSupabaseError(error).code },
      );
      return { supported: true, enabled: false, hasRow: false };
    }

    if (!data) {
      return { supported: true, enabled: false, hasRow: false };
    }

    return {
      supported: true,
      enabled: Boolean(data.search_alerts_enabled),
      hasRow: true,
    };
  } catch (error) {
    if (
      handleMissingSupabaseSchema({
        relation: SAVED_SEARCHES_RELATION,
        error,
        warnPrefix: WARN_PREFIX,
        warnKey: "customer_saved_searches:alerts_select_crash_missing_schema",
      })
    ) {
      return { supported: false, enabled: false, hasRow: false };
    }
    warnOnce(
      "customer_saved_searches:alerts_select_crash",
      `${WARN_PREFIX} alerts lookup crashed; defaulting disabled`,
      { error: String(error) },
    );
    return { supported: true, enabled: false, hasRow: false };
  }
}

export async function setCustomerSearchAlertPreference(input: {
  customerId: string;
  quoteId: string;
  enabled: boolean;
  label?: string | null;
}): Promise<SavedSearchAlertMutationResult> {
  const customerId = normalizeId(input.customerId);
  const quoteId = normalizeId(input.quoteId);
  if (!customerId || !quoteId) {
    return { ok: false, reason: "invalid" };
  }

  const supported = await ensureSavedSearchAlertsSchema("alerts_upsert");
  if (!supported || isSupabaseRelationMarkedMissing(SAVED_SEARCHES_RELATION)) {
    return { ok: false, reason: "unsupported" };
  }

  try {
    const { data, error } = await supabaseServer
      .from(SAVED_SEARCHES_RELATION)
      .update({ search_alerts_enabled: Boolean(input.enabled) })
      .eq("customer_id", customerId)
      .eq("quote_id", quoteId)
      .select("quote_id")
      .returns<Array<{ quote_id: string | null }>>();

    if (error) {
      if (
        handleMissingSupabaseSchema({
          relation: SAVED_SEARCHES_RELATION,
          error,
          warnPrefix: WARN_PREFIX,
          warnKey: "customer_saved_searches:alerts_update_missing_schema",
        })
      ) {
        return { ok: false, reason: "unsupported" };
      }
      warnOnce(
        "customer_saved_searches:alerts_update_failed",
        `${WARN_PREFIX} alerts update failed`,
        { code: serializeSupabaseError(error).code },
      );
      return { ok: false, reason: "unknown" };
    }

    if (Array.isArray(data) && data.length > 0) {
      return { ok: true, stored: true };
    }

    const fallbackLabel = buildSavedSearchFallbackLabel(quoteId);
    const label =
      normalizeLabel(input.label) ||
      normalizeLabel(fallbackLabel) ||
      `Search ${quoteId.slice(0, 6).toUpperCase()}`;

    const { error: insertError } = await supabaseServer.from(SAVED_SEARCHES_RELATION).insert({
      customer_id: customerId,
      quote_id: quoteId,
      label,
      last_viewed_at: new Date().toISOString(),
      search_alerts_enabled: Boolean(input.enabled),
    });

    if (insertError) {
      if (
        handleMissingSupabaseSchema({
          relation: SAVED_SEARCHES_RELATION,
          error: insertError,
          warnPrefix: WARN_PREFIX,
          warnKey: "customer_saved_searches:alerts_insert_missing_schema",
        })
      ) {
        return { ok: false, reason: "unsupported" };
      }
      warnOnce(
        "customer_saved_searches:alerts_insert_failed",
        `${WARN_PREFIX} alerts insert failed`,
        { code: serializeSupabaseError(insertError).code },
      );
      return { ok: false, reason: "unknown" };
    }

    return { ok: true, stored: true };
  } catch (error) {
    if (
      handleMissingSupabaseSchema({
        relation: SAVED_SEARCHES_RELATION,
        error,
        warnPrefix: WARN_PREFIX,
        warnKey: "customer_saved_searches:alerts_upsert_crash_missing_schema",
      })
    ) {
      return { ok: false, reason: "unsupported" };
    }
    warnOnce(
      "customer_saved_searches:alerts_upsert_crash",
      `${WARN_PREFIX} alerts upsert crashed`,
      { error: String(error) },
    );
    return { ok: false, reason: "unknown" };
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

async function loadSavedSearchSummaries(
  quoteIds: string[],
): Promise<Map<string, SavedSearchSummary>> {
  const map = new Map<string, SavedSearchSummary>();
  const ids = Array.from(new Set(quoteIds.map((id) => normalizeId(id)).filter(Boolean)));
  if (ids.length === 0) {
    return map;
  }

  const [quoteSummaries, locationSummaries] = await Promise.all([
    loadSavedSearchQuoteSummaries(ids),
    loadSavedSearchLocations(ids),
  ]);

  for (const quoteId of ids) {
    const quoteSummary = quoteSummaries.get(quoteId) ?? null;
    const locations = locationSummaries.get(quoteId) ?? [];
    map.set(quoteId, {
      process: quoteSummary?.process ?? null,
      quantity: quoteSummary?.quantity ?? null,
      needBy: quoteSummary?.needBy ?? null,
      locations,
    });
  }

  return map;
}

async function loadSavedSearchQuoteSummaries(
  quoteIds: string[],
): Promise<Map<string, SavedSearchQuoteSummary>> {
  const map = new Map<string, SavedSearchQuoteSummary>();
  const ids = Array.from(new Set(quoteIds.map((id) => normalizeId(id)).filter(Boolean)));
  if (ids.length === 0) {
    return map;
  }

  const quotesSupported = await schemaGate({
    enabled: true,
    relation: "quotes_with_uploads",
    requiredColumns: ["id", "upload_id", "target_date"],
    warnPrefix: WARN_PREFIX,
    warnKey: "customer_saved_searches:summary_quotes",
  });
  if (!quotesSupported || isSupabaseRelationMarkedMissing("quotes_with_uploads")) {
    return map;
  }

  let rows: QuoteSummaryRow[] = [];
  try {
    const { data, error } = await supabaseServer
      .from("quotes_with_uploads")
      .select("id,upload_id,target_date")
      .in("id", ids)
      .returns<QuoteSummaryRow[]>();

    if (error) {
      if (
        handleMissingSupabaseSchema({
          relation: "quotes_with_uploads",
          error,
          warnPrefix: WARN_PREFIX,
          warnKey: "customer_saved_searches:summary_quotes_missing_schema",
        })
      ) {
        return map;
      }
      warnOnce(
        "customer_saved_searches:summary_quotes_failed",
        `${WARN_PREFIX} quote summary lookup failed`,
        { code: serializeSupabaseError(error).code },
      );
      return map;
    }
    rows = Array.isArray(data) ? data : [];
  } catch (error) {
    if (
      handleMissingSupabaseSchema({
        relation: "quotes_with_uploads",
        error,
        warnPrefix: WARN_PREFIX,
        warnKey: "customer_saved_searches:summary_quotes_crash_missing_schema",
      })
    ) {
      return map;
    }
    warnOnce(
      "customer_saved_searches:summary_quotes_crash",
      `${WARN_PREFIX} quote summary lookup crashed`,
      { error: String(error) },
    );
    return map;
  }

  const uploadIds = rows
    .map((row) => normalizeId(row?.upload_id))
    .filter((id) => id.length > 0);
  const uploadsById = await loadSavedSearchUploadMeta(uploadIds);

  for (const row of rows) {
    const quoteId = normalizeId(row?.id);
    if (!quoteId) continue;
    const uploadId = normalizeId(row?.upload_id);
    const upload = uploadId ? uploadsById.get(uploadId) ?? null : null;
    const process = normalizeOptionalText(upload?.manufacturing_process);
    const quantity = normalizeOptionalText(upload?.quantity);
    const needBy = normalizeOptionalText(row?.target_date);
    map.set(quoteId, { process, quantity, needBy });
  }

  return map;
}

async function loadSavedSearchUploadMeta(
  uploadIds: string[],
): Promise<Map<string, UploadSummaryRow>> {
  const map = new Map<string, UploadSummaryRow>();
  const ids = Array.from(new Set(uploadIds.map((id) => normalizeId(id)).filter(Boolean)));
  if (ids.length === 0) {
    return map;
  }

  const uploadsSupported = await schemaGate({
    enabled: true,
    relation: "uploads",
    requiredColumns: ["id", "manufacturing_process", "quantity"],
    warnPrefix: WARN_PREFIX,
    warnKey: "customer_saved_searches:summary_uploads",
  });
  if (!uploadsSupported || isSupabaseRelationMarkedMissing("uploads")) {
    return map;
  }

  try {
    const { data, error } = await supabaseServer
      .from("uploads")
      .select("id,manufacturing_process,quantity")
      .in("id", ids)
      .returns<UploadSummaryRow[]>();

    if (error) {
      if (
        handleMissingSupabaseSchema({
          relation: "uploads",
          error,
          warnPrefix: WARN_PREFIX,
          warnKey: "customer_saved_searches:summary_uploads_missing_schema",
        })
      ) {
        return map;
      }
      warnOnce(
        "customer_saved_searches:summary_uploads_failed",
        `${WARN_PREFIX} upload summary lookup failed`,
        { code: serializeSupabaseError(error).code },
      );
      return map;
    }

    for (const row of data ?? []) {
      const id = normalizeId(row?.id);
      if (id) {
        map.set(id, row);
      }
    }
  } catch (error) {
    if (
      handleMissingSupabaseSchema({
        relation: "uploads",
        error,
        warnPrefix: WARN_PREFIX,
        warnKey: "customer_saved_searches:summary_uploads_crash_missing_schema",
      })
    ) {
      return map;
    }
    warnOnce(
      "customer_saved_searches:summary_uploads_crash",
      `${WARN_PREFIX} upload summary lookup crashed`,
      { error: String(error) },
    );
  }

  return map;
}

async function loadSavedSearchLocations(
  quoteIds: string[],
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  const ids = Array.from(new Set(quoteIds.map((id) => normalizeId(id)).filter(Boolean)));
  if (ids.length === 0) {
    return map;
  }

  const [destinationsSupported, providersSupported] = await Promise.all([
    schemaGate({
      enabled: true,
      relation: "rfq_destinations",
      requiredColumns: ["rfq_id", "provider_id"],
      warnPrefix: WARN_PREFIX,
      warnKey: "customer_saved_searches:summary_destinations",
    }),
    schemaGate({
      enabled: true,
      relation: "providers",
      requiredColumns: ["id", "country"],
      warnPrefix: WARN_PREFIX,
      warnKey: "customer_saved_searches:summary_providers",
    }),
  ]);
  if (
    !destinationsSupported ||
    !providersSupported ||
    isSupabaseRelationMarkedMissing("rfq_destinations") ||
    isSupabaseRelationMarkedMissing("providers")
  ) {
    return map;
  }

  let destinationRows: DestinationSummaryRow[] = [];
  try {
    const { data, error } = await supabaseServer
      .from("rfq_destinations")
      .select("rfq_id,provider_id")
      .in("rfq_id", ids)
      .returns<DestinationSummaryRow[]>();

    if (error) {
      if (
        handleMissingSupabaseSchema({
          relation: "rfq_destinations",
          error,
          warnPrefix: WARN_PREFIX,
          warnKey: "customer_saved_searches:summary_destinations_missing_schema",
        })
      ) {
        return map;
      }
      warnOnce(
        "customer_saved_searches:summary_destinations_failed",
        `${WARN_PREFIX} destination summary lookup failed`,
        { code: serializeSupabaseError(error).code },
      );
      return map;
    }
    destinationRows = Array.isArray(data) ? data : [];
  } catch (error) {
    if (
      handleMissingSupabaseSchema({
        relation: "rfq_destinations",
        error,
        warnPrefix: WARN_PREFIX,
        warnKey: "customer_saved_searches:summary_destinations_crash_missing_schema",
      })
    ) {
      return map;
    }
    warnOnce(
      "customer_saved_searches:summary_destinations_crash",
      `${WARN_PREFIX} destination summary lookup crashed`,
      { error: String(error) },
    );
    return map;
  }

  const providerIds = Array.from(
    new Set(destinationRows.map((row) => normalizeId(row?.provider_id)).filter(Boolean)),
  );
  if (providerIds.length === 0) {
    return map;
  }

  const providerCountryById = new Map<string, string>();
  try {
    const { data, error } = await supabaseServer
      .from("providers")
      .select("id,country")
      .in("id", providerIds)
      .returns<ProviderLocationRow[]>();

    if (error) {
      if (
        handleMissingSupabaseSchema({
          relation: "providers",
          error,
          warnPrefix: WARN_PREFIX,
          warnKey: "customer_saved_searches:summary_providers_missing_schema",
        })
      ) {
        return map;
      }
      warnOnce(
        "customer_saved_searches:summary_providers_failed",
        `${WARN_PREFIX} provider location lookup failed`,
        { code: serializeSupabaseError(error).code },
      );
      return map;
    }

    for (const row of data ?? []) {
      const id = normalizeId(row?.id);
      const country = normalizeOptionalText(row?.country);
      if (id && country) {
        providerCountryById.set(id, country);
      }
    }
  } catch (error) {
    if (
      handleMissingSupabaseSchema({
        relation: "providers",
        error,
        warnPrefix: WARN_PREFIX,
        warnKey: "customer_saved_searches:summary_providers_crash_missing_schema",
      })
    ) {
      return map;
    }
    warnOnce(
      "customer_saved_searches:summary_providers_crash",
      `${WARN_PREFIX} provider location lookup crashed`,
      { error: String(error) },
    );
    return map;
  }

  const locationSetsByQuoteId = new Map<string, Map<string, string>>();
  for (const row of destinationRows) {
    const quoteId = normalizeId(row?.rfq_id);
    const providerId = normalizeId(row?.provider_id);
    if (!quoteId || !providerId) continue;
    const country = providerCountryById.get(providerId);
    if (!country) continue;
    const key = country.toLowerCase();
    if (!locationSetsByQuoteId.has(quoteId)) {
      locationSetsByQuoteId.set(quoteId, new Map());
    }
    const entry = locationSetsByQuoteId.get(quoteId)!;
    if (!entry.has(key)) {
      entry.set(key, country);
    }
  }

  for (const [quoteId, locationMap] of locationSetsByQuoteId.entries()) {
    const locations = Array.from(locationMap.values()).sort((a, b) => a.localeCompare(b));
    if (locations.length > 0) {
      map.set(quoteId, locations);
    }
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
    summary: {
      process: null,
      quantity: null,
      needBy: null,
      locations: [],
    },
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

async function ensureSavedSearchAlertsSchema(warnKey: string): Promise<boolean> {
  const requiredColumns = [...SAVED_SEARCHES_COLUMNS, SAVED_SEARCHES_ALERT_COLUMN];
  const hasSchema = await schemaGate({
    enabled: true,
    relation: SAVED_SEARCHES_RELATION,
    requiredColumns,
    warnPrefix: WARN_PREFIX,
    warnKey: `customer_saved_searches:${warnKey}`,
  });
  if (!hasSchema) {
    warnOnce(
      `customer_saved_searches:${warnKey}:missing`,
      `${WARN_PREFIX} missing alerts schema; skipping`,
    );
  }
  return hasSchema;
}

function normalizeId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeOptionalText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeLabel(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  return trimmed.length > MAX_LABEL_LENGTH ? trimmed.slice(0, MAX_LABEL_LENGTH) : trimmed;
}

function buildSavedSearchFallbackLabel(quoteId: string): string {
  if (typeof quoteId !== "string" || !quoteId.trim()) {
    return "Search alert";
  }
  return `Search ${quoteId.trim().slice(0, 6).toUpperCase()}`;
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
