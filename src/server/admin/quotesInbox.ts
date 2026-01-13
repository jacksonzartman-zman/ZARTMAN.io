import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { requireAdminUser } from "@/server/auth";
import {
  type SafeQuoteWithUploadsField,
} from "@/server/suppliers/types";
import {
  isMissingSchemaError,
  logAdminQuotesError,
  logAdminQuotesWarn,
  serializeSupabaseError,
} from "@/server/admin/logging";
import type { AdminLoaderResult } from "@/server/admin/types";

export type AdminQuotesInboxSort =
  | "inbox"
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
  | "awarded_supplier_name"
  | "awarded_supplier_id"
  | "awarded_bid_id";

const ADMIN_QUOTES_INBOX_TABLE = "admin_quotes_inbox" as const;

// Explicit select list: keep this aligned with what the admin quotes UI reads.
// Note: `admin_quotes_inbox` is service-role only (see sql/019_gap6_admin_inbox_activity.sql).
const ADMIN_QUOTES_INBOX_SELECT = [
  // Base quote fields used by /admin/quotes UI
  "id",
  "upload_id",
  "created_at",
  "status",
  "customer_name",
  "customer_email",
  "company",
  "file_name",
  "file_names",
  "upload_file_names",
  "file_count",
  "upload_file_count",
  "upload_name",
  "awarded_at",
  "awarded_supplier_id",
  "awarded_bid_id",
  // View-projected admin activity fields
  "bid_count",
  "latest_bid_at",
  "has_awarded_bid",
  "awarded_supplier_name",
] as const satisfies readonly (InboxBaseField | InboxExtraField | "upload_name")[];

const ADMIN_QUOTES_INBOX_SELECT_STRING = ADMIN_QUOTES_INBOX_SELECT.join(",");

export type AdminQuotesInboxRow = {
  id: string;
  upload_id: string | null;
  created_at: string | null;
  status: string | null;
  customer_name: string | null;
  customer_email: string | null;
  company: string | null;
  file_name: string | null;
  file_names?: string[] | null;
  upload_file_names?: string[] | null;
  file_count?: number | null;
  upload_file_count?: number | null;
  upload_name?: string | null;
  awarded_at?: string | null;
  awarded_supplier_id?: string | null;
  awarded_bid_id?: string | null;
  bid_count: number;
  latest_bid_at: string | null;
  has_awarded_bid: boolean;
  awarded_supplier_name: string | null;
};

export type AdminQuotesInboxData = {
  rows: AdminQuotesInboxRow[];
  count: number | null;
  page: number;
  pageSize: number;
  hasMore: boolean;
  degraded?: boolean;
  degradedReason?: "schema_mismatch" | "misconfigured_service_role_key";
};

export const ADMIN_QUOTES_INBOX_PAGE_SIZES = [10, 25, 50, 100] as const;
const DEFAULT_PAGE_SIZE: (typeof ADMIN_QUOTES_INBOX_PAGE_SIZES)[number] = 25;
const DEFAULT_SORT: AdminQuotesInboxSort = "inbox";

let warnedMissingAdminInboxSchema = false;
let warnedMissingServiceRoleKey = false;
let cachedServiceRoleClient: SupabaseClient | null | undefined;

function getServiceRoleSupabaseClient(): SupabaseClient | null {
  if (cachedServiceRoleClient !== undefined) {
    return cachedServiceRoleClient;
  }

  const url =
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? null;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? null;

  if (!url || typeof url !== "string" || url.trim().length === 0) {
    cachedServiceRoleClient = null;
    return cachedServiceRoleClient;
  }

  if (!serviceKey || typeof serviceKey !== "string" || serviceKey.trim().length === 0) {
    cachedServiceRoleClient = null;
    return cachedServiceRoleClient;
  }

  cachedServiceRoleClient = createClient(url, serviceKey, {
    auth: { persistSession: false },
    global: { fetch },
  });

  return cachedServiceRoleClient;
}

