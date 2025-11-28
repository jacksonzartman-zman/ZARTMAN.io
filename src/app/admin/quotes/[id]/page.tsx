// src/app/admin/quotes/[id]/page.tsx

import clsx from "clsx";
import Link from "next/link";
import type { ReactNode } from "react";
import { formatDateTime } from "@/lib/formatDate";
import { loadQuoteMessages, type QuoteMessage } from "@/server/quotes/messages";
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
import { QuoteMessageComposer } from "./QuoteMessageComposer";
import { QuoteFilesCard } from "./QuoteFilesCard";
import {
  QuoteWorkspaceTabs,
  type QuoteWorkspaceTab,
} from "./QuoteWorkspaceTabs";
import { ctaSizeClasses, secondaryCtaClasses } from "@/lib/ctas";
import { QuoteMessagesThread } from "@/components/quotes/QuoteMessagesThread";
import { loadAdminQuoteDetail } from "@/server/admin/quotes";
import { loadBidsForQuote } from "@/server/bids";
import { loadAdminUploadDetail } from "@/server/admin/uploads";
import { SupplierBidsCard } from "./SupplierBidsCard";

export const dynamic = "force-dynamic";

type QuoteDetailPageProps = {
  params: Promise<{ id: string }>;
};

export default async function QuoteDetailPage({ params }: QuoteDetailPageProps) {
  const resolvedParams = await params;

  const quoteResult = await loadAdminQuoteDetail(resolvedParams.id);

  if (!quoteResult.ok) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-10">
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
      <main className="mx-auto max-w-3xl px-4 py-10">
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
    const {
      messages: quoteMessages,
      error: quoteMessagesError,
    } = await loadQuoteMessages(quote.id);

    if (quoteMessagesError) {
      console.error("Failed to load quote messages", {
        quoteId: quote.id,
        error: quoteMessagesError,
      });
    }
    const messages: QuoteMessage[] = quoteMessages ?? [];
    const bidsResult = await loadBidsForQuote(quote.id);
    const bids = bidsResult.ok ? bidsResult.data : [];

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
        </div>
      </div>
    );

      const messagesContent = (
        <section className={cardClasses}>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Messages
          </p>
          <QuoteMessagesThread
            heading="Admin chat"
            description="Chat-style thread visible only to the admin workspace."
            messages={messages}
            messageCount={messages.length}
            error={
              quoteMessagesError
                ? "Unable to load every message right now. Refresh to retry."
                : null
            }
            emptyState={
              <p className="rounded-2xl border border-dashed border-slate-800/70 bg-black/30 px-4 py-4 text-sm text-slate-400">
                No messages yet. Use the composer below to start the thread for
                this quote.
              </p>
            }
            containerClassName="mt-3"
          />

          <div className="mt-4 border-t border-slate-900/60 pt-4">
            <p className="text-sm font-semibold text-slate-100">Post a message</p>
            <p className="mt-1 text-xs text-slate-500">
              Shared only with admins working on this quote.
            </p>
            <div className="mt-3">
              <QuoteMessageComposer quoteId={quote.id} />
            </div>
          </div>
        </section>
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
      <section className={cardClasses}>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Tracking
        </p>
        <h2 className="mt-1 text-lg font-semibold text-slate-50">
          Production milestones
        </h2>
        <p className="mt-2 text-sm text-slate-300">
          This is where order status, supplier assignments, and production checks
          will live. For now, treat this as a placeholder so we can wire in real
          tracking data without reworking the layout later.
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
