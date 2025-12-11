import clsx from "clsx";
import Link from "next/link";
import type { ReactNode } from "react";
import { formatDateTime } from "@/lib/formatDate";
import { QuoteFilesCard } from "@/app/admin/quotes/[id]/QuoteFilesCard";
import PortalCard from "@/app/(portals)/PortalCard";
import { PortalShell } from "@/app/(portals)/components/PortalShell";
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
import { loadSupplierProfile } from "@/server/suppliers";
import {
  loadBidForSupplierAndQuote,
  loadBidsForQuote,
  type BidRow,
} from "@/server/bids";
import { SupplierBidPanel } from "./SupplierBidPanel";
import { PortalLoginPanel } from "@/app/(portals)/PortalLoginPanel";
import { getServerAuthUser } from "@/server/auth";
import { WorkflowStatusCallout } from "@/components/WorkflowStatusCallout";
import { getNextWorkflowState } from "@/lib/workflow";
import { canUserBid } from "@/lib/permissions";
import { approvalsEnabled } from "@/server/suppliers/flags";
import {
  buildSupplierQuoteTimeline,
  type QuoteTimelineEvent,
} from "@/lib/quote/tracking";
import { SupplierQuoteTrackingCard } from "./SupplierQuoteTrackingCard";
import { loadQuoteProject, type QuoteProjectRow } from "@/server/quotes/projects";
import { SupplierQuoteProjectCard } from "./SupplierQuoteProjectCard";
import {
  loadQuoteThreadForQuote,
  type QuoteThread,
} from "@/server/messages/quoteThreads";
import { QuoteMessagesPanel } from "@/app/(portals)/components/QuoteMessagesPanel";
import {
  loadQuoteKickoffTasksForSupplier,
  type SupplierKickoffTasksResult,
} from "@/server/quotes/kickoffTasks";
import { SupplierKickoffChecklistCard } from "./SupplierKickoffChecklistCard";
import { KickoffChecklist } from "./KickoffChecklist";

export const dynamic = "force-dynamic";

type SupplierQuotePageProps = {
  params: Promise<{ id: string }>;
};

export default async function SupplierQuoteDetailPage({
  params,
}: SupplierQuotePageProps) {
  const { id: quoteId } = await params;

  const { user } = await getServerAuthUser();
  if (!user) {
    return (
      <PortalLoginPanel
        role="supplier"
        fallbackRedirect={`/supplier/quotes/${quoteId}`}
      />
    );
  }
  const supplierEmail = normalizeEmailInput(user.email ?? null);

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

  const workspaceResult = await loadQuoteWorkspaceData(quoteId);
  if (!workspaceResult.ok || !workspaceResult.data) {
    console.error("[supplier quote] load failed", {
      quoteId,
      error: workspaceResult.error ?? "Quote not found",
    });
    return (
      <PortalNoticeCard
        title="Quote not found"
        description="We couldn’t find that quote ID. Double-check the link or ping the Zartman team."
      />
    );
  }
  const workspaceData = workspaceResult.data;

  const projectResult = await loadQuoteProject(quoteId);
  const project = projectResult.data;
  const projectUnavailable = projectResult.unavailable;
  console.info("[supplier quote] project loaded", {
    quoteId,
    hasProject: Boolean(project),
    unavailable: projectUnavailable,
  });

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

  const bidsResult = await loadBidsForQuote(quoteId);
  const bidsArray = bidsResult.ok && Array.isArray(bidsResult.data)
    ? (bidsResult.data ?? [])
    : [];
  const supplierTimelineEvents: QuoteTimelineEvent[] =
    buildSupplierQuoteTimeline({
      quote: workspaceData.quote,
      bids: bidsArray,
      supplierId: profile.supplier.id,
      project,
    });
  console.log("[supplier quote] tracking events built", {
    quoteId,
    supplierId: profile.supplier.id,
    eventCount: supplierTimelineEvents.length,
  });

  const approvalsOn = approvalsEnabled();
  const approved = approvalsOn ? profile.approved : true;
  const bidResult = await loadBidForSupplierAndQuote(
    profile.supplier.id,
    quoteId,
  );
  const initialBid = bidResult.ok ? bidResult.data : null;
  const bidsUnavailableMessage = bidResult.ok ? null : bidResult.error ?? null;
  const existingBid = initialBid;
  const kickoffVisibility = deriveSupplierKickoffVisibility(
    workspaceData.quote.status,
    existingBid?.status ?? null,
    Boolean(project),
  );

  let kickoffTasksResult: SupplierKickoffTasksResult | null = null;
  if (kickoffVisibility.showKickoffChecklist) {
    kickoffTasksResult = await loadQuoteKickoffTasksForSupplier(
      quoteId,
      profile.supplier.id,
    );
  }

  const threadResult = await loadQuoteThreadForQuote(quoteId);
  const threadUnavailable = !threadResult.ok;
  const thread = threadResult.data ?? { quoteId, messages: [] };

  const bidStatus = (existingBid?.status ?? "").toLowerCase();
  const messagingUnlocked =
    bidStatus === "accepted" || bidStatus === "won" || bidStatus === "winner";

  const messagingDisabledReason = messagingUnlocked
    ? null
    : "Chat unlocks after your bid is accepted or selected as the winner for this RFQ.";

  return (
    <SupplierQuoteWorkspace
      data={workspaceData}
      supplierEmail={
        profile.supplier.primary_email ??
        supplierEmail ??
        user.email ??
        "supplier"
      }
      supplierId={profile.supplier.id}
      assignments={assignments}
      supplierNameOverride={profile.supplier.company_name}
      existingBid={existingBid}
      initialBid={initialBid}
      bidsUnavailableMessage={bidsUnavailableMessage}
      approvalsOn={approvalsOn}
      approved={approved}
      messagingUnlocked={messagingUnlocked}
      messagingDisabledReason={messagingDisabledReason}
      thread={thread}
      threadUnavailable={threadUnavailable}
      timelineEvents={supplierTimelineEvents}
      project={project}
      projectUnavailable={projectUnavailable}
      kickoffTasksResult={kickoffTasksResult}
      kickoffVisibility={kickoffVisibility}
    />
  );
}

