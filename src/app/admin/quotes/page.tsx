// src/app/admin/quotes/page.tsx
/**
 * Phase 1 Polish checklist
 * - Done: Admin inbox view filter is wired (needs attention / awarded / all)
 * - Done: Empty state is positive when inbox is clear
 * - Done: Perceived speed: view switches keep scroll stable (scroll:false already in client controls)
 */
import {
  getAdminQuotesInbox,
  getOnlyBidderSupplierIdsForQuotes,
} from "@/server/admin/quotesInbox";
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
import AdminQuotesViewFilter from "./AdminQuotesViewFilter";
import { normalizeAdminQuotesView, viewIncludesStatus } from "./viewFilters";
import TablePaginationControls from "../components/TablePaginationControls";
import { ADMIN_QUOTES_LIST_STATE_CONFIG } from "./listState";
import { normalizeSearchParams } from "@/lib/route/normalizeSearchParams";
import { supabaseServer } from "@/lib/supabaseServer";
import { isMissingTableOrColumnError, serializeSupabaseError } from "@/server/admin/logging";
import {
  CAPACITY_CAPABILITY_UNIVERSE,
  getCapacitySnapshotsForSuppliersWeek,
  type CapacityCapability,
  type CapacityLevel,
} from "@/server/admin/capacity";
import { getNextWeekStartDateIso } from "@/lib/dates/weekStart";
import { loadAdminThreadSlaForQuotes, type AdminThreadSla } from "@/server/admin/messageSla";
import {
  loadPartsCoverageSignalsForQuotes,
  type QuotePartsCoverageSignal,
} from "@/server/quotes/partsCoverageHealth";
import {
  inferLastMessageAuthorRole,
  loadQuoteMessageRollups,
  type QuoteMessageRollup,
} from "@/server/quotes/messageState";
import { isDemoModeEnabled } from "@/server/demo/demoMode";
import { createDemoSearchRequestAction } from "./demoActions";
import { schemaGate } from "@/server/db/schemaContract";
import { loadRfqOffersForQuoteIds, summarizeRfqOffers } from "@/server/rfqs/offers";
import { computeThreadNeedsReplyFromLastMessage } from "@/server/messages/threadNeedsReply";

export const dynamic = "force-dynamic";

