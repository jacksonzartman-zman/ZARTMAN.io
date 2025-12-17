import { supabaseServer } from "@/lib/supabaseServer";
import { isWinningBidStatus } from "@/lib/bids/status";
import { loadQuoteNotificationContext } from "@/server/quotes/notificationContext";
import {
  normalizeQuoteStatus,
  type QuoteStatus,
} from "@/server/quotes/status";
import { notifyCustomerOnQuoteStatusChange } from "@/server/quotes/notifications";
import type { QuoteWithUploadsRow } from "@/server/quotes/types";
import {
  SAFE_QUOTE_WITH_UPLOADS_FIELDS,
  type SafeQuoteWithUploadsField,
} from "@/server/suppliers/types";
import {
  isMissingTableOrColumnError,
  logAdminQuotesError,
  logAdminQuotesInfo,
  logAdminQuotesWarn,
  logAdminUploadsError,
  logAdminUploadsInfo,
  logAdminUploadsWarn,
  serializeSupabaseError,
} from "./logging";
import type { AdminLoaderResult } from "./types";

type QuoteListField = SafeQuoteWithUploadsField;

const ADMIN_QUOTE_LIST_FIELDS: QuoteListField[] = [
  ...SAFE_QUOTE_WITH_UPLOADS_FIELDS,
];

const ADMIN_QUOTE_DETAIL_FIELDS: readonly QuoteListField[] = [
  ...ADMIN_QUOTE_LIST_FIELDS,
];

export type AdminQuoteListRow = Pick<QuoteWithUploadsRow, QuoteListField>;
export type QuoteNotesRow = {
  dfm_notes: string | null;
  internal_notes: string | null;
  kickoff_completed_at: string | null;
};
export type AdminQuoteDetailRow = AdminQuoteListRow & QuoteNotesRow;

export type AdminQuoteMetaInput = {
  quoteId: string | null | undefined;
  status?: string | null;
};

export type AdminQuoteMeta = {
  quoteId: string;
  bidCount: number;
  hasWinner: boolean;
  hasProject: boolean;
  needsDecision: boolean;
};

export type AdminQuoteMetaMap = Record<string, AdminQuoteMeta>;

export type AdminQuoteUpdateInput = {
  quoteId: string;
  status?: string | null;
  price?: number | string | null;
  currency?: string | null;
  targetDate?: string | null;
  dfmNotes?: string | null;
  internalNotes?: string | null;
};

export type AdminQuoteUpdateResult =
  | { ok: true }
  | { ok: false; error: string };

export type AdminQuotesListFilter = {
  status?: string | null;
  search?: string | null;
};

const QUOTE_LIST_LIMIT = 100;
const QUOTE_LIST_ERROR =
  "Unable to load quotes right now. Please refresh to try again.";
const QUOTE_DETAIL_ERROR = "Unable to load this quote right now.";
export const QUOTE_UPDATE_ERROR =
  "Unable to update this quote right now. Please try again.";

async function withRetry<T>(fn: () => Promise<T>, attempts = 2): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

export async function loadAdminQuotesList(
  filter: AdminQuotesListFilter,
): Promise<AdminLoaderResult<AdminQuoteListRow[]>> {
  try {
    const { data, error } = await supabaseServer
      .from("quotes_with_uploads")
      .select(ADMIN_QUOTE_LIST_FIELDS.join(","))
      .order("created_at", { ascending: false })
      .limit(QUOTE_LIST_LIMIT)
      .returns<AdminQuoteListRow[]>();

    if (error) {
      if (isMissingTableOrColumnError(error)) {
        logAdminQuotesWarn("list missing schema", {
          status: filter.status ?? null,
          search: filter.search ?? null,
          supabaseError: serializeSupabaseError(error),
        });
      } else {
        logAdminQuotesError("list query failed", {
          status: filter.status ?? null,
          search: filter.search ?? null,
          supabaseError: serializeSupabaseError(error),
        });
      }
      return {
        ok: false,
        data: [],
        error: QUOTE_LIST_ERROR,
      };
    }

    const rows = data ?? [];
    logAdminQuotesInfo("list loaded", {
      count: rows.length,
      status: filter.status ?? null,
      search: filter.search ?? null,
    });

    return {
      ok: true,
      data: rows,
      error: null,
    };
  } catch (error) {
    logAdminQuotesError("list crashed", {
      status: filter.status ?? null,
      search: filter.search ?? null,
      supabaseError: serializeSupabaseError(error),
    });
    return {
      ok: false,
      data: [],
      error: QUOTE_LIST_ERROR,
    };
  }
}

