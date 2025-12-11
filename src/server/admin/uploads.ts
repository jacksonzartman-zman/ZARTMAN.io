import { supabaseServer } from "@/lib/supabaseServer";
import { isWinningBidStatus } from "@/lib/bids/status";
import type { UploadStatus } from "@/app/admin/constants";
import {
  isMissingTableOrColumnError,
  logAdminUploadsError,
  logAdminUploadsInfo,
  logAdminUploadsWarn,
  serializeSupabaseError,
} from "./logging";
import type { AdminLoaderResult } from "./types";

const PAGE_SIZE = 25;
const MAX_FILE_MATCH_IDS = 50;
const SEARCHABLE_UPLOAD_FIELDS = [
  "company",
  "name",
  "first_name",
  "last_name",
  "email",
  "file_name",
] as const;

const ADMIN_UPLOAD_INBOX_FIELDS = [
  "id",
  "quote_id",
  "name",
  "first_name",
  "last_name",
  "email",
  "company",
  "file_name",
  "status",
  "created_at",
  "manufacturing_process",
  "quantity",
] as const;

const ADMIN_UPLOAD_DETAIL_FIELDS = [
  "id",
  "name",
  "first_name",
  "last_name",
  "email",
  "company",
  "phone",
  "manufacturing_process",
  "quantity",
  "shipping_postal_code",
  "export_restriction",
  "rfq_reason",
  "itar_acknowledged",
  "terms_accepted",
  "file_name",
  "file_path",
  "notes",
  "status",
  "admin_notes",
  "created_at",
  "quote_id",
] as const;

export type AdminUploadInboxRow = {
  id: string;
  quote_id: string | null;
  name: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  company: string | null;
  file_name: string | null;
  status: string | null;
  created_at: string | null;
  manufacturing_process: string | null;
  quantity: string | null;
};

export type AdminUploadDetailRow = AdminUploadInboxRow & {
  phone: string | null;
  shipping_postal_code: string | null;
  export_restriction: string | null;
  rfq_reason: string | null;
  itar_acknowledged: boolean | null;
  terms_accepted: boolean | null;
  file_path: string | null;
  notes: string | null;
  admin_notes: string | null;
};

export type AdminInboxBidAggregate = {
  quoteId: string;
  bidCount: number;
  lastBidAt: string | null;
  hasWinningBid: boolean;
};

export type AdminUploadsInboxFilter = {
  status?: UploadStatus | null;
  search?: string | null;
};

const UPLOAD_LIST_ERROR =
  "Unable to load uploads right now. Please refresh to try again.";

export async function loadAdminUploadsInbox(
  filter: AdminUploadsInboxFilter,
): Promise<AdminLoaderResult<AdminUploadInboxRow[]>> {
  const normalizedSearch =
    typeof filter.search === "string"
      ? filter.search.trim().toLowerCase()
      : "";
  let fileQuoteIds: string[] = [];

  if (normalizedSearch) {
    try {
      const { data: fileMatches, error: filesError } = await supabaseServer
        .from("files")
        .select("quote_id")
        .ilike("filename", `%${normalizedSearch}%`)
        .limit(200);

      if (filesError) {
        if (isMissingTableOrColumnError(filesError)) {
          logAdminUploadsWarn("file search skipped due to missing schema", {
            search: normalizedSearch,
            supabaseError: serializeSupabaseError(filesError),
          });
        } else {
          logAdminUploadsWarn("file search failed", {
            search: normalizedSearch,
            supabaseError: serializeSupabaseError(filesError),
          });
        }
      } else {
        fileQuoteIds =
          fileMatches
            ?.map((row) => row.quote_id)
            .filter(
              (id): id is string => typeof id === "string" && id.trim().length > 0,
            ) ?? [];
      }
    } catch (error) {
      logAdminUploadsWarn("file search crashed", {
        search: normalizedSearch,
        supabaseError: serializeSupabaseError(error),
      });
    }
  }

  try {
    let query = supabaseServer
      .from("uploads")
      .select(ADMIN_UPLOAD_INBOX_FIELDS.join(","))
      .order("created_at", { ascending: false })
      .limit(PAGE_SIZE);

    if (filter.status) {
      query = query.eq("status", filter.status);
    }

    if (normalizedSearch) {
      const pattern = `*${escapeForOrFilter(normalizedSearch)}*`;
      const orFilters = SEARCHABLE_UPLOAD_FIELDS.map(
        (column) => `${column}.ilike.${pattern}`,
      );

      const uniqueQuoteIds = Array.from(new Set(fileQuoteIds)).slice(
        0,
        MAX_FILE_MATCH_IDS,
      );
      if (uniqueQuoteIds.length > 0) {
        orFilters.push(`quote_id.in.(${uniqueQuoteIds.join(",")})`);
      }

      query = query.or(orFilters.join(","));
    }

    const { data, error } = await query.returns<AdminUploadInboxRow[]>();

    if (error) {
      if (isMissingTableOrColumnError(error)) {
        logAdminUploadsWarn("inbox missing schema", {
          status: filter.status ?? null,
          search: normalizedSearch || null,
          supabaseError: serializeSupabaseError(error),
        });
      } else {
        logAdminUploadsError("inbox query failed", {
          status: filter.status ?? null,
          search: normalizedSearch || null,
          supabaseError: serializeSupabaseError(error),
        });
      }
      return {
        ok: false,
        data: [],
        error: UPLOAD_LIST_ERROR,
      };
    }

    const rows = data ?? [];
    logAdminUploadsInfo("inbox loaded", {
      count: rows.length,
      status: filter.status ?? null,
      search: normalizedSearch || null,
    });

    return {
      ok: true,
      data: rows,
      error: null,
    };
  } catch (error) {
    logAdminUploadsError("inbox crashed", {
      status: filter.status ?? null,
      search: normalizedSearch || null,
      supabaseError: serializeSupabaseError(error),
    });
    return {
      ok: false,
      data: [],
      error: UPLOAD_LIST_ERROR,
    };
  }
}

