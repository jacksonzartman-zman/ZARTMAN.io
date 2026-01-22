/**
 * Phase 1 Polish checklist
 * - Done: Empty states (no bids / no files / no messages)
 * - Done: Confirmations (award + nudge + message sent) feel immediate
 * - Done: Copy normalization (Decision/Kickoff/Messages/Uploads match rail)
 */

import clsx from "clsx";
import Link from "next/link";
import type { ReactNode } from "react";
import { formatDateTime } from "@/lib/formatDate";
import { formatCurrency } from "@/lib/formatCurrency";
import { formatAwardedByLabel } from "@/lib/awards";
import { formatSlaResponseTime } from "@/lib/ops/sla";
import { toTimestamp } from "@/lib/relativeTime";
import {
  countContactedSuppliers,
} from "@/lib/search/pendingProviders";
import { buildSearchStateSummary, searchStateLabelTone } from "@/lib/search/searchState";
import { buildSearchProgress } from "@/lib/search/searchProgress";
import PortalCard from "@/app/(portals)/PortalCard";
import { PortalShell } from "@/app/(portals)/components/PortalShell";
import { QuoteTimeline } from "@/app/(portals)/components/QuoteTimeline";
import { QuoteFilesUploadsSection } from "@/app/(portals)/components/QuoteFilesUploadsSection";
import {
  formatQuoteId,
  getSearchParamValue,
  normalizeEmailInput,
  resolveMaybePromise,
  type SearchParamsLike,
} from "@/app/(portals)/quotes/pageUtils";
import {
  loadQuoteWorkspaceData,
  type QuoteWorkspaceData,
} from "@/app/(portals)/quotes/workspaceData";
import { deriveQuotePresentation } from "@/app/(portals)/quotes/deriveQuotePresentation";
import { loadBidsForQuote, type BidRow } from "@/server/bids";
import { loadCustomerQuoteBidSummaries } from "@/server/customers/bids";
import { requireCustomerSessionOrRedirect } from "@/app/(portals)/customer/requireCustomerSessionOrRedirect";
import { getCustomerByUserId } from "@/server/customers";
import { WorkflowStatusCallout } from "@/components/WorkflowStatusCallout";
import { getNextWorkflowState } from "@/lib/workflow";
import { CollapsibleCard } from "@/components/CollapsibleCard";
import { DisclosureSection } from "@/components/DisclosureSection";
import {
  getQuoteStatusLabel,
  normalizeQuoteStatus,
} from "@/server/quotes/status";
import { CustomerQuoteAwardPanel } from "./CustomerQuoteAwardPanel";
import { CustomerQuoteProjectCard } from "./CustomerQuoteProjectCard";
import { FocusScroll } from "./FocusScroll";
import { FocusTabScroll } from "@/app/(portals)/shared/FocusTabScroll";
import {
  loadQuoteProjectForQuote,
  type QuoteProjectRecord,
} from "@/server/quotes/projects";
import { loadSupplierById } from "@/server/suppliers/profile";
import { postCustomerQuoteMessageAction } from "./actions";
import { CustomerQuoteStatusCtas } from "./CustomerQuoteStatusCtas";
import { CustomerQuoteCompareOffers } from "./CustomerQuoteCompareOffers";
import { CustomerQuoteSelectionConfirmation } from "./CustomerQuoteSelectionConfirmation";
import { CustomerQuoteDecisionCtaRow } from "./CustomerQuoteDecisionCtaRow";
import {
  getCustomerKickoffSummary,
  type CustomerKickoffSummary,
} from "@/server/quotes/kickoffSummary";
import {
  formatKickoffTasksRatio,
  resolveKickoffProgressBasis,
} from "@/lib/quote/kickoffChecklist";
import { KickoffNudgeButton } from "@/app/(portals)/customer/components/KickoffNudgeButton";
import type { QuoteSectionRailSection } from "@/components/QuoteSectionRail";
import { EmptyStateCard } from "@/components/EmptyStateCard";
import { getLatestKickoffNudgedAt } from "@/server/quotes/kickoffNudge";
import { computePartsCoverage } from "@/lib/quote/partsCoverage";
import { loadUnreadMessageSummary } from "@/server/quotes/messageReads";
import { CustomerPartsSection } from "./CustomerPartsSection";
import { CustomerUploadsForm } from "./CustomerUploadsForm";
import { loadCachedAiPartSuggestions } from "@/server/quotes/aiPartsSuggestions";
import { formatMaxUploadSize } from "@/lib/uploads/uploadLimits";
import { computeRfqQualitySummary, type SupplierFeedbackCategory } from "@/server/quotes/rfqQualitySignals";
import { isRfqFeedbackEnabled } from "@/server/quotes/rfqFeedback";
import { schemaGate } from "@/server/db/schemaContract";
import { supabaseServer } from "@/lib/supabaseServer";
import {
  handleMissingSupabaseRelation,
  isMissingTableOrColumnError,
  isSupabaseRelationMarkedMissing,
  serializeSupabaseError,
} from "@/server/admin/logging";
import { getOpsMessageReplyMaxHours, getOpsSlaSettings } from "@/server/ops/settings";
import { computeNeedsReplySummary } from "@/server/messages/needsReply";
import { loadCadFeaturesForQuote } from "@/server/quotes/cadFeatures";
import { CustomerQuoteOrderWorkspace } from "./CustomerQuoteOrderWorkspace";
import {
  deriveQuoteWorkspaceStatus,
} from "@/lib/quote/workspaceStatus";
import { CustomerQuoteJourneyHeaderAuto } from "./CustomerQuoteJourneyHeader";
import { TagPill, type TagPillTone } from "@/components/shared/primitives/TagPill";
import { StatusPill } from "@/components/shared/primitives/StatusPill";
import { SectionHeader } from "@/components/shared/primitives/SectionHeader";
import { RequestChangeScaffold } from "./RequestChangeScaffold";
import { DemoModeBanner } from "./DemoModeBanner";
import { CustomerEmailRepliesCard } from "./CustomerEmailRepliesCard";
import { isCustomerEmailBridgeEnabled, isCustomerEmailOptedIn } from "@/server/quotes/customerEmailPrefs";
import { getCustomerReplyToAddress } from "@/server/quotes/emailBridge";
import { CustomerQuoteMessagesSection } from "./CustomerQuoteMessagesSection";
import { CustomerQuoteMessagesReadMarker } from "./CustomerQuoteMessagesReadMarker";
import { EstimateBandCard } from "@/components/EstimateBandCard";
import { SearchAlertOptInCard } from "@/app/(portals)/customer/components/SearchAlertOptInCard";
import {
  buildPricingEstimate,
  buildPricingEstimateTelemetry,
  parseQuantity,
  type PricingEstimateInput,
} from "@/lib/pricing/estimate";
import {
  SearchActivityFeed,
  buildSearchActivityFeedEvents,
} from "@/components/search/SearchActivityFeed";
import { buildOpsEventSessionKey, logOpsEvent } from "@/server/ops/events";
import { deriveSearchAlertPreferenceFromOpsEvents } from "@/server/ops/searchAlerts";
import { getCustomerSearchAlertPreference } from "@/server/customer/savedSearches";
import { loadCustomerOfferShortlist } from "@/server/customer/offerShortlist";
import { debugOnce } from "@/server/db/schemaErrors";
import { CustomerQuoteIntroRequestCtaRow } from "./CustomerQuoteIntroRequestCtaRow";

export const dynamic = "force-dynamic";

type ChangeRequestsChecklistSummary = {
  label: string;
  value: string;
  status: "Pending" | "Captured";
  tone: TagPillTone;
};

type CustomerQuotePageProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<SearchParamsLike>;
};

