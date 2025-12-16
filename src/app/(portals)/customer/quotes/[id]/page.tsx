import clsx from "clsx";
import Link from "next/link";
import { formatDateTime } from "@/lib/formatDate";
import { formatCurrency } from "@/lib/formatCurrency";
import { formatAwardedByLabel } from "@/lib/awards";
import PortalCard from "@/app/(portals)/PortalCard";
import { PortalShell } from "@/app/(portals)/components/PortalShell";
import { QuoteMessagesThread } from "@/app/(portals)/components/QuoteMessagesThread";
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
import {
  getQuoteStatusLabel,
  getQuoteStatusHelper,
  normalizeQuoteStatus,
} from "@/server/quotes/status";
import { CustomerQuoteAwardPanel } from "./CustomerQuoteAwardPanel";
import { CustomerQuoteProjectCard } from "./CustomerQuoteProjectCard";
import {
  loadQuoteProjectForQuote,
  type QuoteProjectRecord,
} from "@/server/quotes/projects";
import { loadSupplierById } from "@/server/suppliers/profile";
import { loadQuoteMessages } from "@/server/quotes/messages";
import {
  loadQuoteKickoffTasksForSupplier,
  summarizeKickoffTasks,
  formatKickoffSummaryLabel,
  type SupplierKickoffTasksResult,
} from "@/server/quotes/kickoffTasks";
import {
  mergeKickoffTasksWithDefaults,
  type SupplierKickoffTask,
} from "@/lib/quote/kickoffChecklist";
import { postQuoteMessage as postCustomerQuoteMessage } from "./actions";
import { formatRelativeTimeFromTimestamp, toTimestamp } from "@/lib/relativeTime";
import { CustomerQuoteStatusCtas } from "./CustomerQuoteStatusCtas";

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
    filePreviews,
  } = workspaceResult.data;
  const customerBidSummariesResult = await loadCustomerQuoteBidSummaries({
    quoteId: quote.id,
    customerEmail: customer.email,
    userEmail: user.email,
    overrideEmail,
  });
  const customerBidSummaries = customerBidSummariesResult.ok ? customerBidSummariesResult.bids : [];
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
  const bidsResult = await loadBidsForQuote(quote.id);
  const bidsUnavailable = !bidsResult.ok;
  const bids = bidsResult.ok && Array.isArray(bidsResult.data)
    ? (bidsResult.data ?? [])
    : [];
  const projectResult = await loadQuoteProjectForQuote(quote.id);
  const hasProject = projectResult.ok;
  const project = hasProject ? projectResult.project : null;
  const projectUnavailable = !hasProject && projectResult.reason !== "not_found";
  const bidCount = bids.length;
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
  let supplierKickoffTasksResult: SupplierKickoffTasksResult | null = null;
  if (winningSupplierId) {
    supplierKickoffTasksResult = await loadQuoteKickoffTasksForSupplier(
      quote.id,
      winningSupplierId,
      { seedIfEmpty: false },
    );
  }
  const kickoffSummary =
    supplierKickoffTasksResult?.ok && supplierKickoffTasksResult.tasks.length > 0
      ? summarizeKickoffTasks(supplierKickoffTasksResult.tasks)
      : null;
  const kickoffSummaryStatus = kickoffSummary?.status ?? null;
  const kickoffSummaryLabel = quoteHasWinner
    ? kickoffSummary
      ? formatKickoffSummaryLabel(kickoffSummary)
      : supplierKickoffTasksResult?.reason === "schema-missing"
        ? "Kickoff checklist unavailable in this environment"
        : "Kickoff begins…"
    : "Select a winning supplier to start kickoff";
  const kickoffSummaryTone =
    kickoffSummary?.status === "complete"
      ? "text-emerald-300"
      : kickoffSummary?.status === "in-progress"
        ? "text-blue-200"
        : "text-slate-200";
  const messagesResult = await loadQuoteMessages(quote.id);
  if (!messagesResult.ok) {
    console.error("[customer quote] messages load failed", {
      quoteId: quote.id,
      error: messagesResult.error ?? messagesResult.reason,
    });
  }
  const quoteMessages = messagesResult.messages;
  const messagesUnavailable = !messagesResult.ok;
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
  const lifecycleLastUpdatedText =
    updatedAtRaw && (!submittedAtRaw || updatedAtRaw !== submittedAtRaw)
      ? updatedAtText
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

  const headerContent = (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">
            RFQ file
          </p>
          <p className="text-sm text-slate-300">{primaryFileName}</p>
        </div>
        <div className="flex max-w-xs flex-col items-start text-left sm:items-end sm:text-right">
          <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-200">
            {quoteStatusLabel}
          </span>
          <p className="mt-1 text-xs text-slate-400">{quoteStatusHelper}</p>
        </div>
      </div>
      <dl className="grid gap-4 text-sm text-slate-300 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Customer
          </dt>
          <dd className="text-slate-100">{customerName ?? "Not provided"}</dd>
        </div>
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Company
          </dt>
          <dd className="text-slate-100">{companyName ?? "Not provided"}</dd>
        </div>
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Target ship date
          </dt>
          <dd className="text-slate-100">{targetDateChipText}</dd>
        </div>
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Fastest lead time
          </dt>
          <dd className="text-slate-100">{leadTimeLabel}</dd>
        </div>
      </dl>
      <div className="flex flex-wrap gap-3 text-xs text-slate-400">
        <span>Submitted {submittedAtText ?? "—"}</span>
        {lifecycleLastUpdatedText ? (
          <span>Last update {lifecycleLastUpdatedText}</span>
        ) : null}
        <span>
          Viewing as{" "}
          <span className="font-mono text-slate-200">{identityEmailDisplay}</span>
        </span>
        {readOnly ? (
          <span className="rounded-full border border-slate-800 bg-slate-900/40 px-3 py-1 text-xs font-semibold text-slate-300">
            Read-only preview
          </span>
        ) : null}
      </div>
    </div>
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
          <p className="text-xs text-slate-400">
            Supplier selection unlocks after you receive your first bid.
          </p>
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
                <CustomerQuoteAwardPanel
                  quoteId={quote.id}
                  bids={customerBidSummaries}
                  canSubmit={customerCanAward}
                  disableReason={customerAwardDisabledReason}
                  winningBidId={winningBidId}
                />
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

  const kickoffPanel = (
    <CustomerKickoffPanel
      hasWinner={Boolean(winningSupplierId)}
      tasksResult={supplierKickoffTasksResult}
      summary={kickoffSummary}
    />
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
    <CollapsibleCard
      title="Quote details"
      description="Status, key dates, and workflow snapshot."
      defaultOpen
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
    </CollapsibleCard>
  );

  const filesSection = (
    <QuoteFilesUploadsSection files={filePreviews} fileCountText={fileCountText} />
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

  const awardSection = (
    <section className="space-y-4">
      {bidSummaryPanel}
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
          <p className="text-xs text-slate-400">
            Supplier selection unlocks after you receive your first bid.
          </p>
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
                <CustomerQuoteAwardPanel
                  quoteId={quote.id}
                  bids={customerBidSummaries}
                  canSubmit={customerCanAward}
                  disableReason={customerAwardDisabledReason}
                  winningBidId={winningBidId}
                />
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

  const kickoffSection = (
    <CollapsibleCard
      id="kickoff"
      title="Kickoff"
      description="Project kickoff details and supplier checklist updates."
      className="scroll-mt-24"
      defaultOpen={quoteHasWinner}
      summary={
        <span className={clsx("rounded-full border px-3 py-1", kickoffSummaryTone)}>
          {kickoffSummaryLabel}
        </span>
      }
    >
      <div className="space-y-4">
        {projectSnapshotCard}
        {projectSection}
        <CustomerKickoffPanel
          hasWinner={Boolean(winningSupplierId)}
          tasksResult={supplierKickoffTasksResult}
          summary={kickoffSummary}
          anchorId={null}
        />
      </div>
    </CollapsibleCard>
  );

  const timelineSection = (
    <CollapsibleCard
      title="Timeline"
      description="Updates and milestones for this RFQ."
      defaultOpen={false}
    >
      <QuoteTimeline
        quoteId={quote.id}
        actorRole="customer"
        actorUserId={user.id}
        emptyState="No updates yet."
      />
    </CollapsibleCard>
  );

  return (
    <PortalShell
      workspace="customer"
      title={headerTitle}
      subtitle="Status updates, files, and shared messages for this RFQ."
      headerContent={headerContent}
      actions={headerActions}
    >
      {receiptBanner}
      <div className="space-y-5 lg:grid lg:grid-cols-[minmax(0,0.65fr)_minmax(0,0.35fr)] lg:gap-5 lg:space-y-0">
        <div className="space-y-5">
          {awardSection}
          {kickoffSection}
          {timelineSection}
          {messagesUnavailable ? (
            <p className="rounded-xl border border-yellow-500/30 bg-yellow-500/5 px-5 py-3 text-sm text-yellow-100">
              Messages are temporarily unavailable. Refresh the page to try again.
            </p>
          ) : null}
          <QuoteMessagesThread
            quoteId={quote.id}
            messages={quoteMessages}
            canPost={!readOnly}
            postAction={postMessageAction}
            currentUserId={user.id}
            title="Messages"
            description="Shared with the Zartman team coordinating this RFQ."
            helperText="Your updates go directly to the Zartman admin team."
            disabledCopy={
              readOnly
                ? "Messages are read-only while you are impersonating another customer."
                : undefined
            }
            emptyStateCopy="No messages yet. Use this space to coordinate build updates and questions."
          />
        </div>
        <div className="space-y-5">
          {filesSection}
          {quoteDetailsSection}
          {notesSection}
        </div>
      </div>
    </PortalShell>
  );
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
  tasksResult,
  summary,
  anchorId,
}: {
  hasWinner: boolean;
  tasksResult: SupplierKickoffTasksResult | null;
  summary: ReturnType<typeof summarizeKickoffTasks> | null;
  anchorId?: string | null;
}) {
  const statusValue =
    summary?.status === "complete"
      ? "Complete"
      : summary?.status === "in-progress"
        ? "In progress"
        : summary?.status === "not-started"
          ? "Not started"
          : "—";
  const completedValue =
    summary ? `${summary.completedCount} / ${summary.totalCount}` : "—";
  const lastUpdatedValue = summary?.lastUpdatedAt
    ? formatRelativeTimeFromTimestamp(toTimestamp(summary.lastUpdatedAt)) ?? "—"
    : "—";

  const tasks: SupplierKickoffTask[] | null =
    hasWinner && tasksResult?.ok && tasksResult.tasks.length > 0
      ? mergeKickoffTasksWithDefaults(tasksResult.tasks)
      : null;

  const pillTone =
    summary?.status === "complete"
      ? "border border-emerald-500/40 bg-emerald-500/10 text-emerald-100"
      : summary?.status === "in-progress"
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
        <div className="rounded-xl border border-slate-900/60 bg-slate-950/30 px-3 py-2">
          <dt className="text-[11px] uppercase tracking-wide text-slate-500">
            Last updated
          </dt>
          <dd className="font-medium text-slate-100">{lastUpdatedValue}</dd>
        </div>
      </dl>

      {!hasWinner ? (
        <p className="mt-4 rounded-xl border border-dashed border-slate-800/70 bg-black/30 px-3 py-2 text-sm text-slate-300">
          Kickoff begins after supplier is selected.
        </p>
      ) : tasks ? (
        <ul className="mt-4 space-y-3">
          {tasks.map((task) => (
            <li
              key={task.taskKey}
              className="flex items-start gap-3 rounded-2xl border border-slate-800 bg-slate-950/50 px-4 py-3"
            >
              <div className="pt-0.5">
                <input
                  type="checkbox"
                  checked={Boolean(task.completed)}
                  disabled
                  readOnly
                  className="size-4 rounded border-slate-700 bg-slate-900 text-emerald-400"
                />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-semibold text-white">{task.title}</p>
                {task.description ? (
                  <p className="text-sm text-slate-300">{task.description}</p>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 rounded-xl border border-dashed border-slate-800/70 bg-black/30 px-3 py-2 text-sm text-slate-300">
          Kickoff not ready yet. Refresh in a moment.
        </p>
      )}
    </section>
  );
}