function SupplierQuoteWorkspace({
  data,
  supplierEmail,
  supplierId,
  assignments,
  supplierNameOverride,
  existingBid,
  initialBid,
  bidsUnavailableMessage,
  approvalsOn,
  approved,
  messagingUnlocked,
  messagingDisabledReason,
  thread,
  threadUnavailable,
  timelineEvents,
  project,
  projectUnavailable,
  kickoffTasksResult,
  kickoffVisibility,
}: {
  data: QuoteWorkspaceData;
  supplierEmail: string;
  supplierId: string;
  assignments: SupplierAssignment[];
  supplierNameOverride?: string | null;
  existingBid: BidRow | null;
  initialBid: BidRow | null;
  bidsUnavailableMessage: string | null;
  approvalsOn: boolean;
  approved: boolean;
  messagingUnlocked: boolean;
  messagingDisabledReason?: string | null;
  thread: QuoteThread;
  threadUnavailable: boolean;
  timelineEvents: QuoteTimelineEvent[];
  project: QuoteProjectRow | null;
  projectUnavailable: boolean;
  kickoffTasksResult: SupplierKickoffTasksResult | null;
  kickoffVisibility: SupplierKickoffVisibility;
}) {
  const { quote, uploadMeta, filePreviews } = data;
  const quoteFiles = Array.isArray(quote.files) ? quote.files : [];
  const fileCount =
    typeof quote.fileCount === "number" ? quote.fileCount : quoteFiles.length;
  const derived = deriveQuotePresentation(quote, uploadMeta);
  const nextWorkflowState = getNextWorkflowState(derived.status);
  const canSubmitBid = canUserBid("supplier", {
    status: quote.status,
    existingBidStatus: existingBid?.status ?? null,
    accessGranted: true,
  });
  const bidLocked = !canSubmitBid;
  const hasProject = Boolean(project);
  const kickoffVisibilityState =
    kickoffVisibility ??
    deriveSupplierKickoffVisibility(
      quote.status,
      existingBid?.status ?? null,
      hasProject,
    );
  const {
    normalizedQuoteStatus,
    normalizedBidStatus,
    bidSelectedAsWinner,
    quoteReadyForKickoff,
    showKickoffChecklist,
  } = kickoffVisibilityState;
  const acceptedLock = normalizedBidStatus === "accepted";
  const closedWindowLock = bidLocked && !acceptedLock;
  console.log("[supplier kickoff] visibility debug", {
    quoteId: quote.id,
    bidSelectedAsWinner,
    normalizedQuoteStatus,
    quoteReadyForKickoff,
    hasProject,
    showKickoffChecklist,
    tasksOk: kickoffTasksResult?.ok ?? null,
    taskCount: kickoffTasksResult?.tasks?.length ?? null,
  });
  const supplierDisplayName =
    supplierNameOverride ??
    getSupplierDisplayName(supplierEmail, quote, assignments);
  const cardClasses =
    "rounded-2xl border border-slate-800 bg-slate-950/60 px-5 py-4";
  const fileCountText =
    fileCount === 0
      ? "No files attached"
      : fileCount === 1
        ? "1 file attached"
        : `${fileCount} files attached`;
  const assignmentNames = assignments
    .map((assignment) => assignment.supplier_name ?? assignment.supplier_email)
    .filter((value): value is string => Boolean(value && value.trim()));
  const primaryFileName =
    filePreviews[0]?.fileName ??
    filePreviews[0]?.label ??
    quote.file_name ??
    quoteFiles[0]?.filename ??
    formatQuoteId(quote.id);
  const isWinningSupplier = bidSelectedAsWinner;
  const showSupplierProjectCard = isWinningSupplier;
  const headerTitle = `${formatQuoteId(quote.id)} · ${derived.customerName}`;
  const headerActions = (
    <Link
      href="/supplier"
      className="inline-flex items-center rounded-full border border-blue-400/40 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-blue-100 transition hover:border-blue-300 hover:text-white"
    >
      Back to inbox
    </Link>
  );
  const headerContent = (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">
            RFQ file
          </p>
          <p className="text-sm text-slate-300">{primaryFileName}</p>
        </div>
        <span className="rounded-full border border-blue-400/40 bg-blue-500/10 px-3 py-1 text-xs font-semibold text-blue-100">
          {derived.statusLabel}
        </span>
      </div>
      <dl className="grid gap-4 text-sm text-slate-300 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Customer
          </dt>
          <dd className="text-slate-100">{derived.customerName ?? "Customer"}</dd>
        </div>
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Company
          </dt>
          <dd className="text-slate-100">{derived.companyName ?? "Not provided"}</dd>
        </div>
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Target ship date
          </dt>
          <dd className="text-slate-100">
            {derived.targetDateValue
              ? formatDateTime(derived.targetDateValue)
              : "Not scheduled"}
          </dd>
        </div>
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Submitted
          </dt>
          <dd className="text-slate-100">
            {formatDateTime(quote.created_at, { includeTime: true }) ?? "—"}
          </dd>
        </div>
      </dl>
      <div className="flex flex-wrap gap-3 text-xs text-slate-400">
        <span>
          Working as{" "}
          <span className="font-semibold text-white">
            {supplierDisplayName}
          </span>{" "}
          (<span className="font-mono text-slate-200">{supplierEmail}</span>)
        </span>
        {assignmentNames.length > 0 ? (
          <span>
            Assigned with:{" "}
            <span className="text-slate-200">{assignmentNames.join(", ")}</span>
          </span>
        ) : null}
        {bidSelectedAsWinner ? (
          <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-200">
            Selected by customer
          </span>
        ) : null}
      </div>
    </div>
  );

  const winnerCallout = bidSelectedAsWinner ? (
    <section className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-5 py-4 text-sm text-emerald-50">
      <p className="text-base font-semibold text-emerald-100">
        Your bid won this RFQ
      </p>
      <p className="mt-1 text-emerald-50/80">
        We&apos;re coordinating kickoff now. Use the checklist below to lock in
        materials, timing, and any handoff notes.
      </p>
    </section>
  ) : null;

  let kickoffChecklistSection: ReactNode = null;
  if (showKickoffChecklist) {
    if (kickoffTasksResult && kickoffTasksResult.ok) {
      kickoffChecklistSection = (
        <SupplierKickoffChecklistCard
          quoteId={quote.id}
          supplierId={supplierId}
          tasks={kickoffTasksResult.tasks}
        />
      );
    } else {
      kickoffChecklistSection = <KickoffChecklist />;
    }
  }

  const summaryCard = (
    <section className={clsx(cardClasses, "space-y-5")}>
      <header className="space-y-1">
        <p className="text-xsenaamde font-semibold uppercase tracking-wide text-slate-500">
          RFQ snapshot
        </p>
        <h2 className="text-lg font-semibold text-white">
          Key details for your shop
        </h2>
      </header>
      <dl className="grid gap-4 text-sm text-slate-200 sm:grid-cols-2">
        <DetailItem label="Customer" value={derived.customerName} />
        <DetailItem
          label="Company"
          value={derived.companyName ?? "Not provided"}
        />
        <DetailItem
          label="Files"
          value={fileCountText}
        />
        <DetailItem
          label="Process hint"
          value={
            uploadMeta?.manufacturing_process
              ? formatProcessLabel(uploadMeta.manufacturing_process)
              : "Not provided"
          }
        />
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
      <WorkflowStatusCallout
        currentLabel={derived.statusLabel}
        nextState={nextWorkflowState}
        variant="blue"
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            DFM notes
          </p>
          <p className="mt-1 whitespace-pre-line text-sm text-slate-200">
            {derived.dfmNotes ??
              "No DFM notes have been shared yet. Expect engineering guidance to appear here."}
          </p>
        </div>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Intake notes
          </p>
          <p className="mt-1 whitespace-pre-line text-sm text-slate-200">
            {derived.intakeNotes ?? "No extra intake notes captured."}
          </p>
        </div>
      </div>
      <div className="space-y-3 rounded-2xl border border-slate-900/60 bg-slate-950/30 p-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Bid
          </p>
          <h3 className="text-lg font-semibold text-white">Submit pricing and lead time</h3>
          <p className="mt-1 text-sm text-slate-300">
            Only the Zartman team and the requesting customer can see these details.
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Share a unit price, realistic lead time, and highlight any certifications or notes that help
            the buyer approve your shop.
          </p>
        </div>
        {acceptedLock ? (
          <p className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
            This bid is locked because the customer already accepted it.
          </p>
        ) : null}
        {closedWindowLock ? (
          <p className="rounded-xl border border-yellow-500/30 bg-yellow-500/5 px-3 py-2 text-xs text-yellow-100">
            Bidding is disabled because this RFQ is no longer accepting new proposals.
          </p>
        ) : null}
        <SupplierBidPanel
          quoteId={quote.id}
          initialBid={initialBid}
          approvalsOn={approvalsOn}
          approved={approved}
          bidsUnavailableMessage={bidsUnavailableMessage}
        />
      </div>
    </section>
  );

  const projectSection = showSupplierProjectCard ? (
    <SupplierQuoteProjectCard
      className={cardClasses}
      project={project}
      unavailable={projectUnavailable}
    />
  ) : (
    <PortalCard
      title="Project kickoff"
      description="Read-only PO details unlock once your bid is selected as the winner."
    >
      <p className="text-sm text-slate-300">
        We’ll surface the customer’s PO number, target ship date, and kickoff notes as soon as they select
        your bid.
      </p>
    </PortalCard>
  );

  return (
    <PortalShell
      workspace="supplier"
      title={headerTitle}
      subtitle="Everything you need to respond — files, DFM guidance, bids, and chat."
      headerContent={headerContent}
      actions={headerActions}
    >
      {winnerCallout}
      {kickoffChecklistSection}
      {summaryCard}
      {projectSection}
      <QuoteMessagesPanel
        thread={thread}
        viewerRole="supplier"
        heading="Shared chat"
        description="Customer, supplier, and admin updates for this RFQ."
        helperText="Your note pings the Zartman admin team instantly."
        messagesUnavailable={threadUnavailable}
        composer={{
          quoteId: quote.id,
          mode: "supplier",
          disabled: !messagingUnlocked,
          disableReason: messagingDisabledReason ?? undefined,
          placeholder:
            "Share build progress, questions, or risks with the Zartman team...",
          sendLabel: "Send update",
          pendingLabel: "Sending...",
        }}
      />
      <div className="space-y-2">
        <QuoteFilesCard files={filePreviews} className="scroll-mt-20" />
        {filePreviews.length === 0 ? (
          <p className="px-1 text-xs text-slate-500">
            No files to display yet. We&apos;ll attach uploads here automatically once they&apos;re processed.
          </p>
        ) : null}
      </div>
      <SupplierQuoteTrackingCard className={cardClasses} events={timelineEvents} />
    </PortalShell>
  );
}