export default async function CustomerQuoteDetailPage({
  params,
  searchParams,
}: CustomerQuotePageProps) {
  const [{ id: quoteId }, resolvedSearchParams] = await Promise.all([
    params,
    resolveMaybePromise(searchParams),
  ]);

  const user = await requireCustomerSessionOrRedirect(`/customer/quotes/${quoteId}`);
  const opsEventSessionKey = buildOpsEventSessionKey({
    userId: user.id,
    lastSignInAt: user.last_sign_in_at ?? null,
  });
  const emailParam = getSearchParamValue(resolvedSearchParams, "email");
  const overrideEmail = normalizeEmailInput(emailParam);
  const focusParam = getSearchParamValue(resolvedSearchParams, "focus");
  const tabParam = getSearchParamValue(resolvedSearchParams, "tab");
  const awardSupplierIdParam = getSearchParamValue(resolvedSearchParams, "awardSupplierId");
  const demoParam = getSearchParamValue(resolvedSearchParams, "demo");
  const whatsHappeningParam = getSearchParamValue(resolvedSearchParams, "happening");
  const shortlistedParam = getSearchParamValue(resolvedSearchParams, "shortlisted");
  const loadWhatsHappeningData = whatsHappeningParam === "1";
  const messagesHref = buildQuoteTabHref(resolvedSearchParams, "messages", "#messages");
  const customer = await getCustomerByUserId(user.id);
  const showDemoModeBanner = demoParam === "1";

  if (!customer) {
    return (
      <PortalNoticeCard
        title="Complete your profile"
        description="Complete your customer profile before opening quote workspaces."
        action={
          <Link
            href="/customer"
            className="inline-flex items-center rounded-full bg-emerald-500 px-4 py-2 text-sm font-semibold text-black transition hover:bg-emerald-400"
          >
            Go to customer dashboard
          </Link>
        }
      />
    );
  }

  debugOnce(
    loadWhatsHappeningData
      ? "customer_quote:whats_happening:loaded"
      : "customer_quote:whats_happening:skipped",
    loadWhatsHappeningData
      ? "[customer quote] whats happening datasets enabled"
      : "[customer quote] whats happening datasets skipped",
    {
      quoteId,
      happeningParam: whatsHappeningParam ?? null,
    },
  );

  const workspaceResult = await loadQuoteWorkspaceData(quoteId, {
    safeOnly: true,
    viewerUserId: user.id,
    viewerRole: "customer",
    includeOffers: true,
    includeOpsEvents: loadWhatsHappeningData,
    includeDestinationDetails: loadWhatsHappeningData,
  });
  if (!workspaceResult.ok || !workspaceResult.data) {
    console.error("[customer quote] load failed", {
      quoteId,
      error: workspaceResult.error ?? "Quote not found",
    });
    return (
      <PortalNoticeCard
        title="Quote not found"
        description={`We couldn’t find a search request for that link (Quote ID ${formatQuoteId(
          quoteId,
        )}). Double-check the URL, or return to your Quotes list.`}
        action={
          <Link
            href="/customer/quotes"
            className="inline-flex items-center rounded-full bg-emerald-500 px-4 py-2 text-sm font-semibold text-black transition hover:bg-emerald-400"
          >
            Back to quotes
          </Link>
        }
      />
    );
  }

  const {
    quote,
    uploadMeta,
    uploadGroups,
    filePreviews,
    parts,
    rfqOffers,
    rfqDestinations,
    opsEvents,
    messages: quoteMessages,
    messagesError,
    filesMissingCanonical,
    legacyFileNames,
  } = workspaceResult.data;
  const messagesUnavailable = Boolean(messagesError);
  const [
    customerBidSummariesResult,
    bidsResult,
    projectResult,
    customerKickoffSummary,
  ] = await Promise.all([
    loadCustomerQuoteBidSummaries({
      quoteId: quote.id,
      customerEmail: customer.email,
      userEmail: user.email,
      overrideEmail,
    }),
    loadBidsForQuote(quote.id),
    loadQuoteProjectForQuote(quote.id),
    getCustomerKickoffSummary(quote.id),
  ]);
  const customerBidSummaries = customerBidSummariesResult.ok
    ? customerBidSummariesResult.bids
    : [];
  const customerBidSummariesUnavailable = !customerBidSummariesResult.ok;
  const quoteFiles = Array.isArray(quote.files) ? quote.files : [];
  const fileCount = quote.fileCount ?? quoteFiles.length;
  const normalizedQuoteEmail = normalizeEmailInput(quote.customer_email);
  const customerEmail = normalizeEmailInput(customer.email);
  const quoteCustomerMatches =
    normalizedQuoteEmail !== null &&
    customerEmail !== null &&
    normalizedQuoteEmail === customerEmail;
  const usingOverride =
    Boolean(overrideEmail) && overrideEmail !== customerEmail;
  const overrideMatchesQuote =
    usingOverride &&
    overrideEmail &&
    normalizedQuoteEmail &&
    normalizedQuoteEmail === overrideEmail;

  if (!quoteCustomerMatches && !overrideMatchesQuote) {
    console.error("Customer portal: access denied", {
      quoteId,
      identityEmail: customerEmail,
      overrideEmail,
      quoteEmail: quote.customer_email,
      customerId: customer.id,
    });
    return (
      <PortalNoticeCard
        title="Access denied"
        description="This quote isn’t linked to your account. Confirm you’re signed into the right workspace, or request access from your admin."
        action={
          <Link
            href="/customer/quotes"
            className="inline-flex items-center rounded-full bg-emerald-500 px-4 py-2 text-sm font-semibold text-black transition hover:bg-emerald-400"
          >
            Back to quotes
          </Link>
        }
      />
    );
  }

  const readOnly = usingOverride;
  const derived = deriveQuotePresentation(quote, uploadMeta);
  const { customerName, companyName, intakeNotes } = derived;

  const customerEmailBridgeEnabled = isCustomerEmailBridgeEnabled();
  const customerReplyToResult = customerEmailBridgeEnabled
    ? getCustomerReplyToAddress({ quoteId: quote.id, customerId: customer.id })
    : null;
  const customerReplyToAddress = customerReplyToResult?.ok ? customerReplyToResult.address : "";
  const customerEmailOptedIn = customerEmailBridgeEnabled
    ? await isCustomerEmailOptedIn({ quoteId: quote.id, customerId: customer.id })
    : false;
  const normalizedQuoteStatus = normalizeQuoteStatus(quote.status ?? undefined);
  const quoteStatusLabel = getQuoteStatusLabel(quote.status ?? undefined, {
    copyVariant: "search",
  });
  const nextWorkflowState = getNextWorkflowState(normalizedQuoteStatus);
  const bidsUnavailable = !bidsResult.ok;
  const bids = bidsResult.ok && Array.isArray(bidsResult.data)
    ? (bidsResult.data ?? [])
    : [];
  const hasProject = projectResult.ok;
  const project = hasProject ? projectResult.project : null;
  const projectUnavailable = !hasProject && projectResult.reason !== "not_found";
  const bidCount = bids.length;
  const preselectAwardBidId =
    typeof awardSupplierIdParam === "string" && awardSupplierIdParam.trim().length > 0
      ? customerBidSummaries.find((bid) => bid.supplierId === awardSupplierIdParam)?.id ?? null
      : null;
  const customerBidSummariesError = customerBidSummariesResult.ok
    ? null
    : customerBidSummariesResult.error;
  const customerAwardBidsReady =
    !customerBidSummariesUnavailable && customerBidSummaries.length > 0;
  const quoteIsWon = normalizedQuoteStatus === "won";
  const quoteAwardStatusAllowed =
    normalizedQuoteStatus !== "cancelled" &&
    normalizedQuoteStatus !== "won" &&
    normalizedQuoteStatus !== "lost";
  const statusWinningBid =
    bids.find(
      (bid) =>
        typeof bid.status === "string" &&
        ["won", "accepted", "winner"].includes(
          bid.status.trim().toLowerCase(),
        ),
    ) ?? null;
  const winningBidId =
    quote.awarded_bid_id ??
    (statusWinningBid?.id ?? null);
  const winningBid =
    winningBidId
      ? bids.find((bid) => bid.id === winningBidId) ?? statusWinningBid
      : statusWinningBid;
  const winningSupplierId =
    quote.awarded_supplier_id ??
    (typeof winningBid?.supplier_id === "string"
      ? winningBid.supplier_id
      : null);
  const winningSupplierProfile = winningSupplierId
    ? await loadSupplierById(winningSupplierId)
    : null;
  const winningSupplierName =
    winningSupplierProfile?.company_name?.trim() || "Supplier";
  const quoteHasWinner =
    Boolean(quote.awarded_at) ||
    Boolean(quote.awarded_bid_id) ||
    Boolean(quote.awarded_supplier_id) ||
    Boolean(winningBidId);
  const workspaceStatus = deriveQuoteWorkspaceStatus({
    hasWinner: quoteHasWinner,
    bidCount,
  });
  const nextStepText =
    workspaceStatus === "draft"
      ? "Upload files and request offers to move forward."
      : workspaceStatus === "in_review"
        ? "Offers are in—review options and select a supplier."
        : "Selection confirmed—confirm details and proceed to order.";
  const latestKickoffNudgedAt =
    quoteHasWinner && winningSupplierId
      ? await getLatestKickoffNudgedAt({
          quoteId: quote.id,
          supplierId: winningSupplierId,
        })
      : null;
  const kickoffSummaryStatus =
    quoteHasWinner && customerKickoffSummary.isComplete
      ? "complete"
      : quoteHasWinner
        ? "in-progress"
        : null;
  const kickoffSummaryLabel = quoteHasWinner
    ? customerKickoffSummary.isComplete
      ? "Kickoff complete"
      : "Kickoff in progress"
    : "Select supplier to start kickoff";
  const kickoffChecklistSummaryLabel = quoteHasWinner
    ? customerKickoffSummary.totalTasks > 0
      ? `${customerKickoffSummary.completedTasks} / ${customerKickoffSummary.totalTasks} tasks completed`
      : customerKickoffSummary.isComplete
        ? "All tasks completed"
        : "—"
    : "—";

  const { summary: partsCoverageSummary } = computePartsCoverage(parts ?? []);
  const partsCoverageDetailLabel = partsCoverageSummary.anyParts
    ? partsCoverageSummary.partsNeedingCad > 0 && partsCoverageSummary.partsNeedingDrawing > 0
      ? `${partsCoverageSummary.partsNeedingCad} need CAD • ${partsCoverageSummary.partsNeedingDrawing} need drawings`
      : partsCoverageSummary.partsNeedingCad > 0
        ? `${partsCoverageSummary.partsNeedingCad} need CAD`
        : partsCoverageSummary.partsNeedingDrawing > 0
          ? `${partsCoverageSummary.partsNeedingDrawing} need drawings`
          : "All covered"
    : null;
  const partsCoverageSummaryLine = partsCoverageSummary.anyParts
    ? `${partsCoverageSummary.totalParts} part${partsCoverageSummary.totalParts === 1 ? "" : "s"} • ${partsCoverageSummary.fullyCoveredParts} fully covered • ${partsCoverageDetailLabel}`
    : null;

  const rfqQualitySummary = await computeRfqQualitySummary(quote.id);
  const showRfqQualityHint =
    rfqQualitySummary.partsCoverage === "needs_attention" ||
    rfqQualitySummary.missingCad ||
    rfqQualitySummary.missingDrawings ||
    rfqQualitySummary.score < 80;

  const customerFeedbackCounts: Partial<Record<SupplierFeedbackCategory, number>> = {};
  const customerFeedbackCategoriesToShow: SupplierFeedbackCategory[] = [
    "missing_cad",
    "missing_drawings",
    "scope_unclear",
    "timeline_unrealistic",
  ];
  try {
    if (isRfqFeedbackEnabled() && !isSupabaseRelationMarkedMissing("quote_rfq_feedback")) {
      const hasSchema = await schemaGate({
        enabled: true,
        relation: "quote_rfq_feedback",
        requiredColumns: ["quote_id", "supplier_id", "categories", "created_at"],
        warnPrefix: "[rfq_feedback]",
      });
      if (!hasSchema) {
        // Feature not enabled; keep empty counts.
      } else {
      const { data, error } = await supabaseServer
        .from("quote_rfq_feedback")
        .select("categories,created_at")
        .eq("quote_id", quote.id)
        .order("created_at", { ascending: false })
        .limit(50)
        .returns<Array<{ categories: string[] | null; created_at: string | null }>>();

      if (error) {
        if (
          handleMissingSupabaseRelation({
            relation: "quote_rfq_feedback",
            error,
            warnPrefix: "[rfq_feedback]",
          })
        ) {
          // Feature not enabled; keep empty counts.
        } else if (!isMissingTableOrColumnError(error)) {
          console.warn("[customer quote] quote_rfq_feedback load failed", {
            quoteId: quote.id,
            error: serializeSupabaseError(error) ?? error,
          });
        }
      } else {
        for (const row of data ?? []) {
          const cats = new Set(
            (Array.isArray(row?.categories) ? row.categories : [])
              .map((value) => (typeof value === "string" ? value.trim() : ""))
              .filter(Boolean) as SupplierFeedbackCategory[],
          );
          for (const cat of cats) {
            if (!customerFeedbackCategoriesToShow.includes(cat)) continue;
            customerFeedbackCounts[cat] = (customerFeedbackCounts[cat] ?? 0) + 1;
          }
        }
      }
      }
    }
  } catch (error) {
    if (
      handleMissingSupabaseRelation({
        relation: "quote_rfq_feedback",
        error,
        warnPrefix: "[rfq_feedback]",
      })
    ) {
      // Feature not enabled; keep empty counts.
    } else if (!isMissingTableOrColumnError(error)) {
      console.warn("[customer quote] quote_rfq_feedback load crashed", {
        quoteId: quote.id,
        error: serializeSupabaseError(error) ?? error,
      });
    }
  }

  let changeRequestsChecklistSummary: ChangeRequestsChecklistSummary | null = null;
  try {
    const { data, error } = await supabaseServer
      .from("quote_change_requests")
      .select("id,status,created_at,resolved_at")
      .eq("quote_id", quote.id)
      .order("created_at", { ascending: false })
      .limit(10)
      .returns<
        Array<{
          id: string;
          status: string | null;
          created_at: string | null;
          resolved_at: string | null;
        }>
      >();

    if (error) {
      console.warn("[customer quote] quote_change_requests load failed", {
        quoteId: quote.id,
        error: serializeSupabaseError(error) ?? error,
      });
    } else {
      const rows = Array.isArray(data) ? data : [];
      const hasOpen = rows.some(
        (row) => (row.status ?? "").trim().toLowerCase() === "open",
      );
      const hasResolved = rows.some(
        (row) =>
          (row.status ?? "").trim().toLowerCase() === "resolved" ||
          Boolean(row.resolved_at),
      );

      if (hasOpen) {
        changeRequestsChecklistSummary = {
          label: "Change requests",
          value: "Open",
          status: "Pending",
          tone: "slate",
        };
      } else if (rows.length === 0) {
        changeRequestsChecklistSummary = {
          label: "Change requests",
          value: "None",
          status: "Captured",
          tone: "emerald",
        };
      } else if (hasResolved) {
        changeRequestsChecklistSummary = {
          label: "Change requests",
          value: "Resolved",
          status: "Captured",
          tone: "emerald",
        };
      } else {
        // Fail-soft: unexpected status values; keep existing behavior.
        changeRequestsChecklistSummary = null;
      }
    }
  } catch (error) {
    console.warn("[customer quote] quote_change_requests load crashed", {
      quoteId: quote.id,
      error: serializeSupabaseError(error) ?? error,
    });
    // Fail-soft: keep existing behavior.
    changeRequestsChecklistSummary = null;
  }

  const customerFeedbackAdvisories = customerFeedbackCategoriesToShow
    .map((cat) => {
      const count = customerFeedbackCounts[cat] ?? 0;
      if (!count) return null;
      const label =
        cat === "missing_cad"
          ? "Missing CAD"
          : cat === "missing_drawings"
            ? "Missing drawings"
            : cat === "scope_unclear"
              ? "Unclear scope"
              : cat === "timeline_unrealistic"
                ? "Timeline unrealistic"
                : cat.replace(/[_-]+/g, " ").replace(/^\w/, (m) => m.toUpperCase());
      return { cat, label, count };
    })
    .filter(
      (entry): entry is { cat: SupplierFeedbackCategory; label: string; count: number } =>
        Boolean(entry),
    );

  const kickoffProgressBasis = resolveKickoffProgressBasis({
    kickoffCompletedAt:
      (quote as { kickoff_completed_at?: string | null })?.kickoff_completed_at ??
      null,
    completedCount: customerKickoffSummary.completedTasks ?? null,
    totalCount: customerKickoffSummary.totalTasks ?? null,
  });
  const kickoffTasksRatio = formatKickoffTasksRatio(kickoffProgressBasis);
  const kickoffCompletionLabel = !quoteHasWinner
    ? "Locked"
    : kickoffProgressBasis.isComplete
      ? "Complete"
      : kickoffTasksRatio
        ? `${kickoffTasksRatio} complete`
        : "In progress";
  const kickoffTasksRowValue = kickoffProgressBasis.isComplete
    ? "Complete"
    : kickoffTasksRatio
      ? `In progress (${kickoffTasksRatio})`
      : "In progress";
  const canNudgeSupplier =
    quoteHasWinner && Boolean(winningSupplierId) && !kickoffProgressBasis.isComplete;
  const kickoffSummaryToneClass =
    kickoffSummaryStatus === "complete"
      ? "text-emerald-300"
      : kickoffSummaryStatus === "in-progress"
        ? "text-blue-200"
        : "text-slate-200";
  const kickoffSummaryPillTone: TagPillTone =
    kickoffSummaryStatus === "complete"
      ? "emerald"
      : kickoffSummaryStatus === "in-progress"
        ? "blue"
        : "slate";
  const showCustomerSupplierSection = bidCount > 0;
  const customerCanAward =
    bidCount > 0 && quoteAwardStatusAllowed && !quoteHasWinner && !readOnly;
  let customerAwardDisabledReason: string | null = null;
  if (showCustomerSupplierSection && !customerCanAward) {
    if (readOnly) {
      customerAwardDisabledReason =
        "Selecting a winner is disabled while you are viewing this workspace in read-only mode.";
    } else if (quoteIsWon || quoteHasWinner) {
      customerAwardDisabledReason =
        "A winning supplier has already been selected for this quote.";
    } else if (!quoteAwardStatusAllowed) {
      customerAwardDisabledReason =
        "Selecting a winner is unavailable for closed or archived search requests.";
    }
  }
  const pricedBids = bids.filter(
    (bid): bid is BidRow & { amount: number } => {
      const value = bid.amount;
      return typeof value === "number" && Number.isFinite(value);
    },
  );
  const bestPriceBid = pricedBids.reduce<BidRow & { amount: number } | null>(
    (currentBest, bid) => {
      if (!currentBest || bid.amount < currentBest.amount) {
        return bid;
      }
      return currentBest;
    },
    null,
  );
  const bestPriceValue = bestPriceBid?.amount ?? null;
  const bestPriceCurrency = bestPriceBid?.currency ?? null;
  const leadTimeBids = bids.filter(
    (bid): bid is BidRow & { lead_time_days: number } => {
      const value = bid.lead_time_days;
      return typeof value === "number" && Number.isFinite(value);
    },
  );
  const fastestLeadTime = leadTimeBids.reduce<number | null>(
    (currentBest, bid) => {
      if (currentBest === null || bid.lead_time_days < currentBest) {
        return bid.lead_time_days;
      }
      return currentBest;
    },
    null,
  );
  const submittedAtRaw = quote.created_at ?? null;
  const updatedAtRaw = quote.updated_at ?? null;
  const submittedAtText = submittedAtRaw
    ? formatDateTime(submittedAtRaw, { includeTime: true })
    : null;
  const updatedAtText = updatedAtRaw
    ? formatDateTime(updatedAtRaw, { includeTime: true })
    : null;
  const fileCountText =
    fileCount === 0
      ? "No files attached"
      : fileCount === 1
        ? "1 file attached"
        : `${fileCount} files attached`;
  const dfmNotes = derived.dfmNotes;
  const priceChipText =
    derived.priceValue !== null
      ? `${(derived.currencyValue ?? "USD").toUpperCase()} ${derived.priceValue.toFixed(2)}`
      : "Pricing pending";
  const targetDateChipText = derived.targetDateValue
    ? formatDateTime(derived.targetDateValue)
    : "Not scheduled";
  const cardClasses =
    "rounded-2xl border border-slate-800 bg-slate-950/60 px-5 py-4";
  const identityEmailDisplay =
    (usingOverride && overrideEmail) ||
    quote.customer_email || customer.email || user.email || "customer";

  const primaryFileName =
    filePreviews[0]?.fileName ??
    filePreviews[0]?.label ??
    quote.file_name ??
    quoteFiles[0]?.filename ??
    formatQuoteId(quote.id);
  const intakeProcess =
    typeof uploadMeta?.manufacturing_process === "string" &&
    uploadMeta.manufacturing_process.trim().length > 0
      ? uploadMeta.manufacturing_process.trim()
      : null;
  const intakeQuantity =
    typeof uploadMeta?.quantity === "string" && uploadMeta.quantity.trim().length > 0
      ? uploadMeta.quantity.trim()
      : null;
  const estimateInput = buildEstimateInput({ quote, uploadMeta, fileCount });
  const pricingEstimate = buildPricingEstimate(estimateInput);

  if (pricingEstimate) {
    const telemetry = buildPricingEstimateTelemetry(estimateInput, pricingEstimate);
    void logOpsEvent({
      quoteId: quote.id,
      eventType: "estimate_shown",
      dedupeKey: opsEventSessionKey,
      payload: {
        process: telemetry.process,
        quantity_bucket: telemetry.quantityBucket,
        urgency_bucket: telemetry.urgencyBucket,
        confidence: telemetry.confidence,
      },
    });
  }
  const intakeTargetShipDateLabel = derived.targetDateValue
    ? formatDateTime(derived.targetDateValue)
    : null;
  const intakeMaterial =
    readOptionalUploadMetaString(uploadMeta, [
      "material",
      "material_type",
      "material_name",
    ]) ?? null;
  const intakeFinish =
    readOptionalUploadMetaString(uploadMeta, [
      "finish",
      "surface_finish",
      "surfaceFinish",
    ]) ?? null;
  const intakeMaterialFinishLabel =
    [intakeMaterial, intakeFinish].filter(Boolean).join(" · ") || null;
  const leadTimeLabel =
    fastestLeadTime != null
      ? `${fastestLeadTime} day${fastestLeadTime === 1 ? "" : "s"}`
      : "Pending";
  const bestPriceLabel =
    bestPriceValue != null
      ? formatCurrency(bestPriceValue, bestPriceCurrency ?? undefined)
      : "Pending";
  const selectedOfferId = quote.selected_offer_id ?? null;
  const selectedOffer = selectedOfferId
    ? rfqOffers.find((offer) => offer.id === selectedOfferId) ?? null
    : null;
  const selectionConfirmedAt = quote.selection_confirmed_at ?? null;
  const searchStateSummary = buildSearchStateSummary({
    destinations: rfqDestinations ?? [],
    offers: rfqOffers ?? [],
  });
  const searchStateCounts = searchStateSummary.counts;
  const searchStateTone = searchStateLabelTone(searchStateSummary.status_label);
  const searchProgress = buildSearchProgress({
    counts: searchStateSummary.counts,
    timestamps: searchStateSummary.timestamps,
    statusLabel: searchStateSummary.status_label,
    recommendedAction: searchStateSummary.recommended_action,
    quoteId: quote.id,
  });
  const searchStatusLabel = searchProgress.statusTag;
  const searchStatusMeta = [
    searchProgress.statusDetail,
    searchProgress.lastUpdatedLabel,
  ]
    .filter(Boolean)
    .join(" · ");
  const searchResultsHref = `/customer/search?quote=${quote.id}`;
  const hasSearchOffers = searchStateCounts.offers_total > 0;
  const contactedSuppliersCount = countContactedSuppliers(rfqDestinations ?? []);
  let pendingOffersDescription = "No offers yet. We’ll notify you when quotes arrive.";
  let showSlaNudge = false;
  let slaElapsedLabel: string | null = null;
  let slaResponseTimeLabel: string | null = null;
  if (rfqOffers.length === 0) {
    const slaSettings = await getOpsSlaSettings();
    slaResponseTimeLabel = slaSettings.usingFallback
      ? null
      : formatSlaResponseTime(slaSettings.config.sentNoReplyMaxHours);
    const lastOutreachTimestamp = toTimestamp(
      searchStateSummary.timestamps.last_destination_activity_at,
    );
    slaElapsedLabel = normalizeElapsedLabel(searchProgress.lastUpdatedLabel);
    const thresholdHours = slaSettings.config.sentNoReplyMaxHours;
    const thresholdMs = Number.isFinite(thresholdHours)
      ? thresholdHours * 60 * 60 * 1000
      : null;
    const elapsedMs =
      typeof lastOutreachTimestamp === "number"
        ? Date.now() - lastOutreachTimestamp
        : null;
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
      Boolean(slaElapsedLabel);
  }
  const searchActivityEvents = loadWhatsHappeningData
    ? buildSearchActivityFeedEvents({
        quote: {
          id: quote.id,
          created_at: quote.created_at ?? null,
          updated_at: quote.updated_at ?? null,
        },
        quoteHref: `/customer/quotes/${quote.id}`,
        // Customer view: keep this high-level and avoid supplier-by-supplier outreach mechanics.
        destinations: [],
        offers: rfqOffers ?? [],
        opsEvents: opsEvents ?? [],
        inviteSupplierHref: "/customer/invite-supplier",
        compareOffersHref: rfqOffers.length > 0 ? "#compare-offers" : null,
      })
    : [];

  const savedSearchAlertPreference = await getCustomerSearchAlertPreference({
    customerId: customer.id,
    quoteId: quote.id,
  });
  const opsAlertPreference = deriveSearchAlertPreferenceFromOpsEvents(opsEvents ?? []);
  const searchAlertEnabled =
    savedSearchAlertPreference.supported && savedSearchAlertPreference.hasRow
      ? savedSearchAlertPreference.enabled
      : opsAlertPreference ?? false;

  const offerShortlist = await loadCustomerOfferShortlist({
    customerId: customer.id,
    quoteId: quote.id,
    opsEvents: opsEvents ?? [],
  });
  const shortlistedOfferIds = offerShortlist.offerIds;

  const kickoffTolerances =
    readOptionalUploadMetaString(uploadMeta, [
      "tolerances",
      "tolerance",
      "tolerance_notes",
      "tolerances_notes",
      "toleranceNotes",
    ]) ?? null;

  const kickoffDeliveryDetails =
    readOptionalUploadMetaString(uploadMeta, [
      "delivery_details",
      "delivery",
      "delivery_address",
      "deliveryAddress",
      "shipping_details",
      "shipping_address",
      "shippingAddress",
      "ship_to",
      "shipTo",
      "shipping_notes",
      "shippingNotes",
    ]) ?? null;

  const kickoffPoNumber =
    readOptionalUploadMetaString(uploadMeta, [
      "po_number",
      "poNumber",
      "purchase_order",
      "purchaseOrder",
      "po",
    ]) ?? null;

  const kickoffPaymentMethod =
    readOptionalUploadMetaString(uploadMeta, [
      "payment_method",
      "paymentMethod",
      "payment_terms",
      "paymentTerms",
      "payment",
    ]) ?? null;

  const kickoffPoPaymentMethod = (() => {
    const parts: string[] = [];
    if (kickoffPoNumber) parts.push(`PO ${kickoffPoNumber}`);
    if (kickoffPaymentMethod) parts.push(kickoffPaymentMethod);
    return parts.join(" · ") || null;
  })();

  const kickoffRevisionVersion =
    readOptionalUploadMetaString(uploadMeta, [
      "revision",
      "rev",
      "version",
      "file_revision",
      "fileRevision",
      "file_version",
      "fileVersion",
      "cad_revision",
      "cadRevision",
    ]) ?? null;

  const bidSummaryBadgeLabel = bidsUnavailable
    ? "Offers unavailable"
    : bidCount === 0
      ? "No offers yet"
      : `${bidCount} offer${bidCount === 1 ? "" : "s"}`;
  const bidSummaryHelper = bidsUnavailable
    ? "Offers aren’t available in this workspace right now."
    : bidCount === 0
      ? "Waiting on suppliers to send offers."
      : quoteHasWinner
        ? "Selection confirmed—kickoff tasks are unlocked."
        : "Review pricing and select a supplier to move forward.";
  const winningBidPriceLabel =
    typeof winningBid?.amount === "number"
      ? formatCurrency(winningBid.amount, winningBid.currency ?? undefined)
      : bestPriceLabel;
  const winningBidLeadTimeLabel =
    typeof winningBid?.lead_time_days === "number" &&
    Number.isFinite(winningBid.lead_time_days)
      ? `${winningBid.lead_time_days} day${
          winningBid.lead_time_days === 1 ? "" : "s"
        }`
      : leadTimeLabel;
  const quoteSummarySelectedPriceLabel =
    typeof winningBid?.amount === "number"
      ? formatCurrency(winningBid.amount, winningBid.currency ?? undefined)
      : null;
  const quoteSummaryBestPriceLabel =
    bestPriceValue != null
      ? formatCurrency(bestPriceValue, bestPriceCurrency ?? undefined)
      : null;
  const quoteSummaryPriceLabel = quoteHasWinner
    ? quoteSummarySelectedPriceLabel ?? "—"
    : quoteSummaryBestPriceLabel ?? "—";
  const quoteSummarySelectedLeadTimeLabel =
    typeof winningBid?.lead_time_days === "number" &&
    Number.isFinite(winningBid.lead_time_days)
      ? `${winningBid.lead_time_days} day${winningBid.lead_time_days === 1 ? "" : "s"}`
      : null;
  const quoteSummaryBestLeadTimeLabel =
    fastestLeadTime != null
      ? `${fastestLeadTime} day${fastestLeadTime === 1 ? "" : "s"}`
      : null;
  const quoteSummaryLeadTimeLabel = quoteHasWinner
    ? quoteSummarySelectedLeadTimeLabel ?? "—"
    : quoteSummaryBestLeadTimeLabel ?? "—";
  const awardedAtLabel = quote.awarded_at
    ? formatDateTime(quote.awarded_at, { includeTime: true })
    : null;
  const awardedByLabel = formatAwardedByLabel(quote.awarded_by_role, {
    perspective: "customer",
  });
  const headerTitle = `${customerName ?? "Search request"} · ${formatQuoteId(quote.id)}`;
  const headerActions = (
    <div className="flex flex-wrap items-center gap-2">
      <CustomerQuoteStatusCtas
        quoteId={quote.id}
        status={normalizedQuoteStatus}
        disabled={readOnly}
      />
      <Link
        href="/customer/invite-supplier"
        className="inline-flex items-center rounded-full border border-slate-800 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-200 transition hover:border-slate-600 hover:text-white"
      >
        Invite your supplier
      </Link>
      <Link
        href="/customer/quotes"
        className="inline-flex items-center rounded-full border border-emerald-400/40 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-emerald-100 transition hover:border-emerald-300 hover:text-white"
      >
        Back to quotes
      </Link>
    </div>
  );
  const createdAtDate = submittedAtRaw ? new Date(submittedAtRaw) : null;
  const quoteAgeInDays =
    createdAtDate && Number.isFinite(createdAtDate.getTime())
      ? Math.floor(
          (Date.now() - createdAtDate.getTime()) / (1000 * 60 * 60 * 24),
        )
      : null;
  const shouldShowReceiptBanner =
    (normalizedQuoteStatus === "submitted" ||
      normalizedQuoteStatus === "in_review") &&
    (quoteAgeInDays === null || quoteAgeInDays <= 14);

  const unreadSummary = await loadUnreadMessageSummary({
    quoteIds: [quote.id],
    userId: user.id,
  });
  const messagesUnreadCount = unreadSummary[quote.id]?.unreadCount ?? 0;

  const cachedAiSuggestions = await loadCachedAiPartSuggestions(quote.id);
  const cadFeaturesByFileId = await loadCadFeaturesForQuote(quote.id);
  const showCadDfMHint = Object.values(cadFeaturesByFileId).some((f) => {
    const flags = Array.isArray(f?.dfmFlags) ? f.dfmFlags : [];
    return flags.includes("very_large") || flags.includes("very_complex");
  });

  const winningBidCallout = quoteHasWinner ? (
    <div className="rounded-xl border border-emerald-500/60 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
      <div className="flex flex-wrap items-center gap-2">
        <TagPill size="sm" tone="emerald">
          Selection confirmed
        </TagPill>
        {awardedAtLabel ? (
          <span className="text-xs uppercase tracking-wide text-emerald-200">
            Awarded {awardedAtLabel}
          </span>
        ) : null}
      </div>
      <p className="mt-2 text-base font-semibold text-white">
        {winningSupplierName ?? "Selection confirmed"}
      </p>
      <p className="text-xs text-emerald-100">
        {winningBidPriceLabel} &middot; Lead time {winningBidLeadTimeLabel}
      </p>
      <p className="mt-1 text-xs text-emerald-200">
        Awarded by: {awardedByLabel}
      </p>
    </div>
  ) : null;

  const bidSummaryPanel = (
    <div className="space-y-3 rounded-2xl border border-slate-900/60 bg-slate-950/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
            Offer summary
          </p>
          <p className="text-sm text-slate-300">{bidSummaryHelper}</p>
        </div>
        <TagPill size="md" tone="slate" className="normal-case tracking-normal">
          {bidSummaryBadgeLabel}
        </TagPill>
      </div>
      <dl className="grid gap-3 text-sm text-slate-200 sm:grid-cols-3">
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Offers received
          </dt>
          <dd className="text-slate-100">{bidSummaryBadgeLabel}</dd>
        </div>
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Best price
          </dt>
          <dd className="text-slate-100">{bestPriceLabel}</dd>
        </div>
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Fastest lead time
          </dt>
          <dd className="text-slate-100">{leadTimeLabel}</dd>
        </div>
      </dl>
      {winningBidCallout}
    </div>
  );

  const summaryCard = (
    <section className={clsx(cardClasses, "space-y-5")}>
      <header className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Search request snapshot
        </p>
        <h2 className="text-lg font-semibold text-white">Project overview</h2>
      </header>
      <div className="flex flex-wrap gap-2">
        <TagPill size="md" tone="emerald" className="normal-case tracking-normal">
          Status: {quoteStatusLabel}
        </TagPill>
        <TagPill size="md" tone="slate" className="normal-case tracking-normal">
          Target date: {targetDateChipText}
        </TagPill>
        <TagPill size="md" tone="slate" className="normal-case tracking-normal">
          Estimate: {priceChipText}
        </TagPill>
      </div>
      <WorkflowStatusCallout
        currentLabel={quoteStatusLabel}
        nextState={nextWorkflowState}
      />
      {bidSummaryPanel}
      <dl className="grid gap-3 text-sm text-slate-300 sm:grid-cols-2">
        <div className="rounded-xl border border-slate-900/60 bg-slate-950/40 px-3 py-2">
          <dt className="text-[11px] uppercase tracking-wide text-slate-500">
            Files attached
          </dt>
          <dd className="text-slate-100">{fileCountText}</dd>
        </div>
        <div className="rounded-xl border border-slate-900/60 bg-slate-950/40 px-3 py-2">
          <dt className="text-[11px] uppercase tracking-wide text-slate-500">
            Submitted
          </dt>
          <dd className="text-slate-100">{submittedAtText ?? "—"}</dd>
        </div>
        <div className="rounded-xl border border-slate-900/60 bg-slate-950/40 px-3 py-2">
          <dt className="text-[11px] uppercase tracking-wide text-slate-500">
            Kickoff checklist
          </dt>
          <dd className={clsx("font-medium", kickoffSummaryToneClass)}>
            Kickoff: {kickoffCompletionLabel}
          </dd>
        </div>
        <div className="rounded-xl border border-slate-900/60 bg-slate-950/40 px-3 py-2">
          <dt className="text-[11px] uppercase tracking-wide text-slate-500">
            Last updated
          </dt>
          <dd className="text-slate-100">{updatedAtText ?? "—"}</dd>
        </div>
        <div className="rounded-xl border border-slate-900/60 bg-slate-950/40 px-3 py-2">
          <dt className="text-[11px] uppercase tracking-wide text-slate-500">
            Estimate
          </dt>
          <dd className="text-slate-100">{priceChipText}</dd>
        </div>
      </dl>
      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            DFM notes
          </p>
          <p className="mt-1 whitespace-pre-line break-words text-sm text-slate-200">
            {dfmNotes ?? "Engineering feedback will show up here once it’s ready."}
          </p>
        </div>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Intake notes
          </p>
          <p className="mt-1 whitespace-pre-line break-words text-sm text-slate-200">
            {intakeNotes ?? "No additional notes captured during upload."}
          </p>
        </div>
      </div>
      <div className="space-y-3 rounded-2xl border border-slate-900/60 bg-slate-950/30 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
              Offers
            </p>
            <p className="text-sm text-slate-300">
              We collect offers from vetted suppliers, then review options before finalizing your quote.
            </p>
          </div>
          {bidCount > 0 ? (
            <TagPill size="md" tone="emerald" className="normal-case tracking-normal">
              {bidCount} offer{bidCount === 1 ? "" : "s"} received
            </TagPill>
          ) : null}
        </div>
        {bidsUnavailable ? (
          <p className="text-xs text-slate-400">
            Offers aren’t available here right now, but your search request is still saved and in
            review. Check Messages for updates.
          </p>
        ) : bidCount === 0 ? (
          <EmptyStateCard
            title="No offers yet"
            description="Next, suppliers will review your files and we’ll message you here if anything needs clarification."
            action={{ label: "Open messages", href: messagesHref }}
          />
        ) : (
          <>
            <dl className="grid gap-3 text-sm text-slate-200 sm:grid-cols-3">
              <div>
                <dt className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                  Best price
                </dt>
                <dd className="mt-1">
                  {bestPriceValue != null
                    ? formatCurrency(bestPriceValue, bestPriceCurrency ?? undefined)
                    : "Pending"}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                  Fastest lead time
                </dt>
                <dd className="mt-1">
                  {fastestLeadTime != null ? leadTimeLabel : "Pending"}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                  Total offers
                </dt>
                <dd className="mt-1">
                  {bidCount} offer{bidCount === 1 ? "" : "s"}
                </dd>
              </div>
            </dl>
            {showCustomerSupplierSection ? (
              customerAwardBidsReady ? (
                <>
                  {partsCoverageSummary.anyParts && !partsCoverageSummary.allCovered ? (
                    <p className="rounded-xl border border-slate-800 bg-slate-950/60 px-5 py-3 text-xs text-slate-300">
                      Note: Some parts are missing CAD or drawings. You can still award, but clarify scope in kickoff.
                    </p>
                  ) : null}
                  <CustomerQuoteAwardPanel
                    quoteId={quote.id}
                    bids={customerBidSummaries}
                    canSubmit={customerCanAward}
                    disableReason={customerAwardDisabledReason}
                    winningBidId={winningBidId}
                    awardedAt={quote.awarded_at ?? null}
                    anchorId="award"
                    preselectBidId={preselectAwardBidId}
                  />
                </>
              ) : (
                <p className="rounded-xl border border-yellow-500/30 bg-yellow-500/5 px-5 py-3 text-xs text-yellow-100">
                  {customerBidSummariesError ??
                    "We couldn’t load offer details. Refresh to try again."}
                </p>
              )
            ) : null}
          </>
        )}
      </div>
    </section>
  );

  const receiptBanner = shouldShowReceiptBanner ? (
    <section className="rounded-2xl border border-slate-800 bg-slate-950/50 px-6 py-5">
      <div className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Early search update
        </p>
        <h2 className="text-lg font-semibold text-white">We&apos;ve got your search request.</h2>
      </div>
      <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-slate-200">
        <li>
          We&apos;re contacting vetted suppliers who match your process and volumes.
        </li>
        <li>You&apos;ll start seeing offers here as suppliers respond.</li>
        <li>Once we review offers, we&apos;ll prepare pricing and move the status to Offers ready.</li>
      </ul>
      <p className="mt-3 text-xs text-slate-400">
        You&apos;re never obligated to award—move forward only when price, lead time, and supplier fit feel right.
      </p>
    </section>
  ) : null;

  const projectSection = quoteIsWon ? (
    <CustomerQuoteProjectCard
      quoteId={quote.id}
      project={project}
      readOnly={readOnly}
      projectUnavailable={projectUnavailable}
    />
  ) : (
    <PortalCard
      title="Project kickoff"
      description="Add PO details and ship dates once you select a supplier."
    >
      <p className="text-sm text-slate-300">
        Select supplier to unlock the kickoff form. We&apos;ll collect PO numbers, target ship
        dates, and any final notes right here.
      </p>
    </PortalCard>
  );

  const projectSnapshotCard =
    hasProject && project ? (
      <CustomerProjectSnapshotCard
        project={project}
        projectUnavailable={projectUnavailable}
        winningSupplierName={winningSupplierName}
        winningBidAmountLabel={winningBidPriceLabel}
        winningBidLeadTimeLabel={winningBidLeadTimeLabel}
        kickoffCompletionLabel={kickoffCompletionLabel}
        kickoffSummaryStatus={kickoffSummaryStatus}
      />
    ) : null;

  const postMessageAction = postCustomerQuoteMessageAction.bind(null, quote.id);

  const orderWorkspaceSection = (
    <CustomerQuoteOrderWorkspace
      files={quote.files}
      previews={filePreviews}
      partName={primaryFileName}
      supplierName={winningSupplierName ?? null}
      priceLabel={winningBidPriceLabel}
      targetDate={derived.targetDateValue ?? null}
      hasWinner={quoteHasWinner}
      workspaceStatus={workspaceStatus}
    />
  );

  const quoteDetailsSection = (
    <DisclosureSection
      id="details"
      className="scroll-mt-24"
      title="Details"
      description="Status, key dates, and workflow snapshot."
      defaultOpen={false}
      summary={
        <TagPill size="md" tone="slate" className="normal-case tracking-normal">
          {quoteStatusLabel}
        </TagPill>
      }
    >
      <div className="space-y-6">
        <div className="flex flex-wrap gap-2">
          <TagPill size="md" tone="emerald" className="normal-case tracking-normal">
            Status: {quoteStatusLabel}
          </TagPill>
          <TagPill size="md" tone="slate" className="normal-case tracking-normal">
            Target date: {targetDateChipText}
          </TagPill>
          <TagPill size="md" tone="slate" className="normal-case tracking-normal">
            Estimate: {priceChipText}
          </TagPill>
        </div>

        <WorkflowStatusCallout
          currentLabel={quoteStatusLabel}
          nextState={nextWorkflowState}
        />

        <dl className="grid gap-3 text-sm text-slate-300 sm:grid-cols-2">
          <div className="rounded-xl border border-slate-900/60 bg-slate-950/40 px-3 py-2">
            <dt className="text-[11px] uppercase tracking-wide text-slate-500">
              Customer
            </dt>
            <dd className="text-slate-100">{customerName ?? "Not provided"}</dd>
          </div>
          <div className="rounded-xl border border-slate-900/60 bg-slate-950/40 px-3 py-2">
            <dt className="text-[11px] uppercase tracking-wide text-slate-500">
              Company
            </dt>
            <dd className="text-slate-100">{companyName ?? "Not provided"}</dd>
          </div>
          <div className="rounded-xl border border-slate-900/60 bg-slate-950/40 px-3 py-2">
            <dt className="text-[11px] uppercase tracking-wide text-slate-500">
              Files attached
            </dt>
            <dd className="text-slate-100">{fileCountText}</dd>
          </div>
          <div className="rounded-xl border border-slate-900/60 bg-slate-950/40 px-3 py-2">
            <dt className="text-[11px] uppercase tracking-wide text-slate-500">
              Submitted
            </dt>
            <dd className="text-slate-100">{submittedAtText ?? "—"}</dd>
          </div>
          <div className="rounded-xl border border-slate-900/60 bg-slate-950/40 px-3 py-2">
            <dt className="text-[11px] uppercase tracking-wide text-slate-500">
              Estimate
            </dt>
            <dd className="text-slate-100">{priceChipText}</dd>
          </div>
          <div className="rounded-xl border border-slate-900/60 bg-slate-950/40 px-3 py-2">
            <dt className="text-[11px] uppercase tracking-wide text-slate-500">
              Last updated
            </dt>
            <dd className="text-slate-100">{updatedAtText ?? "—"}</dd>
          </div>
        </dl>
      </div>
    </DisclosureSection>
  );

  const filesSection = (
    <DisclosureSection
      id="uploads"
      className="scroll-mt-24"
      title="Uploads"
      description={`CAD and drawings are collected here. You can then link them to parts in the Parts section below. Max ${formatMaxUploadSize()} per file. Very large packages may need to be split into multiple uploads.`}
      defaultOpen={fileCount > 0}
      summary={
        <TagPill size="md" tone="slate" className="normal-case tracking-normal">
          {fileCountText}
        </TagPill>
      }
    >
      <div className="space-y-6">
        {showCadDfMHint ? (
          <p className="rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-3 text-sm text-slate-200">
            Some CAD files look <span className="font-semibold text-slate-100">very large or complex</span>. You may see higher prices or longer lead times on these parts.
          </p>
        ) : null}
        {!readOnly ? <CustomerUploadsForm quoteId={quote.id} /> : null}
        <QuoteFilesUploadsSection
          files={filePreviews}
          fileCountText={fileCountText}
          uploadGroups={uploadGroups}
          parts={parts ?? []}
          filesMissingCanonical={Boolean(filesMissingCanonical)}
          legacyFileNames={legacyFileNames}
          partsSection={
            readOnly ? undefined : (
              <CustomerPartsSection
                quoteId={quote.id}
                parts={parts ?? []}
                uploadGroups={uploadGroups ?? []}
                aiSuggestions={cachedAiSuggestions?.suggestions ?? null}
                aiModelVersion={cachedAiSuggestions?.modelVersion ?? null}
              />
            )
          }
        />
      </div>
    </DisclosureSection>
  );

  const notesSection = (
    <CollapsibleCard
      title="Notes"
      description="DFM feedback and any intake notes captured with the upload."
      defaultOpen={false}
    >
      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            DFM notes
          </p>
          <p className="mt-1 whitespace-pre-line break-words text-sm text-slate-200">
            {dfmNotes ?? "Engineering feedback will show up here once it’s ready."}
          </p>
        </div>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Intake notes
          </p>
          <p className="mt-1 whitespace-pre-line break-words text-sm text-slate-200">
            {intakeNotes ?? "No additional notes captured during upload."}
          </p>
        </div>
      </div>
    </CollapsibleCard>
  );

  const decisionSection = (
    <DisclosureSection
      id="decision"
      hashAliases={["award"]}
      className="scroll-mt-24"
      title="Decision"
      description="Once offers arrive, compare options and select a supplier."
      defaultOpen={bidCount > 0 && !quoteHasWinner}
      summary={
        quoteHasWinner ? (
          <TagPill size="md" tone="emerald">
            Winner
          </TagPill>
        ) : bidCount > 0 ? (
          <TagPill size="md" tone="slate" className="normal-case tracking-normal">
            {bidCount} offer{bidCount === 1 ? "" : "s"}
          </TagPill>
        ) : (
          <TagPill size="md" tone="slate" className="normal-case tracking-normal">
            No offers
          </TagPill>
        )
      }
    >
      <div className="space-y-6">
        {customerFeedbackAdvisories.length > 0 ? (
          <div className="rounded-2xl border border-slate-800 bg-slate-950/60 px-5 py-4">
            <p className="text-sm font-semibold text-slate-100">
              Suppliers flagged the following issues on previous search requests like this one:
            </p>
            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-slate-200">
              {customerFeedbackAdvisories.map((entry) => (
                <li key={entry.cat}>
                  {entry.label} ({entry.count})
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-slate-500">
              This is advisory only — you can still proceed, but adding missing details may increase supplier response.
            </p>
          </div>
        ) : null}
        {showRfqQualityHint ? (
          <div className="rounded-2xl border border-amber-500/25 bg-amber-500/5 px-5 py-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-amber-100">
                  Your search request may get fewer offers.
                </p>
                <p className="mt-1 text-xs text-amber-100/80">
                  Improving completeness can increase supplier response rate.
                </p>
              </div>
              <TagPill size="md" tone="amber" className="normal-case tracking-normal">
                Quality score {rfqQualitySummary.score}
              </TagPill>
            </div>
            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-slate-200">
              {rfqQualitySummary.missingCad || rfqQualitySummary.partsCoverage === "none" ? (
                <li>Add CAD models</li>
              ) : null}
              {rfqQualitySummary.missingDrawings || rfqQualitySummary.partsCoverage === "none" ? (
                <li>Add technical drawings</li>
              ) : null}
              {rfqQualitySummary.suppliersRequestedClarification > 0 ||
              rfqQualitySummary.signals.some((s) => s.category === "scope_unclear") ? (
                <li>Clarify scope in messages</li>
              ) : null}
              {rfqQualitySummary.partsCoverage === "needs_attention" ? (
                <li>Link files to parts so suppliers know what’s complete</li>
              ) : null}
              {rfqQualitySummary.score < 80 &&
              rfqQualitySummary.partsCoverage === "good" &&
              !rfqQualitySummary.missingCad &&
              !rfqQualitySummary.missingDrawings &&
              rfqQualitySummary.suppliersRequestedClarification === 0 ? (
                <li>Clarify scope in messages</li>
              ) : null}
            </ul>
          </div>
        ) : null}
        {bidSummaryPanel}
      </div>
    </DisclosureSection>
  );

  const suppliersContactedLabel = `${contactedSuppliersCount} supplier${
    contactedSuppliersCount === 1 ? "" : "s"
  } contacted`;
  const searchStatusTimestamp =
    searchProgress.lastUpdatedLabel ??
    (updatedAtText ? `Last updated ${updatedAtText}` : null);

  const whatsHappeningSummaryCard = (
    <section className="rounded-2xl border border-slate-900/60 bg-slate-950/40 px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Status
            </span>
            <TagPill size="sm" tone={searchStateTone} className="normal-case tracking-normal">
              {searchStatusLabel}
            </TagPill>
          </div>
          {searchStatusMeta ? (
            <p className="text-xs text-slate-400">{searchStatusMeta}</p>
          ) : null}
        </div>
        <dl className="grid gap-2 text-right text-xs text-slate-300 sm:grid-cols-3">
          <div>
            <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Suppliers contacted
            </dt>
            <dd className="text-sm font-semibold text-slate-100">{contactedSuppliersCount}</dd>
          </div>
          <div>
            <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Offers received
            </dt>
            <dd className="text-sm font-semibold text-slate-100">{rfqOffers.length}</dd>
          </div>
          <div>
            <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Awaiting replies
            </dt>
            <dd className="text-sm font-semibold text-slate-100">
              {Math.max(searchStateCounts.destinations_pending, 0)}
            </dd>
          </div>
        </dl>
      </div>
      {searchStatusTimestamp ? (
        <p className="mt-2 text-xs text-slate-400">{searchStatusTimestamp}</p>
      ) : null}
    </section>
  );

  const searchLoopSection = (
    <CollapsibleCard
      title="What’s happening with my request?"
      description="High-level progress and recent updates."
      defaultOpen={loadWhatsHappeningData}
      urlParamKey="happening"
      contentClassName="space-y-4"
    >
      {loadWhatsHappeningData ? (
        <>
          {whatsHappeningSummaryCard}
          <SearchActivityFeed
            events={searchActivityEvents}
            description="Recent updates as offers arrive."
            maxVisible={3}
          />
          {showSlaNudge ? (
            <section className="rounded-2xl border border-amber-500/25 bg-amber-500/5 px-4 py-3 text-sm text-amber-100">
              <p className="font-semibold text-white">No supplier replies yet.</p>
              <p className="mt-1 text-xs text-amber-100/80">
                {slaElapsedLabel ? `It’s been ${slaElapsedLabel} since outreach. ` : ""}
                {slaResponseTimeLabel
                  ? `We typically follow up if we don’t hear back in ~${slaResponseTimeLabel}.`
                  : "We’ll keep following up and notify you as soon as offers arrive."}
              </p>
            </section>
          ) : null}
          <SearchAlertOptInCard
            quoteId={quote.id}
            initialEnabled={searchAlertEnabled}
            quoteLabel={primaryFileName}
            disabled={readOnly}
            disabledReason={readOnly ? "Search alerts are read-only in this view." : undefined}
          />
        </>
      ) : (
        <div className="rounded-xl border border-dashed border-slate-800/70 bg-black/30 px-4 py-3 text-sm text-slate-400">
          Open this section to load recent updates and progress.
        </div>
      )}
    </CollapsibleCard>
  );

  const estimateBandCard = (
    <EstimateBandCard estimate={pricingEstimate} className="rounded-2xl px-5 py-4" />
  );

  const awardedSupplierCard = quoteHasWinner ? (
    <PortalCard
      title="Awarded supplier"
      description="Your selection is recorded. Next: contact the awarded supplier to confirm scope and timing."
      action={
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={messagesHref}
            className="inline-flex items-center rounded-full bg-emerald-500 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-black transition hover:bg-emerald-400"
          >
            Contact awarded supplier
          </Link>
          <a
            href="#kickoff"
            className="inline-flex items-center rounded-full border border-slate-800 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-200 transition hover:border-slate-600 hover:text-white"
          >
            View kickoff
          </a>
        </div>
      }
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <TagPill size="md" tone="emerald" className="normal-case tracking-normal">
            Awarded
          </TagPill>
          {awardedAtLabel ? (
            <span className="text-xs uppercase tracking-wide text-emerald-200">
              Awarded {awardedAtLabel}
            </span>
          ) : null}
        </div>
        <p className="text-base font-semibold text-white">{winningSupplierName ?? "Supplier"}</p>
        <p className="text-xs text-slate-300">
          {winningBidPriceLabel} &middot; Lead time {winningBidLeadTimeLabel}
        </p>
      </div>
    </PortalCard>
  ) : null;

  const decisionHelperCopy = hasSearchOffers
    ? "We'll connect you to finalize details and confirm pricing."
    : null;
  const shortlistOnlyMode = parseToggle(shortlistedParam ?? null);
  const decisionPrimaryCta = hasSearchOffers
    ? { label: "Request introduction", href: "#" }
    : { label: "Invite your supplier", href: "/customer/invite-supplier" };
  const decisionSecondaryCta = hasSearchOffers
    ? { label: "Share", kind: "share" as const }
    : showSlaNudge
      ? { label: "Share", kind: "share" as const }
      : null;
  const decisionCtaRow = quoteHasWinner ? (
    <CustomerQuoteDecisionCtaRow
      statusLabel="Awarded"
      helperCopy={`Awarded to ${winningSupplierName}. Contact your awarded supplier to confirm details.`}
      primary={{ label: "Contact awarded supplier", href: messagesHref }}
      secondary={{ label: "View kickoff", href: "#kickoff" }}
      sharePath={searchResultsHref}
    />
  ) : hasSearchOffers ? (
    <CustomerQuoteIntroRequestCtaRow
      quoteId={quote.id}
      offers={rfqOffers}
      shortlistedOfferIds={shortlistedOfferIds}
      shortlistOnlyMode={shortlistOnlyMode}
      defaultEmail={customer.email ?? user.email ?? quote.customer_email ?? null}
      defaultCompany={companyName ?? null}
      statusLabel={searchProgress.statusTag}
      helperCopy={decisionHelperCopy}
      secondary={decisionSecondaryCta}
      sharePath={searchResultsHref}
    />
  ) : (
    <CustomerQuoteDecisionCtaRow
      statusLabel={searchProgress.statusTag}
      helperCopy={decisionHelperCopy}
      primary={decisionPrimaryCta}
      secondary={decisionSecondaryCta}
      sharePath={searchResultsHref}
    />
  );

  const compareOffersSection = (
    <DisclosureSection
      id="compare-offers"
      className="scroll-mt-24"
      title="Compare Offers"
      description="Review supplier offers and pick a best-fit option."
      defaultOpen={rfqOffers.length > 0}
      summary={
        <TagPill
          size="md"
          tone={rfqOffers.length > 0 ? "emerald" : "slate"}
          className="normal-case tracking-normal"
        >
          {rfqOffers.length > 0
            ? `${rfqOffers.length} offer${rfqOffers.length === 1 ? "" : "s"}`
            : "No offers"}
        </TagPill>
      }
    >
      {rfqOffers.length === 0 ? (
        <EmptyStateCard
          title="Offers are on the way"
          description={pendingOffersDescription}
          tone="info"
        />
      ) : (
        <CustomerQuoteCompareOffers
          quoteId={quote.id}
          offers={rfqOffers}
          selectedOfferId={selectedOfferId}
          shortlistedOfferIds={shortlistedOfferIds}
          awardLocked={quoteHasWinner}
          awardLockedCopy={
            quoteHasWinner
              ? `This request has been awarded to ${winningSupplierName}. Offers are shown for reference.`
              : null
          }
          matchContext={{ matchedOnProcess: Boolean(intakeProcess), locationFilter: null }}
        />
      )}
    </DisclosureSection>
  );

  const selectionConfirmedSection =
    selectedOfferId ? (
      <DisclosureSection
        id="selection-confirmed"
        className="scroll-mt-24"
        title="Selection confirmed"
        description="Confirm supplier details and draft the award pack."
        defaultOpen
        summary={
          <TagPill size="md" tone={selectionConfirmedAt ? "emerald" : "slate"}>
            {selectionConfirmedAt ? "Confirmed" : "Pending"}
          </TagPill>
        }
      >
        <CustomerQuoteSelectionConfirmation
          quoteId={quote.id}
          selectedOffer={selectedOffer}
          selectionConfirmedAt={selectionConfirmedAt}
          poNumber={quote.po_number ?? null}
          shipTo={quote.ship_to ?? null}
          inspectionRequirements={quote.inspection_requirements ?? null}
          files={filePreviews}
          readOnly={readOnly}
        />
      </DisclosureSection>
    ) : null;

  const kickoffSection = (
    <DisclosureSection
      id="kickoff"
      className="scroll-mt-24"
      title="Kickoff"
      description="Track the final confirmations between selection and ordering."
      defaultOpen={quoteHasWinner}
    >
      <div className="space-y-6">
        {fileCount === 0 ? (
          <EmptyStateCard
            title="Upload files to begin kickoff later"
            description="Kickoff is ready when you are. Upload CAD/drawings now, then return after selection to confirm final details."
            action={{ label: "Go to uploads", href: "#uploads" }}
          />
        ) : bidCount === 0 ? (
          <EmptyStateCard
            title="Kickoff starts after selection"
            description="Once a supplier is selected, kickoff will track final confirmations before ordering."
            action={{ label: "Open messages", href: messagesHref }}
          />
        ) : !quoteHasWinner ? (
          <EmptyStateCard
            title="Kickoff starts after selection"
            description="Compare offers to confirm a supplier. Kickoff becomes available right after."
            action={{ label: "Go to compare offers", href: "#compare-offers" }}
          />
        ) : (
          <KickoffChecklistCard
            quoteId={quote.id}
            readOnly={readOnly}
            messagesHref={messagesHref}
            workspaceStatus={workspaceStatus}
            selectedSupplierName={winningSupplierName ?? null}
            changeRequestsChecklistSummary={changeRequestsChecklistSummary}
            materialFinish={intakeMaterialFinishLabel}
            tolerances={kickoffTolerances}
            shipDate={intakeTargetShipDateLabel}
            deliveryDetails={kickoffDeliveryDetails}
            poOrPaymentMethod={kickoffPoPaymentMethod}
            revisionOrVersion={kickoffRevisionVersion}
          />
        )}
      </div>
    </DisclosureSection>
  );

  const timelineSection = (
    <DisclosureSection
      id="timeline"
      className="scroll-mt-24"
      title="Timeline"
      description="Updates and milestones for this search request."
      defaultOpen={tabParam === "activity"}
    >
      <QuoteTimeline
        quoteId={quote.id}
        actorRole="customer"
        actorUserId={user.id}
        emptyState="Updates will appear here as files, offers, and introductions progress."
      />
    </DisclosureSection>
  );

  const sectionRailSections = buildCustomerQuoteSections({
    bidCount,
    hasWinner: quoteHasWinner,
    offerCount: rfqOffers.length,
    kickoffRatio: kickoffTasksRatio,
    kickoffComplete: kickoffProgressBasis.isComplete,
    messageCount: quoteMessages.length,
    unreadCount: messagesUnreadCount,
    fileCount,
    messagesHref,
  });

  const messageReplyMaxHours = await getOpsMessageReplyMaxHours();
  const customerSupplierNeedsReply = computeNeedsReplySummary(quoteMessages, {
    slaWindowHours: messageReplyMaxHours,
  });

  return (
    <PortalShell
      workspace="customer"
      title={headerTitle}
      actions={headerActions}
    >
      <FocusScroll enabled={focusParam === "award"} targetId="award" />
      <FocusTabScroll tab={tabParam} when="activity" targetId="timeline" />
      <FocusTabScroll tab={tabParam} when="messages" targetId="messages" />
      {showDemoModeBanner ? <DemoModeBanner /> : null}
      <div className="space-y-6">
        {awardedSupplierCard}
        {decisionCtaRow}
        {compareOffersSection}
        {searchLoopSection}
        {selectionConfirmedSection}
        {estimateBandCard}
        {orderWorkspaceSection}
        {rfqOffers.length === 0 ? decisionSection : null}
        {kickoffSection}
        {messagesUnavailable ? (
          <p className="rounded-xl border border-yellow-500/30 bg-yellow-500/5 px-5 py-3 text-sm text-yellow-100">
            Messages are temporarily unavailable right now. Your search request is still
            saved—refresh to try again.
          </p>
        ) : null}
        <DisclosureSection
          id="messages"
          className="scroll-mt-24"
          title="Messages"
          description="Shared thread with your supplier and the Zartman team."
          defaultOpen={tabParam === "messages"}
          summary={
            quoteMessages.length > 0 ? (
              <TagPill size="md" tone="slate" className="normal-case tracking-normal">
                {quoteMessages.length} message{quoteMessages.length === 1 ? "" : "s"}
              </TagPill>
            ) : (
              <TagPill size="md" tone="slate" className="normal-case tracking-normal">
                No messages
              </TagPill>
            )
          }
        >
          <CustomerQuoteMessagesReadMarker
            quoteId={quote.id}
            enabled={tabParam === "messages"}
            currentUserId={user.id}
          />
          {customerSupplierNeedsReply.supplierOwesReply ? (
            <p className="rounded-xl border border-slate-900/60 bg-slate-950/30 px-5 py-3 text-sm text-slate-200">
              Waiting for supplier reply.
            </p>
          ) : customerSupplierNeedsReply.customerOwesReply ? (
            <p className="rounded-xl border border-slate-900/60 bg-slate-950/30 px-5 py-3 text-sm text-slate-200">
              Supplier is waiting for your reply.
            </p>
          ) : null}
          <div id="email-replies">
            <CustomerEmailRepliesCard
              quoteId={quote.id}
              initialOptedIn={customerEmailOptedIn}
              bridgeEnabled={customerEmailBridgeEnabled}
              replyToAddress={customerReplyToAddress}
            />
          </div>
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-slate-900/60 bg-slate-950/30 px-5 py-4">
            <div className="max-w-[46rem]">
              <p className="text-sm font-semibold text-white">Need to request a change?</p>
              <p className="mt-1 text-xs text-slate-400">
                Submit a change request and we’ll coordinate next steps here in Messages.
              </p>
            </div>
            <RequestChangeScaffold
              quoteId={quote.id}
              messagesHref={messagesHref}
              disabled={readOnly}
            />
          </div>
          <CustomerQuoteMessagesSection
            quoteId={quote.id}
            messages={quoteMessages}
            currentUserId={user.id}
            canPost={!readOnly}
            postAction={postMessageAction}
          />
        </DisclosureSection>

        {filesSection}
        {quoteDetailsSection}
        {timelineSection}
        {notesSection}
      </div>
    </PortalShell>
  );
}

function QuoteSummaryCard({
  partName,
  priceLabel,
  leadTimeLabel,
  updatedAtText,
  className,
}: {
  partName: string;
  priceLabel: string;
  leadTimeLabel: string;
  updatedAtText?: string | null;
  className?: string;
}) {
  return (
    <section
      className={clsx(
        "rounded-2xl border border-slate-800 bg-slate-950/60 px-5 py-4 sm:px-6 sm:py-5",
        className,
      )}
    >
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">
            Quote snapshot
          </p>
          <p
            className="mt-1 truncate text-base font-semibold text-white"
            title={partName}
          >
            {partName}
          </p>
        </div>
      </header>

      <div className="mt-4 rounded-xl border border-slate-900/60 bg-slate-950/40 px-4 py-3">
        <dl className="grid gap-y-2 text-sm">
          <div className="grid grid-cols-[minmax(0,1fr),auto] items-baseline gap-x-3">
            <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Price
            </dt>
            <dd className="break-anywhere tabular-nums text-base font-semibold text-white">
              {priceLabel}
            </dd>
          </div>
          <div className="grid grid-cols-[minmax(0,1fr),auto] items-baseline gap-x-3 border-t border-slate-900/60 pt-2">
            <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Lead time
            </dt>
            <dd className="break-anywhere tabular-nums text-base font-semibold text-white">
              {leadTimeLabel}
            </dd>
          </div>
          <div className="grid grid-cols-[minmax(0,1fr),auto] items-baseline gap-x-3 border-t border-slate-900/60 pt-2">
            <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Last updated
            </dt>
            <dd className="break-anywhere text-xs text-slate-300">
              {updatedAtText ?? "—"}
            </dd>
          </div>
        </dl>
      </div>
    </section>
  );
}

function KickoffChecklistCard({
  quoteId,
  readOnly,
  messagesHref,
  workspaceStatus,
  selectedSupplierName,
  changeRequestsChecklistSummary,
  materialFinish,
  tolerances,
  shipDate,
  deliveryDetails,
  poOrPaymentMethod,
  revisionOrVersion,
}: {
  quoteId: string;
  readOnly: boolean;
  messagesHref: string;
  workspaceStatus: "draft" | "in_review" | "awarded";
  selectedSupplierName: string | null;
  changeRequestsChecklistSummary: ChangeRequestsChecklistSummary | null;
  materialFinish: string | null;
  tolerances: string | null;
  shipDate: string | null;
  deliveryDetails: string | null;
  poOrPaymentMethod: string | null;
  revisionOrVersion: string | null;
}) {
  const checklistItems: Array<{
    label: string;
    value: string | null;
    status?: "Pending" | "Captured";
    tone?: TagPillTone;
  }> = [
    { label: "Material / finish", value: materialFinish },
    { label: "Tolerances", value: tolerances },
    { label: "Ship date", value: shipDate },
    { label: "Delivery details", value: deliveryDetails },
    { label: "PO / payment method", value: poOrPaymentMethod },
    { label: "Revision / version", value: revisionOrVersion },
  ];

  if (changeRequestsChecklistSummary) {
    checklistItems.unshift({
      label: changeRequestsChecklistSummary.label,
      value: changeRequestsChecklistSummary.value,
      status: changeRequestsChecklistSummary.status,
      tone: changeRequestsChecklistSummary.tone,
    });
  }

  return (
    <PortalCard
      title="Kickoff"
      description="Track final confirmations between selection and ordering."
      action={<StatusPill status={workspaceStatus} />}
    >
      <p className="text-xs text-slate-400">This portal doesn’t place orders yet.</p>

      <div className="mt-4 rounded-xl border border-slate-900/60 bg-slate-950/40 px-4 py-3">
        <CompactDlRow
          label="Selected supplier"
          value={selectedSupplierName?.trim() ? selectedSupplierName.trim() : "—"}
          title={selectedSupplierName?.trim() ? selectedSupplierName.trim() : undefined}
          truncate
        />
      </div>

      <div className="mt-5">
        <SectionHeader
          variant="label"
          title="Checklist"
          subtitle="Read-only. Status reflects what’s already captured in this workspace."
        />
        <ul className="mt-3 divide-y divide-slate-900/60 overflow-hidden rounded-xl border border-slate-900/60 bg-slate-950/30">
          {checklistItems.map((item) => {
            const value = item.value?.trim() ? item.value.trim() : null;
            const status = item.status ?? (value ? "Captured" : "Pending");
            const statusTone: TagPillTone =
              item.tone ?? (value ? "emerald" : "slate");
            const displayValue = value ?? "—";

            return (
              <li
                key={item.label}
                className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 sm:flex sm:min-w-0 sm:flex-1 sm:items-center sm:gap-6">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400 sm:w-44 sm:shrink-0">
                    {item.label}
                  </p>
                  <p
                    className="min-w-0 truncate text-sm text-slate-100"
                    title={value ?? undefined}
                  >
                    {displayValue}
                  </p>
                </div>
                <TagPill
                  size="md"
                  tone={statusTone}
                  className="w-fit normal-case tracking-normal"
                >
                  {status}
                </TagPill>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <RequestChangeScaffold
          quoteId={quoteId}
          messagesHref={messagesHref}
          disabled={readOnly}
          scrollToMessagesOnOpen
        />
        <Link
          href={messagesHref}
          className="inline-flex items-center justify-center rounded-full border border-slate-800 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-200 transition hover:border-slate-600 hover:text-white"
        >
          Open messages
        </Link>
        <p className="w-full text-xs text-slate-400">Changes are coordinated in Messages.</p>
      </div>
    </PortalCard>
  );
}

function CompactDlRow({
  label,
  value,
  title,
  truncate,
}: {
  label: string;
  value: string;
  title?: string;
  truncate?: boolean;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr),auto] items-baseline gap-x-4 gap-y-1">
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </dt>
      <dd
        className={clsx(
          "min-w-0 text-right text-sm text-slate-100",
          truncate ? "truncate" : "break-anywhere",
        )}
        title={title}
      >
        {value}
      </dd>
    </div>
  );
}

function readOptionalUploadMetaString(
  uploadMeta: QuoteWorkspaceData["uploadMeta"],
  keys: string[],
): string | null {
  if (!uploadMeta) return null;
  const record = uploadMeta as unknown as Record<string, unknown>;
  for (const key of keys) {
    const raw = record[key];
    if (typeof raw === "string" && raw.trim().length > 0) {
      return raw.trim();
    }
  }
  return null;
}

function buildEstimateInput(args: {
  quote: QuoteWorkspaceData["quote"];
  uploadMeta: QuoteWorkspaceData["uploadMeta"];
  fileCount: number;
}): PricingEstimateInput {
  const quantity = parseQuantity(args.uploadMeta?.quantity ?? null);
  return {
    manufacturing_process: args.uploadMeta?.manufacturing_process ?? null,
    quantity,
    need_by_date: args.quote.target_date ?? null,
    shipping_postal_code: args.uploadMeta?.shipping_postal_code ?? null,
    num_files: args.fileCount,
  };
}

function buildCustomerQuoteSections(args: {
  bidCount: number;
  hasWinner: boolean;
  offerCount: number;
  kickoffRatio: string | null;
  kickoffComplete: boolean;
  messageCount: number;
  unreadCount: number;
  fileCount: number;
  messagesHref: string;
}): QuoteSectionRailSection[] {
  const decisionBadge = args.hasWinner
    ? "Winner"
    : args.bidCount > 0
      ? `${args.bidCount}`
      : undefined;
  const compareBadge = args.offerCount > 0 ? `${args.offerCount}` : undefined;
  const kickoffBadge = args.kickoffComplete
    ? "Complete"
    : args.kickoffRatio
      ? args.kickoffRatio
      : args.hasWinner
        ? "In progress"
        : "Locked";
  const uploadsBadge = args.fileCount > 0 ? `${args.fileCount}` : undefined;

  return [
    {
      key: "compare-offers",
      label: "Compare offers",
      href: "#compare-offers",
      badge: compareBadge,
      tone: args.offerCount > 0 ? "info" : "neutral",
    },
    {
      key: "decision",
      label: "Decision",
      href: "#decision",
      badge: decisionBadge,
      tone: args.hasWinner ? "neutral" : args.bidCount > 0 ? "info" : "neutral",
    },
    {
      key: "kickoff",
      label: "Kickoff",
      href: "#kickoff",
      badge: kickoffBadge,
      tone: args.kickoffComplete ? "neutral" : args.hasWinner ? "info" : "neutral",
    },
    {
      key: "messages",
      label: "Messages",
      href: args.messagesHref,
      badge:
        args.unreadCount > 0
          ? `${args.unreadCount > 99 ? "99+" : args.unreadCount}`
          : args.messageCount > 0
            ? `${args.messageCount}`
            : undefined,
      tone: args.unreadCount > 0 ? "info" : "neutral",
    },
    { key: "uploads", label: "Uploads", href: "#uploads", badge: uploadsBadge },
    { key: "details", label: "Details", href: "#details" },
    { key: "timeline", label: "Timeline", href: "#timeline" },
  ];
}

function buildQuoteTabHref(
  resolvedSearchParams: SearchParamsLike | undefined,
  tabValue: string,
  hash: string,
): string {
  const params = new URLSearchParams();
  const source = resolvedSearchParams ?? {};
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === "string") {
      params.set(key, value);
    } else if (Array.isArray(value) && typeof value[0] === "string") {
      params.set(key, value[0]);
    }
  }
  params.set("tab", tabValue);
  const qs = params.toString();
  return qs ? `?${qs}${hash}` : `${hash}`;
}

function normalizeElapsedLabel(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.replace(/^Last updated\s+/i, "").replace(/\s+ago$/i, "").trim();
}

function parseToggle(value: string | null): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "on" || normalized === "yes";
}

function PortalNoticeCard({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-slate-900 bg-slate-950/40 p-6 text-center">
      <h1 className="text-xl font-semibold text-white">{title}</h1>
      <p className="mt-2 text-sm text-slate-400">{description}</p>
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </section>
  );
}

function CustomerProjectSnapshotCard({
  project,
  projectUnavailable,
  winningSupplierName,
  winningBidAmountLabel,
  winningBidLeadTimeLabel,
  kickoffCompletionLabel,
  kickoffSummaryStatus,
}: {
  project: QuoteProjectRecord;
  projectUnavailable: boolean;
  winningSupplierName?: string | null;
  winningBidAmountLabel: string;
  winningBidLeadTimeLabel: string;
  kickoffCompletionLabel: string;
  kickoffSummaryStatus: string | null;
}) {
  const createdAtLabel = project?.created_at
    ? formatDateTime(project.created_at, { includeTime: true }) ?? project.created_at
    : "Awaiting kickoff";
  const projectStatus = formatCustomerProjectStatus(project?.status);
  const nextStepMessage = deriveCustomerNextStep(kickoffSummaryStatus);
  const supplierLabel = winningSupplierName?.trim() || "Selection confirmed";

  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-950/50 px-5 py-4 text-sm text-slate-200">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Project summary
          </p>
          <h2 className="text-lg font-semibold text-white">Kickoff snapshot</h2>
          <p className="text-xs text-slate-400">{nextStepMessage}</p>
        </div>
        <TagPill size="md" tone={projectStatus.tone}>
          {projectStatus.label}
        </TagPill>
      </header>

      {projectUnavailable ? (
        <p className="mt-3 rounded-xl border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-yellow-100">
          Project details are temporarily unavailable.
        </p>
      ) : null}

      <dl className="mt-4 grid gap-3 text-slate-100 sm:grid-cols-2 lg:grid-cols-4">
        <SnapshotItem label="Created" value={createdAtLabel} />
        <SnapshotItem label="Winning supplier" value={supplierLabel} />
        <SnapshotItem label="Selected offer" value={winningBidAmountLabel} />
        <SnapshotItem label="Lead time" value={winningBidLeadTimeLabel} />
      </dl>
      <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-slate-400">
        <TagPill size="md" tone="slate" className="normal-case tracking-normal">
          Kickoff: {kickoffCompletionLabel}
        </TagPill>
        <span>Supplier workspace link available after kickoff</span>
      </div>
    </section>
  );
}

function SnapshotItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-900/60 bg-slate-950/40 px-3 py-2">
      <dt className="text-[11px] uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="break-anywhere text-slate-100">{value}</dd>
    </div>
  );
}