export async function loadAdminQuoteDetail(
  quoteId: string,
): Promise<AdminLoaderResult<AdminQuoteDetailRow | null>> {
  if (typeof quoteId !== "string" || quoteId.trim().length === 0) {
    logAdminQuotesWarn("detail requested without id", { quoteId });
    return {
      ok: true,
      data: null,
      error: null,
    };
  }

  try {
    const { data, error } = await withRetry(() =>
      supabaseServer
        .from("quotes_with_uploads")
        .select(ADMIN_QUOTE_DETAIL_FIELDS.join(","))
        .eq("id", quoteId)
        .maybeSingle<AdminQuoteListRow>(),
    );

    if (error) {
      if (isMissingTableOrColumnError(error)) {
        logAdminQuotesWarn("detail missing schema", {
          quoteId,
          supabaseError: serializeSupabaseError(error),
        });
      } else {
        logAdminQuotesError("detail query failed", {
          quoteId,
          supabaseError: serializeSupabaseError(error),
        });
      }
      return {
        ok: false,
        data: null,
        error: QUOTE_DETAIL_ERROR,
      };
    }

    if (!data) {
      logAdminQuotesInfo("detail not found", { quoteId });
      return {
        ok: true,
        data: null,
        error: null,
      };
    }

    const notes = await loadQuoteNotes(quoteId);
    const merged: AdminQuoteDetailRow = {
      ...data,
      ...notes,
    };

    logAdminQuotesInfo("detail loaded", { quoteId });
    return {
      ok: true,
      data: merged,
      error: null,
    };
  } catch (error) {
    logAdminQuotesError("detail crashed", {
      quoteId,
      supabaseError: serializeSupabaseError(error),
    });
    return {
      ok: false,
      data: null,
      error: QUOTE_DETAIL_ERROR,
    };
  }
}

async function loadQuoteNotes(quoteId: string): Promise<QuoteNotesRow> {
  const fallback: QuoteNotesRow = {
    dfm_notes: null,
    internal_notes: null,
    kickoff_completed_at: null,
  };

  try {
    const { data, error } = await supabaseServer
      .from("quotes")
      .select("dfm_notes,internal_notes,kickoff_completed_at")
      .eq("id", quoteId)
      .maybeSingle<QuoteNotesRow>();

    if (error) {
      if (isMissingTableOrColumnError(error)) {
        console.warn("[admin quotes] notes missing schema", {
          quoteId,
          supabaseError: serializeSupabaseError(error),
        });
      } else {
        console.error("[admin quotes] notes query failed", {
          quoteId,
          supabaseError: serializeSupabaseError(error),
        });
      }
      return fallback;
    }

    return data ?? fallback;
  } catch (error) {
    console.error("[admin quotes] notes crashed", {
      quoteId,
      error: serializeSupabaseError(error),
    });
    return fallback;
  }
}

const DECISION_STATUSES: ReadonlySet<QuoteStatus> = new Set([
  "quoted",
  "approved",
]);

type NormalizedMetaInput = {
  quoteId: string;
  status: QuoteStatus;
};

type QuoteBidMetaRow = {
  quote_id: string | null;
  status: string | null;
};

type QuoteProjectMetaRow = {
  quote_id: string | null;
};

