// src/app/admin/quotes/page.tsx
import { getAdminQuotesInbox } from "@/server/admin/quotesInbox";
import type { ReadonlyURLSearchParams } from "next/navigation";
import { buildQuoteFilesFromRow } from "@/server/quotes/files";
import QuotesTable, { type QuoteRow } from "../QuotesTable";
import AdminDashboardShell from "../AdminDashboardShell";
import AdminFiltersBar from "../AdminFiltersBar";
import AdminSearchInput from "../AdminSearchInput";
import { parseListState } from "@/app/(portals)/lib/listState";
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
import TablePaginationControls from "../components/TablePaginationControls";
import { ADMIN_QUOTES_LIST_STATE_CONFIG } from "./listState";

export const dynamic = "force-dynamic";

type QuotesPageProps = {
  searchParams?: Promise<ReadonlyURLSearchParams>;
};

export default async function QuotesPage({ searchParams }: QuotesPageProps) {
  const resolvedSearchParams = await searchParams;
  const listState = parseListState(resolvedSearchParams, ADMIN_QUOTES_LIST_STATE_CONFIG);

  const sort = listState.sort ?? null;
  const status = listState.status ?? null;
  const hasBids = Boolean(listState.hasBids);
  const awarded = Boolean(listState.awarded);

  const searchTerm = listState.q;
  const normalizedSearch = searchTerm.trim().toLowerCase().replace(/\s+/g, " ");

  const page = listState.page;
  const pageSize = listState.pageSize;

  const inboxResult = await getAdminQuotesInbox({
    sort,
    page,
    pageSize,
    filter: {
      status: status?.trim() || null,
      search: normalizedSearch || null,
      hasBids: hasBids || null,
      awarded: awarded || null,
    },
  });

  const baseRows = inboxResult.data.rows ?? [];
  const totalCount = inboxResult.data.count ?? baseRows.length;
  const hasMore = Boolean(inboxResult.data.hasMore);

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
              listStateConfig={ADMIN_QUOTES_LIST_STATE_CONFIG}
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
            <TablePaginationControls
              basePath="/admin/quotes"
              page={page}
              pageSize={pageSize}
              hasMore={hasMore}
              totalCount={inboxResult.data.count}
              rowsOnPage={filteredQuotes.length}
              listStateConfig={ADMIN_QUOTES_LIST_STATE_CONFIG}
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