export default async function AdminQuotesPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const usp = normalizeSearchParams(searchParams ? await searchParams : undefined);
  const demoSeedStatus = (usp.get("demoSeed") ?? "").trim().toLowerCase();
  const demoEnabled = isDemoModeEnabled();
  const returnToBase = (() => {
    const qs = usp.toString();
    return qs ? `/admin/quotes?${qs}` : "/admin/quotes";
  })();
  const listState = parseListState(usp, ADMIN_QUOTES_LIST_STATE_CONFIG);
  const currentView = normalizeAdminQuotesView(usp.get("view") ?? null);
  const partsCoverageFilter = normalizePartsCoverageFilter(usp.get("partsCoverage"));
  const messageFilter = normalizeAdminMessageFilter(usp.get("msg"));
  const needsOrderDetails = (usp.get("needsOrderDetails") ?? "").trim() === "1";
  const supplierId = typeof listState.supplierId === "string" ? listState.supplierId.trim() : "";

  const sort = listState.sort ?? ADMIN_QUOTES_LIST_STATE_CONFIG.defaultSort ?? null;
  const status = listState.status ?? null;
  const hasBids = Boolean(listState.hasBids);
  const awarded = Boolean(listState.awarded);

  const searchTerm = listState.q;
  const normalizedSearch = searchTerm.trim().toLowerCase().replace(/\s+/g, " ");

  const page = listState.page;
  const pageSize = listState.pageSize;

  const wantsInboxOrdering =
    sort === "inbox" || messageFilter !== "all" || needsOrderDetails;
  const candidatePageSize = wantsInboxOrdering
    ? Math.min(1000, page * pageSize + 200)
    : pageSize;
  const candidatePage = wantsInboxOrdering ? 1 : page;

  const inboxResult = await getAdminQuotesInbox({
    sort,
    page: candidatePage,
    pageSize: candidatePageSize,
    filter: {
      status: status?.trim() || null,
      search: normalizedSearch || null,
      hasBids: hasBids || null,
      awarded: awarded || null,
      supplierId: supplierId || null,
    },
  });

  const baseRows = inboxResult.data.rows ?? [];
  const baseTotalCount = inboxResult.data.count ?? baseRows.length;
  const baseHasMore = Boolean(inboxResult.data.hasMore);

  const quoteIdsOnPage = baseRows
    .map((row) => (typeof row?.id === "string" ? row.id.trim() : ""))
    .filter(Boolean);

  const rfqAwardsByQuoteId =
    quoteIdsOnPage.length > 0 ? await loadRfqAwardsByQuoteId(quoteIdsOnPage) : new Map();
  const demoOfferProviderIdsByQuoteId =
    demoEnabled && quoteIdsOnPage.length > 0
      ? await loadOfferProviderIdsByQuoteId(quoteIdsOnPage)
      : new Map<string, string[]>();
  const kickoffProgressResult =
    demoEnabled && quoteIdsOnPage.length > 0
      ? await loadKickoffProgressByQuoteId(quoteIdsOnPage)
      : {
          schemaReady: false,
          progressByQuoteId: new Map<string, { completed: number; total: number | null }>(),
        };
  const providerIdsToName = new Set<string>();
  for (const award of rfqAwardsByQuoteId.values()) {
    if (award?.provider_id) providerIdsToName.add(award.provider_id);
  }
  for (const providerIds of demoOfferProviderIdsByQuoteId.values()) {
    for (const providerId of providerIds) {
      if (providerId) providerIdsToName.add(providerId);
    }
  }
  const providerNameById =
    providerIdsToName.size > 0
      ? await loadProviderNameMapByIds(Array.from(providerIdsToName))
      : new Map<string, string>();
  const demoSupplierProvidersByQuoteId: Record<string, Array<{ providerId: string; label: string }>> =
    {};
  if (demoEnabled && demoOfferProviderIdsByQuoteId.size > 0) {
    for (const [quoteId, providerIds] of demoOfferProviderIdsByQuoteId.entries()) {
      demoSupplierProvidersByQuoteId[quoteId] = providerIds.map((providerId) => ({
        providerId,
        label: providerNameById.get(providerId) ?? `Provider ${providerId.slice(0, 6)}`,
      }));
    }
  }
  const emptyThreadSlaByQuoteId: Record<string, AdminThreadSla> = {};
  const emptyPartsCoverageByQuoteId = new Map<string, QuotePartsCoverageSignal>();
  const emptyMessageRollupsByQuoteId: Record<string, QuoteMessageRollup> = {};

  const enrichmentPromises = [
    loadAdminThreadSlaForQuotes({ quoteIds: quoteIdsOnPage }),
    loadPartsCoverageSignalsForQuotes(quoteIdsOnPage),
    loadQuoteMessageRollups(quoteIdsOnPage),
  ] as const;

  const [threadSlaByQuoteId, partsCoverageByQuoteId, messageRollupsByQuoteId] =
    quoteIdsOnPage.length > 0
      ? await Promise.all(enrichmentPromises)
      : [emptyThreadSlaByQuoteId, emptyPartsCoverageByQuoteId, emptyMessageRollupsByQuoteId];

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
    const rfqAward = rfqAwardsByQuoteId.get(row.id) ?? null;
    const hasRfqAward = Boolean(rfqAward);
    const rfqAwardWinnerName = rfqAward
      ? providerNameById.get(rfqAward.provider_id) ?? null
      : null;
    const threadSla = threadSlaByQuoteId[row.id] ?? null;
    const messageRollup = messageRollupsByQuoteId[row.id] ?? null;
    const lastMessageAt = messageRollup?.lastMessageAt ?? threadSla?.lastMessageAt ?? null;
    const lastMessageAuthorRole =
      messageRollup ? inferLastMessageAuthorRole(messageRollup) : threadSla?.lastMessageAuthorRole ?? null;
    const needsReply = computeThreadNeedsReplyFromLastMessage({
      lastMessageAt,
      lastMessageAuthorRole,
    });
    const adminNeedsReply = needsReply.needs_reply_role === "admin";
    const adminOverdue = adminNeedsReply && needsReply.sla_bucket === ">24h";
    const adminReplySlaBucket =
      adminNeedsReply && needsReply.sla_bucket !== "none" ? needsReply.sla_bucket : null;
    const partsSignal = partsCoverageByQuoteId.get(row.id) ?? {
      partsCoverageHealth: "none" as const,
      partsCount: 0,
    };
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
    const kickoffProgress = demoEnabled
      ? kickoffProgressResult.schemaReady
        ? (kickoffProgressResult.progressByQuoteId.get(row.id) ?? {
            completed: 0,
            total: null,
          })
        : null
      : undefined;

    const hasAward = Boolean(row.has_awarded_bid) || hasRfqAward;
    const poNumber =
      typeof row.po_number === "string" && row.po_number.trim().length > 0
        ? row.po_number.trim()
        : null;
    const shipTo =
      typeof row.ship_to === "string" && row.ship_to.trim().length > 0
        ? row.ship_to.trim()
        : null;
    const needsOrderDetailsForRow = hasAward && (!poNumber || !shipTo);

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
      needsOrderDetails: needsOrderDetailsForRow,
      threadLastMessageAt: messageRollup?.lastMessageAt ?? threadSla?.lastMessageAt ?? null,
      threadNeedsReplyFrom: threadSla?.needsReplyFrom ?? null,
      threadStalenessBucket: threadSla?.stalenessBucket ?? "none",
      threadUnreadForAdmin: Boolean(threadSla?.unreadForAdmin),
      adminNeedsReply,
      adminReplySlaBucket,
      adminOverdue,
      bidSummary: formatAdminBidSummary(aggregate),
      bidCountLabel,
      bestPriceLabel,
      leadTimeLabel,
      hasWinningBid: Boolean(aggregate?.hasWinningBid),
      bidCount: aggregate?.bidCount ?? 0,
      latestBidAt: aggregate?.lastBidAt ?? null,
      hasAwardedBid: Boolean(row.has_awarded_bid),
      hasAward,
      awardedAt: row.awarded_at ?? rfqAward?.awarded_at ?? null,
      awardedSupplierName: row.awarded_supplier_name ?? null,
      awardWinnerName: rfqAwardWinnerName,
      kickoffProgress: demoEnabled ? kickoffProgress : undefined,
      capacityNextWeek,
      partsCoverageHealth: partsSignal.partsCoverageHealth,
      partsCount: partsSignal.partsCount,
      ctaHref: `/admin/quotes/${row.id}`,
      bidsHref: `/admin/quotes/${row.id}#bids-panel`,
    };
  });

  const filteredQuotes = enrichedRows
    .filter((row) => viewIncludesStatus(currentView, row.status))
    .filter((row) => (needsOrderDetails ? Boolean(row.needsOrderDetails) : true))
    .filter((row) => {
      if (partsCoverageFilter === "all") return true;
      return row.partsCoverageHealth === partsCoverageFilter;
    })
    .filter((row) => {
      if (messageFilter === "all") return true;
      if (messageFilter === "overdue") return Boolean(row.adminOverdue);
      return Boolean(row.adminNeedsReply);
    });

  const sortedQuotes = wantsInboxOrdering
    ? [...filteredQuotes].sort(compareInboxPriority)
    : filteredQuotes;

  const pagedQuotes = wantsInboxOrdering
    ? (() => {
        const start = (page - 1) * pageSize;
        const end = start + pageSize;
        return sortedQuotes.slice(start, end);
      })()
    : sortedQuotes;

  const pagedQuotesWithOfferCounts = await attachOfferCounts(pagedQuotes);

  const effectiveTotalCount = wantsInboxOrdering ? sortedQuotes.length : baseTotalCount;
  const effectiveHasMore = wantsInboxOrdering
    ? sortedQuotes.length > page * pageSize
    : baseHasMore;

  return (
    <AdminDashboardShell
      title="Quotes"
      description="Recent quotes created from uploads."
      actions={
        demoEnabled ? (
          <form action={createDemoSearchRequestAction}>
            <button
              type="submit"
              className="inline-flex items-center justify-center rounded-full border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-amber-100 transition hover:border-amber-400 hover:bg-amber-500/15"
              title="Create a deterministic demo customer quote + 2-3 offers."
            >
              Create demo search request
            </button>
          </form>
        ) : null
      }
    >
      {!inboxResult.ok ? (
        <div className="mb-4 rounded-2xl border border-red-500/30 bg-red-950/30 px-6 py-4 text-sm text-red-100">
          <p>We couldn’t load quotes. Try refreshing the page.</p>
          <details className="mt-3 rounded-xl border border-red-500/20 bg-red-950/20 px-4 py-3 text-xs text-red-100">
            <summary className="cursor-pointer select-none font-semibold text-red-50">
              Technical details
            </summary>
            <div className="mt-2 font-mono">error: {inboxResult.error ?? "unknown"}</div>
          </details>
        </div>
      ) : null}
      {inboxResult.data.degraded ? (
        <div className="mb-4 rounded-2xl border border-amber-500/30 bg-amber-950/20 px-6 py-4 text-sm text-amber-100">
          Inbox activity is temporarily unavailable in this environment (schema mismatch). Showing an empty list.
        </div>
      ) : null}
      {demoSeedStatus === "error" ? (
        <div className="mb-4 rounded-2xl border border-rose-500/30 bg-rose-950/20 px-6 py-4 text-sm text-rose-100">
          We couldn’t create demo data in this environment. Confirm `DEMO_MODE=true` and that the
          required tables exist (quotes, customers, providers, rfq_offers).
        </div>
      ) : null}
      <AdminFiltersBar
        filters={
          <div className="flex flex-col gap-3">
            <AdminQuotesViewFilter currentView={currentView} basePath="/admin/quotes" />
            <AdminQuotesInboxControls basePath="/admin/quotes" />
          </div>
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
            quotes={pagedQuotesWithOfferCounts}
            totalCount={effectiveTotalCount}
            currentView={currentView as AdminQuotesView}
            searchTerm={normalizedSearch}
            demoSupplierProvidersByQuoteId={
              demoEnabled ? demoSupplierProvidersByQuoteId : undefined
            }
            demoReturnToBase={demoEnabled ? returnToBase : undefined}
          />
          <TablePaginationControls
            basePath="/admin/quotes"
            page={page}
            pageSize={pageSize}
            hasMore={effectiveHasMore}
            totalCount={effectiveTotalCount}
            rowsOnPage={pagedQuotesWithOfferCounts.length}
            listStateConfig={ADMIN_QUOTES_LIST_STATE_CONFIG}
          />
        </div>
      </div>
    </AdminDashboardShell>
  );
}

