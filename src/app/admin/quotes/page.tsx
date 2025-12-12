// src/app/admin/quotes/page.tsx
import { getAdminQuotesInbox } from "@/server/admin/quotesInbox";
import type { ReadonlyURLSearchParams } from "next/navigation";
import { buildQuoteFilesFromRow } from "@/server/quotes/files";
import QuotesTable, { type QuoteRow } from "../QuotesTable";
import AdminDashboardShell from "../AdminDashboardShell";
import AdminFiltersBar from "../AdminFiltersBar";
import AdminSearchInput from "../AdminSearchInput";
import type { QuoteBidAggregate } from "@/server/quotes/bidAggregates";
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
import AdminQuotesInboxControls from "./AdminQuotesInboxControls";
import type { AdminQuotesInboxSort } from "@/server/admin/quotesInbox";

export const dynamic = "force-dynamic";

type QuotesPageSearchParams = {
  sort?: string | string[] | null;
  status?: string | string[] | null;
  hasBids?: string | string[] | null;
  awarded?: string | string[] | null;
  search?: string | string[] | null;
};

type ResolvedSearchParams = {
  sort?: string;
  status?: string;
  hasBids?: string;
  awarded?: string;
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
      sort: resolved.get("sort") ?? undefined,
      status: resolved.get("status") ?? undefined,
      hasBids: resolved.get("hasBids") ?? undefined,
      awarded: resolved.get("awarded") ?? undefined,
      search: resolved.get("search") ?? undefined,
    };
  }

  const maybeObject = resolved as QuotesPageSearchParams;
  return {
    sort: getFirstParamValue(maybeObject.sort),
    status: getFirstParamValue(maybeObject.status),
    hasBids: getFirstParamValue(maybeObject.hasBids),
    awarded: getFirstParamValue(maybeObject.awarded),
    search: getFirstParamValue(maybeObject.search),
  };
};

export default async function QuotesPage({ searchParams }: QuotesPageProps) {
  const resolvedSearchParams = await resolveSearchParams(searchParams);

  const sort = typeof resolvedSearchParams.sort === "string" ? resolvedSearchParams.sort : null;
  const status = typeof resolvedSearchParams.status === "string" ? resolvedSearchParams.status : null;
  const hasBids = (resolvedSearchParams.hasBids ?? "").trim() === "1";
  const awarded = (resolvedSearchParams.awarded ?? "").trim() === "1";

  const searchTerm =
    typeof resolvedSearchParams.search === "string"
      ? resolvedSearchParams.search
      : "";
  const normalizedSearch = searchTerm.trim().toLowerCase().replace(/\s+/g, " ");

  const inboxResult = await getAdminQuotesInbox({
    sort: (typeof sort === "string"
      ? (sort.trim().toLowerCase() as AdminQuotesInboxSort)
      : null),
    page: 1,
    pageSize: 50,
    filter: {
      status: status?.trim() || null,
      search: normalizedSearch || null,
      hasBids: hasBids || null,
      awarded: awarded || null,
    },
  });

  const baseRows = inboxResult.data.rows ?? [];
  const totalCount = inboxResult.data.count ?? baseRows.length;

  const enrichedRows: QuoteRow[] = baseRows.map((row) => {
    const files = buildQuoteFilesFromRow(row);
    const fileCount = resolveQuoteFileCount(row, files.length);
    const fileCountLabel = formatQuoteFileCountLabel(fileCount);
    const rfqLabel = deriveQuotePrimaryLabel(row, { files });
    const aggregate = buildInboxAggregate(row);
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
      bidCount: aggregate?.bidCount ?? 0,
      latestBidAt: aggregate?.lastBidAt ?? null,
      hasAwardedBid: Boolean(row.has_awarded_bid),
      awardedAt: row.awarded_at ?? null,
      awardedSupplierName: row.awarded_supplier_name ?? null,
      ctaHref: `/admin/quotes/${row.id}`,
      bidsHref: `/admin/quotes/${row.id}#bids-panel`,
    };
  });

  const filteredQuotes = enrichedRows;

  return (
    <AdminDashboardShell title="Quotes" description="Recent quotes created from uploads.">
      {!inboxResult.ok ? (
        <div className="mb-4 rounded-2xl border border-red-500/30 bg-red-950/30 px-6 py-4 text-sm text-red-100">
          We had trouble loading quotes. Check logs and try again.
        </div>
      ) : null}
      {inboxResult.data.degraded ? (
        <div className="mb-4 rounded-2xl border border-amber-500/30 bg-amber-950/20 px-6 py-4 text-sm text-amber-100">
          Inbox activity is temporarily unavailable in this environment (schema mismatch). Showing an empty list.
        </div>
      ) : null}
        <AdminFiltersBar
          filters={
            <AdminQuotesInboxControls basePath="/admin/quotes" />
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
              totalCount={totalCount}
              currentView={"all" as AdminQuotesView}
              searchTerm={normalizedSearch}
            />
          </div>
        </div>
    </AdminDashboardShell>
  );
}

function buildInboxAggregate(row: {
  id: string;
  bid_count: number;
  latest_bid_at: string | null;
  has_awarded_bid: boolean;
}): QuoteBidAggregate {
  return {
    quoteId: row.id,
    bidCount: typeof row.bid_count === "number" ? row.bid_count : 0,
    lastBidAt: row.latest_bid_at ?? null,
    latestStatus: null,
    hasWinningBid: Boolean(row.has_awarded_bid),
    bestPriceAmount: null,
    bestPriceCurrency: null,
    fastestLeadTimeDays: null,
    winningBidAmount: null,
    winningBidCurrency: null,
    winningBidLeadTimeDays: null,
  };
}
