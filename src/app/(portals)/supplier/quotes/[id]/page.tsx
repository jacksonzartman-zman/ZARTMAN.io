import type { ReactNode } from "react";
import { formatDateTime } from "@/lib/formatDate";
import { QuoteFilesCard } from "@/app/admin/quotes/[id]/QuoteFilesCard";
import {
  QuoteWorkspaceTabs,
  type QuoteWorkspaceTab,
} from "@/app/admin/quotes/[id]/QuoteWorkspaceTabs";
import { QuoteMessagesThread } from "@/components/quotes/QuoteMessagesThread";
import { SupplierQuoteMessageComposer } from "./SupplierQuoteMessageComposer";
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
import {
  getSupplierDisplayName,
  loadSupplierAssignments,
  supplierHasAccess,
  type SupplierAssignment,
} from "./supplierAccess";

export const dynamic = "force-dynamic";

type SupplierQuotePageProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<SearchParamsLike>;
};

export default async function SupplierQuoteDetailPage({
  params,
  searchParams,
}: SupplierQuotePageProps) {
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
        description="Append ?email=you@supplier.com so we can confirm your assignment."
      />
    );
  }

  const workspaceData = await loadQuoteWorkspaceData(quoteId);
  if (!workspaceData) {
    return (
      <PortalNoticeCard
        title="Quote not found"
        description="We couldn’t find that quote ID. Double-check the link or ping the Zartman team."
      />
    );
  }

  const assignments = await loadSupplierAssignments(quoteId);
  if (!supplierHasAccess(normalizedEmail, workspaceData.quote, assignments)) {
    return (
      <PortalNoticeCard
        title="Access denied"
        description="This RFQ isn’t assigned to your inbox. Contact your Zartman rep if you believe this is an error."
      />
    );
  }

  return (
    <SupplierQuoteWorkspace
      data={workspaceData}
      supplierEmail={normalizedEmail}
      assignments={assignments}
    />
  );
}

function SupplierQuoteWorkspace({
  data,
  supplierEmail,
  assignments,
}: {
  data: QuoteWorkspaceData;
  supplierEmail: string;
  assignments: SupplierAssignment[];
}) {
  const { quote, uploadMeta, filePreviews, messages, messagesError } = data;
  const derived = deriveQuotePresentation(quote, uploadMeta);
  const supplierDisplayName = getSupplierDisplayName(
    supplierEmail,
    quote,
    assignments,
  );
  const cardClasses =
    "rounded-2xl border border-slate-800 bg-slate-950/60 px-5 py-4";
  const fileCountText =
    filePreviews.length === 0
      ? "No files attached"
      : filePreviews.length === 1
        ? "1 file attached"
        : `${filePreviews.length} files attached`;
  const assignmentNames = assignments
    .map((assignment) => assignment.supplier_name ?? assignment.supplier_email)
    .filter((value): value is string => Boolean(value && value.trim()));

  const summaryContent = (
    <div className="space-y-4">
      <section className={cardClasses}>
        <header className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Build context
          </p>
          <h2 className="text-lg font-semibold text-white">
            Key RFQ details
          </h2>
        </header>
        <dl className="mt-4 grid gap-4 text-sm text-slate-200 sm:grid-cols-2">
          <DetailItem label="Customer" value={derived.customerName} />
          <DetailItem
            label="Company"
            value={derived.companyName ?? "Not provided"}
          />
          <DetailItem
            label="Target ship date"
            value={
              derived.targetDateValue
                ? formatDateTime(derived.targetDateValue)
                : "Not scheduled"
            }
          />
          <DetailItem label="Files" value={fileCountText} />
          <DetailItem
            label="Assigned suppliers"
            value={
              assignmentNames.length > 0
                ? assignmentNames.join(", ")
                : "Pending assignment"
            }
          />
          <DetailItem
            label="Submitted"
            value={formatDateTime(quote.created_at, { includeTime: true }) ?? "—"}
          />
        </dl>
      </section>

      <section className={cardClasses}>
        <header className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Customer notes
          </p>
          <h2 className="text-lg font-semibold text-white">
            DFM & intake summary
          </h2>
        </header>
        <div className="mt-3 grid gap-4 lg:grid-cols-2">
          <div className="space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              DFM notes
            </p>
            <p className="whitespace-pre-line text-sm text-slate-200">
              {derived.dfmNotes ??
                "No DFM notes have been shared yet. Expect engineering guidance to appear here."}
            </p>
          </div>
          <div className="space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Intake notes
            </p>
            <p className="whitespace-pre-line text-sm text-slate-200">
              {derived.intakeNotes ?? "No extra intake notes captured."}
            </p>
          </div>
        </div>
      </section>
    </div>
  );

  const messagesContent = (
    <section className={cardClasses}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Messages
          </p>
          <div className="mt-1 space-y-1">
            <h2 className="text-lg font-semibold text-white">
              Supplier &lt;&gt; admin chat
            </h2>
            <p className="text-sm text-slate-400">
              Keep build updates, questions, and risks in one shared thread.
            </p>
          </div>
        </div>
        <span className="text-xs text-slate-500">
          {messages.length} {messages.length === 1 ? "message" : "messages"}
        </span>
      </div>

      {messagesError && (
        <p className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
          Some messages may be missing. Refresh the page to try again.
        </p>
      )}

      <div className="mt-3">
        <QuoteMessagesThread
          messages={messages}
          emptyState={
            <p className="rounded-2xl border border-dashed border-slate-800/70 bg-black/30 px-4 py-4 text-sm text-slate-400">
              No updates yet. Share a build status, question, or risk to get the
              conversation going.
            </p>
          }
        />
      </div>

      <div className="mt-4 border-t border-slate-900/60 pt-4">
        <p className="text-sm font-semibold text-slate-100">Post an update</p>
        <p className="mt-1 text-xs text-slate-500">
          Your message notifies the Zartman admin team instantly.
        </p>
        <div className="mt-3">
          <SupplierQuoteMessageComposer
            quoteId={quote.id}
            supplierEmail={supplierEmail}
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
        We&apos;ll surface PO status, inspections, and logistics checkpoints
        here as soon as live supplier tracking is wired up.
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
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-blue-300">
          Supplier workspace
        </p>
        <div className="mt-2 space-y-1">
          <h1 className="text-2xl font-semibold text-white">
            {formatQuoteId(quote.id)} · {derived.customerName}
          </h1>
          <p className="text-sm text-slate-400">
            Files, DFM feedback, and shared chat for this assigned RFQ.
          </p>
        </div>
        <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-xs text-slate-400">
          <span>
            Working as{" "}
            <span className="font-semibold text-white">
              {supplierDisplayName}
            </span>{" "}
            (<span className="font-mono text-slate-200">{supplierEmail}</span>)
          </span>
          <span>
            Status:{" "}
            <span className="font-semibold text-blue-200">
              {derived.statusLabel}
            </span>
          </span>
        </div>
      </section>

      <QuoteWorkspaceTabs tabs={tabs} defaultTab="summary" />
    </div>
  );
}

function DetailItem({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-900/60 bg-slate-950/40 px-3 py-2">
      <dt className="text-[11px] uppercase tracking-wide text-slate-500">
        {label}
      </dt>
      <dd className="text-slate-100">{value}</dd>
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