function formatCustomerProjectStatus(status?: string | null): {
  label: string;
  tone: TagPillTone;
} {
  const normalized = typeof status === "string" ? status.trim().toLowerCase() : "";
  switch (normalized) {
    case "kickoff":
    case "in_progress":
    case "in-progress":
      return {
        label: "Kickoff in progress",
        tone: "blue",
      };
    case "production":
    case "in_production":
      return {
        label: "In production",
        tone: "emerald",
      };
    default:
      return {
        label: "Planning",
        tone: "slate",
      };
  }
}

function deriveCustomerNextStep(status?: string | null): string {
  switch (status) {
    case "complete":
      return "Supplier finished kickoff tasks — awaiting PO release.";
    case "in-progress":
      return "Supplier is prepping for kickoff.";
    default:
      return "Supplier handoff will start once final PO details are ready.";
  }
}

function CustomerKickoffPanel({
  hasWinner,
  summary,
  anchorId,
}: {
  hasWinner: boolean;
  summary: CustomerKickoffSummary | null;
  anchorId?: string | null;
}) {
  const statusValue = summary?.isComplete ? "Complete" : hasWinner ? "In progress" : "—";
  const completedValue = summary
    ? `${summary.completedTasks} / ${summary.totalTasks}`
    : "—";

  const statusTone: TagPillTone =
    summary?.isComplete ? "emerald" : hasWinner ? "blue" : "slate";

  return (
    <section
      id={anchorId ?? undefined}
      className="rounded-2xl border border-slate-900 bg-slate-950/40 p-4 text-sm text-slate-200"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Kickoff
          </p>
          <h2 className="mt-1 text-lg font-semibold text-white">
            Kickoff checklist
          </h2>
          <p className="mt-1 text-sm text-slate-300">
            Read-only progress from the awarded supplier.
          </p>
        </div>
        <TagPill size="md" tone={statusTone} className="normal-case tracking-normal">
          {statusValue}
        </TagPill>
      </header>

      <dl className="mt-4 grid gap-3 text-slate-100 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-900/60 bg-slate-950/30 px-3 py-2">
          <dt className="text-[11px] uppercase tracking-wide text-slate-500">
            Status
          </dt>
          <dd className="font-medium text-slate-100">{statusValue}</dd>
        </div>
        <div className="rounded-xl border border-slate-900/60 bg-slate-950/30 px-3 py-2">
          <dt className="text-[11px] uppercase tracking-wide text-slate-500">
            Completed
          </dt>
          <dd className="font-medium text-slate-100">{completedValue}</dd>
        </div>
      </dl>

      {!hasWinner ? (
        <p className="mt-4 rounded-xl border border-dashed border-slate-800/70 bg-black/30 px-3 py-2 text-sm text-slate-300">
          Kickoff begins after supplier is selected.
        </p>
      ) : (
        <p className="mt-4 rounded-xl border border-dashed border-slate-800/70 bg-black/30 px-3 py-2 text-sm text-slate-300">
          Kickoff progress will update as your supplier completes onboarding tasks.
        </p>
      )}
    </section>
  );
}
