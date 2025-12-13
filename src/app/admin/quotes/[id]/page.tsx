// src/app/admin/quotes/[id]/page.tsx

import clsx from "clsx";
import Link from "next/link";
import type { ReactNode } from "react";
import { formatDateTime } from "@/lib/formatDate";
import { formatAwardedByLabel, formatShortId } from "@/lib/awards";
import { supabaseServer } from "@/lib/supabaseServer";
import {
  loadQuoteMessages,
  type QuoteMessageRecord,
} from "@/server/quotes/messages";
import { getQuoteFilePreviews } from "@/server/quotes/files";
import type { UploadMeta } from "@/server/quotes/types";
import {
  DEFAULT_QUOTE_STATUS,
  QUOTE_STATUS_LABELS,
  normalizeQuoteStatus,
  type QuoteStatus,
} from "@/server/quotes/status";
import { loadQuoteBidAggregates } from "@/server/quotes/bidAggregates";
import {
  formatAdminBestPriceLabel,
  formatAdminBidCountLabel,
  formatAdminLeadTimeLabel,
} from "@/server/quotes/adminSummary";
import AdminDashboardShell from "../../AdminDashboardShell";
import QuoteUpdateForm from "../QuoteUpdateForm";
import { QuoteMessagesThread } from "@/app/(portals)/components/QuoteMessagesThread";
import { QuoteEventsTimeline } from "@/app/(portals)/components/QuoteEventsTimeline";
import { QuoteFilesCard } from "./QuoteFilesCard";
import { ctaSizeClasses, primaryCtaClasses, secondaryCtaClasses } from "@/lib/ctas";
import {
  deriveAdminQuoteAttentionState,
  loadAdminQuoteDetail,
} from "@/server/admin/quotes";
import { isWinningBidStatus } from "@/lib/bids/status";
import { loadBidsForQuote } from "@/server/bids";
import { loadAdminUploadDetail } from "@/server/admin/uploads";
import { listSupplierBidsForQuote } from "@/server/suppliers/bids";
import { SupplierBidsCard, type AdminSupplierBidRow } from "./SupplierBidsCard";
import {
  loadQuoteProjectForQuote,
  type QuoteProjectRecord,
} from "@/server/quotes/projects";
import { AdminQuoteProjectCard } from "./AdminQuoteProjectCard";
import {
  loadQuoteKickoffTasksForSupplier,
  summarizeKickoffTasks,
  formatKickoffSummaryLabel,
  type SupplierKickoffTasksResult,
} from "@/server/quotes/kickoffTasks";
import { listQuoteEventsForQuote } from "@/server/quotes/events";
import { postQuoteMessage as postAdminQuoteMessage } from "./actions";
import { PortalContainer } from "@/app/(portals)/components/PortalContainer";
import { CollapsibleCard } from "@/components/CollapsibleCard";
import { AdminDecisionCtas } from "./AdminDecisionCtas";
import { AdminInviteSupplierCard } from "./AdminInviteSupplierCard";
import { HashScrollLink } from "@/app/(portals)/components/hashScroll";
import { formatRelativeTimeFromTimestamp, toTimestamp } from "@/lib/relativeTime";

export const dynamic = "force-dynamic";

type QuoteDetailPageProps = {
  params: Promise<{ id: string }>;
};

