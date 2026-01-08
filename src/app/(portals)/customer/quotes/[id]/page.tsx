/**
 * Phase 1 Polish checklist
 * - Done: Empty states (no bids / no files / no messages)
 * - Done: Confirmations (award + nudge + message sent) feel immediate
 * - Done: Copy normalization (Decision/Kickoff/Messages/Uploads match rail)
 */

import clsx from "clsx";
import Link from "next/link";
import { formatDateTime } from "@/lib/formatDate";
import { formatCurrency } from "@/lib/formatCurrency";
import { formatAwardedByLabel } from "@/lib/awards";
import PortalCard from "@/app/(portals)/PortalCard";
import { PortalShell } from "@/app/(portals)/components/PortalShell";
import { QuoteMessagesThread } from "@/app/(portals)/shared/QuoteMessagesThread";
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
import { requireUser } from "@/server/auth";
import { getCustomerByUserId } from "@/server/customers";
import { WorkflowStatusCallout } from "@/components/WorkflowStatusCallout";
import { getNextWorkflowState } from "@/lib/workflow";
import { CollapsibleCard } from "@/components/CollapsibleCard";
import { DisclosureSection } from "@/components/DisclosureSection";
import {
  getQuoteStatusLabel,
  getQuoteStatusHelper,
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
import { postQuoteMessage as postCustomerQuoteMessage } from "./actions";
import { CustomerQuoteStatusCtas } from "./CustomerQuoteStatusCtas";
import {
  getCustomerKickoffSummary,
  type CustomerKickoffSummary,
} from "@/server/quotes/kickoffSummary";
import {
  formatKickoffTasksRatio,
  resolveKickoffProgressBasis,
} from "@/lib/quote/kickoffChecklist";
import { KickoffNudgeButton } from "@/app/(portals)/customer/components/KickoffNudgeButton";
import { QuoteAtAGlanceBar, type QuoteAtAGlancePill } from "@/components/QuoteAtAGlanceBar";
import { resolvePrimaryAction } from "@/lib/quote/resolvePrimaryAction";
import { QuoteSectionRail } from "@/components/QuoteSectionRail";
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
import { supabaseServer } from "@/lib/supabaseServer";
import { isMissingTableOrColumnError, serializeSupabaseError } from "@/server/admin/logging";
import { loadBidComparisonSummary } from "@/server/quotes/bidCompare";
import { loadCadFeaturesForQuote } from "@/server/quotes/cadFeatures";
import { CustomerCheckoutScaffoldCard } from "./CustomerCheckoutScaffoldCard";

export const dynamic = "force-dynamic";

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

  const user = await requireUser({
    redirectTo: `/customer/quotes/${quoteId}`,
  });
  const emailParam = getSearchParamValue(resolvedSearchParams, "email");
  const overrideEmail = normalizeEmailInput(emailParam);
  const focusParam = getSearchParamValue(resolvedSearchParams, "focus");
  const tabParam = getSearchParamValue(resolvedSearchParams, "tab");
  const awardSupplierIdParam = getSearchParamValue(resolvedSearchParams, "awardSupplierId");
  const messagesHref = buildQuoteTabHref(resolvedSearchParams, "messages", "#messages");
  const customer = await getCustomerByUserId(user.id);

  if (!customer) {
    return (
      <PortalNoticeCard
        title="Complete your profile"
        description="Finish the quick setup on /customer before opening quote workspaces."
      />
    );
  }

  const workspaceResult = await loadQuoteWorkspaceData(quoteId, {
    safeOnly: true,
    viewerUserId: user.id,
  });
  if (!workspaceResult.ok || !workspaceResult.data) {
    console.error("[customer quote] load failed", {
      quoteId,
      error: workspaceResult.error ?? "Quote not found",
    });
    return (
      <PortalNoticeCard
        title="Quote not found"
        description="We couldn’t find a quote with that reference. Double-check the link or contact support."
      />
    );
  }

  const {
    quote,
    uploadMeta,
    uploadGroups,
    filePreviews,
    parts,
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
    bidComparisonSummary,
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
    loadBidComparisonSummary(quote.id),
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
        description="This quote is not linked to your account. Confirm you’re using the right workspace or request access from your admin."
      />
    );
  }

  const readOnly = usingOverride;
  const derived = deriveQuotePresentation(quote, uploadMeta);
  const { customerName, companyName, intakeNotes } = derived;
  const normalizedQuoteStatus = normalizeQuoteStatus(quote.status ?? undefined);
  const quoteStatusLabel = getQuoteStatusLabel(quote.status ?? undefined);
  const quoteStatusHelper = getQuoteStatusHelper(quote.status ?? undefined);
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
    winningSupplierProfile?.company_name?.trim() ||
    winningSupplierProfile?.primary_email ||
    winningSupplierId;
  const quoteHasWinner =
    Boolean(quote.awarded_at) ||
    Boolean(quote.awarded_bid_id) ||
    Boolean(quote.awarded_supplier_id) ||
    Boolean(winningBidId);
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
    : "Select a winning supplier to start kickoff";
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
    const { data, error } = await supabaseServer
      .from("quote_rfq_feedback")
      .select("categories,created_at")
      .eq("quote_id", quote.id)
      .order("created_at", { ascending: false })
      .limit(50)
      .returns<Array<{ categories: string[] | null; created_at: string | null }>>();

    if (error) {
      if (!isMissingTableOrColumnError(error)) {
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
  } catch (error) {
    if (!isMissingTableOrColumnError(error)) {
      console.warn("[customer quote] quote_rfq_feedback load crashed", {
        quoteId: quote.id,
        error: serializeSupabaseError(error) ?? error,
      });
    }
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
  const kickoffTasksRowValue = kickoffProgressBasis.isComplete
    ? "Complete"
    : kickoffTasksRatio
      ? `In progress (${kickoffTasksRatio})`
      : "In progress";
  const canNudgeSupplier =
    quoteHasWinner && Boolean(winningSupplierId) && !kickoffProgressBasis.isComplete;
  const kickoffSummaryTone =
    kickoffSummaryStatus === "complete"
      ? "text-emerald-300"
      : kickoffSummaryStatus === "in-progress"
        ? "text-blue-200"
        : "text-slate-200";
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
        "Selecting a winner is unavailable for closed or archived RFQs.";
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
  const leadTimeLabel =
    fastestLeadTime != null
      ? `${fastestLeadTime} day${fastestLeadTime === 1 ? "" : "s"}`
      : "Pending";
  const bestPriceLabel =
    bestPriceValue != null
      ? formatCurrency(bestPriceValue, bestPriceCurrency ?? undefined)
      : "Pending";

  const bidCompareRows = bidComparisonSummary?.rows ?? [];
  const compareBestPriceSupplierId = (() => {
    let best: { supplierId: string; amount: number } | null = null;
    for (const row of bidCompareRows) {
      if (typeof row.totalAmount !== "number") continue;
      if (!best || row.totalAmount < best.amount) {
        best = { supplierId: row.supplierId, amount: row.totalAmount };
      }
    }
    return best?.supplierId ?? null;
  })();
  const compareFastestLeadSupplierId = (() => {
    let best: { supplierId: string; lead: number } | null = null;
    for (const row of bidCompareRows) {
      if (typeof row.leadTimeDays !== "number") continue;
      if (!best || row.leadTimeDays < best.lead) {
        best = { supplierId: row.supplierId, lead: row.leadTimeDays };
      }
    }
    return best?.supplierId ?? null;
  })();
  const compareRowsByScore = [...bidCompareRows].sort((a, b) => {
    const sa = typeof a.compositeScore === "number" ? a.compositeScore : -1;
    const sb = typeof b.compositeScore === "number" ? b.compositeScore : -1;
    if (sb !== sa) return sb - sa;
    return a.supplierName.localeCompare(b.supplierName);
  });
  const bestCompositeScore =
    compareRowsByScore.length > 0 && typeof compareRowsByScore[0]?.compositeScore === "number"
      ? compareRowsByScore[0]!.compositeScore
      : null;
  const recommendedSupplierIds = new Set(
    compareRowsByScore
      .filter((row) => typeof row.compositeScore === "number")
      .filter((row) =>
        bestCompositeScore === null ? false : (row.compositeScore ?? -1) >= bestCompositeScore - 5,
      )
      .slice(0, 2)
      .map((row) => row.supplierId),
  );
  const bidSummaryBadgeLabel = bidsUnavailable
    ? "Bids unavailable"
    : bidCount === 0
      ? "No bids yet"
      : `${bidCount} bid${bidCount === 1 ? "" : "s"}`;
  const bidSummaryHelper = bidsUnavailable
    ? "Supplier bidding isn't enabled in this environment."
    : bidCount === 0
      ? "Waiting on suppliers to quote."
      : quoteHasWinner
        ? "Supplier selected—kickoff tasks are unlocked."
        : "Review pricing and pick a supplier to move forward.";
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
  const awardedAtLabel = quote.awarded_at
    ? formatDateTime(quote.awarded_at, { includeTime: true })
    : null;
  const awardedByLabel = formatAwardedByLabel(quote.awarded_by_role, {
    perspective: "customer",
  });
  const headerTitle = `${customerName ?? "RFQ"} · ${formatQuoteId(quote.id)}`;
  const headerActions = (
    <div className="flex flex-wrap items-center gap-2">
      <CustomerQuoteStatusCtas
        quoteId={quote.id}
        status={normalizedQuoteStatus}
        disabled={readOnly}
      />
      <Link
        href="/customer/quotes"
        className="inline-flex items-center rounded-full border border-emerald-400/40 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-emerald-100 transition hover:border-emerald-300 hover:text-white"
      >
        Back to quotes
      </Link>
    </div>
  );

  const customerPrimaryAction = resolvePrimaryAction({
    role: "customer",
    quote: {
      id: quote.id,
      status: quote.status ?? null,
      awarded_supplier_id: quote.awarded_supplier_id ?? null,
      awarded_bid_id: quote.awarded_bid_id ?? null,
      awarded_at: quote.awarded_at ?? null,
      kickoff_completed_at:
        (quote as { kickoff_completed_at?: string | null })?.kickoff_completed_at ??
        null,
      primaryActionHints: {
        canAward: customerCanAward,
        hasWinner: quoteHasWinner,
        kickoffComplete: kickoffProgressBasis.isComplete,
      },
    },
  });

  const bidsPillTone: "info" | "neutral" = bidCount > 0 ? "info" : "neutral";

  const customerAtAGlancePills = [
    { key: "rfq", label: "RFQ", value: primaryFileName },
    { key: "files", label: "Files", value: fileCountText, href: "#uploads" },
    {
      key: "bids",
      label: "Bids",
      value: bidSummaryBadgeLabel,
      tone: bidsPillTone,
      href: "#decision",
    },
    {
      key: "kickoff",
      label: "Kickoff",
      value: kickoffSummaryLabel,
      tone: kickoffProgressBasis.isComplete
        ? "success"
        : quoteHasWinner
          ? "info"
          : "neutral",
      href: "#kickoff",
    },
    {
      key: "viewingAs",
      label: "Viewing as",
      value: identityEmailDisplay,
      tone: readOnly ? "warning" : "neutral",
    },
    readOnly
      ? { key: "mode", label: "Mode", value: "Read-only preview", tone: "warning" }
      : { key: "mode", label: "Mode", value: "Full access", tone: "neutral" },
  ] satisfies QuoteAtAGlancePill[];
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

  const headerContent = (
    <QuoteAtAGlanceBar
      role="customer"
      statusLabel={quoteStatusLabel}
      whatsNext={quoteStatusHelper}
      pills={[...customerAtAGlancePills]}
      primaryAction={customerPrimaryAction}
      below={
        <QuoteSectionRail
          sections={buildCustomerQuoteSections({
            bidCount,
            hasWinner: quoteHasWinner,
            kickoffRatio: kickoffTasksRatio,
            kickoffComplete: kickoffProgressBasis.isComplete,
            messageCount: quoteMessages.length,
            unreadCount: messagesUnreadCount,
            fileCount,
            messagesHref,
          })}
        />
      }
    />
  );

  const winningBidCallout = quoteHasWinner ? (
    <div className="rounded-xl border border-emerald-500/60 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
      <div className="flex flex-wrap items-center gap-2">
        <span className="pill pill-success">Winner selected</span>
        {awardedAtLabel ? (
          <span className="text-xs uppercase tracking-wide text-emerald-200">
            Awarded {awardedAtLabel}
          </span>
        ) : null}
      </div>
      <p className="mt-2 text-base font-semibold text-white">
        {winningSupplierName ?? "Supplier selected"}
      </p>
      <p className="text-xs text-emerald-100">
        {winningBidPriceLabel} &middot; Lead time {winningBidLeadTimeLabel}
      </p>
      <p className="mt-1 text-xs text-emerald-200">
        Awarded by: {awardedByLabel}
      </p>
    </div>
  ) : null;

  const checkoutScaffoldSection =
    quoteHasWinner && winningSupplierId ? (
      <CustomerCheckoutScaffoldCard
        partName={primaryFileName}
        supplierName={winningSupplierName}
        priceLabel={winningBidPriceLabel}
      />
    ) : null;

  const bidSummaryPanel = (
    <div className="space-y-3 rounded-2xl border border-slate-900/60 bg-slate-950/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
            Bid summary
          </p>
          <p className="text-sm text-slate-300">{bidSummaryHelper}</p>
        </div>
        <span className="rounded-full border border-slate-800 bg-slate-900/40 px-3 py-1 text-xs font-semibold text-slate-200">
          {bidSummaryBadgeLabel}
        </span>
      </div>
      <dl className="grid gap-3 text-sm text-slate-200 sm:grid-cols-3">
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Bids received
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
          RFQ snapshot
        </p>
        <h2 className="text-lg font-semibold text-white">Project overview</h2>
      </header>
      <div className="flex flex-wrap gap-2 text-xs font-semibold">
        <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-emerald-200">
          Status: {quoteStatusLabel}
        </span>
        <span className="rounded-full border border-slate-800 bg-slate-900/60 px-3 py-1 text-slate-200">
          Target date: {targetDateChipText}
        </span>
        <span className="rounded-full border border-slate-800 bg-slate-900/60 px-3 py-1 text-slate-200">
          Estimate: {priceChipText}
        </span>
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
          <dd className={clsx("font-medium", kickoffSummaryTone)}>
            {kickoffSummaryLabel}
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
          <p className="mt-1 whitespace-pre-line text-sm text-slate-200">
            {dfmNotes ?? "Engineering feedback will show up here once it’s ready."}
          </p>
        </div>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Intake notes
          </p>
          <p className="mt-1 whitespace-pre-line text-sm text-slate-200">
            {intakeNotes ?? "No additional notes captured during upload."}
          </p>
        </div>
      </div>
      <div className="space-y-3 rounded-2xl border border-slate-900/60 bg-slate-950/30 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
              Supplier bids
            </p>
            <p className="text-sm text-slate-300">
              We collect bids from vetted suppliers, then review options before finalizing your quote.
            </p>
          </div>
          {bidCount > 0 ? (
            <span className="rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-200">
              {bidCount} bid{bidCount === 1 ? "" : "s"} received
            </span>
          ) : null}
        </div>
        {bidsUnavailable ? (
          <p className="text-xs text-slate-400">
            Supplier bidding isn&apos;t enabled in this environment yet. Your RFQ is still in review.
          </p>
        ) : bidCount === 0 ? (
          <EmptyStateCard
            title="No bids yet"
            description="We’re reaching out to suppliers now. Check Messages for updates."
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
                  Total bids
                </dt>
                <dd className="mt-1">
                  {bidCount} bid{bidCount === 1 ? "" : "s"}
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
                    anchorId="award"
                    preselectBidId={preselectAwardBidId}
                  />
                </>
              ) : (
                <p className="rounded-xl border border-yellow-500/30 bg-yellow-500/5 px-5 py-3 text-xs text-yellow-100">
                  {customerBidSummariesError ??
                    "We couldn’t load supplier bid details. Refresh to try again."}
                </p>
              )
            ) : null}
          </>
        )}
      </div>
    </section>
  );

  const receiptBanner = shouldShowReceiptBanner ? (
    <section className="rounded-2xl border border-slate-800 bg-slate-950/50 px-5 py-4">
      <div className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Early RFQ update
        </p>
        <h2 className="text-lg font-semibold text-white">We&apos;ve got your RFQ.</h2>
      </div>
      <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-slate-200">
        <li>We&apos;re routing this RFQ to vetted suppliers who match your process and volumes.</li>
        <li>You&apos;ll start seeing bids here as suppliers respond.</li>
        <li>Once we review bids, we&apos;ll prepare pricing and move the status to Quote prepared.</li>
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
      description="Add PO details and ship dates once you select a winning supplier."
    >
      <p className="text-sm text-slate-300">
        Select a winning supplier to unlock the kickoff form. We&apos;ll collect PO numbers, target ship
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
        kickoffSummaryLabel={kickoffSummaryLabel}
        kickoffSummaryStatus={kickoffSummaryStatus}
      />
    ) : null;

  const postMessageAction = postCustomerQuoteMessage.bind(null, quote.id);

  const quoteDetailsSection = (
    <DisclosureSection
      id="details"
      className="scroll-mt-24"
      title="Details"
      description="Status, key dates, and workflow snapshot."
      defaultOpen={false}
      summary={
        <span className="rounded-full border border-slate-800 bg-slate-950/50 px-3 py-1">
          {quoteStatusLabel}
        </span>
      }
    >
      <div className="space-y-5">
        <div className="flex flex-wrap gap-2 text-xs font-semibold">
          <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-emerald-200">
            Status: {quoteStatusLabel}
          </span>
          <span className="rounded-full border border-slate-800 bg-slate-900/60 px-3 py-1 text-slate-200">
            Target date: {targetDateChipText}
          </span>
          <span className="rounded-full border border-slate-800 bg-slate-900/60 px-3 py-1 text-slate-200">
            Estimate: {priceChipText}
          </span>
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
        <span className="rounded-full border border-slate-800 bg-slate-950/50 px-3 py-1">
          {fileCountText}
        </span>
      }
    >
      {showCadDfMHint ? (
        <p className="mb-4 rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-3 text-sm text-slate-200">
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
          <p className="mt-1 whitespace-pre-line text-sm text-slate-200">
            {dfmNotes ?? "Engineering feedback will show up here once it’s ready."}
          </p>
        </div>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Intake notes
          </p>
          <p className="mt-1 whitespace-pre-line text-sm text-slate-200">
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
      description="Review supplier bids and select a winner."
      defaultOpen={bidCount > 0 && !quoteHasWinner}
      summary={
        quoteHasWinner ? (
          <span className="pill pill-success px-3 py-0.5 text-[11px] font-semibold">
            Winner
          </span>
        ) : bidCount > 0 ? (
          <span className="rounded-full border border-slate-800 bg-slate-950/50 px-3 py-1 text-xs font-semibold text-slate-200">
            {bidCount} bid{bidCount === 1 ? "" : "s"}
          </span>
        ) : (
          <span className="rounded-full border border-slate-800 bg-slate-950/50 px-3 py-1 text-xs font-semibold text-slate-200">
            No bids
          </span>
        )
      }
    >
      <div className="space-y-4">
        {customerFeedbackAdvisories.length > 0 ? (
          <div className="rounded-2xl border border-slate-800 bg-slate-950/60 px-5 py-4">
            <p className="text-sm font-semibold text-slate-100">
              Suppliers flagged the following issues on previous RFQs like this one:
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
                  Your RFQ may get fewer bids.
                </p>
                <p className="mt-1 text-xs text-amber-100/80">
                  Improving completeness can increase supplier response rate.
                </p>
              </div>
              <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-[11px] font-semibold text-amber-100">
                Quality score {rfqQualitySummary.score}
              </span>
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
        {bidCompareRows.length > 0 ? (
          <div className="overflow-hidden rounded-2xl border border-slate-900/60 bg-slate-950/30">
            <div className="border-b border-slate-900/60 px-5 py-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                Compare bids
              </p>
              <p className="mt-1 text-sm text-slate-300">
                We’ve summarized each supplier’s bid, lead time, and fit. Use this to choose who to award.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] border-collapse text-left text-sm">
                <thead className="border-b border-slate-900/60 bg-slate-950/70">
                  <tr className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                    <th className="px-5 py-3">Supplier</th>
                    <th className="px-5 py-3">Total price</th>
                    <th className="px-5 py-3">Lead time</th>
                    <th className="px-5 py-3">Match</th>
                    <th className="px-5 py-3">Bench</th>
                    <th className="px-5 py-3">Parts coverage</th>
                    <th className="px-5 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-900/60">
                  {bidCompareRows.map((row) => {
                    const isBestPrice = row.supplierId === compareBestPriceSupplierId;
                    const isFastest = row.supplierId === compareFastestLeadSupplierId;
                    const isRecommended = recommendedSupplierIds.has(row.supplierId);

                    const rowClasses = clsx(
                      isRecommended
                        ? "bg-emerald-500/5"
                        : isBestPrice || isFastest
                          ? "bg-slate-900/30"
                          : "bg-transparent",
                    );

                    const priceLabel =
                      typeof row.totalAmount === "number"
                        ? formatCurrency(row.totalAmount, row.currency ?? undefined)
                        : "Pending";
                    const leadLabel =
                      typeof row.leadTimeDays === "number"
                        ? `${row.leadTimeDays} day${row.leadTimeDays === 1 ? "" : "s"}`
                        : "Pending";
                    const awardHref = buildAwardCompareHref(resolvedSearchParams, row.supplierId);

                    return (
                      <tr key={row.supplierId} className={rowClasses}>
                        <td className="px-5 py-4 align-top">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-base font-semibold text-white">{row.supplierName}</span>
                            {isRecommended ? (
                              <span className="pill pill-success px-3 py-1 text-[11px] uppercase tracking-wide">
                                Recommended
                              </span>
                            ) : null}
                            {isBestPrice ? (
                              <span className="pill pill-info px-3 py-1 text-[11px] uppercase tracking-wide">
                                Best price
                              </span>
                            ) : null}
                            {isFastest ? (
                              <span className="pill pill-info px-3 py-1 text-[11px] uppercase tracking-wide">
                                Fastest lead
                              </span>
                            ) : null}
                          </div>
                        </td>
                        <td className="px-5 py-4 align-top text-slate-100">
                          <span className="font-semibold text-white">{priceLabel}</span>
                        </td>
                        <td className="px-5 py-4 align-top text-slate-100">
                          <span className="font-semibold text-white">{leadLabel}</span>
                        </td>
                        <td className="px-5 py-4 align-top">
                          <span className={clsx("pill px-3 py-1 text-[11px]", matchHealthPillClasses(row.matchHealth))}>
                            {formatMatchHealthLabel(row.matchHealth)}
                          </span>
                        </td>
                        <td className="px-5 py-4 align-top">
                          <span className={clsx("pill px-3 py-1 text-[11px]", benchStatusPillClasses(row.benchStatus))}>
                            {formatBenchStatusLabel(row.benchStatus)}
                          </span>
                        </td>
                        <td className="px-5 py-4 align-top">
                          <span className={clsx("pill px-3 py-1 text-[11px]", partsCoveragePillClasses(row.partsCoverage))}>
                            {row.partsCoverage === "good"
                              ? "Good"
                              : row.partsCoverage === "needs_attention"
                                ? "Needs attention"
                                : "None"}
                          </span>
                        </td>
                        <td className="px-5 py-4 align-top text-right">
                          <Link
                            href={awardHref}
                            className={clsx(
                              "inline-flex items-center rounded-full border px-4 py-2 text-sm font-semibold transition focus-visible:outline focus-visible:outline-2",
                              customerCanAward
                                ? "border-emerald-400/50 bg-emerald-500/10 text-emerald-100 hover:bg-emerald-500/20 focus-visible:outline-emerald-400"
                                : "border-slate-800/80 text-slate-400 opacity-70 pointer-events-none",
                            )}
                          >
                            Award
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
        <div className="space-y-3 rounded-2xl border border-slate-900/60 bg-slate-950/30 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                Supplier bids
              </p>
              <p className="text-sm text-slate-300">
                We collect bids from vetted suppliers, then review options before finalizing your quote.
              </p>
            </div>
            {bidCount > 0 ? (
              <span className="rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-200">
                {bidCount} bid{bidCount === 1 ? "" : "s"} received
              </span>
            ) : null}
          </div>
          {bidsUnavailable ? (
            <p className="text-xs text-slate-400">
              Supplier bidding isn&apos;t enabled in this environment yet. Your RFQ is still in review.
            </p>
          ) : bidCount === 0 ? (
            <EmptyStateCard
              title="No bids yet"
              description="We’re reaching out to suppliers now. Check Messages for updates."
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
                    Total bids
                  </dt>
                  <dd className="mt-1">
                    {bidCount} bid{bidCount === 1 ? "" : "s"}
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
                      anchorId="award"
                      preselectBidId={preselectAwardBidId}
                    />
                  </>
                ) : (
                  <p className="rounded-xl border border-yellow-500/30 bg-yellow-500/5 px-5 py-3 text-xs text-yellow-100">
                    {customerBidSummariesError ??
                      "We couldn’t load supplier bid details. Refresh to try again."}
                  </p>
                )
              ) : null}
            </>
          )}
        </div>
      </div>
    </DisclosureSection>
  );

  const kickoffSection = (
    <DisclosureSection
      id="kickoff"
      className="scroll-mt-24"
      title="Kickoff"
      description="Project kickoff details and supplier checklist updates."
      defaultOpen={quoteHasWinner && !kickoffProgressBasis.isComplete}
      summary={
        <span className={clsx("rounded-full border px-3 py-1", kickoffSummaryTone)}>
          {kickoffSummaryLabel}
        </span>
      }
    >
      <div className="space-y-4">
        {partsCoverageSummary.anyParts ? (
          <section className="rounded-2xl border border-slate-900 bg-slate-950/40 px-6 py-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Parts overview
                </p>
                <p className="mt-1 text-sm text-slate-200">{partsCoverageSummaryLine}</p>
              </div>
              <span
                className={clsx(
                  "rounded-full border px-3 py-1 text-[11px] font-semibold",
                  partsCoverageSummary.allCovered
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-100"
                    : "border-amber-500/40 bg-amber-500/10 text-amber-100",
                )}
              >
                Coverage: {partsCoverageSummary.allCovered ? "Good" : "Needs attention"}
              </span>
            </div>
            {!partsCoverageSummary.allCovered ? (
              <p className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-xs text-amber-100">
                Some parts are missing CAD or drawings. You can still proceed, but this may slow down quoting or production.
              </p>
            ) : null}
          </section>
        ) : (
          <p className="rounded-2xl border border-slate-900 bg-slate-950/40 px-6 py-4 text-sm text-slate-300">
            No parts defined yet. Your Zartman team may add parts later.
          </p>
        )}
        {projectSnapshotCard}
        {projectSection}
        <CustomerKickoffPanel
          hasWinner={Boolean(winningSupplierId)}
          summary={quoteHasWinner ? customerKickoffSummary : null}
          anchorId={null}
        />
      </div>
    </DisclosureSection>
  );

  const timelineSection = (
    <DisclosureSection
      id="timeline"
      className="scroll-mt-24"
      title="Timeline"
      description="Updates and milestones for this RFQ."
      defaultOpen={tabParam === "activity"}
    >
      <QuoteTimeline
        quoteId={quote.id}
        actorRole="customer"
        actorUserId={user.id}
        emptyState="No events yet. Activity will appear here as your RFQ progresses."
      />
    </DisclosureSection>
  );

  return (
    <PortalShell
      workspace="customer"
      title={headerTitle}
      subtitle="Status updates, files, and shared messages for this RFQ."
      headerContent={headerContent}
      actions={headerActions}
    >
      <FocusScroll enabled={focusParam === "award"} targetId="award" />
      <FocusTabScroll tab={tabParam} when="activity" targetId="timeline" />
      <FocusTabScroll tab={tabParam} when="messages" targetId="messages" />
      {receiptBanner}
      <div className="space-y-5 lg:grid lg:grid-cols-[minmax(0,0.65fr)_minmax(0,0.35fr)] lg:gap-5 lg:space-y-0">
        <div className="space-y-5">
          {decisionSection}
          {kickoffSection}
          {timelineSection}
          {messagesUnavailable ? (
            <p className="rounded-xl border border-yellow-500/30 bg-yellow-500/5 px-5 py-3 text-sm text-yellow-100">
              Messages are temporarily unavailable. Refresh the page to try again.
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
                <span className="rounded-full border border-slate-800 bg-slate-950/50 px-3 py-1">
                  {quoteMessages.length} message{quoteMessages.length === 1 ? "" : "s"}
                </span>
              ) : (
                <span className="rounded-full border border-slate-800 bg-slate-950/50 px-3 py-1">
                  No messages
                </span>
              )
            }
          >
            <QuoteMessagesThread
              quoteId={quote.id}
              messages={quoteMessages}
              canPost={!readOnly}
              postAction={postMessageAction}
              currentUserId={user.id}
              markRead={tabParam === "messages"}
              title="Messages"
              description="Shared thread with your supplier and the Zartman admin team."
              helperText="Your note notifies your supplier and the Zartman admin team."
              disabledCopy={
                readOnly
                  ? "Messages are read-only while you are impersonating another customer."
                  : undefined
              }
              emptyStateCopy="Send the first message to align on next steps."
            />
          </DisclosureSection>
        </div>
        <div className="space-y-5">
          {quoteIsWon ? (
            <PortalCard
              title="Project status"
              description="This job is now in progress with your supplier."
            >
              <dl className="grid gap-3 text-sm text-slate-200 sm:grid-cols-2">
                <div className="rounded-xl border border-slate-900/60 bg-slate-950/40 px-3 py-2">
                  <dt className="text-[11px] uppercase tracking-wide text-slate-500">
                    Supplier
                  </dt>
                  <dd className="text-slate-100">
                    {winningSupplierId ? (winningSupplierName ?? winningSupplierId) : "Supplier assignment pending."}
                  </dd>
                </div>
                <div className="rounded-xl border border-slate-900/60 bg-slate-950/40 px-3 py-2">
                  <dt className="text-[11px] uppercase tracking-wide text-slate-500">
                    Awarded on
                  </dt>
                  <dd className="text-slate-100">
                    {quote.awarded_at ? formatDateTime(quote.awarded_at) : "—"}
                  </dd>
                </div>
                <div className="rounded-xl border border-slate-900/60 bg-slate-950/40 px-3 py-2 sm:col-span-2">
                  <dt className="text-[11px] uppercase tracking-wide text-slate-500">
                    Kickoff status
                  </dt>
                  <dd className="mt-1 space-y-1">
                    <p className="font-medium text-slate-100">{kickoffSummaryLabel}</p>
                    <p className="text-xs text-slate-400">{kickoffChecklistSummaryLabel}</p>
                  </dd>
                </div>
                <div className="rounded-xl border border-slate-900/60 bg-slate-950/40 px-3 py-2 sm:col-span-2">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <dt className="text-[11px] uppercase tracking-wide text-slate-500">
                        Kickoff tasks
                      </dt>
                      <dd className="mt-1 font-medium text-slate-100">
                        {kickoffTasksRowValue}
                      </dd>
                    </div>
                    {canNudgeSupplier && winningSupplierId ? (
                      <KickoffNudgeButton
                        quoteId={quote.id}
                        supplierId={winningSupplierId}
                        latestNudgedAt={latestKickoffNudgedAt}
                      />
                    ) : null}
                  </div>
                </div>
              </dl>
              <div className="mt-4">
                <Link
                  href="#timeline"
                  className="inline-flex items-center justify-center rounded-full border border-emerald-400/40 bg-emerald-500/10 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-emerald-100 transition hover:border-emerald-300 hover:text-white"
                >
                  View activity timeline
                </Link>
              </div>
            </PortalCard>
          ) : null}
          {checkoutScaffoldSection}
          {filesSection}
          {quoteDetailsSection}
          {notesSection}
        </div>
      </div>
    </PortalShell>
  );
}

function buildCustomerQuoteSections(args: {
  bidCount: number;
  hasWinner: boolean;
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

function buildAwardCompareHref(
  resolvedSearchParams: SearchParamsLike | undefined,
  supplierId: string,
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
  params.set("focus", "award");
  params.set("awardSupplierId", supplierId);
  const qs = params.toString();
  return qs ? `?${qs}#award` : "#award";
}

function formatMatchHealthLabel(value: unknown): string {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (normalized === "good") return "Good";
  if (normalized === "caution") return "Caution";
  if (normalized === "poor") return "Poor";
  return "Unknown";
}

function matchHealthPillClasses(value: unknown): string {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  switch (normalized) {
    case "good":
      return "pill-success";
    case "caution":
      return "pill-warning";
    case "poor":
      return "pill-danger";
    default:
      return "pill-muted";
  }
}

function formatBenchStatusLabel(value: unknown): string {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (normalized === "underused") return "Underused";
  if (normalized === "balanced") return "Balanced";
  if (normalized === "overused") return "Overused";
  return "Unknown";
}

function benchStatusPillClasses(value: unknown): string {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  switch (normalized) {
    case "underused":
      return "pill-info";
    case "balanced":
      return "pill-success";
    case "overused":
      return "pill-warning";
    default:
      return "pill-muted";
  }
}

function partsCoveragePillClasses(value: unknown): string {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  switch (normalized) {
    case "good":
      return "pill-success";
    case "needs_attention":
      return "pill-warning";
    default:
      return "pill-muted";
  }
}

function PortalNoticeCard({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <section className="rounded-2xl border border-slate-900 bg-slate-950/40 p-6 text-center">
      <h1 className="text-xl font-semibold text-white">{title}</h1>
      <p className="mt-2 text-sm text-slate-400">{description}</p>
    </section>
  );
}

function CustomerProjectSnapshotCard({
  project,
  projectUnavailable,
  winningSupplierName,
  winningBidAmountLabel,
  winningBidLeadTimeLabel,
  kickoffSummaryLabel,
  kickoffSummaryStatus,
}: {
  project: QuoteProjectRecord;
  projectUnavailable: boolean;
  winningSupplierName?: string | null;
  winningBidAmountLabel: string;
  winningBidLeadTimeLabel: string;
  kickoffSummaryLabel: string;
  kickoffSummaryStatus: string | null;
}) {
  const createdAtLabel = project?.created_at
    ? formatDateTime(project.created_at, { includeTime: true }) ?? project.created_at
    : "Awaiting kickoff";
  const projectStatus = formatCustomerProjectStatus(project?.status);
  const nextStepMessage = deriveCustomerNextStep(kickoffSummaryStatus);
  const supplierLabel = winningSupplierName?.trim() || "Supplier selected";

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
        <span
          className={clsx(
            "rounded-full border px-4 py-1 text-xs font-semibold uppercase tracking-wide",
            projectStatus.pillClasses,
          )}
        >
          {projectStatus.label}
        </span>
      </header>

      {projectUnavailable ? (
        <p className="mt-3 rounded-xl border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-yellow-100">
          Project details are temporarily unavailable.
        </p>
      ) : null}

      <dl className="mt-4 grid gap-3 text-slate-100 sm:grid-cols-2 lg:grid-cols-4">
        <SnapshotItem label="Created" value={createdAtLabel} />
        <SnapshotItem label="Winning supplier" value={supplierLabel} />
        <SnapshotItem label="Winning bid" value={winningBidAmountLabel} />
        <SnapshotItem label="Lead time" value={winningBidLeadTimeLabel} />
      </dl>
      <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-slate-400">
        <span className="rounded-full border border-slate-800 bg-slate-950/70 px-3 py-1 text-slate-200">
          Kickoff: {kickoffSummaryLabel}
        </span>
        <span>View supplier workspace (coming soon)</span>
      </div>
    </section>
  );
}

function SnapshotItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-900/60 bg-slate-950/40 px-3 py-2">
      <dt className="text-[11px] uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="text-slate-100">{value}</dd>
    </div>
  );
}

function formatCustomerProjectStatus(status?: string | null): {
  label: string;
  pillClasses: string;
} {
  const normalized = typeof status === "string" ? status.trim().toLowerCase() : "";
  switch (normalized) {
    case "kickoff":
    case "in_progress":
    case "in-progress":
      return {
        label: "Kickoff in progress",
        pillClasses: "border-blue-500/40 bg-blue-500/10 text-blue-100",
      };
    case "production":
    case "in_production":
      return {
        label: "In production",
        pillClasses: "border-emerald-500/40 bg-emerald-500/10 text-emerald-100",
      };
    default:
      return {
        label: "Planning",
        pillClasses: "border-slate-700 bg-slate-900/40 text-slate-200",
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

  const pillTone =
    summary?.isComplete
      ? "border border-emerald-500/40 bg-emerald-500/10 text-emerald-100"
      : hasWinner
        ? "border border-blue-500/40 bg-blue-500/10 text-blue-100"
        : "border border-slate-800 bg-slate-900/60 text-slate-200";

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
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${pillTone}`}>
          {statusValue}
        </span>
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
