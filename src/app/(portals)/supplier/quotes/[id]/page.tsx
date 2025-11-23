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
  normalizeEmailInput,
} from "@/app/(portals)/quotes/pageUtils";
import {
  loadQuoteWorkspaceData,
  type QuoteWorkspaceData,
} from "@/app/(portals)/quotes/workspaceData";
import { deriveQuotePresentation } from "@/app/(portals)/quotes/deriveQuotePresentation";
import {
  getSupplierDisplayName,
  loadSupplierAssignments,
  matchesSupplierProcess,
  supplierHasAccess,
  type SupplierAssignment,
} from "./supplierAccess";
import {
  getSupplierBidForQuote,
  loadSupplierProfile,
  type SupplierBidRow,
} from "@/server/suppliers";
import { SupplierBidForm } from "./SupplierBidForm";
import { PortalLoginPanel } from "@/app/(portals)/PortalLoginPanel";
import { getCurrentSession } from "@/server/auth";

export const dynamic = "force-dynamic";

type SupplierQuotePageProps = {
  params: Promise<{ id: string }>;
};

export default async function SupplierQuoteDetailPage({
  params,
}: SupplierQuotePageProps) {
  const { id: quoteId } = await params;

  const session = await getCurrentSession();
  if (!session) {
    return (
      <PortalLoginPanel
        role="supplier"
        fallbackRedirect={`/supplier/quotes/${quoteId}`}
      />
    );
  }
  const supplierEmail = normalizeEmailInput(session.user.email ?? null);

  if (!supplierEmail) {
    return (
      <PortalNoticeCard
        title="Sign in with a supplier email"
        description="We couldn’t determine which supplier account you’re using. Try signing out and back in."
      />
    );
  }

  const profile = await loadSupplierProfile(supplierEmail);
  if (!profile?.supplier) {
    return (
      <PortalNoticeCard
        title="Complete onboarding"
        description="Finish the supplier onboarding form before opening RFQs."
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
  const capabilities = profile.capabilities ?? [];
  const verifiedProcessMatch = matchesSupplierProcess(
    capabilities,
    workspaceData.uploadMeta?.manufacturing_process ?? null,
  );

  if (
    !supplierHasAccess(supplierEmail, workspaceData.quote, assignments, {
      supplier: profile.supplier,
      verifiedProcessMatch,
    })
  ) {
    console.error("Supplier portal: access denied", {
      quoteId,
      identityEmail: supplierEmail,
      quoteEmail: workspaceData.quote.email,
      assignmentCount: assignments.length,
      reason: "ACCESS_DENIED",
      verifiedProcessMatch,
    });
    return (
      <PortalNoticeCard
        title="Access denied"
        description="This RFQ isn’t assigned to your inbox. Contact your Zartman rep if you believe this is an error."
      />
    );
  }

  const existingBid = await getSupplierBidForQuote(
    quoteId,
    profile.supplier.id,
  );

  return (
    <SupplierQuoteWorkspace
      data={workspaceData}
      supplierEmail={
        profile.supplier.primary_email ??
        supplierEmail ??
        session.user.email ??
        "supplier"
      }
      assignments={assignments}
      supplierNameOverride={profile.supplier.company_name}
      existingBid={existingBid}
      messagingUnlocked={existingBid?.status === "accepted"}
    />
  );
}

function SupplierQuoteWorkspace({
  data,
  supplierEmail,
  assignments,
  supplierNameOverride,
  existingBid,
  messagingUnlocked,
}: {
  data: QuoteWorkspaceData;
  supplierEmail: string;
  assignments: SupplierAssignment[];
  supplierNameOverride?: string | null;
  existingBid: SupplierBidRow | null;
  messagingUnlocked: boolean;
}) {
  const { quote, uploadMeta, filePreviews, messages, messagesError } = data;
  const derived = deriveQuotePresentation(quote, uploadMeta);
    const supplierDisplayName =
      supplierNameOverride ??
      getSupplierDisplayName(supplierEmail, quote, assignments);
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
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Messages
        </p>
        <QuoteMessagesThread
          heading="Supplier <> admin chat"
          description="Keep build updates, questions, and risks in one shared thread."
          messages={messages}
          messageCount={messages.length}
          error={
            messagesError
              ? "Some messages may be missing. Refresh the page to try again."
              : null
          }
          emptyState={
            <p className="rounded-2xl border border-dashed border-slate-800/70 bg-black/30 px-4 py-4 text-sm text-slate-400">
              No updates yet. Share a build status, question, or risk to get the
              conversation going.
            </p>
          }
          containerClassName="mt-3"
        />

        <div className="mt-4 border-t border-slate-900/60 pt-4">
          <p className="text-sm font-semibold text-slate-100">Post an update</p>
          <p className="mt-1 text-xs text-slate-500">
            Your message notifies the Zartman admin team instantly.
          </p>
          {!messagingUnlocked ? (
            <p className="mt-2 rounded-xl border border-dashed border-slate-800/70 bg-black/30 px-3 py-2 text-xs text-slate-400">
              Chat will unlock after you submit a bid and are selected by the customer.
            </p>
          ) : null}
          <div className="mt-3">
            <SupplierQuoteMessageComposer
              quoteId={quote.id}
              supplierEmail={supplierEmail}
              disabled={!messagingUnlocked}
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

    const bidTabLabel = existingBid
      ? existingBid.status === "accepted"
        ? "Bid (accepted)"
        : "Bid (submitted)"
      : "Bid";

    const bidContent = (
      <section className={cardClasses}>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Bid
        </p>
        <p className="mt-1 text-sm text-slate-300">
          Pricing is only visible to the Zartman team and the customer tied to this RFQ.
        </p>
        <div className="mt-4">
          <SupplierBidForm
            quoteId={quote.id}
            supplierEmail={supplierEmail}
            existingBid={existingBid}
            isLocked={existingBid?.status === "accepted"}
          />
        </div>
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
      { id: "bid", label: bidTabLabel, content: bidContent },
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
            {existingBid?.status === "accepted" ? (
              <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-200">
                Selected by customer
              </span>
            ) : null}
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