async function attachOfferCounts(quotes: QuoteRow[]): Promise<QuoteRow[]> {
  const quoteIds = quotes
    .map((row) => (typeof row?.id === "string" ? row.id.trim() : ""))
    .filter(Boolean);
  if (quoteIds.length === 0) {
    return quotes;
  }

  const offersResult = await loadRfqOffersForQuoteIds(quoteIds);
  if (!offersResult.ok) {
    return quotes;
  }

  const offersByQuoteId = new Map<string, typeof offersResult.offers>();
  for (const offer of offersResult.offers) {
    const quoteId = typeof offer.rfq_id === "string" ? offer.rfq_id.trim() : "";
    if (!quoteId) continue;
    if (!offersByQuoteId.has(quoteId)) {
      offersByQuoteId.set(quoteId, []);
    }
    offersByQuoteId.get(quoteId)!.push(offer);
  }

  const summaryByQuoteId = new Map<string, ReturnType<typeof summarizeRfqOffers>>();
  for (const quoteId of quoteIds) {
    const offers = offersByQuoteId.get(quoteId) ?? [];
    summaryByQuoteId.set(quoteId, summarizeRfqOffers(offers));
  }

  return quotes.map((row) => {
    const quoteId = typeof row?.id === "string" ? row.id.trim() : "";
    const summary = quoteId ? summaryByQuoteId.get(quoteId) ?? null : null;
    if (!quoteId || !summary) {
      return row;
    }
    return {
      ...row,
      // Source of truth for the offers column: rfq_offers excluding withdrawn.
      bidCount: summary.nonWithdrawn,
      // And the latest "offer received" timestamp where possible.
      latestBidAt: summary.latestReturnedAt ?? row.latestBidAt ?? null,
    };
  });
}

