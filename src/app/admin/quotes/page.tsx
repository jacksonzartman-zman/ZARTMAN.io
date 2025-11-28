// src/app/admin/quotes/page.tsx
import { loadAdminQuotesList } from "@/server/admin/quotes";
import { normalizePriceValue } from "@/server/admin/price";
import type { ReadonlyURLSearchParams } from "next/navigation";
import {
  QUOTE_STATUS_LABELS,
  QUOTE_STATUS_OPTIONS,
  normalizeQuoteStatus,
  type QuoteStatus,
} from "@/server/quotes/status";
import QuotesTable, { type QuoteRow } from "../QuotesTable";
import StatusFilterChips from "../StatusFilterChips";
import AdminDashboardShell from "../AdminDashboardShell";
import AdminFiltersBar from "../AdminFiltersBar";
import AdminSearchInput from "../AdminSearchInput";

export const dynamic = "force-dynamic";

type QuotesPageSearchParams = {
  status?: string | string[] | null;
  search?: string | string[] | null;
};

type ResolvedSearchParams = {
  status?: string;
  search?: string;
};

type QuotesPageProps = {
  searchParams?: Promise<ReadonlyURLSearchParams>;
};

const VALID_STATUS_VALUES: QuoteStatus[] = [...QUOTE_STATUS_OPTIONS];
const QUOTE_STATUS_FILTER_OPTIONS = QUOTE_STATUS_OPTIONS.map((status) => ({
  value: status,
  label: QUOTE_STATUS_LABELS[status],
}));

const getFirstParamValue = (
  value?: string | string[] | null,
): string | undefined => {
  if (Array.isArray(value)) {
    return value[0];
  }

  return value ?? undefined;
};

type ResolvableSearchParams =
  | QuotesPageProps["searchParams"]
  | URLSearchParams
  | ReadonlyURLSearchParams
  | QuotesPageSearchParams
  | null
  | undefined;

const isURLSearchParamsLike = (
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

  if (isURLSearchParamsLike(resolved)) {
    return {
      status: resolved.get("status") ?? undefined,
      search: resolved.get("search") ?? undefined,
    };
  }

  const maybeObject = resolved as QuotesPageSearchParams;
  return {
    status: getFirstParamValue(maybeObject.status),
    search: getFirstParamValue(maybeObject.search),
  };
};

export default async function QuotesPage({ searchParams }: QuotesPageProps) {
  const resolvedSearchParams = await resolveSearchParams(searchParams);

  const normalizedStatus =
    typeof resolvedSearchParams.status === "string"
      ? resolvedSearchParams.status.trim().toLowerCase()
      : "";
  const statusFilter: QuoteStatus | "all" = VALID_STATUS_VALUES.includes(
    normalizedStatus as QuoteStatus,
  )
    ? (normalizedStatus as QuoteStatus)
    : "all";

  const searchTerm =
    typeof resolvedSearchParams.search === "string"
      ? resolvedSearchParams.search
      : "";
  const normalizedSearch = searchTerm.trim().toLowerCase().replace(/\s+/g, " ");

  const quotesResult = await loadAdminQuotesList({
    status: statusFilter === "all" ? null : statusFilter,
    search: normalizedSearch || null,
  });

  const rows: QuoteRow[] =
    quotesResult.data?.map((row) => ({
        id: row.id,
        customerName: row.customer_name ?? "Unknown",
        customerEmail: row.email ?? "",
        company: row.company ?? "",
        fileName: row.file_name ?? "",
        status: normalizeQuoteStatus(row.status),
        price: normalizePriceValue(row.price),
        currency: row.currency,
        targetDate: row.target_date,
        createdAt: row.created_at,
      })) ?? [];

  const filteredQuotes = rows.filter((row) => {
    const matchesStatus =
      statusFilter === "all" ? true : row.status === statusFilter;

    if (!normalizedSearch) {
      return matchesStatus;
    }

    const haystack = `${row.customerName ?? ""} ${row.customerEmail ?? ""} ${
      row.company ?? ""
    } ${row.fileName ?? ""} ${row.status ?? ""}`
      .toLowerCase()
      .replace(/\s+/g, " ");

    return matchesStatus && haystack.includes(normalizedSearch);
  });

    return (
      <AdminDashboardShell
        title="Quotes"
        description="Recent quotes created from uploads."
      >
      {!quotesResult.ok ? (
        <div className="mb-4 rounded-2xl border border-red-500/30 bg-red-950/30 px-4 py-3 text-sm text-red-100">
          We had trouble loading quotes. Check logs and try again.
        </div>
      ) : null}
        <AdminFiltersBar
          filters={
            <StatusFilterChips
              currentStatus={statusFilter === "all" ? "" : statusFilter}
              basePath="/admin/quotes"
              options={QUOTE_STATUS_FILTER_OPTIONS}
            />
          }
          search={
            <AdminSearchInput
              initialValue={searchTerm}
              basePath="/admin/quotes"
              placeholder="Search by customer, email, company, file, or status..."
            />
          }
        />
        <QuotesTable quotes={filteredQuotes} totalCount={rows.length} />
      </AdminDashboardShell>
    );
}
