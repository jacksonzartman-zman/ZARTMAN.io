// src/app/admin/quotes/page.tsx
import {
  loadAdminQuotesList,
  type AdminQuoteListRow,
} from "@/server/admin/quotes";
import type { ReadonlyURLSearchParams } from "next/navigation";
import { buildQuoteFilesFromRow } from "@/server/quotes/files";
import QuotesTable, { type QuoteRow } from "../QuotesTable";
import AdminDashboardShell from "../AdminDashboardShell";
import AdminFiltersBar from "../AdminFiltersBar";
import AdminSearchInput from "../AdminSearchInput";
import { loadQuoteBidAggregates } from "@/server/quotes/bidAggregates";
import {
  deriveAdminQuoteListStatus,
  formatAdminBestPriceLabel,
  formatAdminBidCountLabel,
  formatAdminBidSummary,
  formatAdminLeadTimeLabel,
  getAdminQuoteStatusMeta,
} from "@/server/quotes/adminSummary";
import {
  deriveQuotePrimaryLabel,
  formatQuoteFileCountLabel,
  resolveQuoteFileCount,
} from "@/server/quotes/fileSummary";
import type { AdminQuotesView } from "@/types/adminQuotes";
import AdminQuotesViewFilter from "./AdminQuotesViewFilter";
import {
  normalizeAdminQuotesView,
  viewIncludesStatus,
} from "./viewFilters";

export const dynamic = "force-dynamic";

type QuotesPageSearchParams = {
  view?: string | string[] | null;
  search?: string | string[] | null;
};

type ResolvedSearchParams = {
  view?: string;
  search?: string;
};

type QuotesPageProps = {
  searchParams?: Promise<ReadonlyURLSearchParams>;
};

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
      view: resolved.get("view") ?? undefined,
      search: resolved.get("search") ?? undefined,
    };
  }

  const maybeObject = resolved as QuotesPageSearchParams;
  return {
    view: getFirstParamValue(maybeObject.view),
    search: getFirstParamValue(maybeObject.search),
  };
};

export default async function QuotesPage({ searchParams }: QuotesPageProps) {
  const resolvedSearchParams = await resolveSearchParams(searchParams);

  const viewFilter = normalizeAdminQuotesView(resolvedSearchParams.view);

  const searchTerm =
    typeof resolvedSearchParams.search === "string"
      ? resolvedSearchParams.search
      : "";
  const normalizedSearch = searchTerm.trim().toLowerCase().replace(/\s+/g, " ");

  const quotesResult = await loadAdminQuotesList({
    status: null,
    search: normalizedSearch || null,
  });

  const baseRows = quotesResult.data ?? [];
  const quoteIds = baseRows.map((row) => row.id);
  const bidAggregates =
    quoteIds.length > 0 ? await loadQuoteBidAggregates(quoteIds) : {};

  const enrichedRows: QuoteRow[] = baseRows.map((row) => {
    const files = buildQuoteFilesFromRow(row);
    const fileCount = resolveQuoteFileCount(row, files.length);
    const fileCountLabel = formatQuoteFileCountLabel(fileCount);
    const rfqLabel = deriveQuotePrimaryLabel(row, { files });
    const aggregate = bidAggregates[row.id];
    const listStatus = deriveAdminQuoteListStatus({
      quoteStatus: row.status,
      aggregate,
    });
    const statusMeta = getAdminQuoteStatusMeta(listStatus);

    const bidCountLabel =
      aggregate && typeof aggregate.bidCount === "number"
        ? formatAdminBidCountLabel(aggregate)
        : "No bids yet";
    const bestPriceLabel =
      formatAdminBestPriceLabel(
        aggregate?.bestPriceAmount ?? null,
        aggregate?.bestPriceCurrency ?? null,
      ) ?? "Pending";
    const leadTimeLabel =
      formatAdminLeadTimeLabel(aggregate?.fastestLeadTimeDays ?? null) ??
      "Pending";

    return {
      id: row.id,
      rfqLabel,
      createdAt: row.created_at,
      customerName: row.customer_name ?? "",
      customerEmail: row.email ?? "",
      company: row.company ?? "",
      fileCountLabel,
      status: listStatus,
      statusLabel: statusMeta.label,
      statusHelper: statusMeta.helper,
      statusClassName: statusMeta.pillClass,
      bidSummary: formatAdminBidSummary(aggregate),
      bidCountLabel,
      bestPriceLabel,
      leadTimeLabel,
      hasWinningBid: Boolean(aggregate?.hasWinningBid),
      ctaHref: `/admin/quotes/${row.id}`,
      bidsHref: `/admin/quotes/${row.id}#bids-panel`,
    };
  });

  const filteredQuotes = enrichedRows.filter((row) => {
    if (!viewIncludesStatus(viewFilter, row.status)) {
      return false;
    }

    if (!normalizedSearch) {
      return true;
    }

    const haystack = `${row.rfqLabel} ${row.customerName ?? ""} ${
      row.customerEmail ?? ""
    } ${row.company ?? ""} ${row.bidSummary ?? ""} ${row.statusLabel ?? ""}`
      .toLowerCase()
      .replace(/\s+/g, " ");

    return haystack.includes(normalizedSearch);
  });

    return (
      <AdminDashboardShell
        title="Quotes"
        description="Recent quotes created from uploads."
      >
      {!quotesResult.ok ? (
        <div className="mb-4 rounded-2xl border border-red-500/30 bg-red-950/30 px-6 py-4 text-sm text-red-100">
          We had trouble loading quotes. Check logs and try again.
        </div>
      ) : null}
        <AdminFiltersBar
          filters={
            <AdminQuotesViewFilter
              currentView={viewFilter}
              basePath="/admin/quotes"
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
        <div className="mt-6 overflow-x-auto">
          <div className="inline-block min-w-full align-middle">
            <QuotesTable
              quotes={filteredQuotes}
              totalCount={baseRows.length}
              currentView={viewFilter}
              searchTerm={normalizedSearch}
            />
          </div>
        </div>
      </AdminDashboardShell>
    );
}
