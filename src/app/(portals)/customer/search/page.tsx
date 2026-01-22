export const dynamic = "force-dynamic";

import Link from "next/link";
import clsx from "clsx";
import type { ReactNode } from "react";

import PortalCard from "@/app/(portals)/PortalCard";
import { PortalShell } from "@/app/(portals)/components/PortalShell";
import { CustomerQuoteCompareOffers } from "@/app/(portals)/customer/quotes/[id]/CustomerQuoteCompareOffers";
import { CustomerQuoteRefreshResultsButton } from "@/app/(portals)/customer/quotes/[id]/CustomerQuoteRefreshResultsButton";
import { CustomerSearchActions } from "@/app/(portals)/customer/search/CustomerSearchActions";
import { loadQuoteWorkspaceData, type QuoteWorkspaceData } from "@/app/(portals)/quotes/workspaceData";
import { formatQuoteId } from "@/app/(portals)/quotes/pageUtils";
import { primaryCtaClasses, secondaryCtaClasses } from "@/lib/ctas";
import { formatDateTime } from "@/lib/formatDate";
import { formatSlaResponseTime } from "@/lib/ops/sla";
import { formatRelativeTimeFromTimestamp, toTimestamp } from "@/lib/relativeTime";
import { normalizeSearchParams } from "@/lib/route/normalizeSearchParams";
import {
  buildPendingProvidersNextStepsCopy,
  countContactedSuppliers,
  isDestinationReceived,
  sortDestinationsBySlaUrgency,
} from "@/lib/search/pendingProviders";
import { buildSearchStateSummary, searchStateLabelTone } from "@/lib/search/searchState";
import {
  buildSearchProgress,
  EMPTY_SEARCH_STATE_COUNTS,
  EMPTY_SEARCH_STATE_TIMESTAMPS,
} from "@/lib/search/searchProgress";
import { SHOW_LEGACY_QUOTE_ENTRYPOINTS } from "@/lib/ui/deprecation";
import { supabaseServer } from "@/lib/supabaseServer";
import { requireCustomerSessionOrRedirect } from "@/app/(portals)/customer/requireCustomerSessionOrRedirect";
import { getCustomerByUserId } from "@/server/customers";
import { loadCustomerQuotesList, type CustomerQuoteListRow } from "@/server/customer/quotesList";
import {
  getCustomerSearchAlertPreference,
  touchCustomerSavedSearch,
} from "@/server/customer/savedSearches";
import { loadCustomerOfferShortlist } from "@/server/customer/offerShortlist";
import { schemaGate } from "@/server/db/schemaContract";
import { isMissingTableOrColumnError, serializeSupabaseError } from "@/server/admin/logging";
import { getOpsSlaSettings } from "@/server/ops/settings";
import { deriveSearchAlertPreferenceFromOpsEvents } from "@/server/ops/searchAlerts";
import { type RfqDestination } from "@/server/rfqs/destinations";
import { type RfqOffer } from "@/server/rfqs/offers";
import { PROVIDER_TYPES } from "@/server/providers";
import { EmptyStateCard } from "@/components/EmptyStateCard";
import { CoverageDisclosure } from "@/components/CoverageDisclosure";
import { CoverageConfidenceBadge } from "@/components/CoverageConfidenceBadge";
import { TagPill, type TagPillTone } from "@/components/shared/primitives/TagPill";
import { CustomerEstimatedPriceTile } from "@/components/CustomerEstimatedPriceTile";
import {
  SearchActivityFeed,
  buildSearchActivityFeedEvents,
} from "@/components/search/SearchActivityFeed";
import { PendingProvidersTable } from "@/components/search/PendingProvidersTable";
import { buildOpsEventSessionKey, logOpsEvent } from "@/server/ops/events";
import { SearchAlertOptInCard } from "@/app/(portals)/customer/components/SearchAlertOptInCard";
import { computeCustomerCoverageConfidence } from "@/server/customer/coverageConfidence";
import { buildCustomerCompareOffers } from "@/server/customer/compareOffers";
import { userHasTeamAccessToQuote } from "@/server/customerTeams";
import { getCustomerPricingEstimate, partsBucketFromCount } from "@/server/customer/pricingEstimate";

type CustomerSearchPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

type SearchFilters = {
  providerType: string | null;
  status: "pending" | "received" | null;
  minLeadDays: number | null;
  maxLeadDays: number | null;
  minPrice: number | null;
  maxPrice: number | null;
  location: string | null;
};

type SearchParamsSnapshot = {
  quoteId: string;
  providerType: string;
  status: string;
  minLeadDays: string;
  maxLeadDays: string;
  minPrice: string;
  maxPrice: string;
  location: string;
  sort: string;
  shortlisted: string;
};

type CountMap = Map<string, number>;

const FILTER_PARAM_KEYS = [
  "providerType",
  "status",
  "minLeadDays",
  "maxLeadDays",
  "minPrice",
  "maxPrice",
  "location",
  "sort",
  "shortlisted",
] as const;

const SORT_PARAM_VALUES = ["bestValue", "fastest", "lowestPrice", "lowestRisk"] as const;
type SortParamValue = (typeof SORT_PARAM_VALUES)[number];
const DEFAULT_SORT_PARAM: SortParamValue = "bestValue";