export async function loadAdminUploadDetail(
  uploadId: string,
): Promise<AdminLoaderResult<AdminUploadDetailRow | null>> {
  if (typeof uploadId !== "string" || uploadId.trim().length === 0) {
    logAdminUploadsWarn("detail requested without id", { uploadId });
    return {
      ok: true,
      data: null,
      error: null,
    };
  }

  try {
    const { data, error } = await supabaseServer
      .from("uploads")
      .select(ADMIN_UPLOAD_DETAIL_FIELDS.join(","))
      .eq("id", uploadId)
      .maybeSingle<AdminUploadDetailRow>();

    if (error) {
      if (isMissingTableOrColumnError(error)) {
        logAdminUploadsWarn("detail missing schema", {
          uploadId,
          supabaseError: serializeSupabaseError(error),
        });
      } else {
        logAdminUploadsError("detail query failed", {
          uploadId,
          supabaseError: serializeSupabaseError(error),
        });
      }
      return {
        ok: false,
        data: null,
        error: "Unable to load this upload right now.",
      };
    }

    if (!data) {
      logAdminUploadsWarn("detail not found", { uploadId });
      return {
        ok: true,
        data: null,
        error: null,
      };
    }

    logAdminUploadsInfo("detail loaded", { uploadId });
    return {
      ok: true,
      data,
      error: null,
    };
  } catch (error) {
    logAdminUploadsError("detail crashed", {
      uploadId,
      supabaseError: serializeSupabaseError(error),
    });
    return {
      ok: false,
      data: null,
      error: "Unable to load this upload right now.",
    };
  }
}

type SupplierBidAggregateRow = {
  quote_id: string | null;
  status: string | null;
  created_at: string | null;
};

export async function loadAdminInboxBidAggregates(
  quoteIds: readonly (string | null | undefined)[],
): Promise<Record<string, AdminInboxBidAggregate>> {
  const normalizedIds = Array.from(
    new Set(
      (quoteIds ?? [])
        .map((value) => (typeof value === "string" ? value.trim() : ""))
        .filter((value) => value.length > 0),
    ),
  );

  if (normalizedIds.length === 0) {
    return {};
  }

  try {
    const { data, error } = await supabaseServer
      .from("supplier_bids")
      .select("quote_id,status,created_at")
      .in("quote_id", normalizedIds)
      .returns<SupplierBidAggregateRow[]>();

    if (error) {
      logBidAggregateError(error);
      return {};
    }

    const rows = Array.isArray(data) ? data : [];
    return rows.reduce<Record<string, AdminInboxBidAggregate>>((acc, row) => {
      const quoteId =
        typeof row?.quote_id === "string" && row.quote_id.trim().length > 0
          ? row.quote_id
          : null;

      if (!quoteId) {
        return acc;
      }

      if (!acc[quoteId]) {
        acc[quoteId] = {
          quoteId,
          bidCount: 0,
          lastBidAt: null,
          hasWinningBid: false,
        };
      }

      const aggregate = acc[quoteId];
      aggregate.bidCount += 1;

      const createdAt =
        typeof row.created_at === "string" && row.created_at.trim().length > 0
          ? row.created_at
          : null;
      if (createdAt) {
        if (
          !aggregate.lastBidAt ||
          new Date(createdAt).getTime() > new Date(aggregate.lastBidAt).getTime()
        ) {
          aggregate.lastBidAt = createdAt;
        }
      }

      if (isWinningBidStatus(row.status)) {
        aggregate.hasWinningBid = true;
      }

      return acc;
    }, {});
  } catch (error) {
    logBidAggregateError(error);
    return {};
  }
}

function logBidAggregateError(error: unknown) {
  const serialized = serializeSupabaseError(error);
  console.error("[admin inbox] failed to load bid aggregates", {
    error: serialized ?? error ?? null,
  });
}

function escapeForOrFilter(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/,/g, "\\,").replace(/\*/g, "\\*");
}
