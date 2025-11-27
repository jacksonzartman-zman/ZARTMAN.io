import { supabaseServer } from "@/lib/supabaseServer";
import type {
  QuoteFileSource,
  QuoteWithUploadsRow,
} from "@/server/quotes/types";
import {
  SAFE_QUOTE_WITH_UPLOADS_FIELDS,
  type SafeQuoteWithUploadsField,
} from "@/server/suppliers/types";
import {
  isMissingTableOrColumnError,
  logAdminQuotesError,
  logAdminQuotesInfo,
  logAdminQuotesWarn,
  serializeSupabaseError,
} from "./logging";
import type { AdminLoaderResult } from "./types";

type QuoteListField = SafeQuoteWithUploadsField;
type QuoteFileField = keyof QuoteFileSource;

const ADMIN_QUOTE_LIST_FIELDS: QuoteListField[] = [
  ...SAFE_QUOTE_WITH_UPLOADS_FIELDS,
];

const ADMIN_QUOTE_DETAIL_FIELDS = [
  ...ADMIN_QUOTE_LIST_FIELDS,
  "internal_notes",
  "dfm_notes",
  "file_names",
  "upload_file_names",
  "created_at",
  "updated_at",
] satisfies ReadonlyArray<
  | QuoteListField
  | QuoteFileField
  | "internal_notes"
  | "dfm_notes"
  | "created_at"
  | "updated_at"
>;

export type AdminQuoteListRow = Pick<QuoteWithUploadsRow, QuoteListField>;
export type AdminQuoteDetailRow = Pick<
  QuoteWithUploadsRow,
  (typeof ADMIN_QUOTE_DETAIL_FIELDS)[number]
>;

export type AdminQuotesListFilter = {
  status?: string | null;
  search?: string | null;
};

const QUOTE_LIST_LIMIT = 100;
const QUOTE_LIST_ERROR =
  "Unable to load quotes right now. Please refresh to try again.";

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
      .maybeSingle<AdminQuoteDetailRow>();

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
        error: "Unable to load this quote right now.",
      };
    }

    if (!data) {
      logAdminQuotesWarn("detail not found", { quoteId });
      return {
        ok: true,
        data: null,
        error: null,
      };
    }

    logAdminQuotesInfo("detail loaded", { quoteId });
    return {
      ok: true,
      data,
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
      error: "Unable to load this quote right now.",
    };
  }
}