async function loadOfferProviderIdsByQuoteId(
  quoteIds: string[],
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  const ids = Array.from(
    new Set(
      (quoteIds ?? [])
        .map((id) => (typeof id === "string" ? id.trim() : ""))
        .filter(Boolean),
    ),
  );
  if (ids.length === 0) return map;

  const schemaReady = await schemaGate({
    enabled: true,
    relation: "rfq_offers",
    requiredColumns: ["rfq_id", "provider_id"],
    warnPrefix: "[admin quotes demo]",
    warnKey: "admin_quotes_demo:rfq_offers_schema",
  });
  if (!schemaReady) return map;

  try {
    const { data, error } = await supabaseServer()
      .from("rfq_offers")
      .select("rfq_id,provider_id")
      .in("rfq_id", ids)
      .returns<Array<{ rfq_id: string | null; provider_id: string | null }>>();

    if (error) {
      if (isMissingTableOrColumnError(error)) return map;
      console.warn("[admin quotes demo] rfq_offers query failed", {
        quoteIdsCount: ids.length,
        error: serializeSupabaseError(error) ?? error,
      });
      return map;
    }

    for (const row of data ?? []) {
      const rfqId = typeof row?.rfq_id === "string" ? row.rfq_id.trim() : "";
      const providerId = typeof row?.provider_id === "string" ? row.provider_id.trim() : "";
      if (!rfqId || !providerId) continue;
      const existing = map.get(rfqId) ?? [];
      if (!existing.includes(providerId)) {
        existing.push(providerId);
      }
      map.set(rfqId, existing);
    }

    for (const [rfqId, providerIds] of map.entries()) {
      providerIds.sort((a, b) => a.localeCompare(b));
      map.set(rfqId, providerIds);
    }
  } catch (error) {
    if (isMissingTableOrColumnError(error)) return map;
    console.warn("[admin quotes demo] rfq_offers query crashed", {
      quoteIdsCount: ids.length,
      error: serializeSupabaseError(error) ?? error,
    });
  }

  return map;
}