export default async function CustomerSearchPage({ searchParams }: CustomerSearchPageProps) {
  const user = await requireCustomerSessionOrRedirect("/customer/search");
  const opsEventSessionKey = buildOpsEventSessionKey({
    userId: user.id,
    lastSignInAt: user.last_sign_in_at ?? null,
  });
  const customer = await getCustomerByUserId(user.id);

  if (!customer) {
    return (
      <PortalShell
        workspace="customer"
        title="Search results"
        subtitle="Compare pricing and lead times across providers."
        actions={
          SHOW_LEGACY_QUOTE_ENTRYPOINTS ? (
            <Link href="/quote" className={primaryCtaClasses}>
              Start a search
            </Link>
          ) : null
        }
      >
        <EmptyStateCard
          title="Complete your profile"
          description="Finish setting up your customer profile to access search results and provider offers."
          action={{ label: "Back to dashboard", href: "/customer" }}
        />
      </PortalShell>
    );
  }

  const usp = normalizeSearchParams(searchParams ? await searchParams : undefined);
  const normalizedSort = normalizeSortParam(usp.get("sort")) ?? DEFAULT_SORT_PARAM;
  if (usp.get("sort") !== normalizedSort) {
    usp.set("sort", normalizedSort);
  }
  const rawParams = snapshotSearchParams(usp);
  const filters = parseSearchFilters(usp);

  const quoteIdParam = normalizeText(rawParams.quoteId);
  const quotes = await loadCustomerQuotesList(
    { userId: user.id, email: user.email ?? null },
    {},
  );

  let selectedQuote = quotes.find((quote) => quote.id === quoteIdParam) ?? null;
  const recentQuotes = quotes.slice(0, 8);

  let activeQuote = selectedQuote;
  let workspaceData = null;
  let workspaceError: string | null = null;

  // If the user is following a shared link (quote=...) but it isn't in their
  // email-derived list, fall back to team-based access (Phase 20.1.3).
  if (!activeQuote && quoteIdParam) {
    try {
      const teamAccess = await userHasTeamAccessToQuote({ quoteId: quoteIdParam, userId: user.id });
      if (teamAccess) {
        const { data } = await supabaseServer
          .from("quotes_with_uploads")
          .select("id,customer_email,created_at,updated_at,file_name,status")
          .eq("id", quoteIdParam)
          .maybeSingle<{
            id: string;
            customer_email: string | null;
            created_at: string | null;
            updated_at: string | null;
            file_name: string | null;
            status: string | null;
          }>();

        if (data?.id) {
          // Minimal shape to let the search workspace render.
          selectedQuote = {
            id: data.id,
            createdAt: data.created_at ?? new Date().toISOString(),
            updatedAt: data.updated_at ?? null,
            rfqLabel: "Shared search request",
            status: (data.status ?? "Submitted").trim() || "Submitted",
            hasWinner: false,
            kickoffStatus: "n/a",
            bidsCount: 0,
            primaryFileName: data.file_name ?? null,
            bestPriceAmount: null,
            bestPriceCurrency: null,
            bestLeadTimeDays: null,
            selectedPriceAmount: null,
            selectedPriceCurrency: null,
            selectedLeadTimeDays: null,
            unreadMessagesCount: 0,
            lastActivityAt: data.updated_at ?? data.created_at ?? null,
          };
          activeQuote = selectedQuote;
        }
      }
    } catch {
      // Fail-soft: keep existing behavior.
    }
  }

  if (activeQuote) {
    const workspaceResult = await loadQuoteWorkspaceData(activeQuote.id, {
      safeOnly: true,
      viewerUserId: user.id,
      viewerRole: "customer",
      includeOffers: true,
      includeOpsEvents: true,
    });
    if (!workspaceResult.ok || !workspaceResult.data) {
      workspaceError = workspaceResult.error ?? "Unable to load this search.";
      activeQuote = null;
      workspaceData = null;
    } else {
      workspaceData = workspaceResult.data;
    }
  }

  if (activeQuote) {
    await touchCustomerSavedSearch({ customerId: customer.id, quoteId: activeQuote.id });
  }

  const showRecentSearches = !activeQuote && !quoteIdParam;
  const listCounts = showRecentSearches
    ? await loadSearchListCounts(recentQuotes.map((quote) => quote.id))
    : { offerCounts: new Map(), destinationCounts: new Map() };
  const recentQuoteForActivity = showRecentSearches ? recentQuotes[0] ?? null : null;

  const rfqOffers = workspaceData?.rfqOffers ?? [];
  const rfqDestinations = workspaceData?.rfqDestinations ?? [];
  const customerCompareOffersPromise =
    activeQuote && rfqOffers.length > 0
      ? buildCustomerCompareOffers(rfqOffers)
      : Promise.resolve([]);
  const filterContext = buildFilterContext({
    offers: rfqOffers,
    destinations: rfqDestinations,
    filters,
  });

  const filteredOffers = applyOfferFilters(rfqOffers, filterContext.filters);
  const searchStateSummary = buildSearchStateSummary({
    destinations: rfqDestinations,
    offers: rfqOffers,
  });
  const searchStateCounts = searchStateSummary.counts;
  const searchStateTone = searchStateLabelTone(searchStateSummary.status_label);
  const searchProgress = buildSearchProgress({
    counts: searchStateSummary.counts,
    timestamps: searchStateSummary.timestamps,
    statusLabel: searchStateSummary.status_label,
    recommendedAction: searchStateSummary.recommended_action,
    quoteId: activeQuote?.id ?? null,
  });
  const initializingSearchProgress = quoteIdParam
    ? buildSearchProgress({
        counts: EMPTY_SEARCH_STATE_COUNTS,
        timestamps: EMPTY_SEARCH_STATE_TIMESTAMPS,
        statusLabel: "searching",
        recommendedAction: "refresh",
        quoteId: quoteIdParam,
        isInitializing: true,
      })
    : null;
  const searchProgressActionLabel = searchProgress.recommendedActionLabel;
  const searchProgressActionHref = searchProgress.recommendedActionHref;
  const searchProgressActionIsMailto = Boolean(
    searchProgressActionHref && searchProgressActionHref.startsWith("mailto:"),
  );
  const pendingDestinations = buildPendingDestinations({
    destinations: rfqDestinations,
    filters: filterContext.filters,
  }).sort(sortDestinationsBySlaUrgency);
  const visiblePendingDestinations = pendingDestinations.slice(0, 6);
  const remainingPendingDestinationCount = Math.max(
    pendingDestinations.length - visiblePendingDestinations.length,
    0,
  );

  const totalOfferCount = searchStateCounts.offers_total;
  const contactedSuppliersCount = countContactedSuppliers(rfqDestinations);
  let pendingNextStepsCopy: string | null = null;
  let pendingOffersDescription =
    "Providers are reviewing your search request. We will surface offers here as soon as they respond.";
  let showSlaNudge = false;
  let slaNudgeDetail: string | null = null;
  if (activeQuote && workspaceData && totalOfferCount === 0) {
    const slaSettings = await getOpsSlaSettings();
    const responseTimeLabel = slaSettings.usingFallback
      ? null
      : formatSlaResponseTime(slaSettings.config.sentNoReplyMaxHours);
    pendingNextStepsCopy = buildPendingProvidersNextStepsCopy({
      contactedCount: contactedSuppliersCount,
      responseTimeLabel,
    });
    pendingOffersDescription = `${pendingNextStepsCopy} We will surface offers here as soon as they respond.`;
    const lastOutreachTimestamp = toTimestamp(searchStateSummary.timestamps.last_destination_activity_at);
    const elapsedSinceOutreachLabel = normalizeElapsedLabel(searchProgress.lastUpdatedLabel);
    const thresholdHours = slaSettings.config.sentNoReplyMaxHours;
    const thresholdMs = Number.isFinite(thresholdHours) ? thresholdHours * 60 * 60 * 1000 : null;
    const elapsedMs =
      typeof lastOutreachTimestamp === "number" ? Date.now() - lastOutreachTimestamp : null;
    const exceedsSla =
      typeof elapsedMs === "number" &&
      elapsedMs > 0 &&
      typeof thresholdMs === "number" &&
      thresholdMs > 0 &&
      elapsedMs > thresholdMs;
    showSlaNudge =
      searchStateCounts.destinations_total > 0 &&
      contactedSuppliersCount > 0 &&
      exceedsSla &&
      Boolean(elapsedSinceOutreachLabel);
    if (showSlaNudge && elapsedSinceOutreachLabel) {
      const supplierLabel = contactedSuppliersCount === 1 ? "supplier" : "suppliers";
      slaNudgeDetail = `We've reached out to ${contactedSuppliersCount} ${supplierLabel}; it's been ${elapsedSinceOutreachLabel} since outreach.`;
    }
  }

  const activeQuoteSummary = buildQuoteSummary(workspaceData);
  const matchedOnProcess = activeQuoteSummary.process !== "Pending" && activeQuoteSummary.process !== "—";
  const coverageConfidence =
    activeQuote && workspaceData?.uploadMeta
      ? await computeCustomerCoverageConfidence({ uploadMeta: workspaceData.uploadMeta })
      : null;
  const estimateTechnology =
    activeQuote && workspaceData
      ? normalizeUploadMetaString(workspaceData.uploadMeta, ["manufacturing_process"])
      : null;
  const estimateMaterialCanon =
    activeQuote && workspaceData
      ? normalizeUploadMetaString(workspaceData.uploadMeta, ["material_canon", "materialCanon"])
      : null;
  const estimateMaterialForTooltip =
    activeQuote && workspaceData
      ? normalizeUploadMetaString(workspaceData.uploadMeta, [
          "material_canon",
          "materialCanon",
          "material",
          "material_type",
          "material_name",
          "materialName",
        ])
      : null;
  const estimatePartsCount =
    activeQuote && workspaceData && Array.isArray(workspaceData.parts) && workspaceData.parts.length > 0
      ? workspaceData.parts.length
      : null;
  const customerPricingEstimate =
    activeQuote && workspaceData
      ? await getCustomerPricingEstimate({
          technology: estimateTechnology,
          materialCanon: estimateMaterialCanon,
          partsCount: estimatePartsCount,
        })
      : null;

  if (activeQuote && customerPricingEstimate) {
    const partsBucket = partsBucketFromCount(estimatePartsCount);
    void logOpsEvent({
      quoteId: activeQuote.id,
      eventType: "estimate_shown",
      dedupeKey: opsEventSessionKey,
      payload: {
        process: estimateTechnology,
        material_canon: estimateMaterialCanon,
        parts_bucket: partsBucket,
        confidence: customerPricingEstimate.confidence,
        source: customerPricingEstimate.source,
      },
    });
  }

  const clearFiltersHref = buildClearFiltersHref(rawParams.quoteId, rawParams.sort);
  const shareSearchHref = activeQuote ? buildSearchShareHref(usp, activeQuote.id) : "";
  const activityQuote = workspaceData?.quote
    ? {
        id: workspaceData.quote.id,
        created_at: workspaceData.quote.created_at ?? null,
        updated_at: workspaceData.quote.updated_at ?? null,
      }
    : recentQuoteForActivity
      ? {
          id: recentQuoteForActivity.id,
          created_at: recentQuoteForActivity.createdAt ?? null,
          updated_at: recentQuoteForActivity.updatedAt ?? null,
        }
      : null;
  const activityQuoteHref = activityQuote ? `/customer/quotes/${activityQuote.id}` : null;
  const searchActivityEvents = buildSearchActivityFeedEvents({
    quote: activityQuote,
    quoteHref: activityQuoteHref,
    destinations: activeQuote ? rfqDestinations : [],
    offers: activeQuote ? rfqOffers : [],
    opsEvents: activeQuote ? workspaceData?.opsEvents ?? [] : [],
    inviteSupplierHref: activeQuote ? "/customer/invite-supplier" : null,
    viewResultsHref: !activeQuote && recentQuoteForActivity
      ? buildSearchHref(usp, recentQuoteForActivity.id)
      : null,
  });
  const showActivityFeed = Boolean(quoteIdParam) || Boolean(recentQuoteForActivity);
  const activityDescription = activeQuote
    ? "Latest updates as suppliers respond to your search request."
    : quoteIdParam
      ? "We will show updates as soon as the search is live."
      : "Recent activity from your latest search.";
  const activityEmptyState = quoteIdParam
    ? "Activity will appear once the search is live."
    : "Activity will appear here as new updates arrive.";

  const savedSearchAlertPreference = activeQuote
    ? await getCustomerSearchAlertPreference({
        customerId: customer.id,
        quoteId: activeQuote.id,
      })
    : null;
  const opsAlertPreference = activeQuote
    ? deriveSearchAlertPreferenceFromOpsEvents(workspaceData?.opsEvents ?? [])
    : null;
  const searchAlertEnabled =
    savedSearchAlertPreference?.supported && savedSearchAlertPreference.hasRow
      ? savedSearchAlertPreference.enabled
      : opsAlertPreference ?? false;

  const offerShortlist = activeQuote
    ? await loadCustomerOfferShortlist({
        customerId: customer.id,
        quoteId: activeQuote.id,
        opsEvents: workspaceData?.opsEvents ?? [],
      })
    : null;
  const shortlistedOfferIds = offerShortlist?.offerIds ?? [];

  const customerCompareOffers = await customerCompareOffersPromise;
  const filteredOfferIdSet = new Set(filteredOffers.map((offer) => offer.id));
  let filteredCustomerCompareOffers = customerCompareOffers.filter((offer) =>
    filteredOfferIdSet.has(offer.id),
  );
  const shortlistOnlyMode = parseToggle(normalizeText(rawParams.shortlisted));
  if (shortlistOnlyMode) {
    const shortlistIdSet = new Set(shortlistedOfferIds);
    filteredCustomerCompareOffers = filteredCustomerCompareOffers.filter((offer) =>
      shortlistIdSet.has(offer.id),
    );
  }
  const offerCount = filteredCustomerCompareOffers.length;
  const showAllOffersHref = (() => {
    const params = new URLSearchParams(usp.toString());
    params.delete("shortlisted");
    const qs = params.toString();
    return qs ? `/customer/search?${qs}` : "/customer/search";
  })();

  return (
    <PortalShell
      workspace="customer"
      title="Search results"
      subtitle="Track provider responses, compare offers, and refine your search."
    >
      <section
        className={clsx(
          "rounded-2xl border border-slate-900/70 bg-slate-950/70 px-6 py-5 shadow-[0_10px_30px_rgba(2,6,23,0.45)]",
          "lg:sticky lg:top-4 lg:z-20",
        )}
        aria-label="Search summary"
      >
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
              {activeQuote ? `Search ${formatQuoteId(activeQuote.id)}` : "Search summary"}
            </div>
            <p className="text-lg font-semibold text-white">
              {activeQuote?.rfqLabel ?? "Select a search to view results"}
            </p>
            {activeQuote?.primaryFileName ? (
              <p className="text-sm text-slate-400">{activeQuote.primaryFileName}</p>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {activeQuote ? (
              <CustomerSearchActions
                quoteId={activeQuote.id}
                sharePath={shareSearchHref}
                quoteLabel={activeQuote.rfqLabel ?? null}
              />
            ) : null}
            <Link href="/customer/invite-supplier" className={secondaryCtaClasses}>
              Invite your supplier
            </Link>
            {activeQuote ? (
              <Link href={`/customer/quotes/${activeQuote.id}`} className={secondaryCtaClasses}>
                Open quote
              </Link>
            ) : null}
            {activeQuote ? (
              <Link
                href={`/customer/quotes/${activeQuote.id}#uploads`}
                className={primaryCtaClasses}
              >
                Edit search
              </Link>
            ) : null}
            {SHOW_LEGACY_QUOTE_ENTRYPOINTS ? (
              <Link href="/quote" className={secondaryCtaClasses}>
                New search
              </Link>
            ) : null}
          </div>
        </div>
        <dl className="mt-4 grid gap-3 text-sm text-slate-200 sm:grid-cols-2 lg:grid-cols-6">
          <SummaryTile label="Process" value={activeQuoteSummary.process} />
          <SummaryTile label="Quantity" value={activeQuoteSummary.quantity} />
          <SummaryTile label="Need-by" value={activeQuoteSummary.needBy} />
          <SummaryTile label="Files" value={activeQuoteSummary.files} />
          <CustomerEstimatedPriceTile
            estimate={customerPricingEstimate}
            technology={estimateTechnology}
            material={estimateMaterialForTooltip}
            partsCount={estimatePartsCount}
          />
          {coverageConfidence ? (
            <SummaryTile
              label="Coverage"
              value={
                <span className="inline-flex flex-col items-start gap-1">
                  <CoverageConfidenceBadge summary={coverageConfidence} size="md" />
                  <span className="text-xs font-normal text-slate-400 normal-case tracking-normal">
                    {coverageConfidence.helper}
                  </span>
                </span>
              }
            />
          ) : null}
        </dl>
      </section>

      {showActivityFeed ? (
        <SearchActivityFeed
          className="mt-6"
          events={searchActivityEvents}
          description={activityDescription}
          emptyState={activityEmptyState}
        />
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,260px)_minmax(0,1fr)]">
        <aside className="space-y-4">
          <PortalCard title="Filters" description="Refine which providers appear in results.">
            <form method="get" className="space-y-4">
              {activeQuote ? (
                <input type="hidden" name="quote" value={activeQuote.id} />
              ) : null}
              <input type="hidden" name="sort" value={rawParams.sort} />
              {rawParams.shortlisted ? (
                <input type="hidden" name="shortlisted" value={rawParams.shortlisted} />
              ) : null}
              {!activeQuote ? (
                <p className="text-xs text-slate-400">
                  Select a search to apply filters to provider results.
                </p>
              ) : null}
              <label className="flex flex-col gap-1 text-xs font-semibold text-slate-300">
                Provider type
                <select
                  name="providerType"
                  defaultValue={rawParams.providerType}
                  className="rounded-lg border border-slate-800 bg-slate-950/60 px-2 py-2 text-xs text-slate-100 outline-none transition focus:border-emerald-400"
                >
                  <option value="">All</option>
                  {PROVIDER_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {formatEnumLabel(type)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs font-semibold text-slate-300">
                Status
                <select
                  name="status"
                  defaultValue={rawParams.status}
                  className="rounded-lg border border-slate-800 bg-slate-950/60 px-2 py-2 text-xs text-slate-100 outline-none transition focus:border-emerald-400"
                >
                  <option value="">All</option>
                  <option value="pending">Pending</option>
                  <option value="received">Received</option>
                </select>
              </label>
              <div className="space-y-2">
                <p className="text-xs font-semibold text-slate-300">Lead time (days)</p>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="number"
                    name="minLeadDays"
                    min={0}
                    placeholder="Min"
                    defaultValue={rawParams.minLeadDays}
                    className="w-full rounded-lg border border-slate-800 bg-slate-950/60 px-2 py-2 text-xs text-slate-100 outline-none transition focus:border-emerald-400"
                  />
                  <input
                    type="number"
                    name="maxLeadDays"
                    min={0}
                    placeholder="Max"
                    defaultValue={rawParams.maxLeadDays}
                    className="w-full rounded-lg border border-slate-800 bg-slate-950/60 px-2 py-2 text-xs text-slate-100 outline-none transition focus:border-emerald-400"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <p className="text-xs font-semibold text-slate-300">Price (total)</p>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="number"
                    name="minPrice"
                    min={0}
                    placeholder="Min"
                    defaultValue={rawParams.minPrice}
                    className="w-full rounded-lg border border-slate-800 bg-slate-950/60 px-2 py-2 text-xs text-slate-100 outline-none transition focus:border-emerald-400"
                  />
                  <input
                    type="number"
                    name="maxPrice"
                    min={0}
                    placeholder="Max"
                    defaultValue={rawParams.maxPrice}
                    className="w-full rounded-lg border border-slate-800 bg-slate-950/60 px-2 py-2 text-xs text-slate-100 outline-none transition focus:border-emerald-400"
                  />
                </div>
              </div>
              <label className="flex flex-col gap-1 text-xs font-semibold text-slate-300">
                Location
                <input
                  type="search"
                  name="location"
                  placeholder={filterContext.hasLocationData ? "Any country" : "Location unavailable"}
                  defaultValue={rawParams.location}
                  disabled={!filterContext.hasLocationData}
                  list={filterContext.hasLocationData ? "provider-location-options" : undefined}
                  className={clsx(
                    "w-full rounded-lg border border-slate-800 bg-slate-950/60 px-2 py-2 text-xs text-slate-100 outline-none transition focus:border-emerald-400",
                    !filterContext.hasLocationData && "cursor-not-allowed text-slate-500",
                  )}
                />
              </label>
              {filterContext.hasLocationData ? (
                <datalist id="provider-location-options">
                  {filterContext.locationOptions.map((location) => (
                    <option key={location} value={location} />
                  ))}
                </datalist>
              ) : (
                <p className="text-xs text-slate-500">
                  Provider location details are not available for this search.
                </p>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="submit"
                  className="inline-flex w-full items-center justify-center rounded-lg bg-emerald-500 px-4 py-2 text-xs font-semibold text-black transition hover:bg-emerald-400 sm:w-auto"
                >
                  Apply
                </button>
                <Link
                  href={clearFiltersHref}
                  className="text-xs font-semibold text-slate-300 underline-offset-4 hover:underline"
                >
                  Clear filters
                </Link>
              </div>
            </form>
          </PortalCard>
        </aside>

        <div className="space-y-6">
          {workspaceError ? (
            <EmptyStateCard
              title="Search unavailable"
              description={workspaceError}
              action={{ label: "View searches", href: "/customer/search" }}
            />
          ) : null}

          {!workspaceError && quoteIdParam && !activeQuote ? (
            <PortalCard
              title={initializingSearchProgress?.statusHeadline ?? "Searching providers..."}
              description={
                initializingSearchProgress?.statusDetail ??
                "We are setting up your search request and routing it to matched providers."
              }
              action={
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <TagPill size="sm" tone="slate" className="normal-case tracking-normal">
                    {initializingSearchProgress?.statusTag ?? "Initializing"}
                  </TagPill>
                  <CustomerQuoteRefreshResultsButton quoteId={quoteIdParam} />
                </div>
              }
            >
              <div className="rounded-xl border border-slate-900/60 bg-slate-950/40 px-4 py-3">
                <p className="text-sm font-semibold text-slate-100">
                  Quote ID: {quoteIdParam}
                </p>
                <p className="text-xs text-slate-400">
                  We’ll surface status updates here as soon as the search is live.
                </p>
              </div>
            </PortalCard>
          ) : null}

          {activeQuote && workspaceData ? (
            <>
              <PortalCard
                title={searchProgress.statusHeadline}
                description={searchProgress.statusDetail}
                action={
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <TagPill size="sm" tone={searchStateTone} className="normal-case tracking-normal">
                      {searchProgress.statusTag}
                    </TagPill>
                    <CustomerQuoteRefreshResultsButton quoteId={activeQuote.id} />
                  </div>
                }
              >
                <div className="space-y-4">
                  <dl className="grid gap-3 text-sm text-slate-200 sm:grid-cols-4">
                    <SummaryStat
                      label="Suppliers contacted"
                      value={searchStateCounts.destinations_total}
                    />
                    <SummaryStat label="Pending" value={searchStateCounts.destinations_pending} />
                    <SummaryStat label="Error" value={searchStateCounts.destinations_error} />
                    <SummaryStat label="Offers" value={searchStateCounts.offers_total} />
                  </dl>
                  {searchProgress.lastUpdatedLabel ? (
                    <p className="text-xs text-slate-500">{searchProgress.lastUpdatedLabel}</p>
                  ) : null}
                  {searchProgressActionLabel && searchProgressActionHref ? (
                    <p className="text-xs text-slate-400">
                      Next step:{" "}
                      {searchProgressActionIsMailto ? (
                        <a
                          href={searchProgressActionHref}
                          className="font-semibold text-slate-100 hover:text-white"
                        >
                          {searchProgressActionLabel}
                        </a>
                      ) : (
                        <Link
                          href={searchProgressActionHref}
                          className="font-semibold text-slate-100 hover:text-white"
                        >
                          {searchProgressActionLabel}
                        </Link>
                      )}
                    </p>
                  ) : null}
                  <div className="rounded-xl border border-slate-900/60 bg-slate-950/40 px-4 py-3">
                    <p className="text-sm font-semibold text-slate-100">
                      {totalOfferCount > 0
                        ? `${totalOfferCount} offer${totalOfferCount === 1 ? "" : "s"} received`
                        : "Offers still pending"}
                    </p>
                    <p className="text-xs text-slate-400">
                      We will notify you as new responses arrive.
                    </p>
                  </div>
                </div>
              </PortalCard>

              <SearchAlertOptInCard
                quoteId={activeQuote.id}
                initialEnabled={searchAlertEnabled}
                quoteLabel={activeQuote.rfqLabel ?? null}
              />

              {showSlaNudge && slaNudgeDetail ? (
                <section className="rounded-2xl border border-amber-500/30 bg-amber-500/5 px-6 py-5">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="space-y-2">
                      <p className="text-xs font-semibold uppercase tracking-wide text-amber-200">
                        Response follow-up
                      </p>
                      <h2 className="text-lg font-semibold text-white">
                        Still waiting on supplier responses
                      </h2>
                      <p className="text-sm text-amber-100/80">{slaNudgeDetail}</p>
                    </div>
                    <div className="flex flex-col gap-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <CustomerQuoteRefreshResultsButton quoteId={activeQuote.id} />
                        <Link href="/customer/invite-supplier" className={secondaryCtaClasses}>
                          Invite supplier
                        </Link>
                      </div>
                      <CustomerSearchActions
                        quoteId={activeQuote.id}
                        sharePath={shareSearchHref}
                        quoteLabel={activeQuote.rfqLabel ?? null}
                      />
                    </div>
                  </div>
                </section>
              ) : null}

              <CoverageDisclosure destinations={rfqDestinations} />

              <PortalCard
                title="Offers returned"
                description="Compare pricing and lead times from qualified providers."
                action={
                  <TagPill
                    size="sm"
                    tone={totalOfferCount > 0 ? "emerald" : "slate"}
                    className="normal-case tracking-normal"
                  >
                    {totalOfferCount > 0
                      ? `${offerCount} of ${totalOfferCount}`
                      : "No offers"}
                  </TagPill>
                }
              >
                {offerCount > 0 ? (
                  <CustomerQuoteCompareOffers
                    quoteId={activeQuote.id}
                    offers={filteredCustomerCompareOffers}
                    selectedOfferId={workspaceData.quote.selected_offer_id ?? null}
                    shortlistedOfferIds={shortlistedOfferIds}
                    matchContext={{
                      matchedOnProcess,
                      locationFilter: filterContext.filters.location ?? null,
                    }}
                  />
                ) : totalOfferCount === 0 ? (
                  <div className="space-y-4">
                    <EmptyStateCard
                      title="Offers are on the way"
                      description={pendingOffersDescription}
                      tone="info"
                    />
                    <PendingProvidersTable
                      destinations={visiblePendingDestinations}
                      remainingCount={remainingPendingDestinationCount}
                      matchContext={{
                        matchedOnProcess,
                        locationFilter: filterContext.filters.location ?? null,
                      }}
                    />
                  </div>
                ) : shortlistOnlyMode ? (
                  <div className="rounded-xl border border-slate-900/60 bg-slate-950/30 px-5 py-6 text-sm text-slate-300">
                    No offers shortlisted yet.{" "}
                    <Link
                      href={showAllOffersHref}
                      className="text-xs font-semibold text-slate-100 underline-offset-4 hover:underline"
                    >
                      Show all offers
                    </Link>
                  </div>
                ) : (
                  <EmptyStateCard
                    title="No offers match these filters"
                    description="Adjust your filters to see the full list of returned offers."
                    action={{ label: "Clear filters", href: clearFiltersHref }}
                  />
                )}
              </PortalCard>
            </>
          ) : quoteIdParam ? null : quotes.length === 0 ? (
            <EmptyStateCard
              title="No searches yet"
              description="Submit a new search request to start comparing pricing and lead times."
              action={
                SHOW_LEGACY_QUOTE_ENTRYPOINTS
                  ? { label: "Start a search", href: "/quote" }
                  : null
              }
              secondaryAction={{ label: "View dashboard", href: "/customer" }}
            />
          ) : (
            <PortalCard
              title="Recent searches"
              description="Pick a search session to see provider progress and offers."
            >
              <div className="space-y-3">
                {recentQuotes.map((quote) => {
                  const lastActivity = formatRelativeTimeFromTimestamp(
                    toTimestamp(quote.lastActivityAt ?? quote.updatedAt ?? quote.createdAt),
                  );
                  const destinationsCount = listCounts.destinationCounts.get(quote.id) ?? 0;
                  const offersCount = listCounts.offerCounts.get(quote.id) ?? 0;
                  const href = buildSearchHref(usp, quote.id);
                  const statusTone = deriveSearchStatusTone(quote.status);
                  return (
                    <div
                      key={quote.id}
                      className="rounded-xl border border-slate-900/60 bg-slate-950/40 px-4 py-4"
                    >
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                        <div className="space-y-2">
                          <p className="text-base font-semibold text-white">{quote.rfqLabel}</p>
                          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                            <span>{formatQuoteId(quote.id)}</span>
                            <span>•</span>
                            <span>{lastActivity ? `Active ${lastActivity}` : "Activity pending"}</span>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <TagPill size="sm" tone={statusTone} className="normal-case">
                              {quote.status}
                            </TagPill>
                            <TagPill size="sm" tone="muted" className="normal-case tracking-normal">
                              {destinationsCount} supplier
                              {destinationsCount === 1 ? "" : "s"} contacted
                            </TagPill>
                            <TagPill size="sm" tone="muted" className="normal-case tracking-normal">
                              {offersCount} offer{offersCount === 1 ? "" : "s"}
                            </TagPill>
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center">
                          <Link
                            href={href}
                            className="inline-flex items-center rounded-full border border-emerald-400/40 bg-emerald-500/10 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-emerald-100 transition hover:border-emerald-300 hover:text-white"
                          >
                            View results
                          </Link>
                        </div>
                      </div>
                    </div>
                  );
                })}
                <Link
                  href="/customer/quotes"
                  className="text-xs font-semibold text-slate-300 underline-offset-4 hover:underline"
                >
                  View quote history
                </Link>
              </div>
            </PortalCard>
          )}
        </div>
      </div>
    </PortalShell>
  );
}

function SummaryTile({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-900/60 bg-slate-950/40 px-3 py-2">
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-1 text-sm font-semibold text-white">{value}</dd>
    </div>
  );
}

function SummaryStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-slate-900/60 bg-slate-950/40 px-3 py-2">
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="text-lg font-semibold text-white">{value}</dd>
    </div>
  );
}

function snapshotSearchParams(usp: URLSearchParams): SearchParamsSnapshot {
  return {
    quoteId: usp.get("quote") ?? "",
    providerType: usp.get("providerType") ?? "",
    status: usp.get("status") ?? "",
    minLeadDays: usp.get("minLeadDays") ?? "",
    maxLeadDays: usp.get("maxLeadDays") ?? "",
    minPrice: usp.get("minPrice") ?? "",
    maxPrice: usp.get("maxPrice") ?? "",
    location: usp.get("location") ?? "",
    sort: usp.get("sort") ?? "",
    shortlisted: usp.get("shortlisted") ?? "",
  };
}

function parseSearchFilters(usp: URLSearchParams): SearchFilters {
  const providerType = normalizeFilterValue(usp.get("providerType"));
  const statusRaw = normalizeFilterValue(usp.get("status"));
  const status =
    statusRaw === "pending" || statusRaw === "received" ? statusRaw : null;
  const minLeadDaysRaw = parseNumberFilter(usp.get("minLeadDays"), true);
  const maxLeadDaysRaw = parseNumberFilter(usp.get("maxLeadDays"), true);
  const minPriceRaw = parseNumberFilter(usp.get("minPrice"), false);
  const maxPriceRaw = parseNumberFilter(usp.get("maxPrice"), false);
  const normalizedLeadRange = normalizeRange(minLeadDaysRaw, maxLeadDaysRaw);
  const normalizedPriceRange = normalizeRange(minPriceRaw, maxPriceRaw);

  return {
    providerType,
    status,
    minLeadDays: normalizedLeadRange.min,
    maxLeadDays: normalizedLeadRange.max,
    minPrice: normalizedPriceRange.min,
    maxPrice: normalizedPriceRange.max,
    location: normalizeFilterValue(usp.get("location")),
  };
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeElapsedLabel(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.replace(/^Last updated\s+/i, "").replace(/\s+ago$/i, "").trim();
}

function normalizeFilterValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeSortParam(value: string | null | undefined): SortParamValue | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return SORT_PARAM_VALUES.includes(trimmed as SortParamValue)
    ? (trimmed as SortParamValue)
    : null;
}

function parseToggle(value: string | null): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function parseNumberFilter(value: string | null, integer: boolean): number | null {
  if (!value) return null;
  const cleaned = value.replace(/[^0-9.-]/g, "");
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed)) return null;
  const normalized = integer ? Math.round(parsed) : parsed;
  if (normalized < 0) return null;
  return normalized;
}

function normalizeRange(min: number | null, max: number | null): { min: number | null; max: number | null } {
  if (min == null || max == null) {
    return { min, max };
  }
  if (min <= max) {
    return { min, max };
  }
  return { min: max, max: min };
}

function buildFilterContext(args: {
  offers: RfqOffer[];
  destinations: RfqDestination[];
  filters: SearchFilters;
}) {
  const locationOptions = new Set<string>();
  for (const offer of args.offers) {
    const location = readProviderLocation(offer.provider);
    if (location) locationOptions.add(location);
  }
  for (const destination of args.destinations) {
    const location = readProviderLocation(destination.provider);
    if (location) locationOptions.add(location);
  }
  const sortedLocations = Array.from(locationOptions).sort((a, b) => a.localeCompare(b));
  const hasLocationData = sortedLocations.length > 0;
  const filters = {
    ...args.filters,
    location: hasLocationData ? args.filters.location : null,
  };

  return { filters, locationOptions: sortedLocations, hasLocationData };
}

function readProviderLocation(provider?: { country?: string | null } | null): string | null {
  if (!provider) return null;
  if (typeof provider.country === "string" && provider.country.trim().length > 0) {
    return provider.country.trim();
  }
  return null;
}

function applyOfferFilters(offers: RfqOffer[], filters: SearchFilters): RfqOffer[] {
  return offers.filter((offer) => {
    if (filters.status === "pending") {
      return false;
    }
    if (!matchesProviderType(offer.provider?.provider_type, filters.providerType)) {
      return false;
    }
    if (!matchesLocation(offer.provider, filters.location)) {
      return false;
    }
    const leadTimeValue = deriveOfferLeadTime(offer);
    if (!matchesRange(leadTimeValue, filters.minLeadDays, filters.maxLeadDays)) {
      return false;
    }
    const priceValue = parseOfferAmount(offer.total_price);
    if (!matchesRange(priceValue, filters.minPrice, filters.maxPrice)) {
      return false;
    }
    return true;
  });
}

function applyDestinationFilters(
  destinations: RfqDestination[],
  filters: SearchFilters,
): RfqDestination[] {
  return destinations.filter((destination) => {
    if (!matchesProviderType(destination.provider?.provider_type, filters.providerType)) {
      return false;
    }
    if (!matchesLocation(destination.provider, filters.location)) {
      return false;
    }
    if (filters.status === "received") {
      return isDestinationReceived(destination.status);
    }
    if (filters.status === "pending") {
      return !isDestinationReceived(destination.status);
    }
    return true;
  });
}

function buildPendingDestinations(args: {
  destinations: RfqDestination[];
  filters: SearchFilters;
}): RfqDestination[] {
  return applyDestinationFilters(args.destinations, {
    ...args.filters,
    status: "pending",
  });
}

function matchesProviderType(value: string | null | undefined, filter: string | null): boolean {
  if (!filter) return true;
  const normalized = normalizeFilterValue(value);
  return normalized === filter;
}

function matchesLocation(
  provider: { country?: string | null } | null | undefined,
  filter: string | null,
): boolean {
  if (!filter) return true;
  const location = readProviderLocation(provider);
  if (!location) return false;
  return location.toLowerCase().includes(filter);
}

function matchesRange(
  value: number | null,
  min: number | null,
  max: number | null,
): boolean {
  if (value == null) {
    return min == null && max == null;
  }
  if (min != null && value < min) {
    return false;
  }
  if (max != null && value > max) {
    return false;
  }
  return true;
}

function deriveOfferLeadTime(offer: RfqOffer): number | null {
  const min = offer.lead_time_days_min;
  const max = offer.lead_time_days_max;
  if (typeof min === "number" && typeof max === "number") {
    return Math.round((min + max) / 2);
  }
  if (typeof min === "number") return min;
  if (typeof max === "number") return max;
  return null;
}

function parseOfferAmount(value: number | string | null): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[^0-9.-]/g, "");
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildSearchHref(usp: URLSearchParams, quoteId: string): string {
  const params = new URLSearchParams();
  for (const [key, value] of usp.entries()) {
    if (key === "quote") continue;
    if (FILTER_PARAM_KEYS.includes(key as (typeof FILTER_PARAM_KEYS)[number])) {
      params.set(key, value);
    }
  }
  params.set("quote", quoteId);
  const qs = params.toString();
  return qs ? `/customer/search?${qs}` : "/customer/search";
}

function buildSearchShareHref(usp: URLSearchParams, quoteId: string): string {
  const params = new URLSearchParams();
  const normalizedQuoteId = normalizeText(quoteId);
  if (normalizedQuoteId) {
    params.set("quote", normalizedQuoteId);
  }

  const shortlistedValue = normalizeText(usp.get("shortlisted"));
  const shortlistedOnly =
    shortlistedValue === "1" ||
    shortlistedValue.toLowerCase() === "true" ||
    shortlistedValue.toLowerCase() === "yes" ||
    shortlistedValue.toLowerCase() === "on";

  // Keep share URLs clean by default. If the user is explicitly in "shortlisted only"
  // mode, preserve relevant filters since this view is intentional.
  if (shortlistedOnly) {
    params.set("shortlisted", "1");

    for (const [key, value] of usp.entries()) {
      if (key === "quote") continue;
      if (key === "shortlisted") continue;
      if (!FILTER_PARAM_KEYS.includes(key as (typeof FILTER_PARAM_KEYS)[number])) continue;

      const cleaned = normalizeText(value);
      if (!cleaned) continue;

      if (key === "sort") {
        const normalizedSort = normalizeSortParam(cleaned) ?? DEFAULT_SORT_PARAM;
        if (normalizedSort === DEFAULT_SORT_PARAM) continue;
        params.set("sort", normalizedSort);
        continue;
      }

      params.set(key, cleaned);
    }
  }

  const qs = params.toString();
  return qs ? `/customer/search?${qs}` : "/customer/search";
}

function buildClearFiltersHref(quoteId?: string | null, sort?: string | null): string {
  const params = new URLSearchParams();
  const normalizedQuote = normalizeText(quoteId);
  const normalizedSort = normalizeSortParam(sort);
  if (normalizedQuote) {
    params.set("quote", normalizedQuote);
  }
  if (normalizedSort) {
    params.set("sort", normalizedSort);
  }
  const qs = params.toString();
  return qs ? `/customer/search?${qs}` : "/customer/search";
}

async function loadSearchListCounts(quoteIds: string[]): Promise<{
  offerCounts: CountMap;
  destinationCounts: CountMap;
}> {
  const normalizedIds = Array.from(new Set(quoteIds.map((id) => normalizeText(id)).filter(Boolean)));
  if (normalizedIds.length === 0) {
    return { offerCounts: new Map(), destinationCounts: new Map() };
  }

  const [offerCounts, destinationCounts] = await Promise.all([
    loadCountMap("rfq_offers", "rfq_id", normalizedIds),
    loadCountMap("rfq_destinations", "rfq_id", normalizedIds),
  ]);

  return { offerCounts, destinationCounts };
}

async function loadCountMap(
  relation: string,
  column: string,
  ids: string[],
): Promise<CountMap> {
  const map = new Map<string, number>();
  if (ids.length === 0) return map;

  const supported = await schemaGate({
    enabled: true,
    relation,
    requiredColumns: [column],
    warnPrefix: "[customer search]",
    warnKey: `customer_search:${relation}`,
  });
  if (!supported) {
    return map;
  }

  try {
    const { data, error } = await supabaseServer
      .from(relation)
      .select(column)
      .in(column, ids)
      .returns<Array<Record<string, string | null>>>();

    if (error) {
      if (isMissingTableOrColumnError(error)) {
        return map;
      }
      console.warn("[customer search] count query failed", {
        relation,
        error: serializeSupabaseError(error) ?? error,
      });
      return map;
    }

    for (const row of data ?? []) {
      const raw = row?.[column];
      const id = typeof raw === "string" ? raw.trim() : "";
      if (!id) continue;
      map.set(id, (map.get(id) ?? 0) + 1);
    }
  } catch (error) {
    if (isMissingTableOrColumnError(error)) {
      return map;
    }
    console.warn("[customer search] count query crashed", {
      relation,
      error: serializeSupabaseError(error) ?? error,
    });
  }

  return map;
}

function buildQuoteSummary(workspaceData: Awaited<ReturnType<typeof loadQuoteWorkspaceData>>["data"]) {
  if (!workspaceData) {
    return {
      process: "—",
      quantity: "—",
      needBy: "—",
      files: "—",
    };
  }
  const quote = workspaceData?.quote ?? null;
  const uploadMeta = workspaceData?.uploadMeta ?? null;
  const process =
    typeof uploadMeta?.manufacturing_process === "string" &&
    uploadMeta.manufacturing_process.trim().length > 0
      ? uploadMeta.manufacturing_process.trim()
      : "Pending";
  const quantity =
    typeof uploadMeta?.quantity === "string" && uploadMeta.quantity.trim().length > 0
      ? uploadMeta.quantity.trim()
      : "Pending";
  const needBy = quote?.target_date ? formatDateTime(quote.target_date) : "Pending";
  const fileCount = quote?.fileCount ?? 0;
  const fileLabel = fileCount === 0
    ? "No files"
    : fileCount === 1
      ? quote?.files?.[0]?.filename ?? "1 file"
      : `${quote?.files?.[0]?.filename ?? "Files"} + ${fileCount - 1}`;

  return {
    process,
    quantity,
    needBy,
    files: fileLabel,
  };
}

function formatEnumLabel(value?: string | null): string {
  if (!value) return "";
  const collapsed = value.replace(/[_-]+/g, " ").trim();
  if (!collapsed) return "";
  return collapsed
    .split(" ")
    .map((segment) => (segment ? segment[0].toUpperCase() + segment.slice(1) : ""))
    .join(" ");
}

function normalizeUploadMetaString(
  uploadMeta: QuoteWorkspaceData["uploadMeta"],
  keys: string[],
): string | null {
  if (!uploadMeta) return null;
  const record = uploadMeta as unknown as Record<string, unknown>;
  for (const key of keys) {
    const raw = record[key];
    if (typeof raw === "string") {
      const trimmed = raw.trim();
      if (trimmed) return trimmed;
    }
  }
  return null;
}

function deriveSearchStatusTone(statusLabel: string): TagPillTone {
  const normalized = normalizeFilterValue(statusLabel);
  if (!normalized) return "slate";
  if (normalized.includes("award") || normalized.includes("won")) return "emerald";
  if (normalized.includes("bid") || normalized.includes("review")) return "blue";
  if (normalized.includes("closed") || normalized.includes("cancel")) return "amber";
  return "slate";
}