type SupplierKickoffVisibility = {
  normalizedQuoteStatus: string;
  normalizedBidStatus: string;
  bidSelectedAsWinner: boolean;
  quoteReadyForKickoff: boolean;
  showKickoffChecklist: boolean;
};

function deriveSupplierKickoffVisibility(
  quoteStatus: string | null | undefined,
  bidStatus: string | null | undefined,
  hasProject: boolean,
): SupplierKickoffVisibility {
  const normalizedQuoteStatus = (quoteStatus ?? "").trim().toLowerCase();
  const normalizedBidStatus =
    typeof bidStatus === "string" ? bidStatus.trim().toLowerCase() : "";
  const bidSelectedAsWinner = ["accepted", "won", "winner"].includes(
    normalizedBidStatus,
  );
  const quoteReadyForKickoff = [
    "approved",
    "won",
    "winner_selected",
    "winner-selected",
    "winner",
  ].includes(normalizedQuoteStatus);
  const showKickoffChecklist =
    bidSelectedAsWinner && (quoteReadyForKickoff || hasProject);

  return {
    normalizedQuoteStatus,
    normalizedBidStatus,
    bidSelectedAsWinner,
    quoteReadyForKickoff,
    showKickoffChecklist,
  };
}

function formatProcessLabel(processHint: string | null): string {
  if (typeof processHint !== "string") {
    return "this";
  }
  const trimmed = processHint.trim();
  if (!trimmed) {
    return "this";
  }
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
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