export function deriveAdminQuoteAttentionState({
  quoteId,
  status,
  bidCount,
  hasWinner,
  hasProject,
}: {
  quoteId: string;
  status: QuoteStatus;
  bidCount: number;
  hasWinner: boolean;
  hasProject: boolean;
}): AdminQuoteMeta {
  const normalizedBidCount =
    typeof bidCount === "number" && Number.isFinite(bidCount) ? bidCount : 0;
  const derivedHasWinner = Boolean(hasWinner);
  const derivedHasProject = Boolean(hasProject);
  const needsDecision =
    DECISION_STATUSES.has(status) &&
    normalizedBidCount > 0 &&
    !derivedHasWinner;

  return {
    quoteId,
    bidCount: normalizedBidCount,
    hasWinner: derivedHasWinner,
    hasProject: derivedHasProject,
    needsDecision,
  };
}

export async function loadAdminQuoteMeta(
  quotes: readonly AdminQuoteMetaInput[],
): Promise<AdminQuoteMetaMap> {
  const statusMap = normalizeMetaInputs(quotes);
  const quoteIds = Array.from(statusMap.keys());

  if (quoteIds.length === 0) {
    return {};
  }

  const metaMap: AdminQuoteMetaMap = {};
  for (const [quoteId] of statusMap) {
    metaMap[quoteId] = {
      quoteId,
      bidCount: 0,
      hasWinner: false,
      hasProject: false,
      needsDecision: false,
    };
  }

  let bidRows: QuoteBidMetaRow[] = [];
  let projectRows: QuoteProjectMetaRow[] = [];
  let bidQueryFailed = false;
  let projectQueryFailed = false;

  try {
    const { data, error } = await supabaseServer
      .from("supplier_bids")
      .select("quote_id,status")
      .in("quote_id", quoteIds)
      .returns<QuoteBidMetaRow[]>();

    if (error) {
      bidQueryFailed = true;
      logMetaQueryError("meta bids query failed", error);
    } else if (Array.isArray(data)) {
      bidRows = data;
    }
  } catch (error) {
    bidQueryFailed = true;
    logMetaQueryError("meta bids query crashed", error);
  }

  try {
    const { data, error } = await supabaseServer
      .from("quote_projects")
      .select("quote_id")
      .in("quote_id", quoteIds)
      .returns<QuoteProjectMetaRow[]>();

    if (error) {
      projectQueryFailed = true;
      logMetaQueryError("meta projects query failed", error);
    } else if (Array.isArray(data)) {
      projectRows = data;
    }
  } catch (error) {
    projectQueryFailed = true;
    logMetaQueryError("meta projects query crashed", error);
  }

  for (const row of bidRows) {
    const quoteId = normalizeQuoteId(row?.quote_id);
    if (!quoteId || !metaMap[quoteId]) {
      continue;
    }
    metaMap[quoteId].bidCount += 1;
    if (isWinningBidStatus(row?.status)) {
      metaMap[quoteId].hasWinner = true;
    }
  }

  const projectIds = new Set(
    projectRows.map((row) => normalizeQuoteId(row?.quote_id)).filter(Boolean),
  );
  for (const quoteId of projectIds) {
    if (quoteId && metaMap[quoteId]) {
      metaMap[quoteId].hasProject = true;
    }
  }

  let withBids = 0;
  let withProjects = 0;
  let needsDecisionCount = 0;

  for (const [quoteId, status] of statusMap) {
    const current = metaMap[quoteId];
    if (!current) {
      continue;
    }
    const derived = deriveAdminQuoteAttentionState({
      quoteId,
      status,
      bidCount: current.bidCount,
      hasWinner: current.hasWinner,
      hasProject: current.hasProject,
    });
    metaMap[quoteId] = derived;

    if (derived.bidCount > 0) {
      withBids += 1;
    }
    if (derived.hasProject) {
      withProjects += 1;
    }
    if (derived.needsDecision) {
      needsDecisionCount += 1;
    }
  }

  logAdminQuotesInfo("meta loaded", {
    quoteCount: quoteIds.length,
    withBids,
    withProjects,
    needsDecisionCount,
    bidQueryFailed: bidQueryFailed || undefined,
    projectQueryFailed: projectQueryFailed || undefined,
  });

  return metaMap;
}

