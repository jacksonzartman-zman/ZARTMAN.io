import clsx from "clsx";
import type { ReactNode } from "react";
import { formatDateTime } from "@/lib/formatDate";
import { formatCurrency } from "@/lib/formatCurrency";
import { QuoteFilesCard } from "@/app/admin/quotes/[id]/QuoteFilesCard";
import {
  QuoteWorkspaceTabs,
  type QuoteWorkspaceTab,
} from "@/app/admin/quotes/[id]/QuoteWorkspaceTabs";
import { QuoteMessagesThread } from "@/components/quotes/QuoteMessagesThread";
import { CustomerQuoteMessageComposer } from "./CustomerQuoteMessageComposer";
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
import { requireSession } from "@/server/auth";
import { getCustomerByUserId } from "@/server/customers";
import { WorkflowStatusCallout } from "@/components/WorkflowStatusCallout";
import { getNextWorkflowState } from "@/lib/workflow";
import { DataFallbackNotice } from "@/app/(portals)/DataFallbackNotice";
import {
  getQuoteStatusLabel,
  normalizeQuoteStatus,
  isOpenQuoteStatus,
} from "@/server/quotes/status";
import { CustomerBidSelectionCard } from "./CustomerBidSelectionCard";

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

  const session = await requireSession({
    redirectTo: `/customer/quotes/${quoteId}`,
  });
  const emailParam = getSearchParamValue(resolvedSearchParams, "email");
  const overrideEmail = normalizeEmailInput(emailParam);
  const customer = await getCustomerByUserId(session.user.id);

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
  const nextWorkflowState = getNextWorkflowState(normalizedQuoteStatus);
  const bidsResult = await loadBidsForQuote(quote.id);
  const bidsUnavailable = !bidsResult.ok;
  const bids = bidsResult.ok && Array.isArray(bidsResult.data)
    ? (bidsResult.data ?? [])
    : [];
  const bidCount = bids.length;
  const quoteIsOpen = isOpenQuoteStatus(quote.status ?? undefined);
  const quoteIsWon = normalizedQuoteStatus === "won";
  const winningBid =
    bids.find(
      (bid) =>
        typeof bid.status === "string" &&
        bid.status.trim().toLowerCase() === "won",
    ) ?? null;
  const winningBidId = winningBid?.id ?? null;
  const winningBidSelectedAt = winningBid?.updated_at ?? winningBid?.created_at ?? null;
  const canSelectWinner = !readOnly && quoteIsOpen && !quoteIsWon && bidCount > 0;
  let selectWinnerDisabledReason: string | null = null;
  if (readOnly) {
    selectWinnerDisabledReason =
      "Selecting a winner is disabled while you are viewing this workspace in read-only mode.";
  } else if (!quoteIsOpen) {
    selectWinnerDisabledReason =
      "This quote is no longer open for supplier selection.";
  } else if (quoteIsWon) {
    selectWinnerDisabledReason =
      "A winning supplier has already been selected for this quote.";
  } else if (bidCount === 0) {
    selectWinnerDisabledReason =
      "At least one supplier bid is required before awarding the quote.";
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
    quote.email ||
    customer.email ||
    session.user.email ||
    "customer";

  const summaryContent = (
    <div className="space-y-4 lg:grid lg:grid-cols-[minmax(0,0.6fr)_minmax(0,0.4fr)] lg:gap-4 lg:space-y-0">
      <section className={clsx(cardClasses, "space-y-4")}>
        <header className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            RFQ snapshot
          </p>
          <h2 className="text-lg font-semibold text-white">
            Project overview
          </h2>
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
          className="mt-3"
        />
        <dl className="grid gap-3 text-sm text-slate-300 sm:grid-cols-2">
          <div className="rounded-xl border border-slate-900/60 bg-slate-950/40 px-3 py-2">
            <dt className="text-[11px] uppercase tracking-wide text-slate-500">
              Company
            </dt>
            <dd className="text-slate-100">{companyName ?? "Not provided"}</dd>
          </div>
          <div className="rounded-xl border border-slate-900/60 bg-slate-950/40 px-3 py-2">
            <dt className="text-[11px] uppercase tracking-wide text-slate-500">
              Files
            </dt>
            <dd className="text-slate-100">{fileCountText}</dd>
          </div>
          <div className="rounded-xl border border-slate-900/60 bg-slate-950/40 px-3 py-2">
            <dt className="text-[11px] uppercase tracking-wide text-slate-500">
              Submitted
            </dt>
            <dd className="text-slate-100">
              {submittedAtText ?? "—"}
            </dd>
          </div>
          <div className="rounded-xl border border-slate-900/60 bg-slate-950/40 px-3 py-2">
            <dt className="text-[11px] uppercase tracking-wide text-slate-500">
              Last updated
            </dt>
            <dd className="text-slate-100">
              {updatedAtText ?? "—"}
            </dd>
          </div>
        </dl>
      </section>
      <section className={clsx(cardClasses, "space-y-3")}>
        <header>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Notes & guidance
          </p>
          <h2 className="text-lg font-semibold text-white">
            DFM & intake comments
          </h2>
        </header>
        <div className="space-y-4">
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
      </section>
    </div>
  );

    const messagesContent = (
      <section className={cardClasses}>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Messages
        </p>
        <QuoteMessagesThread
          heading="Shared chat"
          description="Collaborate directly with the Zartman admin team on this quote."
          messages={messages}
          messageCount={messages.length}
          error={
            messagesError
              ? "Some messages may be missing. Refresh the page to try again."
              : null
          }
          emptyState={
            <p className="rounded-2xl border border-dashed border-slate-800/70 bg-black/30 px-4 py-4 text-sm text-slate-400">
              No updates yet. Start the conversation below to keep things moving.
            </p>
          }
          containerClassName="mt-3"
        />

        <div className="mt-4 border-t border-slate-900/60 pt-4">
          <p className="text-sm font-semibold text-slate-100">Post a message</p>
          <p className="mt-1 text-xs text-slate-500">
            Shared with admins and suppliers supporting this RFQ.
          </p>
            {readOnly ? (
              <p className="mt-2 rounded-xl border border-dashed border-slate-800/70 bg-black/30 px-3 py-2 text-xs text-slate-400">
                Read-only preview. Remove the ?email override to reply as the customer.
              </p>
            ) : null}
          <div className="mt-3">
            <CustomerQuoteMessageComposer
              quoteId={quote.id}
              customerName={customerName}
                disabled={readOnly}
            />
          </div>
        </div>
      </section>
    );

  const filesContent = (
    <div className="space-y-2">
      <QuoteFilesCard files={filePreviews} className="scroll-mt-20" />
      {filesUnavailable ? (
        <>
          <p className="px-1 text-xs text-slate-500">
            File metadata is temporarily unavailable. Download links fall back to the
            original upload while we resync.
          </p>
          <DataFallbackNotice className="px-1" />
        </>
      ) : null}
    </div>
  );

  const trackingContent = (
    <section className={cardClasses}>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        Tracking
      </p>
      <h2 className="mt-1 text-lg font-semibold text-white">
        Production milestones
      </h2>
      <p className="mt-2 text-sm text-slate-300">
        We&apos;ll surface build partners, PO details, and schedule checkpoints
        here as we expand the customer portal experience.
      </p>
    </section>
  );

  const tabs: {
    id: QuoteWorkspaceTab;
    label: string;
    count?: number;
    content: ReactNode;
  }[] = [
    { id: "summary", label: "Summary", content: summaryContent },
    {
      id: "messages",
      label: "Messages",
      count: messages.length,
      content: messagesContent,
    },
    { id: "viewer", label: "Files", content: filesContent },
    { id: "tracking", label: "Tracking", content: trackingContent },
  ];

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-900 bg-slate-950/40 p-4">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-emerald-300">
          Quote workspace
        </p>
        <div className="mt-2 space-y-1">
          <h1 className="text-2xl font-semibold text-white">
            {customerName} · {formatQuoteId(quote.id)}
          </h1>
          <p className="text-sm text-slate-400">
            Status updates, files, and shared messages for this RFQ.
          </p>
        </div>
      <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-xs text-slate-400">
          <span>
            Viewing as{" "}
            <span className="font-mono text-slate-200">{identityEmailDisplay}</span>
          </span>
          <span>
            Quote status:{" "}
            <span className="font-semibold text-emerald-200">
              {quoteStatusLabel}
            </span>
          </span>
            {readOnly ? (
              <span className="rounded-full border border-slate-800 bg-slate-900/40 px-3 py-1 text-xs font-semibold text-slate-300">
                Read-only preview
              </span>
            ) : null}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-900 bg-slate-950/40 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Quote status
          </p>
          <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-200">
            {quoteStatusLabel}
          </span>
        </div>
        {submittedAtText || lifecycleLastUpdatedText ? (
          <dl className="mt-3 space-y-2 text-sm text-slate-300">
            {submittedAtText ? (
              <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
                <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Submitted
                </dt>
                <dd className="text-slate-100">{submittedAtText}</dd>
              </div>
            ) : null}
            {lifecycleLastUpdatedText ? (
              <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
                <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Last updated
                </dt>
                <dd className="text-slate-100">{lifecycleLastUpdatedText}</dd>
              </div>
            ) : null}
          </dl>
        ) : null}
      </section>

      <section className="rounded-2xl border border-slate-900 bg-slate-950/40 p-4">
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
        <p className="mt-3 text-xs text-slate-400">
          Once bids are in, we&apos;ll review options and update your quote status.
        </p>
        {bidsUnavailable ? (
          <p className="mt-3 text-xs text-slate-400">
            Supplier bidding isn&apos;t enabled in this environment yet. Your RFQ is still in review.
          </p>
        ) : bidCount === 0 ? (
          <p className="mt-3 text-xs text-slate-400">
            No supplier bids yet. We&apos;ll notify you when bids arrive.
          </p>
        ) : (
          <>
            <dl className="mt-4 grid gap-3 text-sm text-slate-200 sm:grid-cols-3">
              <div>
                <dt className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                  Best price
                </dt>
                <dd className="mt-1">
                  {bestPriceValue != null
                    ? formatCurrency(
                        bestPriceValue,
                        bestPriceCurrency ?? undefined,
                      )
                    : "Pending"}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                  Fastest lead time
                </dt>
                <dd className="mt-1">
                  {fastestLeadTime != null
                    ? `${fastestLeadTime} day${fastestLeadTime === 1 ? "" : "s"}`
                    : "Pending"}
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
            <CustomerBidSelectionCard
              quoteId={quote.id}
              bids={bids}
              canSelectWinner={canSelectWinner}
              disableReason={selectWinnerDisabledReason}
              winningBidId={winningBidId}
              winningBidSelectedAt={winningBidSelectedAt}
              quoteWon={quoteIsWon}
            />
          </>
        )}
      </section>

      <QuoteWorkspaceTabs tabs={tabs} defaultTab="summary" />
    </div>
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
