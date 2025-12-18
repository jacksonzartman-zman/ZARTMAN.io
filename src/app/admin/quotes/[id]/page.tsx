// src/app/admin/quotes/[id]/page.tsx
/**
 * Phase 1 Polish checklist
 * - Done: Empty states (no bids, no messages) with calm guidance
 * - Done: Signals note when thread SLA falls back (non-blocking)
 * - Done: Error surface copy is actionable (refresh / back)
 * - Done: Copy normalization (Decision/Kickoff/Messages/Uploads match rail)
 */

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
import { QuoteTimeline } from "@/app/(portals)/components/QuoteTimeline";
import { QuoteFilesCard } from "./QuoteFilesCard";
import { QuoteUploadsStructuredList } from "@/components/QuoteUploadsStructuredList";
import { ctaSizeClasses, primaryCtaClasses, secondaryCtaClasses } from "@/lib/ctas";
import { QuoteAtAGlanceBar } from "@/components/QuoteAtAGlanceBar";
import { resolvePrimaryAction } from "@/lib/quote/resolvePrimaryAction";
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
import {
  resolveKickoffProgressBasis,
  formatKickoffTasksRatio,
} from "@/lib/quote/kickoffChecklist";
import { postQuoteMessage as postAdminQuoteMessage } from "./actions";
import { PortalContainer } from "@/app/(portals)/components/PortalContainer";
import { CollapsibleCard } from "@/components/CollapsibleCard";
import { DisclosureSection } from "@/components/DisclosureSection";
import { QuoteSectionRail } from "@/components/QuoteSectionRail";
import type { QuoteSectionRailSection } from "@/components/QuoteSectionRail";
import { AdminDecisionCtas } from "./AdminDecisionCtas";
import { AdminInviteSupplierCard } from "./AdminInviteSupplierCard";
import { HashScrollLink } from "@/app/(portals)/components/hashScroll";
import { formatRelativeTimeFromTimestamp, toTimestamp } from "@/lib/relativeTime";
import { resolveThreadStatusLabel } from "@/lib/messages/needsReply";
import { loadAdminThreadSlaForQuotes } from "@/server/admin/messageSla";
import {
  getCapacitySnapshotsForSupplierWeek,
  type AdminCapacityLevel,
  type AdminCapacitySnapshotRow,
} from "@/server/admin/capacity";
import { getNextWeekStartDateIso } from "@/lib/dates/weekStart";
import { getRoutingSuggestionForQuote } from "@/server/admin/routing";
import { CapacitySummaryPills } from "@/app/admin/components/CapacitySummaryPills";
import { RequestCapacityUpdateButton } from "./RequestCapacityUpdateButton";
import {
  isCapacityRequestSuppressed,
  loadRecentCapacityUpdateRequest,
  type CapacityUpdateRequestReason,
} from "@/server/admin/capacityRequests";
import { AwardOutcomeCard } from "./AwardOutcomeCard";
import { loadLatestAwardFeedbackForQuote } from "@/server/quotes/awardFeedback";
import { formatAwardFeedbackReasonLabel } from "@/lib/awardFeedback";
import { getLatestKickoffNudgedAt } from "@/server/quotes/kickoffNudge";
import { EmptyStateCard } from "@/components/EmptyStateCard";
import { loadQuoteUploadGroups } from "@/server/quotes/uploadFiles";
import { computePartsCoverage } from "@/lib/quote/partsCoverage";
import { loadQuoteWorkspaceData } from "@/app/(portals)/quotes/workspaceData";
import {
  createQuotePartAction,
  updateQuotePartFilesForQuoteAction,
} from "./actions";
import { AdminPartsFilesSection } from "./AdminPartsFilesSection";