function normalizeMetaInputs(
  quotes: readonly AdminQuoteMetaInput[],
): Map<string, QuoteStatus> {
  const statusMap = new Map<string, QuoteStatus>();
  for (const quote of quotes ?? []) {
    const quoteId = normalizeQuoteId(quote?.quoteId);
    if (!quoteId) {
      continue;
    }
    statusMap.set(quoteId, normalizeQuoteStatus(quote?.status));
  }
  return statusMap;
}

function logMetaQueryError(message: string, error: unknown) {
  const serialized = serializeSupabaseError(error);
  if (isMissingTableOrColumnError(error)) {
    logAdminQuotesWarn(message, { supabaseError: serialized });
    return;
  }
  logAdminQuotesError(message, { supabaseError: serialized });
}

function normalizeQuoteId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function updateAdminQuote(
  input: AdminQuoteUpdateInput,
  options?: { skipStatusNotifications?: boolean },
): Promise<AdminQuoteUpdateResult> {
  const normalized = normalizeAdminQuoteUpdateInput(input);
  const hasStatusUpdate = Object.prototype.hasOwnProperty.call(
    normalized?.updates ?? {},
    "status",
  );

  if (!normalized) {
    logAdminQuotesWarn("update invalid input", {
      quoteId: input?.quoteId ?? null,
    });
    return { ok: false, error: QUOTE_UPDATE_ERROR };
  }

  const fields = Object.keys(normalized.updates);
  const updatePayload = {
    ...normalized.updates,
    updated_at: new Date().toISOString(),
  };
  const shouldNotifyStatus =
    hasStatusUpdate && !options?.skipStatusNotifications;
  const notificationContext = shouldNotifyStatus
    ? await loadQuoteNotificationContext(normalized.quoteId)
    : null;

  logAdminQuotesInfo("update start", {
    quoteId: normalized.quoteId,
    fields,
  });

  try {
    // Defense-in-depth: do not allow marking quotes as "won" via generic admin
    // status update. Awarding must populate awarded_* fields.
    if (hasStatusUpdate && normalized.updates.status === "won") {
      const { data: award, error: awardError } = await supabaseServer
        .from("quotes")
        .select("awarded_bid_id,awarded_supplier_id,awarded_at")
        .eq("id", normalized.quoteId)
        .maybeSingle<{
          awarded_bid_id: string | null;
          awarded_supplier_id: string | null;
          awarded_at: string | null;
        }>();

      if (awardError) {
        logAdminQuotesWarn("update blocked; unable to verify award state", {
          quoteId: normalized.quoteId,
          supabaseError: serializeSupabaseError(awardError),
        });
        return { ok: false, error: QUOTE_UPDATE_ERROR };
      }

      const hasAward =
        Boolean(award?.awarded_bid_id?.trim()) &&
        Boolean(award?.awarded_supplier_id?.trim()) &&
        Boolean(award?.awarded_at?.toString().trim());

      if (!hasAward) {
        logAdminQuotesWarn("update blocked; attempted to set won without award", {
          quoteId: normalized.quoteId,
          awardedBidId: award?.awarded_bid_id ?? null,
          awardedSupplierId: award?.awarded_supplier_id ?? null,
          awardedAt: award?.awarded_at ?? null,
        });
        return {
          ok: false,
          error:
            "This RFQ can’t be marked won until a winner is awarded. Use the Award action instead.",
        };
      }
    }

    const { data, error } = await supabaseServer
      .from("quotes")
      .update(updatePayload)
      .eq("id", normalized.quoteId)
      .select("id, upload_id, status")
      .maybeSingle<{
        id: string;
        upload_id: string | null;
        status: string | null;
      }>();

    if (error) {
      if (isMissingTableOrColumnError(error)) {
        logAdminQuotesWarn("update missing schema", {
          quoteId: normalized.quoteId,
          supabaseError: serializeSupabaseError(error),
        });
      } else {
        logAdminQuotesError("update failed", {
          quoteId: normalized.quoteId,
          supabaseError: serializeSupabaseError(error),
        });
      }
      return { ok: false, error: QUOTE_UPDATE_ERROR };
    }

    if (!data) {
      logAdminQuotesWarn("update not found", { quoteId: normalized.quoteId });
      return { ok: false, error: QUOTE_UPDATE_ERROR };
    }

    logAdminQuotesInfo("update success", {
      quoteId: normalized.quoteId,
      fields,
    });

    if (hasStatusUpdate) {
      await syncUploadStatus({
        quoteId: normalized.quoteId,
        uploadId: data.upload_id,
        status: data.status ?? null,
      });
    }

    if (
      shouldNotifyStatus &&
      typeof normalized.updates.status === "string"
    ) {
      const nextStatus = normalizeQuoteStatus(normalized.updates.status);
      void notifyCustomerOnQuoteStatusChange({
        quoteId: normalized.quoteId,
        status: nextStatus,
        context: notificationContext,
      });
    }

    return { ok: true };
  } catch (error) {
    logAdminQuotesError("update crashed", {
      quoteId: normalized.quoteId,
      supabaseError: serializeSupabaseError(error),
    });
    return { ok: false, error: QUOTE_UPDATE_ERROR };
  }
}