async function loadKickoffProgressByQuoteId(
  quoteIds: string[],
): Promise<{
  schemaReady: boolean;
  progressByQuoteId: Map<string, { completed: number; total: number | null }>;
}> {
  const progressByQuoteId = new Map<string, { completed: number; total: number | null }>();
  const ids = Array.from(
    new Set(
      (quoteIds ?? [])
        .map((id) => (typeof id === "string" ? id.trim() : ""))
        .filter(Boolean),
    ),
  );
  if (ids.length === 0) {
    return { schemaReady: false, progressByQuoteId };
  }

  const schemaReady = await schemaGate({
    enabled: true,
    relation: "quote_kickoff_tasks",
    requiredColumns: ["quote_id", "status"],
    warnPrefix: "[admin quotes]",
    warnKey: "admin_quotes:kickoff_progress_schema",
  });
  if (!schemaReady) {
    return { schemaReady: false, progressByQuoteId };
  }

  try {
    const { data, error } = await supabaseServer()
      .from("quote_kickoff_tasks")
      .select("quote_id,status")
      .in("quote_id", ids)
      .returns<Array<{ quote_id: string | null; status: string | null }>>();

    if (error) {
      if (isMissingTableOrColumnError(error)) {
        return { schemaReady: false, progressByQuoteId };
      }
      console.warn("[admin quotes] quote_kickoff_tasks query failed", {
        quoteIdsCount: ids.length,
        error: serializeSupabaseError(error) ?? error,
      });
      return { schemaReady: true, progressByQuoteId };
    }

    for (const row of data ?? []) {
      const quoteId = typeof row?.quote_id === "string" ? row.quote_id.trim() : "";
      if (!quoteId) continue;
      const status = typeof row?.status === "string" ? row.status.trim().toLowerCase() : "";
      const existing = progressByQuoteId.get(quoteId) ?? { completed: 0, total: 0 };
      existing.total = (existing.total ?? 0) + 1;
      if (status === "complete") {
        existing.completed += 1;
      }
      progressByQuoteId.set(quoteId, existing);
    }

    // Ensure all ids exist in the map: schema is present but tasks might not be seeded yet.
    for (const id of ids) {
      if (!progressByQuoteId.has(id)) {
        progressByQuoteId.set(id, { completed: 0, total: null });
      }
    }
  } catch (error) {
    if (isMissingTableOrColumnError(error)) {
      return { schemaReady: false, progressByQuoteId };
    }
    console.warn("[admin quotes] quote_kickoff_tasks query crashed", {
      quoteIdsCount: ids.length,
      error: serializeSupabaseError(error) ?? error,
    });
  }

  return { schemaReady: true, progressByQuoteId };
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

type PartsCoverageFilter = "all" | "good" | "needs_attention" | "none";

function normalizePartsCoverageFilter(value: unknown): PartsCoverageFilter {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  switch (normalized) {
    case "good":
    case "needs_attention":
    case "none":
      return normalized;
    default:
      return "all";
  }
}

type AdminMessageFilter = "all" | "needs_reply" | "overdue";

function normalizeAdminMessageFilter(value: unknown): AdminMessageFilter {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  switch (normalized) {
    case "needs_reply":
    case "overdue":
      return normalized;
    default:
      return "all";
  }
}

function toMs(value: string | null | undefined): number {
  if (!value) return -1;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : -1;
}

function compareInboxPriority(a: QuoteRow, b: QuoteRow): number {
  const aPriority = a.adminOverdue ? 2 : a.adminNeedsReply ? 1 : 0;
  const bPriority = b.adminOverdue ? 2 : b.adminNeedsReply ? 1 : 0;
  if (aPriority !== bPriority) return bPriority - aPriority;

  const aLastMsg = toMs(a.threadLastMessageAt);
  const bLastMsg = toMs(b.threadLastMessageAt);
  if (aLastMsg !== bLastMsg) return bLastMsg - aLastMsg;

  const aCreated = toMs(a.createdAt);
  const bCreated = toMs(b.createdAt);
  return bCreated - aCreated;
}

type RfqAwardLite = { rfq_id: string; provider_id: string; awarded_at: string };

async function loadRfqAwardsByQuoteId(
  quoteIds: string[],
): Promise<Map<string, RfqAwardLite>> {
  const map = new Map<string, RfqAwardLite>();
  const ids = Array.from(new Set((quoteIds ?? []).map((id) => (typeof id === "string" ? id.trim() : "")).filter(Boolean)));
  if (ids.length === 0) return map;

  try {
    const { data, error } = await supabaseServer()
      .from("rfq_awards")
      .select("rfq_id,provider_id,awarded_at")
      .in("rfq_id", ids)
      .returns<RfqAwardLite[]>();

    if (error) {
      if (isMissingTableOrColumnError(error)) return map;
      console.warn("[admin quotes] rfq_awards query failed", {
        quoteIdsCount: ids.length,
        error: serializeSupabaseError(error) ?? error,
      });
      return map;
    }

    for (const row of data ?? []) {
      const rfqId = typeof row?.rfq_id === "string" ? row.rfq_id.trim() : "";
      const providerId = typeof row?.provider_id === "string" ? row.provider_id.trim() : "";
      const awardedAt = typeof row?.awarded_at === "string" ? row.awarded_at.trim() : "";
      if (!rfqId || !providerId || !awardedAt) continue;
      map.set(rfqId, { rfq_id: rfqId, provider_id: providerId, awarded_at: awardedAt });
    }
  } catch (error) {
    if (isMissingTableOrColumnError(error)) return map;
    console.warn("[admin quotes] rfq_awards query crashed", {
      quoteIdsCount: ids.length,
      error: serializeSupabaseError(error) ?? error,
    });
  }

  return map;
}

async function loadProviderNameMapByIds(providerIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const ids = Array.from(new Set((providerIds ?? []).map((id) => (typeof id === "string" ? id.trim() : "")).filter(Boolean)));
  if (ids.length === 0) return map;

  try {
    const { data, error } = await supabaseServer()
      .from("providers")
      .select("id,name")
      .in("id", ids)
      .returns<{ id: string; name: string | null }[]>();

    if (error) {
      if (isMissingTableOrColumnError(error)) return map;
      console.warn("[admin quotes] providers query failed", {
        providerIdsCount: ids.length,
        error: serializeSupabaseError(error) ?? error,
      });
      return map;
    }

    for (const row of data ?? []) {
      const id = typeof row?.id === "string" ? row.id.trim() : "";
      if (!id) continue;
      const name = typeof row?.name === "string" ? row.name.trim() : "";
      if (name) {
        map.set(id, name);
      }
    }
  } catch (error) {
    if (isMissingTableOrColumnError(error)) return map;
    console.warn("[admin quotes] providers query crashed", {
      providerIdsCount: ids.length,
      error: serializeSupabaseError(error) ?? error,
    });
  }

  return map;
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
