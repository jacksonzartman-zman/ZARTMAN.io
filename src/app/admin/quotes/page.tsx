// src/app/admin/quotes/page.tsx
import {
  getAdminQuotesInbox,
  getOnlyBidderSupplierIdsForQuotes,
} from "@/server/admin/quotesInbox";
import type { ReadonlyURLSearchParams } from "next/navigation";
import { buildQuoteFilesFromRow } from "@/server/quotes/files";
import QuotesTable, {
  type QuoteCapacitySummary,
  type QuoteRow,
} from "../QuotesTable";
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
import {
  CAPACITY_CAPABILITY_UNIVERSE,
  getCapacitySnapshotsForSuppliersWeek,
  type CapacityCapability,
  type CapacityLevel,
} from "@/server/admin/capacity";
import { getNextWeekStartDateIso } from "@/lib/dates/weekStart";

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

  const nextWeekStartDateIso = getNextWeekStartDateIso();

  const awardedSupplierByQuoteId = new Map<string, string>();
  const quoteIdsNeedingOnlyBidderResolution: string[] = [];
  for (const row of baseRows) {
    const quoteId = typeof row.id === "string" ? row.id : "";
    const awardedSupplierId =
      typeof row.awarded_supplier_id === "string" ? row.awarded_supplier_id.trim() : "";
    if (quoteId && awardedSupplierId) {
      awardedSupplierByQuoteId.set(quoteId, awardedSupplierId);
      continue;
    }
    if (quoteId && row.bid_count === 1) {
      quoteIdsNeedingOnlyBidderResolution.push(quoteId);
    }
  }

  const onlyBidderSupplierIdByQuoteId =
    quoteIdsNeedingOnlyBidderResolution.length > 0
      ? await getOnlyBidderSupplierIdsForQuotes(quoteIdsNeedingOnlyBidderResolution)
      : {};

  const deterministicSupplierIdByQuoteId = new Map<string, string | null>();
  for (const row of baseRows) {
    const quoteId = typeof row.id === "string" ? row.id : "";
    if (!quoteId) continue;
    const awarded = awardedSupplierByQuoteId.get(quoteId) ?? null;
    if (awarded) {
      deterministicSupplierIdByQuoteId.set(quoteId, awarded);
      continue;
    }
    if (row.bid_count === 1) {
      const onlyBidder =
        typeof onlyBidderSupplierIdByQuoteId[quoteId] === "string"
          ? onlyBidderSupplierIdByQuoteId[quoteId]!.trim()
          : "";
      deterministicSupplierIdByQuoteId.set(quoteId, onlyBidder || null);
      continue;
    }
    deterministicSupplierIdByQuoteId.set(quoteId, null);
  }

  const supplierIdsToCheck = Array.from(
    new Set(
      Array.from(deterministicSupplierIdByQuoteId.values()).filter(
        (value): value is string => typeof value === "string" && value.trim().length > 0,
      ),
    ),
  );

  const capacityBySupplierId =
    supplierIdsToCheck.length > 0
      ? await getCapacitySnapshotsForSuppliersWeek({
          supplierIds: supplierIdsToCheck,
          weekStartDate: nextWeekStartDateIso,
        })
      : {};

  const capacitySummaryBySupplierId = new Map<string, QuoteCapacitySummary>();
  for (const supplierId of supplierIdsToCheck) {
    capacitySummaryBySupplierId.set(
      supplierId,
      buildCapacitySummary({
        supplierId,
        weekStartDate: nextWeekStartDateIso,
        snapshots: capacityBySupplierId[supplierId] ?? [],
      }),
    );
  }

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

    const supplierId = deterministicSupplierIdByQuoteId.get(row.id) ?? null;
    const capacityNextWeek = supplierId
      ? (capacitySummaryBySupplierId.get(supplierId) ??
        buildEmptyCapacitySummary(supplierId, nextWeekStartDateIso))
      : null;

    return {
      id: row.id,
      rfqLabel,
      createdAt: row.created_at,
      customerName: row.customer_name ?? "",
      customerEmail: row.customer_email ?? "",
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
      capacityNextWeek,
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

function buildEmptyCapacitySummary(
  supplierId: string,
  weekStartDate: string,
): QuoteCapacitySummary {
  const levels = Object.fromEntries(
    CAPACITY_CAPABILITY_UNIVERSE.map((capability) => [capability, null]),
  ) as Record<CapacityCapability, CapacityLevel | null>;
  return {
    supplierId,
    weekStartDate,
    coverageCount: 0,
    totalCount: CAPACITY_CAPABILITY_UNIVERSE.length,
    levels,
    lastUpdatedAt: null,
  };
}

function buildCapacitySummary(args: {
  supplierId: string;
  weekStartDate: string;
  snapshots: Array<{
    capability: string;
    capacity_level: string;
    created_at: string;
  }>;
}): QuoteCapacitySummary {
  const summary = buildEmptyCapacitySummary(args.supplierId, args.weekStartDate);
  let lastUpdatedAt: string | null = null;

  for (const snapshot of args.snapshots) {
    const capability = (snapshot?.capability ?? "").trim().toLowerCase();
    if (!isCapacityCapability(capability)) continue;

    const createdAt = typeof snapshot?.created_at === "string" ? snapshot.created_at : "";
    if (createdAt && (!lastUpdatedAt || createdAt > lastUpdatedAt)) {
      lastUpdatedAt = createdAt;
    }

    if (summary.levels[capability] !== null) {
      continue;
    }
    const level = (snapshot?.capacity_level ?? "").trim().toLowerCase();
    summary.levels[capability] = isCapacityLevel(level) ? level : null;
  }

  summary.lastUpdatedAt = lastUpdatedAt;
  summary.coverageCount = CAPACITY_CAPABILITY_UNIVERSE.reduce(
    (count, capability) => count + (summary.levels[capability] ? 1 : 0),
    0,
  );
  return summary;
}

function isCapacityCapability(value: string): value is CapacityCapability {
  return (CAPACITY_CAPABILITY_UNIVERSE as readonly string[]).includes(value);
}

function isCapacityLevel(value: string): value is CapacityLevel {
  return (
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "unavailable" ||
    value === "overloaded"
  );
}
