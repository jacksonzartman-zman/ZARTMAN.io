import clsx from "clsx";
import type { ReactNode } from "react";
import { formatDateTime } from "@/lib/formatDate";
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
import { listSupplierBidsForQuote, type SupplierBidWithContext } from "@/server/suppliers";
import { BidDecisionButtons } from "./BidDecisionButtons";

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

  const emailParam = getSearchParamValue(resolvedSearchParams, "email");
  const normalizedEmail = normalizeEmailInput(emailParam);

  if (!normalizedEmail) {
    return (
      <PortalNoticeCard
        title="Add your email to view this quote"
        description="Append ?email=you@company.com to the URL so we can verify which RFQs to load."
      />
    );
  }

  const workspaceData = await loadQuoteWorkspaceData(quoteId);
  if (!workspaceData) {
    return (
      <PortalNoticeCard
        title="Quote not found"
        description="We couldn’t find a quote with that reference. Double-check the link or contact support."
      />
    );
  }

    const { quote, uploadMeta, filePreviews, messages, messagesError } =
      workspaceData;
    const quoteEmail = normalizeEmailInput(quote.email);
    if (!quoteEmail || quoteEmail !== normalizedEmail) {
      console.error("Customer portal: access denied", {
        quoteId,
        identityEmail: normalizedEmail,
        quoteEmail: quote.email,
      });
    return (
      <PortalNoticeCard
        title="Access denied"
        description="This quote is not linked to your email address. Confirm you’re using the right mailbox or request access from your admin."
      />
    );
  }

    const derived = deriveQuotePresentation(quote, uploadMeta);
    const { status, statusLabel, customerName, companyName, intakeNotes } =
      derived;
    const supplierBids = await listSupplierBidsForQuote(quoteId);
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
    const identityEmailDisplay = quote.email ?? normalizedEmail;

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
            Status: {statusLabel}
          </span>
          <span className="rounded-full border border-slate-800 bg-slate-900/60 px-3 py-1 text-slate-200">
            Target date: {targetDateChipText}
          </span>
          <span className="rounded-full border border-slate-800 bg-slate-900/60 px-3 py-1 text-slate-200">
            Estimate: {priceChipText}
          </span>
        </div>
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
              {formatDateTime(quote.created_at, { includeTime: true }) ?? "—"}
            </dd>
          </div>
          <div className="rounded-xl border border-slate-900/60 bg-slate-950/40 px-3 py-2">
            <dt className="text-[11px] uppercase tracking-wide text-slate-500">
              Last updated
            </dt>
            <dd className="text-slate-100">
              {formatDateTime(quote.updated_at, { includeTime: true }) ?? "—"}
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
          <div className="mt-3">
            <CustomerQuoteMessageComposer
              quoteId={quote.id}
              customerEmail={identityEmailDisplay}
              customerName={customerName}
            />
          </div>
        </div>
      </section>
    );

  const filesContent = (
    <QuoteFilesCard files={filePreviews} className="scroll-mt-20" />
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

    const suppliersContent = (
      <section className={cardClasses}>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Supplier bids
        </p>
        {supplierBids.length > 0 ? (
          <div className="mt-3 space-y-3">
            {supplierBids.map((bid) => (
              <article
                key={bid.id}
                className="rounded-2xl border border-slate-900/60 bg-slate-950/40 p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-white">
                      {bid.supplier?.company_name ?? "Supplier"}
                    </p>
                    <p className="text-xs text-slate-500">
                      {bid.supplier?.primary_email ?? "—"}
                    </p>
                  </div>
                  <BidStatusBadge status={bid.status} />
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-4">
                  <DetailChip label="Unit price" value={formatBidPrice(bid)} />
                  <DetailChip
                    label="Lead time"
                    value={
                      bid.lead_time_days
                        ? `${bid.lead_time_days} day${bid.lead_time_days === 1 ? "" : "s"}`
                        : "Pending"
                    }
                  />
                  <DetailChip
                    label="Certifications"
                    value={
                      bid.certifications && bid.certifications.length > 0
                        ? bid.certifications.join(", ")
                        : "Not shared"
                    }
                  />
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      Actions
                    </p>
                    <BidDecisionButtons
                      bidId={bid.id}
                      quoteId={quote.id}
                      identityEmail={normalizedEmail}
                      status={bid.status}
                    />
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-sm text-slate-400">
            No supplier bids yet. We’ll surface responses in real time as they arrive.
          </p>
        )}
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
      {
        id: "suppliers",
        label: `Suppliers (${supplierBids.length})`,
        content: suppliersContent,
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
            {statusLabel}
            </span>
          </span>
        </div>
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

function BidStatusBadge({ status }: { status: string }) {
  const colorMap: Record<string, string> = {
    accepted: "bg-emerald-500/20 text-emerald-200 border-emerald-500/30",
    declined: "bg-red-500/10 text-red-200 border-red-500/30",
    pending: "bg-blue-500/10 text-blue-200 border-blue-500/30",
    withdrawn: "bg-slate-500/10 text-slate-200 border-slate-500/30",
  };
  const classes =
    colorMap[status] ?? "bg-slate-500/10 text-slate-200 border-slate-500/30";
  return (
    <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${classes}`}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

function DetailChip({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-900/60 bg-slate-950/30 px-3 py-2">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p className="text-sm text-slate-100">{value}</p>
    </div>
  );
}

function formatBidPrice(bid: SupplierBidWithContext): string {
  const numeric =
    typeof bid.unit_price === "string" ? Number(bid.unit_price) : bid.unit_price;
  if (typeof numeric !== "number" || !Number.isFinite(numeric)) {
    return "Pending";
  }

  const currency = (bid.currency ?? "USD").toUpperCase();
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(numeric);
  } catch {
    return `${currency} ${numeric.toFixed(0)}`;
  }
}
