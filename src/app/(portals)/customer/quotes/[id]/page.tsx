import clsx from "clsx";
import Link from "next/link";
import { formatDateTime } from "@/lib/formatDate";
import { formatCurrency } from "@/lib/formatCurrency";
import {
  buildCustomerQuoteTimeline,
  type QuoteTimelineEvent,
} from "@/lib/quote/tracking";
import { QuoteFilesCard } from "@/app/admin/quotes/[id]/QuoteFilesCard";
import PortalCard from "@/app/(portals)/PortalCard";
import { PortalShell } from "@/app/(portals)/components/PortalShell";
import { CustomerQuoteMessagesCard } from "./CustomerQuoteMessagesCard";
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
import { requireUser } from "@/server/auth";
import { getCustomerByUserId } from "@/server/customers";
import { WorkflowStatusCallout } from "@/components/WorkflowStatusCallout";
import { getNextWorkflowState } from "@/lib/workflow";
import { DataFallbackNotice } from "@/app/(portals)/DataFallbackNotice";
import {
  getQuoteStatusLabel,
  getQuoteStatusHelper,
  normalizeQuoteStatus,
} from "@/server/quotes/status";
import { CustomerBidSelectionCard } from "./CustomerBidSelectionCard";
import { CustomerQuoteTrackingCard } from "./CustomerQuoteTrackingCard";
import { CustomerQuoteProjectCard } from "./CustomerQuoteProjectCard";
import { loadQuoteProject } from "@/server/quotes/projects";

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
    messages,
    messagesError,
    filesUnavailable,
  } = workspaceResult.data;
  const normalizedQuoteEmail = normalizeEmailInput(quote.email);
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
      quoteEmail: quote.email,
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
  console.log("[customer quote] loaded", {
    quoteId: quote.id,
    uploadId: quote.upload_id,
    customerEmail: quote.email,
  });

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
  const projectResult = await loadQuoteProject(quote.id);
  const project = projectResult.data;
  const projectUnavailable = projectResult.unavailable;
  console.info("[customer quote] project loaded", {
    quoteId: quote.id,
    hasProject: Boolean(project),
    unavailable: projectUnavailable,
  });
  const bidCount = bids.length;
  const timelineEvents: QuoteTimelineEvent[] = buildCustomerQuoteTimeline({
    quote,
    bids,
    project,
  });
  console.log("[customer quote] tracking events built", {
    quoteId: quote.id,
    eventCount: timelineEvents.length,
  });
  const quoteIsWon = normalizedQuoteStatus === "won";
  const quoteAllowsCustomerAward =
    normalizedQuoteStatus === "quoted" || normalizedQuoteStatus === "approved";
  const winningBid =
    bids.find(
      (bid) =>
        typeof bid.status === "string" &&
        bid.status.trim().toLowerCase() === "won",
    ) ?? null;
  const winningBidId = winningBid?.id ?? null;
  const quoteHasWinner = Boolean(winningBidId);
  const showCustomerSupplierSection = bidCount > 0;
  const showCustomerAwardButtons =
    quoteAllowsCustomerAward &&
    bidCount > 0 &&
    !quoteIsWon &&
    !quoteHasWinner &&
    !readOnly;
  let customerAwardDisabledReason: string | null = null;
  if (showCustomerSupplierSection && !showCustomerAwardButtons) {
    if (readOnly) {
      customerAwardDisabledReason =
        "Selecting a winner is disabled while you are viewing this workspace in read-only mode.";
    } else if (quoteIsWon || quoteHasWinner) {
      customerAwardDisabledReason =
        "A winning supplier has already been selected for this quote.";
    } else if (!quoteAllowsCustomerAward) {
      customerAwardDisabledReason =
        "We’ll unlock supplier selection after your quote is prepared. We’re still collecting bids and preparing the final pricing.";
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
    filePreviews.length === 0
      ? "No files attached"
      : filePreviews.length === 1
        ? "1 file attached"
        : `${filePreviews.length} files attached`;
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
    quote.email || customer.email || user.email || "customer";

  const fileNameCandidates = [
    filePreviews[0]?.label,
    filePreviews[0]?.fileName,
    quote.file_name,
  ].filter((value): value is string => Boolean(value && value.trim()));
  const primaryFileName = fileNameCandidates[0] ?? formatQuoteId(quote.id);
  const leadTimeLabel =
    fastestLeadTime != null
      ? `${fastestLeadTime} day${fastestLeadTime === 1 ? "" : "s"}`
      : "Pending";
  const headerTitle = `${customerName ?? "RFQ"} · ${formatQuoteId(quote.id)}`;
  const headerActions = (
    <Link
      href="/customer/quotes"
      className="inline-flex items-center rounded-full border border-emerald-400/40 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-emerald-100 transition hover:border-emerald-300 hover:text-white"
    >
      Back to quotes
    </Link>
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
            No supplier bids yet. We&apos;ll notify you when bids arrive.
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
              <CustomerBidSelectionCard
                quoteId={quote.id}
                bids={bids}
                showAwardButtons={showCustomerAwardButtons}
                disableReason={customerAwardDisabledReason}
                winningBidId={winningBidId}
                quoteWon={quoteIsWon}
              />
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

  const messagesUnavailable = Boolean(messagesError);

  return (
    <PortalShell
      workspace="customer"
      title={headerTitle}
      subtitle="Status updates, files, and shared messages for this RFQ."
      headerContent={headerContent}
      actions={headerActions}
    >
      {receiptBanner}
      {summaryCard}
      {projectSection}
      <CustomerQuoteMessagesCard
        quoteId={quote.id}
        messages={messages}
        messagesUnavailable={messagesUnavailable}
        readOnly={readOnly}
      />
      <div className="space-y-2">
        <QuoteFilesCard files={filePreviews} className="scroll-mt-20" />
        {filesUnavailable ? (
          <>
            <p className="px-1 text-xs text-slate-500">
              File metadata is temporarily unavailable. Download links fall back to the original upload
              while we resync.
            </p>
            <DataFallbackNotice className="px-1" />
          </>
        ) : null}
      </div>
      <CustomerQuoteTrackingCard className={cardClasses} events={timelineEvents} />
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
