// src/app/admin/page.tsx
import type { ReadonlyURLSearchParams } from "next/navigation";
import AdminTable, { type InboxRow } from "./AdminTable";
import StatusFilterChips from "./StatusFilterChips";
import AdminSearchInput from "./AdminSearchInput";
import {
  normalizeUploadStatus,
  isUploadStatus,
  type UploadStatus,
} from "./constants";
import { supabaseServer } from "@/lib/supabaseServer";
import AdminDashboardShell from "./AdminDashboardShell";
import AdminFiltersBar from "./AdminFiltersBar";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;
const MAX_FILE_MATCH_IDS = 50;
const SEARCHABLE_UPLOAD_FIELDS = [
  "company",
  "name",
  "first_name",
  "last_name",
  "email",
  "file_name",
] as const satisfies readonly string[];

type AdminPageProps = {
  searchParams?: Promise<ReadonlyURLSearchParams>;
};

type SearchParamRecord = {
  status?: string | string[] | null;
  search?: string | string[] | null;
};

type ResolvedSearchParams = {
  status?: string;
  search?: string;
};

type ResolvableSearchParams =
  | AdminPageProps["searchParams"]
  | URLSearchParams
  | ReadonlyURLSearchParams
  | SearchParamRecord
  | null
  | undefined;

const getFirstParamValue = (
  value?: string | string[] | null,
): string | undefined => {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value ?? undefined;
};

const isSearchParamsLike = (
  value: unknown,
): value is Pick<URLSearchParams, "get"> => {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>).get === "function"
  );
};

const resolveSearchParams = async (
  rawSearchParams?: ResolvableSearchParams,
): Promise<ResolvedSearchParams> => {
  const resolved = await rawSearchParams;

  if (!resolved) {
    return {};
  }

  if (isSearchParamsLike(resolved)) {
    return {
      status: resolved.get("status") ?? undefined,
      search: resolved.get("search") ?? undefined,
    };
  }

  return {
    status: getFirstParamValue(resolved.status),
    search: getFirstParamValue(resolved.search),
  };
};

const escapeForOrFilter = (value: string) =>
  value.replace(/\\/g, "\\\\").replace(/,/g, "\\,").replace(/\*/g, "\\*");

export default async function AdminPage({ searchParams }: AdminPageProps) {
  const supabase = supabaseServer;
  const resolvedSearchParams = await resolveSearchParams(searchParams);

  const rawStatus = resolvedSearchParams.status?.trim().toLowerCase();
  const statusFilter: UploadStatus | undefined = rawStatus
    ? (isUploadStatus(rawStatus) ? rawStatus : undefined)
    : undefined;

  const searchInputValue =
    typeof resolvedSearchParams.search === "string"
      ? resolvedSearchParams.search
      : "";
  const normalizedSearch = searchInputValue.trim().toLowerCase();

  let fileQuoteIds: string[] = [];
  if (normalizedSearch) {
    const { data: fileMatches, error: filesError } = await supabase
      .from("files")
      .select("quote_id")
      .ilike("filename", `%${normalizedSearch}%`)
      .limit(200);

    if (filesError) {
      console.error("Failed to search files for admin inbox", filesError);
    } else {
      fileQuoteIds =
        fileMatches
          ?.map((row) => row.quote_id)
          .filter(
            (id): id is string => typeof id === "string" && id.trim().length > 0,
          ) ?? [];
    }
  }

  let query = supabase
    .from("uploads")
    .select(
      `
      id,
      quote_id,
      name,
      first_name,
      last_name,
      email,
      company,
      file_name,
      status,
      created_at,
      manufacturing_process,
      quantity
    `,
    )
    .order("created_at", { ascending: false })
    .limit(PAGE_SIZE);

  if (statusFilter) {
    query = query.eq("status", statusFilter);
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

  const { data, error } = await query;

  if (error) {
    console.error("Error loading uploads for admin inbox", error);
    return (
      <main className="mx-auto max-w-5xl px-4 py-10">
        <p className="text-sm text-red-400">
          Failed to load RFQ inbox: {error.message}
        </p>
      </main>
    );
  }

  const rows: InboxRow[] =
    data?.map((row) => {
      const contactPieces = [row.first_name, row.last_name]
        .map((value) => (typeof value === "string" ? value.trim() : ""))
        .filter((value) => value.length > 0);
      const fallbackName =
        typeof row.name === "string" && row.name.trim().length > 0
          ? row.name.trim()
          : undefined;
      const fallbackEmail =
        typeof row.email === "string" && row.email.trim().length > 0
          ? row.email.trim()
          : undefined;
      const contactName =
        contactPieces.join(" ").trim() ||
        fallbackName ||
        fallbackEmail ||
        "Unknown contact";

      return {
        id: row.id,
        quoteId: row.quote_id ?? null,
        createdAt: row.created_at ?? null,
        company: row.company ?? null,
        contactName,
        contactEmail: fallbackEmail ?? null,
        manufacturingProcess: row.manufacturing_process ?? null,
        quantity: row.quantity ?? null,
        status: normalizeUploadStatus(row.status),
      };
    }) ?? [];

    const hasActiveFilters = Boolean(statusFilter || normalizedSearch);

    return (
      <AdminDashboardShell
        title="RFQ inbox"
        description="Filter, search, and jump into the latest submissions from customers."
      >
        <AdminFiltersBar
          filters={
            <StatusFilterChips
              currentStatus={statusFilter ?? ""}
              basePath="/admin"
            />
          }
          search={
            <AdminSearchInput
              initialValue={searchInputValue}
              basePath="/admin"
              placeholder="Search company, contact, email, or file name..."
            />
          }
        />
        <AdminTable rows={rows} hasActiveFilters={hasActiveFilters} />
      </AdminDashboardShell>
    );
}