export default async function QuoteDetailPage({ params }: QuoteDetailPageProps) {
  const resolvedParams = await params;

  const quoteResult = await loadAdminQuoteDetail(resolvedParams.id);

  if (!quoteResult.ok) {
    return (
      <main className="py-10">
        <PortalContainer>
          <section className="mx-auto max-w-3xl rounded-2xl border border-red-500/30 bg-red-950/40 p-6 text-center">
            <h1 className="text-xl font-semibold text-red-50">
              We had trouble loading this quote.
            </h1>
            <p className="mt-2 text-sm text-red-100">
              Check logs and try again. The quote data stayed untouched.
            </p>
            <div className="mt-4">
              <Link
                href="/admin/quotes"
                className={clsx(
                  secondaryCtaClasses,
                  ctaSizeClasses.sm,
                  "inline-flex",
                )}
              >
                Back to quotes
              </Link>
            </div>
          </section>
        </PortalContainer>
      </main>
    );
  }

  const quote = quoteResult.data;

  if (!quote) {
    return (
      <main className="py-10">
        <PortalContainer>
          <section className="mx-auto max-w-3xl rounded-2xl border border-slate-800 bg-slate-950/60 p-6 text-center">
            <h1 className="text-xl font-semibold text-slate-50">
              Quote not found
            </h1>
            <p className="mt-2 text-sm text-slate-400">
              We couldn’t find a quote with ID{" "}
              <span className="font-mono text-slate-200">
                {resolvedParams.id}
              </span>
              .
            </p>
            <div className="mt-4">
              <Link
                href="/admin/quotes"
                className={clsx(
                  secondaryCtaClasses,
                  ctaSizeClasses.sm,
                  "inline-flex",
                )}
              >
                Back to quotes
              </Link>
            </div>
          </section>
        </PortalContainer>
      </main>
    );
  }

  let inviteCount = 0;
  try {
    const { count, error } = await supabaseServer
      .from("quote_invites")
      .select("id", { count: "exact", head: true })
      .eq("quote_id", quote.id);
    if (!error && typeof count === "number") {
      inviteCount = count;
    }
  } catch (error) {
    console.warn("[admin quote] invite count lookup crashed", {
      quoteId: quote.id,
      error,
    });
  }

  let assignedSupplierEmail: string | null = null;
  let assignedSupplierName: string | null = null;
  try {
    const { data, error } = await supabaseServer
      .from("quotes")
      .select("assigned_supplier_email,assigned_supplier_name")
      .eq("id", quote.id)
      .maybeSingle<{
        assigned_supplier_email: string | null;
        assigned_supplier_name: string | null;
      }>();
    if (!error && data) {
      assignedSupplierEmail = data.assigned_supplier_email ?? null;
      assignedSupplierName = data.assigned_supplier_name ?? null;
    }
  } catch (error) {
    console.warn("[admin quote] assigned supplier lookup crashed", {
      quoteId: quote.id,
      error,
    });
  }

  const projectResult = await loadQuoteProjectForQuote(quote.id);
  const hasProject = projectResult.ok;
  const project = hasProject ? projectResult.project : null;
  const projectUnavailable = !hasProject && projectResult.reason !== "not_found";

  let uploadMeta: UploadMeta | null = null;
  if (quote.upload_id) {
    const uploadResult = await loadAdminUploadDetail(quote.upload_id);
    if (!uploadResult.ok) {
      console.warn("Failed to load upload metadata for quote", {
        uploadId: quote.upload_id,
        error: uploadResult.error,
      });
    } else if (uploadResult.data) {
      const data = uploadResult.data;
      uploadMeta = {
        first_name: data.first_name,
        last_name: data.last_name,
        phone: data.phone,
        company: data.company,
        manufacturing_process: data.manufacturing_process,
        quantity: data.quantity,
        shipping_postal_code: data.shipping_postal_code,
        export_restriction: data.export_restriction,
        rfq_reason: data.rfq_reason,
        notes: data.notes,
        itar_acknowledged: data.itar_acknowledged,
        terms_accepted: data.terms_accepted,
      };
    }
  }

    const status: QuoteStatus = normalizeQuoteStatus(
      quote.status ?? DEFAULT_QUOTE_STATUS,
    );
    const customerName =
      [uploadMeta?.first_name, uploadMeta?.last_name]
        .filter((value) => typeof value === "string" && value.trim().length > 0)
        .map((value) => (value ?? "").trim())
        .join(" ")
        .trim() ||
      (typeof quote.customer_name === "string" &&
      quote.customer_name.trim().length > 0
        ? quote.customer_name
        : "Unknown customer");
    const customerEmail =
      typeof quote.customer_email === "string" && quote.customer_email.includes("@")
        ? quote.customer_email
        : null;
    const companyName =
      (typeof uploadMeta?.company === "string" &&
      (uploadMeta?.company ?? "").trim().length > 0
        ? uploadMeta?.company
        : null) ||
      (typeof quote.company === "string" && quote.company.trim().length > 0
        ? quote.company
        : null);
    const contactPhone =
      typeof uploadMeta?.phone === "string" && uploadMeta.phone.trim().length > 0
        ? uploadMeta.phone.trim()
        : null;
    const intakeSummaryItems = uploadMeta
      ? [
          {
            label: "Company",
            value: uploadMeta.company || companyName || "—",
          },
          {
            label: "Manufacturing process",
            value: uploadMeta.manufacturing_process || "—",
          },
          {
            label: "Quantity / volumes",
            value: uploadMeta.quantity || "—",
          },
          {
            label: "Export restriction",
            value: uploadMeta.export_restriction || "—",
          },
          {
            label: "Shipping ZIP / Postal code",
            value: uploadMeta.shipping_postal_code || "—",
          },
          {
            label: "RFQ reason",
            value: uploadMeta.rfq_reason || "—",
          },
          {
            label: "ITAR acknowledgement",
            value: uploadMeta.itar_acknowledged ? "Acknowledged" : "Not confirmed",
          },
          {
            label: "Terms acceptance",
            value: uploadMeta.terms_accepted ? "Accepted" : "Not accepted",
          },
        ]
      : null;
    const intakeNotes =
      typeof uploadMeta?.notes === "string" && uploadMeta.notes.trim().length > 0
        ? uploadMeta.notes
        : null;
    const normalizedPrice =
      typeof quote.price === "number"
        ? quote.price
        : typeof quote.price === "string"
          ? Number(quote.price)
          : null;
    const priceValue =
      typeof normalizedPrice === "number" && Number.isFinite(normalizedPrice)
        ? normalizedPrice
        : null;
    const currencyValue =
      typeof quote.currency === "string" && quote.currency.trim().length > 0
        ? quote.currency.trim().toUpperCase()
        : null;
    const targetDateValue =
      typeof quote.target_date === "string" && quote.target_date.trim().length > 0
        ? quote.target_date
        : null;
    const statusLabel = QUOTE_STATUS_LABELS[status] ?? "Unknown";
    const filePreviews = await getQuoteFilePreviews(quote);
    const dfmNotes =
      typeof quote.dfm_notes === "string" && quote.dfm_notes.trim().length > 0
        ? quote.dfm_notes
        : null;
    const internalNotes =
      typeof quote.internal_notes === "string" &&
      quote.internal_notes.trim().length > 0
        ? quote.internal_notes
        : null;
    const messagesResult = await loadQuoteMessages(quote.id);
    if (!messagesResult.ok) {
      console.error("Failed to load quote messages", {
        quoteId: quote.id,
        error: messagesResult.error ?? messagesResult.reason,
      });
    }
    const quoteMessages: QuoteMessageRecord[] = messagesResult.messages;
    const quoteMessagesError = messagesResult.ok ? null : messagesResult.error;
    const bidsResult = await loadBidsForQuote(quote.id);
    const bidAggregateMap = await loadQuoteBidAggregates([quote.id]);
    const bidAggregate = bidAggregateMap[quote.id];
    const baseBids = bidsResult.ok ? bidsResult.data : [];
    let bids: AdminSupplierBidRow[] = baseBids.map((bid) => ({
      ...bid,
      supplier: null,
    }));

    if (baseBids.length > 0) {
      try {
        const enrichedBids = await listSupplierBidsForQuote(quote.id);
        if (enrichedBids.length > 0) {
          const supplierByBidId = new Map(
            enrichedBids.map((bid) => [bid.id, bid.supplier ?? null]),
          );
          bids = baseBids.map((bid) => ({
            ...bid,
            supplier: supplierByBidId.get(bid.id) ?? null,
          }));
        }
      } catch (error) {
        console.error("[admin quote] enriched bids failed", {
          quoteId: quote.id,
          error,
        });
      }
    }

    const fallbackBestPriceBid = findBestPriceBid(bids);
    const fallbackBestPriceAmount =
      typeof fallbackBestPriceBid?.amount === "number" &&
      Number.isFinite(fallbackBestPriceBid.amount)
        ? fallbackBestPriceBid.amount
        : null;
    const fallbackBestPriceCurrency = fallbackBestPriceBid?.currency ?? null;
    const fallbackFastestLeadTime = findFastestLeadTime(bids);
    const aggregateBidCount = bidAggregate?.bidCount ?? bids.length;
    const canonicalAwardedBidId =
      typeof quote.awarded_bid_id === "string" ? quote.awarded_bid_id.trim() : "";
    const hasWinningBid =
      Boolean(canonicalAwardedBidId) ||
      Boolean(quote.awarded_supplier_id) ||
      Boolean(quote.awarded_at) ||
      bids.some((bid) => isWinningBidStatus(bid?.status));
    const winningBidRow =
      (canonicalAwardedBidId
        ? bids.find((bid) => bid.id === canonicalAwardedBidId) ?? null
        : null) ??
      bids.find((bid) => isWinningBidStatus(bid?.status)) ??
      null;
    let supplierKickoffTasksResult: SupplierKickoffTasksResult | null = null;
    if (winningBidRow?.supplier_id) {
      supplierKickoffTasksResult = await loadQuoteKickoffTasksForSupplier(
        quote.id,
        winningBidRow.supplier_id,
      );
    }
    const kickoffSummary =
      supplierKickoffTasksResult?.ok
        ? summarizeKickoffTasks(supplierKickoffTasksResult.tasks)
        : null;
    const kickoffSummaryLabel = hasWinningBid
      ? kickoffSummary
        ? formatKickoffSummaryLabel(kickoffSummary)
        : supplierKickoffTasksResult?.reason === "schema-missing"
          ? "Checklist unavailable in this environment"
          : "Checklist unavailable"
      : "Waiting for winner";
    const kickoffSummaryTone =
      kickoffSummary?.status === "complete"
        ? "text-emerald-300"
        : kickoffSummary?.status === "in-progress"
          ? "text-blue-200"
          : "text-slate-200";
    const kickoffStatusValue =
      kickoffSummary?.status === "complete"
        ? "Complete"
        : kickoffSummary?.status === "in-progress"
          ? "In progress"
          : kickoffSummary?.status === "not-started"
            ? "Not started"
            : "—";
    const kickoffCompletedValue = kickoffSummary
      ? `${kickoffSummary.completedCount} / ${kickoffSummary.totalCount}`
      : "—";
    const kickoffLastUpdatedValue = kickoffSummary?.lastUpdatedAt
      ? formatRelativeTimeFromTimestamp(toTimestamp(kickoffSummary.lastUpdatedAt)) ?? "—"
      : "—";
    const attentionState = deriveAdminQuoteAttentionState({
      quoteId: quote.id,
      status,
      bidCount: aggregateBidCount,
      hasWinner: hasWinningBid,
      hasProject,
    });
    const quoteEventsResult = await listQuoteEventsForQuote(quote.id);
    const quoteEvents = quoteEventsResult.ok ? quoteEventsResult.events : [];

    const headerTitleSource = companyName || customerName || "Unnamed customer";
    const headerTitle = `Quote for ${headerTitleSource}`;
    const headerDescription =
      "Details, files, pricing, and messages for this RFQ.";
    const cardClasses =
      "rounded-2xl border border-slate-800 bg-slate-950/60 px-5 py-4";
    const pillBaseClasses =
      "flex min-w-max items-center gap-1 rounded-full border px-3 py-1 text-xs font-semibold";
    const secondaryPillClasses =
      "border-slate-800 bg-slate-950/50 text-slate-200 hover:border-emerald-400 hover:text-emerald-100 transition";
    const priceChipText =
      typeof priceValue === "number"
        ? `${(currencyValue ?? "USD").toUpperCase()} ${priceValue.toFixed(2)}`
        : "Not set";
    const targetDateChipText = targetDateValue
      ? formatDateTime(targetDateValue)
      : "Not set";
    const fileCountText =
      filePreviews.length === 0
        ? "None attached"
        : filePreviews.length === 1
          ? "1 attached"
          : `${filePreviews.length} attached`;
    const fileCardAnchorId = "quote-files-card";
    const bidCountLabel =
      bidAggregate && aggregateBidCount >= 0
        ? formatAdminBidCountLabel(bidAggregate)
        : aggregateBidCount === 0
          ? "No bids yet"
          : `${aggregateBidCount} bid${aggregateBidCount === 1 ? "" : "s"} received`;
    const bestPriceDisplay =
      formatAdminBestPriceLabel(
        bidAggregate?.bestPriceAmount ?? fallbackBestPriceAmount,
        bidAggregate?.bestPriceCurrency ?? fallbackBestPriceCurrency,
      ) ?? (aggregateBidCount > 0 ? "Awaiting pricing" : "Pending");
    const fastestLeadTimeDisplay =
      formatAdminLeadTimeLabel(
        bidAggregate?.fastestLeadTimeDays ?? fallbackFastestLeadTime,
      ) ?? (aggregateBidCount > 0 ? "Awaiting lead time" : "Pending");
    const lastBidAtLabel =
      bidAggregate?.lastBidAt
        ? formatDateTime(bidAggregate.lastBidAt, { includeTime: true })
        : aggregateBidCount > 0
          ? "See bid table"
          : "No bids yet";
    const winningBidExists = bidAggregate?.hasWinningBid || hasWinningBid;
    const fallbackWinningAmount =
      typeof winningBidRow?.amount === "number" ? winningBidRow.amount : null;
    const fallbackWinningCurrency = winningBidRow?.currency ?? null;
    const winningBidAmountLabel =
      formatAdminBestPriceLabel(
        bidAggregate?.winningBidAmount ?? fallbackWinningAmount,
        bidAggregate?.winningBidCurrency ?? fallbackWinningCurrency,
      ) ?? bestPriceDisplay;
    const fallbackWinningLeadTime =
      typeof winningBidRow?.lead_time_days === "number"
        ? winningBidRow.lead_time_days
        : null;
    const winningLeadTimeLabel =
      formatAdminLeadTimeLabel(
        bidAggregate?.winningBidLeadTimeDays ?? fallbackWinningLeadTime,
      ) ?? fastestLeadTimeDisplay;
    const winningSupplierName =
      winningBidRow?.supplier?.company_name ??
      winningBidRow?.supplier?.primary_email ??
      winningBidRow?.supplier_id ??
      null;
    const winningSupplierEmail =
      winningBidRow?.supplier?.primary_email ?? null;
    const awardedAtLabel = quote.awarded_at
      ? formatDateTime(quote.awarded_at, { includeTime: true })
      : null;
    const awardedByLabel = formatAwardedByLabel(quote.awarded_by_role);
    const awardedBidDisplayId = quote.awarded_bid_id ?? winningBidRow?.id ?? null;
    const awardedBidDisplay =
      awardedBidDisplayId
        ? `${formatShortId(awardedBidDisplayId)} · ${winningSupplierName ?? "Supplier selected"}`
        : winningSupplierName ?? "Supplier selected";

    const winningBidCallout = winningBidExists ? (
      <div className="mt-4 rounded-xl border border-emerald-500/40 bg-emerald-500/5 px-4 py-3 text-sm text-emerald-100">
        <div className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-wide text-emerald-200">
          <span className="pill pill-success px-3 py-0.5 text-[11px] font-semibold">
            Winning supplier
          </span>
          <span>Award locked in</span>
        </div>
        <p className="mt-2 text-base font-semibold text-white">
          {winningSupplierName ?? "Supplier selected"}
        </p>
        {winningSupplierEmail ? (
          <a
            href={`mailto:${winningSupplierEmail}`}
            className="text-xs text-emerald-200 hover:underline"
          >
            {winningSupplierEmail}
          </a>
        ) : null}
        <p className="mt-1 text-xs text-emerald-100">
          {winningBidAmountLabel} • {winningLeadTimeLabel}
        </p>
      </div>
    ) : null;

    const bidSummaryPanel = (
      <section className="rounded-2xl border border-slate-900 bg-slate-950/40 px-6 py-4 text-sm text-slate-200">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Bid summary
            </p>
            <p className="text-xs text-slate-400">
              {aggregateBidCount > 0
                ? "Latest supplier bidding snapshot."
                : "We’ll surface supplier bids here as they arrive."}
            </p>
          </div>
          <span className="rounded-full border border-slate-800 bg-slate-900/60 px-3 py-1 text-xs font-semibold text-slate-100">
            {bidCountLabel}
          </span>
        </div>
        <dl className="mt-4 grid gap-4 text-slate-100 sm:grid-cols-3">
          <div>
            <dt className="text-[11px] uppercase tracking-wide text-slate-500">
              Best price
            </dt>
            <dd className="mt-1 font-semibold">{bestPriceDisplay}</dd>
          </div>
          <div>
            <dt className="text-[11px] uppercase tracking-wide text-slate-500">
              Fastest lead time
            </dt>
            <dd className="mt-1 font-semibold">{fastestLeadTimeDisplay}</dd>
          </div>
          <div>
            <dt className="text-[11px] uppercase tracking-wide text-slate-500">
              Last bid
            </dt>
            <dd className="mt-1 font-semibold">{lastBidAtLabel}</dd>
          </div>
        </dl>
        {winningBidCallout}
      </section>
    );

    const workflowPanel = (
      <section className="rounded-2xl border border-slate-900 bg-slate-950/40 px-6 py-4 text-sm text-slate-200">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          Workflow & next steps
        </p>
        <div className="mt-4 space-y-4">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-slate-500">
              Next action
            </p>
            <p
              className={clsx(
                "mt-1 font-semibold",
                attentionState.needsDecision ? "text-amber-200" : "text-slate-300",
              )}
            >
              {attentionState.needsDecision
                ? "Needs award decision"
                : "No pending actions"}
            </p>
          </div>
        </div>
      </section>
    );

    const kickoffStatusPanel = (
      <section className="rounded-2xl border border-slate-900 bg-slate-950/40 px-6 py-4 text-sm text-slate-200">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Kickoff status
            </p>
            <p className={clsx("mt-1 font-semibold", kickoffSummaryTone)}>
              {kickoffSummaryLabel}
            </p>
          </div>
          <HashScrollLink
            hash="kickoff"
            className={clsx(primaryCtaClasses, ctaSizeClasses.sm, "whitespace-nowrap")}
          >
            View kickoff
          </HashScrollLink>
        </div>
        <dl className="mt-4 grid gap-3 text-slate-100 sm:grid-cols-3">
          <SnapshotField label="Status" value={kickoffStatusValue} />
          <SnapshotField label="Completed" value={kickoffCompletedValue} />
          <SnapshotField label="Last updated" value={kickoffLastUpdatedValue} />
        </dl>
      </section>
    );
    const awardAuditPanel =
      quote.awarded_at || quote.awarded_bid_id || winningBidExists ? (
        <section className="rounded-2xl border border-slate-900 bg-slate-950/40 px-6 py-4 text-sm text-slate-200">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Winner audit
          </p>
          <dl className="mt-4 grid gap-3 text-slate-100 sm:grid-cols-3">
            <div>
              <dt className="text-[11px] uppercase tracking-wide text-slate-500">
                Awarded at
              </dt>
              <dd className="mt-1 font-semibold">
                {awardedAtLabel ?? "Pending"}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] uppercase tracking-wide text-slate-500">
                Awarded by
              </dt>
              <dd className="mt-1 font-semibold">{awardedByLabel}</dd>
            </div>
            <div>
              <dt className="text-[11px] uppercase tracking-wide text-slate-500">
                Winning bid
              </dt>
              <dd className="mt-1 font-semibold">{awardedBidDisplay}</dd>
            </div>
          </dl>
        </section>
      ) : null;

    const projectSnapshotPanel =
      hasProject && project ? (
        <section className="rounded-2xl border border-slate-900 bg-slate-950/40 px-6 py-4 text-sm text-slate-200">
          <header className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Project snapshot
              </p>
              <h2 className="text-base font-semibold text-slate-100">Winner handoff</h2>
            </div>
            <span
              className={clsx(
                "rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-wide",
                mapProjectStatusToPill(project.status).pillClasses,
              )}
            >
              {mapProjectStatusToPill(project.status).label}
            </span>
          </header>
          {projectUnavailable ? (
            <p className="mt-3 rounded-xl border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-100">
              Project details are temporarily unavailable.
            </p>
          ) : null}
          <dl className="mt-4 grid gap-3 text-slate-100 sm:grid-cols-2">
            <SnapshotField
              label="Created"
              value={
                project.created_at
                  ? formatDateTime(project.created_at, { includeTime: true }) ?? project.created_at
                  : "Awaiting kickoff"
              }
            />
            <SnapshotField
              label="Winning supplier"
              value={winningSupplierName ?? "Supplier selected"}
            />
            <SnapshotField label="Winning bid" value={winningBidAmountLabel} />
            <SnapshotField label="Lead time" value={winningLeadTimeLabel} />
          </dl>
          <p className="mt-3 text-xs text-slate-400">
            {kickoffSummaryLabel} &middot; keep supplier + customer in sync via messages below.
          </p>
        </section>
      ) : null;

    const rfqSummaryCard = (
      <section className={cardClasses}>
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            RFQ summary
          </p>
          <h2 className="text-base font-semibold text-slate-100">
            Intake snapshot
          </h2>
        </div>
        {intakeSummaryItems ? (
          <dl className="mt-4 grid gap-4 text-sm text-slate-200 sm:grid-cols-2">
            {intakeSummaryItems.map((item) => (
              <div
                key={item.label}
                className="space-y-1 rounded-xl border border-slate-900/60 bg-slate-950/30 px-3 py-2"
              >
                <dt className="text-[11px] uppercase tracking-wide text-slate-500">
                  {item.label}
                </dt>
                <dd className="font-medium text-slate-100">{item.value}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="mt-3 text-sm text-slate-400">
            No structured intake metadata was captured for this quote.
          </p>
        )}
      </section>
    );

    const projectNotesCard = (
      <section className={cardClasses}>
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Project details / notes
          </p>
          <h2 className="text-base font-semibold text-slate-100">
            Customer notes
          </h2>
        </div>
        <p className="mt-3 whitespace-pre-line text-sm text-slate-200">
          {intakeNotes ?? "No additional notes captured during intake."}
        </p>
      </section>
    );

    const uploadsContent = (
      <div className="space-y-5 lg:grid lg:grid-cols-[minmax(0,0.6fr)_minmax(0,0.4fr)] lg:gap-5 lg:space-y-0">
        <div className="space-y-4 lg:space-y-5">
          <QuoteFilesCard id={fileCardAnchorId} files={filePreviews} />
          {rfqSummaryCard}
        </div>
        <div className="space-y-4 lg:space-y-5">{projectNotesCard}</div>
      </div>
    );

    const messagesUnavailable = Boolean(quoteMessagesError);
    const postMessageAction = postAdminQuoteMessage.bind(null, quote.id);
    const messagesContent = (
      <div className="space-y-3">
        {messagesUnavailable ? (
          <p className="rounded-xl border border-yellow-500/30 bg-yellow-500/5 px-5 py-3 text-sm text-yellow-100">
            Messages are temporarily unavailable. Refresh the page to try again.
          </p>
        ) : null}
        <QuoteMessagesThread
          quoteId={quote.id}
          messages={quoteMessages}
          canPost
          postAction={postMessageAction}
          currentUserId={null}
          title="Customer & supplier messages"
          description="One shared conversation across portals."
          helperText="Replies notify the customer inbox immediately."
          emptyStateCopy="No messages yet. Use this thread to keep the customer and suppliers aligned."
        />
      </div>
    );

    const editContent = (
      <section className={cardClasses}>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Quote actions
        </p>
        <h2 className="mt-1 text-lg font-semibold text-slate-50">Update quote</h2>
        <p className="mt-1 text-sm text-slate-400">
          Adjust status, pricing, currency, target date, and internal/DFM notes.
        </p>
        <QuoteUpdateForm
          quote={{
            id: quote.id,
            status,
            price: priceValue,
            currency: currencyValue,
            targetDate: targetDateValue,
            internalNotes,
            dfmNotes,
          }}
        />
      </section>
    );

    const viewerContent = (
      <div className="space-y-4 lg:space-y-5">
        <section className={cardClasses}>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            3D viewer workspace
          </p>
          <h2 className="text-lg font-semibold text-slate-50">Interactive preview</h2>
          <p className="mt-1 text-sm text-slate-400">
            Pick a file below to launch the STL modal. Non-STL uploads will show
            the fallback message so you know why a preview is unavailable.
          </p>
          <p className="mt-3 text-xs text-slate-500">
            The viewer uses the same CAD pipeline from the summary tab&mdash;this
            workspace just keeps it front and center.
          </p>
        </section>
        <QuoteFilesCard files={filePreviews} />
      </div>
    );

    const trackingContent = (
      <QuoteEventsTimeline
        className={cardClasses}
        events={quoteEvents}
        headingLabel="Tracking"
        title="Quote events timeline"
        description="A durable audit trail of bid submissions, awards, messages, and kickoff updates."
        emptyState="No activity yet."
      />
    );

    const decisionAwardedSupplier =
      winningBidExists && (winningSupplierName ?? "").trim().length > 0
        ? (winningSupplierName ?? "").trim()
        : winningBidExists
          ? "Supplier selected"
          : "Not awarded";
    const decisionAwardedAt = awardedAtLabel ?? (winningBidExists ? "Pending" : "—");
    const decisionAwardedBy =
      winningBidExists || awardedAtLabel
        ? awardedByLabel || "—"
        : "—";
    const decisionHeaderTone = attentionState.needsDecision
      ? "border-amber-500/30 bg-amber-500/5"
      : winningBidExists
        ? "border-emerald-500/30 bg-emerald-500/5"
        : "border-slate-800 bg-slate-950/60";
    const hasAssignedSupplier = Boolean(
      (assignedSupplierEmail ?? "").trim() || (assignedSupplierName ?? "").trim(),
    );
    const quoteIsAwarded = Boolean(
      (quote.awarded_supplier_id ?? "").trim() || quote.awarded_at,
    );
    const showInviteSupplierCta =
      !quoteIsAwarded && !hasAssignedSupplier && inviteCount === 0;

    return (
      <AdminDashboardShell
        eyebrow="Admin · Quote"
        title={headerTitle}
        description={headerDescription}
        actions={
          quote.upload_id ? (
            <Link
              href={`/admin/uploads/${quote.upload_id}`}
              className={clsx(
                secondaryCtaClasses,
                ctaSizeClasses.sm,
                "whitespace-nowrap",
              )}
            >
              View upload
            </Link>
          ) : null
        }
      >
        <div className="space-y-6">
          <section
            className={clsx(
              "sticky top-4 z-30 rounded-2xl border px-5 py-4 backdrop-blur",
              decisionHeaderTone,
            )}
          >
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0 space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Decision console
                </p>
                <dl className="grid gap-3 text-sm text-slate-200 sm:grid-cols-2 lg:grid-cols-4">
                  <DecisionField label="RFQ status" value={statusLabel} />
                  <DecisionField
                    label="Awarded supplier"
                    value={decisionAwardedSupplier}
                    valueClassName={
                      decisionAwardedSupplier === "Not awarded"
                        ? "text-slate-300"
                        : "text-slate-50"
                    }
                  />
                  <DecisionField label="Awarded at" value={decisionAwardedAt} />
                  <DecisionField label="Awarded by" value={decisionAwardedBy} />
                </dl>
              </div>
              <div className="flex flex-col items-start gap-2 sm:items-end">
                <AdminDecisionCtas quoteId={quote.id} status={status} />
                {showInviteSupplierCta ? (
                  <Link
                    href="#suppliers-panel"
                    className={clsx(
                      secondaryCtaClasses,
                      ctaSizeClasses.sm,
                      "whitespace-nowrap",
                    )}
                  >
                    Invite supplier
                  </Link>
                ) : null}
                <div className="flex flex-wrap gap-2 text-[11px] text-slate-400">
                  <a
                    href="#uploads-panel"
                    className="rounded-full border border-slate-800 bg-slate-950/40 px-3 py-1 hover:border-emerald-400 hover:text-emerald-100"
                  >
                    Uploads
                  </a>
                  <a
                    href="#messages-panel"
                    className="rounded-full border border-slate-800 bg-slate-950/40 px-3 py-1 hover:border-emerald-400 hover:text-emerald-100"
                  >
                    Messages
                  </a>
                  <HashScrollLink
                    hash="kickoff"
                    className="rounded-full border border-slate-800 bg-slate-950/40 px-3 py-1 hover:border-emerald-400 hover:text-emerald-100"
                  >
                    Kickoff
                  </HashScrollLink>
                </div>
              </div>
            </div>
          </section>

          <div className="space-y-3">
            <div className="overflow-x-auto pb-1">
              <div className="flex min-w-max gap-2">
                <span
                  className={clsx(
                    pillBaseClasses,
                    "border-transparent bg-emerald-500/10 text-emerald-200",
                  )}
                >
                  Status: {statusLabel}
                </span>
                <span className={clsx(pillBaseClasses, secondaryPillClasses)}>
                  Price: {priceChipText}
                </span>
                <span className={clsx(pillBaseClasses, secondaryPillClasses)}>
                  Target date: {targetDateChipText}
                </span>
                <a
                  href="#uploads-panel"
                  className={clsx(
                    pillBaseClasses,
                    secondaryPillClasses,
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400",
                  )}
                >
                  Files: {fileCountText}
                </a>
              </div>
            </div>

            <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs text-slate-400">
              <span>
                Quote ID:{" "}
                <span className="font-mono text-slate-300">{quote.id}</span>
              </span>
              {quote.upload_id && (
                <span>
                  Upload ID:{" "}
                  <span className="font-mono text-slate-300">
                    {quote.upload_id}
                  </span>
                </span>
              )}
              <span>
                Created:{" "}
                {formatDateTime(quote.created_at, { includeTime: true }) ?? "—"}
              </span>
              <span>
                Updated:{" "}
                {formatDateTime(quote.updated_at, { includeTime: true }) ?? "—"}
              </span>
            </div>

            <div className="flex flex-wrap gap-3 text-sm text-slate-300">
              <span className="font-medium text-slate-50">{customerName}</span>
              {customerEmail && (
                <a
                  href={`mailto:${customerEmail}`}
                  className="text-emerald-300 hover:underline"
                >
                  {customerEmail}
                </a>
              )}
              {contactPhone && (
                <a
                  href={`tel:${contactPhone}`}
                  className="text-slate-400 hover:text-emerald-200"
                >
                  {contactPhone}
                </a>
              )}
              {companyName && (
                <span className="text-slate-400">{companyName}</span>
              )}
            </div>

            <div className="grid gap-4 lg:grid-cols-[minmax(0,0.65fr)_minmax(0,0.35fr)]">
              {bidSummaryPanel}
              <div className="space-y-4">
                {kickoffStatusPanel}
                {workflowPanel}
                {awardAuditPanel}
                {projectSnapshotPanel}
              </div>
            </div>
          </div>

          {showInviteSupplierCta ? (
            <div id="suppliers-panel" className="scroll-mt-24">
              <AdminInviteSupplierCard quoteId={quote.id} />
            </div>
          ) : null}

          <SupplierBidsCard
            id="bids-panel"
            quoteId={quote.id}
            quoteStatus={status}
            awardedBidId={quote.awarded_bid_id ?? null}
            awardedSupplierId={quote.awarded_supplier_id ?? null}
            bids={bids}
            bidsLoaded={bidsResult.ok}
            errorMessage={bidsResult.ok ? bidsResult.error : null}
          />

          <div className="space-y-4">
            <CollapsibleCard
              id="uploads-panel"
              title="Uploads & intake"
              description="Files, structured intake metadata, and customer notes."
              defaultOpen={false}
              summary={
                <span className="rounded-full border border-slate-800 bg-slate-950/50 px-3 py-1">
                  {fileCountText}
                </span>
              }
            >
              {uploadsContent}
            </CollapsibleCard>

            <CollapsibleCard
              id="kickoff"
              title="Kickoff"
              description="Customer PO, ship date, and handoff notes (visible to winner)."
              defaultOpen={false}
              className="scroll-mt-24"
              summary={
                <span className={clsx("rounded-full border px-3 py-1", kickoffSummaryTone)}>
                  {kickoffSummaryLabel}
                </span>
              }
            >
              <AdminQuoteProjectCard
                quoteId={quote.id}
                project={project}
                projectUnavailable={projectUnavailable}
                className={cardClasses}
              />
            </CollapsibleCard>

            <CollapsibleCard
              id="messages-panel"
              title="Messages"
              description="Shared customer + supplier thread for this RFQ."
              defaultOpen={false}
              summary={
                <span className="rounded-full border border-slate-800 bg-slate-950/50 px-3 py-1">
                  {quoteMessages.length} message{quoteMessages.length === 1 ? "" : "s"}
                </span>
              }
            >
              {messagesContent}
            </CollapsibleCard>

            <CollapsibleCard
              title="Edit quote"
              description="Status, pricing, target date, internal and DFM notes."
              defaultOpen={false}
            >
              {editContent}
            </CollapsibleCard>

            <CollapsibleCard
              title="Tracking"
              description="Status changes, bids, award, and kickoff activity."
              defaultOpen={false}
            >
              {trackingContent}
            </CollapsibleCard>

            <CollapsibleCard
              title="3D viewer workspace"
              description="Open STL previews in the interactive modal."
              defaultOpen={false}
            >
              {viewerContent}
            </CollapsibleCard>
          </div>
        </div>
      </AdminDashboardShell>
    );
}

function DecisionField({
  label,
  value,
  valueClassName,
}: {
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-900/60 bg-slate-950/30 px-3 py-2">
      <dt className="text-[11px] uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className={clsx("font-medium text-slate-100", valueClassName)}>{value}</dd>
    </div>
  );
}

function SnapshotField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-900/60 bg-slate-950/30 px-3 py-2">
      <dt className="text-[11px] uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="font-medium text-slate-100">{value}</dd>
    </div>
  );
}

function mapProjectStatusToPill(status?: string | null): {
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

function findBestPriceBid(
  bids: AdminSupplierBidRow[],
): AdminSupplierBidRow | null {
  return bids.reduce<AdminSupplierBidRow | null>((currentBest, bid) => {
    if (typeof bid.amount !== "number" || Number.isNaN(bid.amount)) {
      return currentBest;
    }
    if (!currentBest || (currentBest.amount ?? Infinity) > bid.amount) {
      return bid;
    }
    return currentBest;
  }, null);
}

function findFastestLeadTime(bids: AdminSupplierBidRow[]): number | null {
  return bids.reduce<number | null>((currentBest, bid) => {
    if (
      typeof bid.lead_time_days !== "number" ||
      Number.isNaN(bid.lead_time_days)
    ) {
      return currentBest;
    }
    if (currentBest === null || bid.lead_time_days < currentBest) {
      return bid.lead_time_days;
    }
    return currentBest;
  }, null);
}