export async function getAdminQuotesInbox(
  args: AdminQuotesInboxArgs = {},
  ctx?: { authenticatedAdminUserId?: string },
): Promise<AdminLoaderResult<AdminQuotesInboxData>> {
  // Defense-in-depth: admin routes are already gated in `src/app/admin/layout.tsx`,
  // but keep this here so service-role backed data can't be queried accidentally.
  const authenticatedAdminUserId =
    typeof ctx?.authenticatedAdminUserId === "string" ? ctx.authenticatedAdminUserId.trim() : "";
  if (!authenticatedAdminUserId) {
    await requireAdminUser();
  }

  const page = normalizePage(args.page);
  const pageSize = normalizePageSize(args.pageSize);
  const sort = normalizeSort(args.sort);

  const filter = normalizeFilter(args.filter);
  const normalizedSearch = filter.search ?? "";

  const rangeFrom = (page - 1) * pageSize;
  // Fetch one extra row so we can answer "hasMore" without relying on total count.
  const rangeTo = rangeFrom + pageSize;

  function buildQueryLogContext(error: unknown) {
    return {
      table: ADMIN_QUOTES_INBOX_TABLE,
      select: ADMIN_QUOTES_INBOX_SELECT_STRING,
      supabaseError: serializeSupabaseError(error),
    };
  }

  try {
    const supabase = getServiceRoleSupabaseClient();

    if (!supabase) {
      if (!warnedMissingServiceRoleKey) {
        warnedMissingServiceRoleKey = true;
        logAdminQuotesError(
          "SUPABASE_SERVICE_ROLE_KEY missing; cannot query admin inbox view",
          {
            reason: "misconfigured_service_role_key",
          },
        );
      }

      // Match the existing degraded "schema mismatch" behavior: return empty
      // rows with `ok: true` so the UI stays stable, but include a reason for logs.
      return {
        ok: true,
        data: {
          rows: [],
          count: 0,
          page,
          pageSize,
          hasMore: false,
          degraded: true,
          degradedReason: "misconfigured_service_role_key",
        },
        error: null,
      };
    }

    let query = supabase
      .from(ADMIN_QUOTES_INBOX_TABLE)
      .select(ADMIN_QUOTES_INBOX_SELECT_STRING, { count: "exact" })
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
          `customer_email.ilike.${pattern}`,
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
          logAdminQuotesWarn(
            "admin inbox view missing schema; returning empty",
            buildQueryLogContext(error),
          );
        }
        return {
          ok: true,
          data: {
            rows: [],
            count: 0,
            page,
            pageSize,
            hasMore: false,
            degraded: true,
            degradedReason: "schema_mismatch",
          },
          error: null,
        };
      }

      logAdminQuotesError("admin inbox query failed", buildQueryLogContext(error));
      return {
        ok: false,
        data: { rows: [], count: 0, page, pageSize, hasMore: false },
        error: "Unable to load the inbox right now. Please refresh to try again.",
      };
    }

    const fetchedRows = Array.isArray(data) ? data : [];
    const hasMore = fetchedRows.length > pageSize;
    const rows = hasMore ? fetchedRows.slice(0, pageSize) : fetchedRows;

    return {
      ok: true,
      data: {
        rows,
        count: typeof count === "number" ? count : null,
        page,
        pageSize,
        hasMore,
      },
      error: null,
    };
  } catch (error) {
    if (isMissingSchemaError(error)) {
      if (!warnedMissingAdminInboxSchema) {
        warnedMissingAdminInboxSchema = true;
        logAdminQuotesWarn(
          "admin inbox view crashed due to missing schema; returning empty",
          buildQueryLogContext(error),
        );
      }
      return {
        ok: true,
        data: {
          rows: [],
          count: 0,
          page,
          pageSize,
          hasMore: false,
          degraded: true,
          degradedReason: "schema_mismatch",
        },
        error: null,
      };
    }

    logAdminQuotesError("admin inbox crashed", buildQueryLogContext(error));
    return {
      ok: false,
      data: { rows: [], count: 0, page, pageSize, hasMore: false },
      error: "Unable to load the inbox right now. Please refresh to try again.",
    };
  }
}

export async function getOnlyBidderSupplierIdsForQuotes(
  quoteIds: string[],
): Promise<Record<string, string>> {
  // Defense-in-depth: admin routes are already gated in `src/app/admin/layout.tsx`.
  await requireAdminUser();

  const normalized = Array.from(
    new Set(
      quoteIds
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  );

  if (normalized.length === 0) {
    return {};
  }

  const supabase = getServiceRoleSupabaseClient();
  if (!supabase) {
    return {};
  }

  try {
    const { data, error } = await supabase
      .from("supplier_bids")
      .select("quote_id,supplier_id,created_at")
      .in("quote_id", normalized)
      .order("created_at", { ascending: true })
      .limit(5000)
      .returns<Array<{ quote_id: string; supplier_id: string; created_at: string | null }>>();

    if (error) {
      if (isMissingSchemaError(error)) {
        // Failure-only logging; schema mismatch is common in ephemeral envs.
        logAdminQuotesWarn("supplier_bids missing schema; skipping only-bidder resolution", {
          quoteIdsCount: normalized.length,
          supabaseError: serializeSupabaseError(error),
        });
        return {};
      }

      logAdminQuotesError("only-bidder resolution query failed", {
        quoteIdsCount: normalized.length,
        supabaseError: serializeSupabaseError(error),
      });
      return {};
    }

    const rows = Array.isArray(data) ? data : [];
    const supplierIdsByQuote = new Map<string, Set<string>>();
    for (const row of rows) {
      const quoteId = typeof row?.quote_id === "string" ? row.quote_id.trim() : "";
      const supplierId = typeof row?.supplier_id === "string" ? row.supplier_id.trim() : "";
      if (!quoteId || !supplierId) continue;
      const set = supplierIdsByQuote.get(quoteId) ?? new Set<string>();
      set.add(supplierId);
      supplierIdsByQuote.set(quoteId, set);
    }

    const result: Record<string, string> = {};
    for (const [quoteId, supplierSet] of supplierIdsByQuote.entries()) {
      if (supplierSet.size === 1) {
        const [supplierId] = Array.from(supplierSet);
        if (supplierId) result[quoteId] = supplierId;
      }
    }
    return result;
  } catch (error) {
    if (isMissingSchemaError(error)) {
      logAdminQuotesWarn("supplier_bids crashed (missing schema); skipping only-bidder resolution", {
        quoteIdsCount: normalized.length,
        supabaseError: serializeSupabaseError(error),
      });
      return {};
    }

    logAdminQuotesError("only-bidder resolution crashed", {
      quoteIdsCount: normalized.length,
      supabaseError: serializeSupabaseError(error) ?? error,
    });
    return {};
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
  const normalized = Math.floor(value);
  return ADMIN_QUOTES_INBOX_PAGE_SIZES.includes(
    normalized as (typeof ADMIN_QUOTES_INBOX_PAGE_SIZES)[number],
  )
    ? normalized
    : DEFAULT_PAGE_SIZE;
}

function normalizeSort(value: unknown): AdminQuotesInboxSort {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  switch (normalized) {
    case "inbox":
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
    case "inbox":
      // Phase 18.3.3: "inbox" ordering (overdue/needs-reply + last message) is applied
      // in the page layer after message rollups are loaded (fail-soft when rollup missing).
      q.order("created_at", { ascending: false });
      return query;
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