export const runtime = "nodejs";
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
              We couldn’t load this quote.
            </h1>
            <p className="mt-2 text-sm text-red-100">
              Try refreshing the page. If this keeps happening, contact support.
            </p>
            <details className="mt-4 rounded-xl border border-red-500/20 bg-red-950/20 px-4 py-3 text-left text-xs text-red-100">
              <summary className="cursor-pointer select-none font-semibold text-red-50">
                Technical details
              </summary>
              <div className="mt-2 space-y-1 font-mono">
                <div>quoteId: {resolvedParams.id}</div>
                <div>error: {quoteResult.error ?? "unknown"}</div>
              </div>
            </details>
            <div className="mt-4">
              <Link
                href={`/admin/quotes/${resolvedParams.id}`}
                className={clsx(
                  primaryCtaClasses,
                  ctaSizeClasses.sm,
                  "inline-flex mr-2",
                )}
              >
                Refresh
              </Link>
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
      .from("quotes_with_uploads")
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
    const uploadGroups = await loadQuoteUploadGroups(quote.id);
    const workspaceResult = await loadQuoteWorkspaceData(quote.id, { safeOnly: true });
    const parts = workspaceResult.ok && workspaceResult.data ? workspaceResult.data.parts : [];
    const { perPart, summary: partsCoverageSummary } = computePartsCoverage(parts ?? []);
    const partsCoverageSummaryLine = partsCoverageSummary.anyParts
      ? `${partsCoverageSummary.totalParts} part${
          partsCoverageSummary.totalParts === 1 ? "" : "s"
        } • ${partsCoverageSummary.fullyCoveredParts} fully covered • ${
          partsCoverageSummary.partsNeedingCad
        } need CAD • ${partsCoverageSummary.partsNeedingDrawing} need drawings`
      : null;
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

    const threadSlaByQuoteId = await loadAdminThreadSlaForQuotes({ quoteIds: [quote.id] });
    const threadSla = threadSlaByQuoteId[quote.id] ?? null;
    const lastMessage = quoteMessages.length > 0 ? quoteMessages[quoteMessages.length - 1] : null;
    const lastMessagePreview = lastMessage ? truncateThreadPreview(lastMessage.body, 80) : null;
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
    const kickoffCompleteFromQuote =
      typeof (quote as { kickoff_completed_at?: string | null })?.kickoff_completed_at ===
        "string" &&
      ((quote as { kickoff_completed_at?: string | null })?.kickoff_completed_at ?? "").trim()
        .length > 0;
    const kickoffSummaryLabel = hasWinningBid
      ? kickoffCompleteFromQuote
        ? "Kickoff complete"
        : kickoffSummary
          ? formatKickoffSummaryLabel(kickoffSummary)
        : supplierKickoffTasksResult?.reason === "schema-missing"
          ? "Checklist unavailable in this environment"
          : "Checklist unavailable"
      : "Waiting for winner";
    const kickoffSummaryTone =
      kickoffCompleteFromQuote || kickoffSummary?.status === "complete"
        ? "text-emerald-300"
        : kickoffSummary?.status === "in-progress"
          ? "text-blue-200"
          : "text-slate-200";
    const kickoffStatusValue =
      kickoffCompleteFromQuote || kickoffSummary?.status === "complete"
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
    const kickoffProgressBasis = resolveKickoffProgressBasis({
      kickoffCompletedAt: (quote as { kickoff_completed_at?: string | null })?.kickoff_completed_at ?? null,
      completedCount: kickoffSummary?.completedCount ?? null,
      totalCount: kickoffSummary?.totalCount ?? null,
    });
    const kickoffProgressRatio = formatKickoffTasksRatio(kickoffProgressBasis);

    const winningSupplierIdForNudge =
      typeof winningBidRow?.supplier_id === "string" && winningBidRow.supplier_id.trim().length > 0
        ? winningBidRow.supplier_id.trim()
        : typeof quote.awarded_supplier_id === "string" && quote.awarded_supplier_id.trim().length > 0
          ? quote.awarded_supplier_id.trim()
          : null;
    const latestKickoffNudgedAt = winningSupplierIdForNudge
      ? await getLatestKickoffNudgedAt({
          quoteId: quote.id,
          supplierId: winningSupplierIdForNudge,
        })
      : null;
    const latestKickoffNudgedRelative = latestKickoffNudgedAt
      ? formatRelativeTimeFromTimestamp(toTimestamp(latestKickoffNudgedAt)) ?? null
      : null;
    const attentionState = deriveAdminQuoteAttentionState({
      quoteId: quote.id,
      status,
      bidCount: aggregateBidCount,
      hasWinner: hasWinningBid,
      hasProject,
    });
    const headerTitleSource = companyName || customerName || "Unnamed customer";
    const headerTitle = `Quote for ${headerTitleSource}`;
    const headerDescription =
      "Details, files, pricing, and messages for this RFQ.";
    const cardClasses =
      "rounded-2xl border border-slate-800 bg-slate-950/60 px-5 py-4";
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

    const awardedSupplierId =
      (typeof quote.awarded_supplier_id === "string" && quote.awarded_supplier_id.trim()
        ? quote.awarded_supplier_id.trim()
        : typeof winningBidRow?.supplier_id === "string" && winningBidRow.supplier_id.trim()
          ? winningBidRow.supplier_id.trim()
          : null) ?? null;
    const awardFeedback = awardedSupplierId
      ? await loadLatestAwardFeedbackForQuote({
          quoteId: quote.id,
          supplierId: awardedSupplierId,
        })
      : null;

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

    const projectStatusKickoffLabel = !hasWinningBid
      ? "Waiting for winner"
      : kickoffProgressBasis.isComplete
        ? "Kickoff complete"
        : kickoffProgressRatio
          ? `Kickoff in progress (${kickoffProgressRatio} tasks)`
          : "Kickoff in progress";

    const projectStatusPanel = (
      <section className="rounded-2xl border border-slate-900 bg-slate-950/40 px-6 py-4 text-sm text-slate-200">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Project status
            </p>
            <p className="mt-1 text-xs text-slate-400">
              Shared kickoff status across supplier + customer.
            </p>
          </div>
          <span
            className={clsx(
              "rounded-full border px-3 py-1 text-[11px] font-semibold",
              kickoffProgressBasis.isComplete
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-100"
                : hasWinningBid
                  ? "border-blue-500/40 bg-blue-500/10 text-blue-100"
                  : "border-slate-800 bg-slate-900/60 text-slate-200",
            )}
          >
            {kickoffProgressBasis.isComplete ? "Complete" : hasWinningBid ? "In progress" : "—"}
          </span>
        </header>
        <dl className="mt-4 grid gap-3 text-slate-100 sm:grid-cols-3">
          <SnapshotField
            label="Supplier"
            value={hasWinningBid ? (winningSupplierName ?? "Supplier selected") : "—"}
          />
          <SnapshotField
            label="Awarded on"
            value={hasWinningBid ? (awardedAtLabel ?? "Pending") : "—"}
          />
          <SnapshotField label="Kickoff" value={projectStatusKickoffLabel} />
          {latestKickoffNudgedRelative ? (
            <SnapshotField
              label="Customer nudged kickoff"
              value={latestKickoffNudgedRelative}
            />
          ) : null}
        </dl>
      </section>
    );

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

    const threadStatusPanel = (
      <section className="rounded-2xl border border-slate-900 bg-slate-950/40 px-6 py-4 text-sm text-slate-200">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Thread status
            </p>
            <p className="mt-1 text-xs text-slate-400">
              Role-based “needs reply” and staleness.
            </p>
          </div>
          {(() => {
            const needsReplyFrom = threadSla?.needsReplyFrom ?? "none";
            const label = resolveThreadStatusLabel("admin", needsReplyFrom);
            const pillClasses =
              label === "Needs your reply"
                ? "border-amber-500/40 bg-amber-500/10 text-amber-100"
                : label === "Up to date"
                  ? "border-slate-800 bg-slate-950/50 text-slate-300"
                  : label === "Status unknown"
                    ? "border-slate-800 bg-slate-950/50 text-slate-400"
                    : "border-slate-800 bg-slate-900/40 text-slate-200";
            return (
              <span
                className={clsx(
                  "inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-semibold",
                  pillClasses,
                )}
              >
                {label}
              </span>
            );
          })()}
        </header>

        <div className="mt-4 space-y-2">
          <p className="text-xs text-slate-400">
            Last message{" "}
            {threadSla?.lastMessageAt
              ? formatRelativeTimeFromTimestamp(toTimestamp(threadSla.lastMessageAt)) ?? "—"
              : "—"}
            {threadSla?.stalenessBucket === "very_stale" ? (
              <span className="ml-2 inline-flex rounded-full border border-slate-800 bg-slate-900/60 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-200">
                Stale
              </span>
            ) : null}
          </p>
          <p className="text-sm text-slate-100">
            {lastMessagePreview ? (
              <span className="text-slate-200">{lastMessagePreview}</span>
            ) : (
              <span className="text-slate-500">No messages yet.</span>
            )}
          </p>
          <a
            href="#messages"
            className="text-sm font-semibold text-emerald-200 underline-offset-4 hover:underline"
          >
            Open messages
          </a>
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

    const partsCoveragePanel = (
      <section className="rounded-2xl border border-slate-900 bg-slate-950/40 px-6 py-4 text-sm text-slate-200">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Parts coverage
            </p>
            <h2 className="mt-1 text-base font-semibold text-slate-100">Parts coverage</h2>
          </div>
          {partsCoverageSummary.anyParts ? (
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
          ) : null}
        </header>

        {!partsCoverageSummary.anyParts ? (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-slate-300">
              No parts have been defined for this RFQ yet.
            </p>
            <HashScrollLink
              hash="uploads"
              className={clsx(secondaryCtaClasses, ctaSizeClasses.sm, "whitespace-nowrap")}
            >
              Go to uploads
            </HashScrollLink>
          </div>
        ) : (
          <>
            <p className="mt-3 text-sm text-slate-300">{partsCoverageSummaryLine}</p>
            <div className="mt-4 overflow-hidden rounded-xl border border-slate-900/60 bg-slate-950/30">
              <div className="grid grid-cols-[minmax(0,1.5fr)_90px_105px_minmax(0,1fr)] gap-3 border-b border-slate-900/60 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                <div>Part</div>
                <div className="text-right">CAD</div>
                <div className="text-right">Drawings</div>
                <div>Status</div>
              </div>
              <div className="divide-y divide-slate-900/60">
                {perPart.map((part) => {
                  const statusLabel = part.hasCad
                    ? part.hasDrawing
                      ? "Covered"
                      : "Needs drawing"
                    : part.hasDrawing
                      ? "Needs CAD"
                      : "Needs CAD + drawing";
                  const partDisplay = part.partNumber
                    ? `${part.partLabel} (${part.partNumber})`
                    : part.partLabel;
                  return (
                    <div
                      key={part.partId}
                      className="grid grid-cols-[minmax(0,1.5fr)_90px_105px_minmax(0,1fr)] gap-3 px-4 py-2 text-sm text-slate-200"
                    >
                      <div className="min-w-0 truncate font-medium text-slate-100">
                        {partDisplay}
                      </div>
                      <div className="text-right tabular-nums">{part.cadCount}</div>
                      <div className="text-right tabular-nums">{part.drawingCount}</div>
                      <div className="text-slate-300">{statusLabel}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </section>
    );
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
          <QuoteUploadsStructuredList uploadGroups={uploadGroups} />
          <QuoteFilesCard id={fileCardAnchorId} files={filePreviews} />
          {rfqSummaryCard}
        </div>
        <div className="space-y-4 lg:space-y-5">{projectNotesCard}</div>
      </div>
    );

    const partsWorkArea = (
      <AdminPartsFilesSection
        quoteId={quote.id}
        parts={parts ?? []}
        uploadGroups={uploadGroups}
        createPartAction={createQuotePartAction.bind(null, quote.id)}
        updatePartFilesAction={updateQuotePartFilesForQuoteAction.bind(null, quote.id)}
      />
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
          emptyStateCopy="Send the first update to keep the customer and suppliers aligned."
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
        <div className="mt-4">
          <AdminDecisionCtas
            quoteId={quote.id}
            status={status}
            showAwardLink={false}
          />
        </div>
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
      <div className={cardClasses}>
        <QuoteTimeline
          quoteId={quote.id}
          actorRole="admin"
          actorUserId={null}
          emptyState="No events yet. Activity will appear here as your RFQ progresses."
        />
      </div>
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
    const hasAssignedSupplier = Boolean(
      (assignedSupplierEmail ?? "").trim() || (assignedSupplierName ?? "").trim(),
    );
    const quoteIsAwarded = Boolean(
      (quote.awarded_supplier_id ?? "").trim() || quote.awarded_at,
    );
    const showInviteSupplierCta =
      !quoteIsAwarded && !hasAssignedSupplier && inviteCount === 0;

    const nextWeekStartDateIso = getNextWeekStartDateIso();
    const nextWeekLabel = formatWeekOfLabel(nextWeekStartDateIso);
    const resolvedCapacitySupplierId = resolveCapacitySupplierId({
      awardedSupplierId: quote.awarded_supplier_id,
      baseBids,
    });

    const routingSuggestion = await getRoutingSuggestionForQuote({
      quoteId: quote.id,
    });
    const routingWeekLabel = formatWeekOfLabel(routingSuggestion.weekStartDate);

    const capacityRequestCandidate =
      routingSuggestion.supplierSummaries.length > 0
        ? routingSuggestion.supplierSummaries[0]
        : null;
    const capacityRequestSupplierId =
      routingSuggestion.resolvedSupplierId ?? capacityRequestCandidate?.supplierId ?? null;
    const capacityRequestReason: CapacityUpdateRequestReason | null =
      capacityRequestCandidate && capacityRequestSupplierId
        ? inferCapacityRequestReason({
            coverageCount: capacityRequestCandidate.coverageCount,
            lastUpdatedAt: capacityRequestCandidate.lastUpdatedAt,
          })
        : null;

    const supplierCapacityLastUpdatedAt = capacityRequestCandidate?.lastUpdatedAt ?? null;
    const { createdAt: lastCapacityRequestCreatedAt } =
      capacityRequestSupplierId && capacityRequestReason
        ? await loadRecentCapacityUpdateRequest({
            supplierId: capacityRequestSupplierId,
            weekStartDate: routingSuggestion.weekStartDate,
            lookbackDays: 7,
          })
        : { createdAt: null };
    const suppressCapacityRequest = isCapacityRequestSuppressed({
      requestCreatedAt: lastCapacityRequestCreatedAt,
      supplierLastUpdatedAt: supplierCapacityLastUpdatedAt,
    });

    let capacitySnapshots: AdminCapacitySnapshotRow[] = [];
    let capacitySnapshotsError: string | null = null;
    if (resolvedCapacitySupplierId) {
      const capacityResult = await getCapacitySnapshotsForSupplierWeek({
        supplierId: resolvedCapacitySupplierId,
        weekStartDate: nextWeekStartDateIso,
      });
      capacitySnapshots = capacityResult.data.snapshots ?? [];
      capacitySnapshotsError = capacityResult.ok ? null : capacityResult.error ?? null;
    }

    const capacityLevelByCapability = new Map<string, AdminCapacityLevel | string>();
    for (const snapshot of capacitySnapshots) {
      const key = (snapshot?.capability ?? "").trim().toLowerCase();
      if (!key) continue;
      if (!capacityLevelByCapability.has(key)) {
        capacityLevelByCapability.set(key, snapshot.capacity_level);
      }
    }

    const capacityPanel = (
      <section className="rounded-2xl border border-slate-900 bg-slate-950/40 px-6 py-4 text-sm text-slate-200">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-100">
              Capacity (Next Week)
            </h2>
            <p className="mt-1 text-xs text-slate-400">Week of {nextWeekLabel}</p>
          </div>
          {resolvedCapacitySupplierId ? (
            <Link
              href={`/admin/capacity?supplierId=${encodeURIComponent(resolvedCapacitySupplierId)}`}
              className="text-sm font-semibold text-blue-200 underline-offset-4 hover:underline"
            >
              View capacity calendar
            </Link>
          ) : null}
        </header>

        {!resolvedCapacitySupplierId ? (
          <p className="mt-4 text-sm text-slate-400">No supplier selected yet.</p>
        ) : capacitySnapshotsError ? (
          <p className="mt-4 rounded-xl border border-amber-500/30 bg-amber-950/20 px-4 py-3 text-sm text-amber-100">
            {capacitySnapshotsError}
          </p>
        ) : (
          <div className="mt-4 space-y-3">
            {capacitySnapshots.length === 0 ? (
              <p className="text-sm text-slate-400">No capacity signal for this week.</p>
            ) : null}
            <dl className="grid gap-2">
              {CAPACITY_SNAPSHOT_UNIVERSE.map((capability) => {
                const level = capacityLevelByCapability.get(capability.key) ?? null;
                const display = formatCapacityLevelLabel(level);
                const pill = display ? (
                  <span className={clsx("rounded-full border px-2.5 py-0.5 text-[11px] font-semibold", capacityLevelPillClasses(level))}>
                    {display}
                  </span>
                ) : (
                  <span className="text-sm font-semibold text-slate-400">Not set</span>
                );

                return (
                  <div
                    key={capability.key}
                    className="flex items-center justify-between gap-3 rounded-xl border border-slate-900/60 bg-slate-950/30 px-4 py-3"
                  >
                    <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      {capability.label}
                    </dt>
                    <dd className="flex items-center gap-2 text-sm font-semibold text-slate-100">
                      {pill}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </div>
        )}
      </section>
    );

    const routingSuggestionPanel = (
      <section className="rounded-2xl border border-slate-900 bg-slate-950/40 px-6 py-4 text-sm text-slate-200">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-100">
              Routing suggestion
            </h2>
            <p className="mt-1 text-xs text-slate-400">
              Based on supplier capacity for next week.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-slate-800 bg-slate-900/60 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-200">
              Week of {routingWeekLabel}
            </span>
            {capacityRequestSupplierId && capacityRequestReason ? (
              <RequestCapacityUpdateButton
                quoteId={quote.id}
                supplierId={capacityRequestSupplierId}
                weekStartDate={routingSuggestion.weekStartDate}
                reason={capacityRequestReason}
                suppressed={suppressCapacityRequest}
                lastRequestCreatedAt={lastCapacityRequestCreatedAt}
              />
            ) : null}
          </div>
        </header>

        {routingSuggestion.resolvedSupplierId ? (
          routingSuggestion.supplierSummaries.length > 0 ? (
            <div className="mt-4 space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Selected supplier
                  </p>
                  <p className="mt-1 truncate text-sm font-semibold text-slate-100">
                    {routingSuggestion.supplierSummaries[0]?.supplierName ??
                      routingSuggestion.resolvedSupplierId}
                  </p>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <span
                    className={clsx(
                      "rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-wide",
                      insightMatchHealthPillClasses(
                        routingSuggestion.supplierSummaries[0]?.benchHealth?.matchHealth ??
                          "unknown",
                      ),
                    )}
                  >
                    Match:{" "}
                    {formatInsightMatchHealthLabel(
                      routingSuggestion.supplierSummaries[0]?.benchHealth?.matchHealth ??
                        "unknown",
                    )}
                  </span>
                  <span
                    className={clsx(
                      "rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-wide",
                      insightBenchStatusPillClasses(
                        routingSuggestion.supplierSummaries[0]?.benchHealth?.benchStatus ??
                          "unknown",
                      ),
                    )}
                  >
                    Bench:{" "}
                    {formatInsightBenchStatusLabel(
                      routingSuggestion.supplierSummaries[0]?.benchHealth?.benchStatus ??
                        "unknown",
                    )}
                  </span>
                </div>
              </div>

              <CapacitySummaryPills
                coverageCount={routingSuggestion.supplierSummaries[0]?.coverageCount ?? 0}
                totalCount={routingSuggestion.supplierSummaries[0]?.totalCount ?? 4}
                levels={routingSuggestion.supplierSummaries[0]?.levels ?? {}}
                lastUpdatedAt={routingSuggestion.supplierSummaries[0]?.lastUpdatedAt ?? null}
                align="start"
              />

              <div className="rounded-xl border border-slate-900/60 bg-slate-950/30 px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Historical win reasons (90d)
                </p>
                <p className="mt-1 text-sm text-slate-200">
                  {formatTopWinReasons(
                    routingSuggestion.supplierSummaries[0]?.awardFeedbackSummary?.byReason ?? {},
                    2,
                  ) ?? "No award feedback yet"}
                </p>
              </div>
            </div>
          ) : (
            <p className="mt-4 text-sm text-slate-400">
              Capacity signals are temporarily unavailable.
            </p>
          )
        ) : routingSuggestion.supplierSummaries.length === 0 ? (
          <p className="mt-4 text-sm text-slate-400">
            No supplier selected yet. Capacity suggestions are temporarily unavailable.
          </p>
        ) : (
          <div className="mt-4 space-y-3">
            {routingSuggestion.supplierSummaries.map((summary) => (
              <div
                key={summary.supplierId}
                className="rounded-xl border border-slate-900/60 bg-slate-950/30 px-4 py-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-100">
                      {summary.supplierName ?? "Unnamed supplier"}
                    </p>
                    {summary.matchHealth === "poor" && summary.blockingReason ? (
                      <p className="mt-1 text-xs text-red-200">
                        {summary.blockingReason}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <span
                      className={clsx(
                        "rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-wide",
                        insightMatchHealthPillClasses(
                          summary.benchHealth?.matchHealth ?? "unknown",
                        ),
                      )}
                    >
                      Match:{" "}
                      {formatInsightMatchHealthLabel(
                        summary.benchHealth?.matchHealth ?? "unknown",
                      )}
                    </span>
                    <span
                      className={clsx(
                        "rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-wide",
                        insightBenchStatusPillClasses(
                          summary.benchHealth?.benchStatus ?? "unknown",
                        ),
                      )}
                    >
                      Bench:{" "}
                      {formatInsightBenchStatusLabel(
                        summary.benchHealth?.benchStatus ?? "unknown",
                      )}
                    </span>
                  </div>
                </div>
                <div className="mt-2">
                  <CapacitySummaryPills
                    coverageCount={summary.coverageCount}
                    totalCount={summary.totalCount}
                    levels={summary.levels}
                    lastUpdatedAt={summary.lastUpdatedAt}
                    align="start"
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    );

    const adminPrimaryAction = resolvePrimaryAction({
      role: "admin",
      quote: {
        id: quote.id,
        status,
        primaryActionHints: {
          needsDecision: attentionState.needsDecision,
          hasWinner: hasWinningBid,
        },
      },
    });
    const adminWhatsNext = attentionState.needsDecision
      ? "Needs award decision."
      : "No pending actions.";
    const adminPills = [
      { key: "quote", label: "Quote", value: formatShortId(quote.id) },
      {
        key: "bids",
        label: "Bids",
        value: bidCountLabel,
        tone: attentionState.needsDecision ? "warning" : "neutral",
        href: "#decision",
      },
      { key: "bestPrice", label: "Best price", value: bestPriceDisplay },
      { key: "leadTime", label: "Fastest lead", value: fastestLeadTimeDisplay },
      {
        key: "kickoff",
        label: "Kickoff",
        value: kickoffSummaryLabel,
        tone: kickoffProgressBasis.isComplete
          ? "success"
          : hasWinningBid
            ? "info"
            : "neutral",
        href: "#kickoff",
      },
      {
        key: "messages",
        label: "Messages",
        value: `${quoteMessages.length}`,
        tone: threadSla?.needsReplyFrom ? "warning" : "neutral",
        href: "#messages",
      },
    ] as const;

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
          <QuoteAtAGlanceBar
            role="admin"
            statusLabel={statusLabel}
            whatsNext={adminWhatsNext}
            pills={[...adminPills]}
            primaryAction={adminPrimaryAction}
            below={
              <QuoteSectionRail
                sections={buildAdminQuoteSections({
                  bidCount: aggregateBidCount,
                  hasWinner: hasWinningBid,
                  kickoffRatio: kickoffProgressRatio,
                  kickoffComplete: kickoffProgressBasis.isComplete,
                  messageCount: quoteMessages.length,
                  needsReply: Boolean(threadSla?.needsReplyFrom),
                  fileCount: filePreviews.length,
                })}
              />
            }
          />

          <DisclosureSection
            id="details"
            className="scroll-mt-24"
            title="Details"
            description="IDs and metadata for troubleshooting."
            defaultOpen={false}
            summary={
              <span className="rounded-full border border-slate-800 bg-slate-950/50 px-3 py-1">
                {formatShortId(quote.id)}
              </span>
            }
          >
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
          </DisclosureSection>

          <div className="space-y-3">
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
              <DisclosureSection
                id="signals"
                title="Signals"
                description="Thread SLA, kickoff status, routing health, and capacity."
                defaultOpen
                summary={
                  threadSla?.needsReplyFrom ? (
                    <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-[11px] font-semibold text-amber-100">
                      Needs reply
                    </span>
                  ) : (
                    <span className="rounded-full border border-slate-800 bg-slate-950/50 px-3 py-1 text-[11px] font-semibold text-slate-200">
                      No reply needed
                    </span>
                  )
                }
              >
                <div className="space-y-4">
                  {threadSla?.usingFallback ? (
                    <p className="rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-3 text-xs text-slate-300">
                      SLA signal unavailable; using basic staleness.
                    </p>
                  ) : null}
                  {threadStatusPanel}
                  {kickoffStatusPanel}
                  {partsCoveragePanel}
                  {routingSuggestionPanel}
                  {capacityPanel}
                </div>
              </DisclosureSection>
            </div>
          </div>

          <DisclosureSection
            id="decision"
            className="scroll-mt-24"
            hashAliases={["bids-panel", "suppliers-panel"]}
            title="Decision"
            description="Invite suppliers, review bids, and award a winner."
            defaultOpen={!hasWinningBid && aggregateBidCount > 0}
            summary={
              hasWinningBid ? (
                <span className="pill pill-success px-3 py-0.5 text-[11px] font-semibold">
                  Winner
                </span>
              ) : (
                <span className="rounded-full border border-slate-800 bg-slate-950/50 px-3 py-1 text-xs font-semibold text-slate-200">
                  {bidCountLabel}
                </span>
              )
            }
          >
            <div className="space-y-4">
              {aggregateBidCount === 0 && !hasWinningBid ? (
                <EmptyStateCard
                  title="No bids yet"
                  description="Invite a supplier to start bidding, or check back later."
                  action={
                    showInviteSupplierCta
                      ? { label: "Invite a supplier", href: "#suppliers-panel" }
                      : { label: "Open messages", href: "#messages" }
                  }
                  secondaryAction={
                    showInviteSupplierCta ? { label: "Open messages", href: "#messages" } : null
                  }
                />
              ) : null}
              {showInviteSupplierCta ? (
                <div id="suppliers-panel" className="scroll-mt-24">
                  <AdminInviteSupplierCard quoteId={quote.id} />
                </div>
              ) : null}
              {partsCoverageSummary.anyParts && !partsCoverageSummary.allCovered ? (
                <p className="rounded-xl border border-slate-800 bg-slate-950/60 px-5 py-3 text-xs text-slate-300">
                  Note: Some parts are missing CAD or drawings. You can still award, but clarify scope during kickoff.
                </p>
              ) : null}

              <SupplierBidsCard
                id="bids-panel"
                quoteId={quote.id}
                quoteStatus={status}
                awardedBidId={quote.awarded_bid_id ?? null}
                awardedSupplierId={quote.awarded_supplier_id ?? null}
                bids={bids}
                bidsLoaded={bidsResult.ok}
                errorMessage={bidsResult.error ?? null}
              />
            </div>
          </DisclosureSection>

          <div className="space-y-4">
            <DisclosureSection
              id="uploads"
              className="scroll-mt-24"
              hashAliases={["uploads-panel"]}
              title="Uploads"
              description="Files, structured intake metadata, and customer notes."
              defaultOpen={false}
              summary={
                <span className="rounded-full border border-slate-800 bg-slate-950/50 px-3 py-1">
                  {fileCountText}
                </span>
              }
            >
              {uploadsContent}
            </DisclosureSection>

            <DisclosureSection
              id="parts"
              className="scroll-mt-24"
              hashAliases={["components"]}
              title="Parts & files"
              description="Define parts and attach CAD/drawings from uploads."
              defaultOpen={parts.length === 0}
              summary={
                <span className="rounded-full border border-slate-800 bg-slate-950/50 px-3 py-1">
                  {parts.length} part{parts.length === 1 ? "" : "s"}
                </span>
              }
            >
              {partsWorkArea}
            </DisclosureSection>

            <DisclosureSection
              id="kickoff"
              className="scroll-mt-24"
              title="Kickoff"
              description="Customer PO, ship date, and handoff notes (visible to winner)."
              defaultOpen={false}
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
            </DisclosureSection>

            <DisclosureSection
              id="messages"
              className="scroll-mt-24"
              hashAliases={["messages-panel"]}
              title="Messages"
              description="Shared customer + supplier thread for this RFQ."
              defaultOpen={Boolean(threadSla?.needsReplyFrom)}
              summary={
                <span className="rounded-full border border-slate-800 bg-slate-950/50 px-3 py-1">
                  {quoteMessages.length} message{quoteMessages.length === 1 ? "" : "s"}
                </span>
              }
            >
              {messagesContent}
            </DisclosureSection>

            <CollapsibleCard
              title="Edit quote"
              description="Status, pricing, target date, internal and DFM notes."
              defaultOpen={false}
            >
              {editContent}
            </CollapsibleCard>

            <DisclosureSection
              id="timeline"
              className="scroll-mt-24"
              title="Timeline"
              description="Updates and milestones for this RFQ."
              defaultOpen={false}
            >
              {trackingContent}
            </DisclosureSection>

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

function buildAdminQuoteSections(args: {
  bidCount: number;
  hasWinner: boolean;
  kickoffRatio: string | null;
  kickoffComplete: boolean;
  messageCount: number;
  needsReply: boolean;
  fileCount: number;
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
  const messagesBadge = args.needsReply ? "Reply" : args.messageCount > 0 ? `${args.messageCount}` : undefined;

  return [
    {
      key: "decision",
      label: "Decision",
      href: "#decision",
      badge: decisionBadge,
      tone: args.hasWinner ? "neutral" : args.bidCount > 0 ? "warning" : "neutral",
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
      href: "#messages",
      badge: messagesBadge,
      tone: args.needsReply ? "warning" : "neutral",
    },
    { key: "uploads", label: "Uploads", href: "#uploads", badge: uploadsBadge },
    { key: "details", label: "Details", href: "#details" },
    { key: "timeline", label: "Timeline", href: "#timeline" },
  ];
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

const CAPACITY_SNAPSHOT_UNIVERSE: Array<{ key: string; label: string }> = [
  { key: "cnc_mill", label: "CNC Mill" },
  { key: "cnc_lathe", label: "CNC Lathe" },
  { key: "mjp", label: "MJP" },
  { key: "sla", label: "SLA" },
];

function resolveCapacitySupplierId(args: {
  awardedSupplierId?: string | null;
  baseBids: Array<{ supplier_id?: string | null }>;
}): string | null {
  const awarded =
    typeof args.awardedSupplierId === "string" ? args.awardedSupplierId.trim() : "";
  if (awarded) return awarded;
  if (args.baseBids.length !== 1) return null;
  const bidSupplier =
    typeof args.baseBids[0]?.supplier_id === "string" ? args.baseBids[0].supplier_id.trim() : "";
  return bidSupplier || null;
}

function formatWeekOfLabel(weekStartDateIso: string): string {
  const parsed = Date.parse(`${weekStartDateIso}T00:00:00.000Z`);
  if (Number.isNaN(parsed)) return weekStartDateIso;
  return new Date(parsed).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  });
}

function inferCapacityRequestReason(args: {
  coverageCount: number;
  lastUpdatedAt: string | null;
}): CapacityUpdateRequestReason {
  const coverageCount =
    typeof args.coverageCount === "number" && Number.isFinite(args.coverageCount)
      ? args.coverageCount
      : 0;
  const lastUpdatedAt =
    typeof args.lastUpdatedAt === "string" && args.lastUpdatedAt.trim()
      ? args.lastUpdatedAt.trim()
      : null;
  const parsed = lastUpdatedAt ? Date.parse(lastUpdatedAt) : Number.NaN;
  const isStale =
    Number.isFinite(parsed) && Date.now() - parsed > 14 * 24 * 60 * 60 * 1000;
  if (isStale) return "stale";
  if (coverageCount < 2) return "missing";
  return "manual";
}

function formatCapacityLevelLabel(level: unknown): string | null {
  const normalized = typeof level === "string" ? level.trim().toLowerCase() : "";
  if (!normalized) return null;
  if (normalized === "high") return "High";
  if (normalized === "medium") return "Medium";
  if (normalized === "low") return "Low";
  if (normalized === "unavailable") return "Unavailable";
  if (normalized === "overloaded") return "Overloaded";
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function capacityLevelPillClasses(level: unknown): string {
  const normalized = typeof level === "string" ? level.trim().toLowerCase() : "";
  switch (normalized) {
    case "high":
      return "border-emerald-500/40 bg-emerald-500/10 text-emerald-100";
    case "medium":
      return "border-amber-500/40 bg-amber-500/10 text-amber-100";
    case "low":
      return "border-blue-500/40 bg-blue-500/10 text-blue-100";
    case "unavailable":
      return "border-slate-700 bg-slate-900/40 text-slate-200";
    case "overloaded":
      return "border-red-500/40 bg-red-500/10 text-red-100";
    default:
      return "border-slate-700 bg-slate-900/40 text-slate-200";
  }
}

function matchHealthPillClasses(health: unknown): string {
  const normalized = typeof health === "string" ? health.trim().toLowerCase() : "";
  switch (normalized) {
    case "good":
      return "border-emerald-500/40 bg-emerald-500/10 text-emerald-100";
    case "poor":
      return "border-red-500/40 bg-red-500/10 text-red-100";
    case "caution":
    default:
      return "border-amber-500/40 bg-amber-500/10 text-amber-100";
  }
}

function formatMatchHealthLabel(health: unknown): string {
  const normalized = typeof health === "string" ? health.trim().toLowerCase() : "";
  if (normalized === "good") return "Good";
  if (normalized === "poor") return "Poor";
  return "Caution";
}

function formatInsightMatchHealthLabel(value: unknown): string {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (normalized === "good") return "Good";
  if (normalized === "caution") return "Caution";
  if (normalized === "poor") return "Poor";
  return "Unknown";
}

function insightMatchHealthPillClasses(value: unknown): string {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  switch (normalized) {
    case "good":
      return "border-emerald-500/40 bg-emerald-500/10 text-emerald-100";
    case "caution":
      return "border-amber-500/40 bg-amber-500/10 text-amber-100";
    case "poor":
      return "border-red-500/40 bg-red-500/10 text-red-100";
    default:
      return "border-slate-800 bg-slate-950/50 text-slate-200";
  }
}

function formatInsightBenchStatusLabel(value: unknown): string {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (normalized === "underused") return "Underused";
  if (normalized === "balanced") return "Balanced";
  if (normalized === "overused") return "Overused";
  return "Unknown";
}

function insightBenchStatusPillClasses(value: unknown): string {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  switch (normalized) {
    case "underused":
      return "border-blue-500/40 bg-blue-500/10 text-blue-100";
    case "balanced":
      return "border-emerald-500/40 bg-emerald-500/10 text-emerald-100";
    case "overused":
      return "border-amber-500/40 bg-amber-500/10 text-amber-100";
    default:
      return "border-slate-800 bg-slate-950/50 text-slate-200";
  }
}

function formatTopWinReasons(byReason: Record<string, number>, limit: number): string | null {
  const entries = Object.entries(byReason ?? {})
    .filter(([reason, count]) => typeof reason === "string" && reason.trim() && typeof count === "number")
    .sort((a, b) => {
      const dc = (b[1] ?? 0) - (a[1] ?? 0);
      if (dc !== 0) return dc;
      return a[0].localeCompare(b[0]);
    })
    .slice(0, Math.max(0, Math.floor(limit)));

  if (entries.length === 0) return null;

  const parts = entries.map(([reason, count]) => {
    const label =
      formatAwardFeedbackReasonLabel(reason) ??
      reason.replace(/[_-]+/g, " ").trim().replace(/^\w/, (m) => m.toUpperCase());
    return `${label} (${count})`;
  });
  return parts.join(", ");
}

function truncateThreadPreview(value: unknown, maxLen: number): string | null {
  const raw = typeof value === "string" ? value : "";
  const squashed = raw.replace(/\s+/g, " ").trim();
  if (!squashed) return null;
  if (squashed.length <= maxLen) return squashed;
  return `${squashed.slice(0, Math.max(0, maxLen - 1))}…`;
}