async function syncUploadStatus({
  quoteId,
  uploadId,
  status,
}: {
  quoteId: string;
  uploadId: string | null;
  status: string | null;
}) {
  if (!uploadId) {
    logAdminUploadsInfo("status sync skipped", {
      quoteId,
      uploadId: null,
      status,
    });
    return;
  }

  try {
    const { error: uploadError } = await supabaseServer
      .from("uploads")
      .update({ status })
      .eq("id", uploadId);

    if (uploadError) {
      const context = {
        quoteId,
        uploadId,
        status,
        supabaseError: serializeSupabaseError(uploadError),
      };
      if (isMissingTableOrColumnError(uploadError)) {
        logAdminUploadsWarn("status sync missing schema", context);
      } else {
        logAdminUploadsError("status sync failed", context);
      }
      return;
    }

    logAdminUploadsInfo("status sync success", {
      quoteId,
      uploadId,
      status,
    });
  } catch (error) {
    logAdminUploadsError("status sync crashed", {
      quoteId,
      uploadId,
      status,
      supabaseError: serializeSupabaseError(error),
    });
  }
}

type NormalizedAdminQuoteUpdatePayload = {
  quoteId: string;
  updates: Record<string, string | number | null>;
};

function normalizeAdminQuoteUpdateInput(
  input: AdminQuoteUpdateInput,
): NormalizedAdminQuoteUpdatePayload | null {
  const quoteId = typeof input.quoteId === "string" ? input.quoteId.trim() : "";

  if (!quoteId) {
    return null;
  }

  const updates: Record<string, string | number | null> = {};

  if (typeof input.status !== "undefined") {
    updates.status = normalizeQuoteStatus(input.status);
  }

  const price = normalizeOptionalPrice(input.price);
  if (typeof price !== "undefined") {
    updates.price = price;
  }

  const currency = normalizeCurrency(input.currency);
  if (typeof currency !== "undefined") {
    updates.currency = currency;
  }

  const targetDate = normalizeOptionalString(input.targetDate);
  if (typeof targetDate !== "undefined") {
    updates.target_date = targetDate;
  }

  const dfmNotes = normalizeOptionalString(input.dfmNotes, { preserveCase: true });
  if (typeof dfmNotes !== "undefined") {
    updates.dfm_notes = dfmNotes;
  }

  const internalNotes = normalizeOptionalString(input.internalNotes, {
    preserveCase: true,
  });
  if (typeof internalNotes !== "undefined") {
    updates.internal_notes = internalNotes;
  }

  return { quoteId, updates };
}

function normalizeOptionalString(
  value: unknown,
  options?: { preserveCase?: boolean },
): string | null | undefined {
  if (typeof value === "undefined") {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  if (options?.preserveCase) {
    return trimmed;
  }

  return trimmed;
}

function normalizeCurrency(value: unknown): string | null | undefined {
  const normalized = normalizeOptionalString(value);
  if (typeof normalized === "undefined" || normalized === null) {
    return normalized;
  }
  return normalized.toUpperCase();
}

function normalizeOptionalPrice(
  value: unknown,
): number | null | undefined {
  if (typeof value === "undefined") {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return null;
    }

    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}
