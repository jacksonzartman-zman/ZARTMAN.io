// src/app/admin/quotes/[id]/page.tsx

import clsx from "clsx";
import Link from "next/link";
import type { ReactNode } from "react";
import { formatDateTime } from "@/lib/formatDate";
import { buildCustomerQuoteTimeline } from "@/lib/quote/tracking";
import { loadQuoteThreadForQuote } from "@/server/messages/quoteThreads";
import { getQuoteFilePreviews } from "@/server/quotes/files";
import type { UploadMeta } from "@/server/quotes/types";
import {
  DEFAULT_QUOTE_STATUS,
  QUOTE_STATUS_LABELS,
  normalizeQuoteStatus,
  type QuoteStatus,
} from "@/server/quotes/status";
import AdminDashboardShell from "../../AdminDashboardShell";
import QuoteUpdateForm from "../QuoteUpdateForm";
import { QuoteMessagesPanel } from "@/app/(portals)/components/QuoteMessagesPanel";
import { QuoteFilesCard } from "./QuoteFilesCard";
import {
  QuoteWorkspaceTabs,
  type QuoteWorkspaceTab,
} from "./QuoteWorkspaceTabs";
import { ctaSizeClasses, secondaryCtaClasses } from "@/lib/ctas";
import {
  deriveAdminQuoteAttentionState,
  isWinningBidStatus,
  loadAdminQuoteDetail,
} from "@/server/admin/quotes";
import { loadBidsForQuote } from "@/server/bids";
import { loadAdminUploadDetail } from "@/server/admin/uploads";
import { listSupplierBidsForQuote } from "@/server/suppliers/bids";
import { SupplierBidsCard, type AdminSupplierBidRow } from "./SupplierBidsCard";
import { loadQuoteProject } from "@/server/quotes/projects";
import { AdminQuoteProjectCard } from "./AdminQuoteProjectCard";
import { AdminQuoteTrackingCard } from "./AdminQuoteTrackingCard";
import {
  loadQuoteKickoffTasksForSupplier,
  summarizeKickoffTasks,
  formatKickoffSummaryLabel,
  type SupplierKickoffTasksResult,
} from "@/server/quotes/kickoffTasks";

export const dynamic = "force-dynamic";

type QuoteDetailPageProps = {
  params: Promise<{ id: string }>;
};

export default async function QuoteDetailPage({ params }: QuoteDetailPageProps) {
  const resolvedParams = await params;

  const quoteResult = await loadAdminQuoteDetail(resolvedParams.id);

  if (!quoteResult.ok) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-10">
        <section className="rounded-2xl border border-red-500/30 bg-red-950/40 p-6 text-center">
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
      </main>
    );
  }

  const quote = quoteResult.data;

  if (!quote) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-10">
        <section className="rounded-2xl border border-slate-800 bg-slate-950/60 p-6 text-center">
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
      </main>
    );
  }

  const projectResult = await loadQuoteProject(quote.id);
  const project = projectResult.data;
  const projectUnavailable = projectResult.unavailable;
  console.info("[admin quote] project loaded", {
    quoteId: quote.id,
    hasProject: Boolean(project),
    unavailable: projectUnavailable,
  });

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
      typeof quote.email === "string" && quote.email.includes("@")
        ? quote.email
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
    const threadResult = await loadQuoteThreadForQuote(quote.id);
    if (!threadResult.ok) {
      console.error("Failed to load quote messages", {
        quoteId: quote.id,
        error: threadResult.error,
      });
    }
    const thread = threadResult.data ?? { quoteId: quote.id, messages: [] };
    const quoteMessagesError = threadResult.ok ? null : threadResult.error;
    const bidsResult = await loadBidsForQuote(quote.id);
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

    const bidCount = bids.length;
    const hasWinningBid = bids.some((bid) => isWinningBidStatus(bid?.status));
    const winningBidRow =
      bids.find((bid) => isWinningBidStatus(bid?.status)) ?? null;
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
    const hasProject = Boolean(project);
    const attentionState = deriveAdminQuoteAttentionState({
      quoteId: quote.id,
      status,
      bidCount,
      hasWinner: hasWinningBid,
      hasProject,
    });
    const timelineEvents = buildCustomerQuoteTimeline({
      quote,
      bids,
      project,
    });

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

    const summaryContent = (
      <div className="space-y-5 lg:grid lg:grid-cols-[minmax(0,0.6fr)_minmax(0,0.4fr)] lg:gap-5 lg:space-y-0">
        <div className="space-y-4 lg:space-y-5">
          <QuoteFilesCard
            id={fileCardAnchorId}
            files={filePreviews}
            className="scroll-mt-20"
          />
          {rfqSummaryCard}
        </div>
        <div className="space-y-4 lg:space-y-5">
          {projectNotesCard}
          <AdminQuoteProjectCard
            quoteId={quote.id}
            project={project}
            projectUnavailable={projectUnavailable}
            className={cardClasses}
          />
        </div>
      </div>
    );

    const messagesUnavailable = Boolean(quoteMessagesError);
    const messagesContent = (
      <QuoteMessagesPanel
        thread={thread}
        viewerRole="admin"
        heading="Customer & supplier messages"
        description="One shared conversation across portals."
        helperText="Replies notify the customer inbox immediately."
        messagesUnavailable={messagesUnavailable}
        composer={{
          quoteId: quote.id,
          mode: "admin",
          placeholder: "Share an update or ask a follow-up question...",
          sendLabel: "Reply",
          pendingLabel: "Sending...",
        }}
      />
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
      <AdminQuoteTrackingCard
        events={timelineEvents}
        className={cardClasses}
      />
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
        count: thread.messages.length,
        content: messagesContent,
      },
      { id: "edit", label: "Edit quote", content: editContent },
      { id: "viewer", label: "3D viewer", content: viewerContent },
      { id: "tracking", label: "Tracking", content: trackingContent },
    ];

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
                  href={`#${fileCardAnchorId}`}
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

            <div className="rounded-2xl border border-slate-900 bg-slate-950/40 px-6 py-4 text-sm text-slate-200">
              <div className="flex flex-wrap gap-4">
                <span className="font-semibold text-slate-50">
                  Bids: {attentionState.bidCount}
                  {attentionState.hasWinner ? " · Winner selected" : ""}
                </span>
                <span className="text-slate-300">
                  Kickoff:{" "}
                  <span className={kickoffSummaryTone}>{kickoffSummaryLabel}</span>
                </span>
                <span
                  className={
                    attentionState.needsDecision
                      ? "font-semibold text-amber-200"
                      : "text-slate-500"
                  }
                >
                  Next action:{" "}
                  {attentionState.needsDecision ? "Needs award decision" : "None"}
                </span>
              </div>
            </div>
          </div>

          <QuoteWorkspaceTabs tabs={tabs} defaultTab="summary" />

          <SupplierBidsCard
            quoteId={quote.id}
            quoteStatus={status}
            bids={bids}
            bidsLoaded={bidsResult.ok}
            errorMessage={bidsResult.ok ? bidsResult.error : null}
          />
        </div>
      </AdminDashboardShell>
    );
}
