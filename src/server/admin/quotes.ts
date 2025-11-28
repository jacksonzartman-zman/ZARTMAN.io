import { supabaseServer } from "@/lib/supabaseServer";
import type { QuoteWithUploadsRow } from "@/server/quotes/types";
import { normalizeQuoteStatus } from "@/server/quotes/status";
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
};
export type AdminQuoteDetailRow = AdminQuoteListRow & QuoteNotesRow;

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
    const { data, error } = await supabaseServer
      .from("quotes_with_uploads")
      .select(ADMIN_QUOTE_DETAIL_FIELDS.join(","))
      .eq("id", quoteId)
      .maybeSingle<AdminQuoteListRow>();

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
  };

  try {
    const { data, error } = await supabaseServer
      .from("quotes")
      .select("dfm_notes,internal_notes")
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

export async function updateAdminQuote(
  input: AdminQuoteUpdateInput,
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

  logAdminQuotesInfo("update start", {
    quoteId: normalized.quoteId,
    fields,
  });

  try {
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
