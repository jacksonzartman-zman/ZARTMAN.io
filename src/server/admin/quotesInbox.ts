import { supabaseServer } from "@/lib/supabaseServer";
import type { QuoteWithUploadsRow } from "@/server/quotes/types";
import {
  SAFE_QUOTE_WITH_UPLOADS_FIELDS,
  type SafeQuoteWithUploadsField,
} from "@/server/suppliers/types";
import {
  isMissingSchemaError,
  logAdminQuotesError,
  logAdminQuotesInfo,
  logAdminQuotesWarn,
  serializeSupabaseError,
} from "@/server/admin/logging";
import type { AdminLoaderResult } from "@/server/admin/types";

export type AdminQuotesInboxSort =
  | "newest_rfq"
  | "latest_bid_activity"
  | "awarded_recently"
  | "most_bids";

export type AdminQuotesInboxFilter = {
  status?: string | null;
  hasBids?: boolean | null;
  awarded?: boolean | null;
  search?: string | null;
};

export type AdminQuotesInboxArgs = {
  page?: number;
  pageSize?: number;
  sort?: AdminQuotesInboxSort | null;
  filter?: AdminQuotesInboxFilter;
};

type InboxBaseField = SafeQuoteWithUploadsField;
type InboxExtraField =
  | "bid_count"
  | "latest_bid_at"
  | "has_awarded_bid"
  | "awarded_supplier_name";

const ADMIN_QUOTES_INBOX_FIELDS: readonly (InboxBaseField | InboxExtraField)[] = [
  ...SAFE_QUOTE_WITH_UPLOADS_FIELDS,
  "bid_count",
  "latest_bid_at",
  "has_awarded_bid",
  "awarded_supplier_name",
];

export type AdminQuotesInboxRow = Pick<QuoteWithUploadsRow, InboxBaseField> & {
  bid_count: number;
  latest_bid_at: string | null;
  has_awarded_bid: boolean;
  awarded_supplier_name: string | null;
};

export type AdminQuotesInboxData = {
  rows: AdminQuotesInboxRow[];
  count: number | null;
  degraded?: boolean;
};

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;
const DEFAULT_SORT: AdminQuotesInboxSort = "newest_rfq";

let warnedMissingAdminInboxSchema = false;

export async function getAdminQuotesInbox(
  args: AdminQuotesInboxArgs = {},
): Promise<AdminLoaderResult<AdminQuotesInboxData>> {
  const page = normalizePage(args.page);
  const pageSize = normalizePageSize(args.pageSize);
  const sort = normalizeSort(args.sort);

  const filter = normalizeFilter(args.filter);
  const normalizedSearch = filter.search ?? "";

  const rangeFrom = (page - 1) * pageSize;
  const rangeTo = rangeFrom + pageSize - 1;

  try {
    let query = supabaseServer
      .from("admin_quotes_inbox")
      .select(ADMIN_QUOTES_INBOX_FIELDS.join(","), { count: "exact" })
      .range(rangeFrom, rangeTo);

    if (filter.status) {
      query = query.eq("status", filter.status);
    }

    if (filter.hasBids) {
      query = query.gt("bid_count", 0);
    }

    if (filter.awarded) {
      query = query.eq("has_awarded_bid", true);
    }

    if (normalizedSearch) {
      const pattern = `*${escapeForOrFilter(normalizedSearch)}*`;
      query = query.or(
        [
          `customer_name.ilike.${pattern}`,
          `email.ilike.${pattern}`,
          `company.ilike.${pattern}`,
          `file_name.ilike.${pattern}`,
        ].join(","),
      );
    }

    query = applySort(query, sort);

    const { data, error, count } = await query.returns<AdminQuotesInboxRow[]>();

    if (error) {
      if (isMissingSchemaError(error)) {
        if (!warnedMissingAdminInboxSchema) {
          warnedMissingAdminInboxSchema = true;
          logAdminQuotesWarn("admin inbox view missing schema; returning empty", {
            supabaseError: serializeSupabaseError(error),
          });
        }
        return {
          ok: true,
          data: { rows: [], count: 0, degraded: true },
          error: null,
        };
      }

      logAdminQuotesError("admin inbox query failed", {
        supabaseError: serializeSupabaseError(error),
      });
      return {
        ok: false,
        data: { rows: [], count: 0 },
        error: "Unable to load the inbox right now. Please refresh to try again.",
      };
    }

    const rows = Array.isArray(data) ? data : [];
    logAdminQuotesInfo("admin inbox loaded", {
      count: rows.length,
      page,
      pageSize,
      sort,
      hasSearch: Boolean(normalizedSearch),
      status: filter.status ?? null,
      hasBids: filter.hasBids ?? null,
      awarded: filter.awarded ?? null,
    });

    return {
      ok: true,
      data: { rows, count: typeof count === "number" ? count : null },
      error: null,
    };
  } catch (error) {
    if (isMissingSchemaError(error)) {
      if (!warnedMissingAdminInboxSchema) {
        warnedMissingAdminInboxSchema = true;
        logAdminQuotesWarn("admin inbox view crashed due to missing schema; returning empty", {
          supabaseError: serializeSupabaseError(error),
        });
      }
      return {
        ok: true,
        data: { rows: [], count: 0, degraded: true },
        error: null,
      };
    }

    logAdminQuotesError("admin inbox crashed", {
      supabaseError: serializeSupabaseError(error),
    });
    return {
      ok: false,
      data: { rows: [], count: 0 },
      error: "Unable to load the inbox right now. Please refresh to try again.",
    };
  }
}

function normalizePage(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 1;
  }
  return Math.max(1, Math.floor(value));
}

function normalizePageSize(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_PAGE_SIZE;
  }
  const clamped = Math.max(1, Math.floor(value));
  return Math.min(clamped, MAX_PAGE_SIZE);
}

function normalizeSort(value: unknown): AdminQuotesInboxSort {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  switch (normalized) {
    case "latest_bid_activity":
    case "awarded_recently":
    case "most_bids":
    case "newest_rfq":
      return normalized;
    default:
      return DEFAULT_SORT;
  }
}

function normalizeFilter(raw?: AdminQuotesInboxFilter): Required<AdminQuotesInboxFilter> {
  const status =
    typeof raw?.status === "string" && raw.status.trim().length > 0
      ? raw.status.trim()
      : null;
  const hasBids = Boolean(raw?.hasBids);
  const awarded = Boolean(raw?.awarded);
  const search =
    typeof raw?.search === "string"
      ? raw.search.trim().toLowerCase().replace(/\s+/g, " ")
      : null;

  return {
    status,
    hasBids,
    awarded,
    search: search && search.length > 0 ? search : null,
  };
}

function applySort<T>(query: T, sort: AdminQuotesInboxSort): T {
  // supabase-js query builder is structurally typed; keep this helper untyped.
  const q = query as unknown as {
    order: (
      column: string,
      opts?: { ascending?: boolean; nullsFirst?: boolean },
    ) => unknown;
  };

  switch (sort) {
    case "latest_bid_activity":
      q.order("latest_bid_at", { ascending: false, nullsFirst: false });
      q.order("created_at", { ascending: false });
      return query;
    case "awarded_recently":
      q.order("awarded_at", { ascending: false, nullsFirst: false });
      q.order("created_at", { ascending: false });
      return query;
    case "most_bids":
      q.order("bid_count", { ascending: false });
      q.order("created_at", { ascending: false });
      return query;
    case "newest_rfq":
    default:
      q.order("created_at", { ascending: false });
      return query;
  }
}

function escapeForOrFilter(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/,/g, "\\,").replace(/\*/g, "\\*");
}

