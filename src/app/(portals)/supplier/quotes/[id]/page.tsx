import clsx from "clsx";
import Link from "next/link";
import type { ReactNode } from "react";
import { formatDateTime } from "@/lib/formatDate";
import { formatCurrency } from "@/lib/formatCurrency";
import { formatAwardedByLabel } from "@/lib/awards";
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
  type SupplierAssignment,
} from "./supplierAccess";
import { loadSupplierProfileByUserId } from "@/server/suppliers";
import { assertSupplierQuoteAccess } from "@/server/quotes/access";
import {
  loadBidForSupplierAndQuote,
  type BidRow,
} from "@/server/bids";
import { SupplierBidPanel } from "./SupplierBidPanel";
import { PortalLoginPanel } from "@/app/(portals)/PortalLoginPanel";
import { getServerAuthUser } from "@/server/auth";
import { WorkflowStatusCallout } from "@/components/WorkflowStatusCallout";
import { getNextWorkflowState } from "@/lib/workflow";
import { canUserBid } from "@/lib/permissions";
import { approvalsEnabled } from "@/server/suppliers/flags";
import { QuoteTimeline } from "@/app/(portals)/components/QuoteTimeline";
import { CollapsibleCard } from "@/components/CollapsibleCard";
import {
  loadQuoteProjectForQuote,
  type QuoteProjectRecord,
} from "@/server/quotes/projects";
import { SupplierQuoteProjectCard } from "./SupplierQuoteProjectCard";
import { QuoteMessagesThread } from "@/app/(portals)/components/QuoteMessagesThread";
import {
  loadQuoteMessages,
  type QuoteMessageRecord,
} from "@/server/quotes/messages";
import {
  loadQuoteKickoffTasksForSupplier,
  type SupplierKickoffTasksResult,
  ensureKickoffTasksForQuote,
  isKickoffReadyForSupplier,
} from "@/server/quotes/kickoffTasks";
import { SupplierKickoffChecklistCard } from "./SupplierKickoffChecklistCard";
import { postQuoteMessage as postSupplierQuoteMessage } from "./actions";
import type { QuoteMessageFormState } from "@/app/(portals)/components/QuoteMessagesThread.types";
import type { QuoteEventRecord } from "@/server/quotes/events";
import { QuoteFilesUploadsSection } from "@/app/(portals)/components/QuoteFilesUploadsSection";

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

  const profile = user.id ? await loadSupplierProfileByUserId(user.id) : null;
  if (!profile?.supplier) {
    return (
      <PortalNoticeCard
        title="Complete onboarding"
        description="Finish the supplier onboarding form before opening RFQs."
      />
    );
  }

  const accessResult = await assertSupplierQuoteAccess({
    quoteId,
    supplierId: profile.supplier.id,
    supplierUserEmail: user.email ?? null,
  });

  if (!accessResult.ok) {
    console.warn("[supplier access] denied", {
      quoteId,
      supplierId: profile.supplier.id,
      reason: accessResult.reason,
      debug: accessResult.debug ?? null,
    });

    return (
      <PortalNoticeCard
        title="Not invited to this RFQ"
        description="You can only open RFQs you’ve been invited to (or where you’ve submitted a bid). If you believe you should have access, contact the Zartman team."
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

  const assignments = await loadSupplierAssignments(quoteId);

  const approvalsOn = approvalsEnabled();
  const approved = approvalsOn ? profile.approved : true;
  const bidResult = await loadBidForSupplierAndQuote(
    profile.supplier.id,
    quoteId,
  );
  const initialBid = bidResult.ok ? bidResult.data : null;
  const bidsUnavailableMessage = bidResult.ok ? null : bidResult.error ?? null;
  const existingBid = initialBid;

  const normalizedAwardedSupplierId =
    typeof workspaceData.quote.awarded_supplier_id === "string"
      ? workspaceData.quote.awarded_supplier_id.trim()
      : "";
  const awardedToSupplier = isKickoffReadyForSupplier({
    quote: {
      awarded_supplier_id: workspaceData.quote.awarded_supplier_id ?? null,
      awarded_at: workspaceData.quote.awarded_at ?? null,
      awarded_bid_id: workspaceData.quote.awarded_bid_id ?? null,
    },
    supplierId: profile.supplier.id,
  });
  const isWinningSupplier = awardedToSupplier;

  let project: QuoteProjectRecord | null = null;
  let projectUnavailable = false;
  if (isWinningSupplier) {
    const projectResult = await loadQuoteProjectForQuote(quoteId);
    if (projectResult.ok) {
      project = projectResult.project;
    } else {
      projectUnavailable = projectResult.reason !== "not_found";
    }
  }

  const kickoffVisibility = deriveSupplierKickoffVisibility(
    workspaceData.quote.awarded_supplier_id ?? null,
    workspaceData.quote.awarded_at ?? null,
    workspaceData.quote.awarded_bid_id ?? null,
    profile.supplier.id,
  );

  let kickoffTasksResult: SupplierKickoffTasksResult | null = null;
  if (awardedToSupplier) {
    const initialKickoffTasksResult = await loadQuoteKickoffTasksForSupplier(
      quoteId,
      profile.supplier.id,
      { seedIfEmpty: false },
    );

    // Gap 6: best-effort server-side seeding for awarded supplier, only when the
    // first tasks query returns 0 rows. Never throw if seeding fails.
    if (
      awardedToSupplier &&
      initialKickoffTasksResult.ok &&
      initialKickoffTasksResult.tasks.length === 0
    ) {
      try {
        const ensureResult = await ensureKickoffTasksForQuote(quoteId, {
          actorRole: "supplier",
          actorUserId: user.id,
        });

        if (!ensureResult.ok) {
          console.warn("[supplier kickoff] ensure failed", {
            quoteId,
            supplierId: profile.supplier.id,
            reason: ensureResult.reason,
            pgCode: null,
            message: ensureResult.error,
          });
        }
      } catch (error) {
        console.warn("[supplier kickoff] ensure failed", {
          quoteId,
          supplierId: profile.supplier.id,
          reason: "seed-error",
          pgCode: (error as { code?: string | null })?.code ?? null,
          message: (error as { message?: string | null })?.message ?? null,
        });
      }

      kickoffTasksResult = await loadQuoteKickoffTasksForSupplier(
        quoteId,
        profile.supplier.id,
        { seedIfEmpty: false },
      );
    } else {
      kickoffTasksResult = initialKickoffTasksResult;
    }
  }

  const messagesResult = await loadQuoteMessages(quoteId);
  if (!messagesResult.ok) {
    console.error("[supplier quote] messages load failed", {
      quoteId,
      error: messagesResult.error ?? messagesResult.reason,
    });
  }
  const quoteMessages = messagesResult.messages;
  const messagesUnavailable = !messagesResult.ok;

  const messagingUnlocked = true;
  const messagingDisabledReason = null;

  const supplierPostMessageAction =
    postSupplierQuoteMessage.bind(null, quoteId);

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
      quoteMessages={quoteMessages}
      messagesUnavailable={messagesUnavailable}
      postMessageAction={supplierPostMessageAction}
      currentUserId={user.id}
      project={project}
      projectUnavailable={projectUnavailable}
      kickoffTasksResult={kickoffTasksResult}
      kickoffVisibility={kickoffVisibility}
      awardedSupplierId={workspaceData.quote.awarded_supplier_id ?? null}
      awardedToSupplier={awardedToSupplier}
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
  quoteMessages,
  messagesUnavailable,
  postMessageAction,
  currentUserId,
  project,
  projectUnavailable,
  kickoffTasksResult,
  kickoffVisibility,
  awardedSupplierId,
  awardedToSupplier,
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
  quoteMessages: QuoteMessageRecord[];
  messagesUnavailable: boolean;
  postMessageAction: (
    prevState: QuoteMessageFormState,
    formData: FormData,
  ) => Promise<QuoteMessageFormState>;
  currentUserId: string;
  project: QuoteProjectRecord | null;
  projectUnavailable: boolean;
  kickoffTasksResult: SupplierKickoffTasksResult | null;
  kickoffVisibility: SupplierKickoffVisibility;
  awardedSupplierId: string | null;
  awardedToSupplier: boolean;
}) {
  const { quote, uploadMeta, filePreviews } = data;
  const quoteFiles = Array.isArray(quote.files) ? quote.files : [];
  const fileCount =
    typeof quote.fileCount === "number" ? quote.fileCount : quoteFiles.length;
  const derived = deriveQuotePresentation(quote, uploadMeta);
  const normalizedAwardedSupplierId =
    typeof awardedSupplierId === "string" ? awardedSupplierId.trim() : "";
  const quoteHasWinner =
    Boolean(normalizedAwardedSupplierId) || Boolean(quote.awarded_at);
  const awardedAtLabel = quote.awarded_at
    ? formatDateTime(quote.awarded_at, { includeTime: true })
    : null;
  const awardedByLabel = formatAwardedByLabel(quote.awarded_by_role);
  const nextWorkflowState = getNextWorkflowState(derived.status);
  const canSubmitBid = canUserBid("supplier", {
    status: quote.status,
    existingBidStatus: existingBid?.status ?? null,
    accessGranted: true,
  });
  const bidLocked = !canSubmitBid;
  const normalizedBidStatus =
    typeof existingBid?.status === "string" ? existingBid.status.trim().toLowerCase() : "";
  const acceptedLock = normalizedBidStatus === "accepted";
  const closedWindowLock = bidLocked && !acceptedLock;
  const hasProject = Boolean(project);
  const kickoffVisibilityState =
    kickoffVisibility ??
    deriveSupplierKickoffVisibility(
      awardedSupplierId,
      quote.awarded_at ?? null,
      quote.awarded_bid_id ?? null,
      supplierId,
    );
  const { showKickoffChecklist } = kickoffVisibilityState;
  const isWinningSupplier = awardedToSupplier;
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
  const winningBidAmountLabel =
    typeof existingBid?.amount === "number" && Number.isFinite(existingBid.amount)
      ? formatCurrency(existingBid.amount, existingBid.currency ?? undefined)
      : "Pricing pending";
  const winningBidLeadTimeLabel =
    typeof existingBid?.lead_time_days === "number" &&
    Number.isFinite(existingBid.lead_time_days)
      ? `${existingBid.lead_time_days} day${
          existingBid.lead_time_days === 1 ? "" : "s"
        }`
      : "Lead time pending";
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
        {isWinningSupplier ? (
          <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-200">
            Winner selected
          </span>
        ) : null}
      </div>
    </div>
  );

  const winnerCallout = quoteHasWinner ? (
    awardedToSupplier ? (
      <section className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-5 py-4 text-sm text-emerald-50">
        <p className="text-base font-semibold text-emerald-100">
          Awarded to you
        </p>
        <p className="mt-1 text-emerald-50/80">
          {awardedAtLabel ? `Awarded ${awardedAtLabel}. ` : null}
          We&apos;re coordinating kickoff now. Use the checklist below to lock in materials, timing, and any handoff notes.
        </p>
        <p className="mt-2 text-xs text-emerald-200">
          Awarded by {awardedByLabel}
        </p>
      </section>
    ) : (
      <section className="rounded-2xl border border-slate-800 bg-slate-950/40 px-5 py-4 text-sm text-slate-200">
        <p className="text-base font-semibold text-white">Not selected</p>
        <p className="mt-1 text-slate-300">
          This RFQ was awarded to another supplier{awardedAtLabel ? ` on ${awardedAtLabel}` : ""}. Keep an eye out for the next opportunity.
        </p>
      </section>
    )
  ) : null;

  // Kickoff + bid + details sections are rendered below.

  let projectSection: ReactNode = null;
  if (isWinningSupplier) {
    projectSection = hasProject ? (
      <SupplierQuoteProjectCard
        className={cardClasses}
        project={project}
        unavailable={projectUnavailable}
        winningBidAmountLabel={winningBidAmountLabel}
        winningBidLeadTimeLabel={winningBidLeadTimeLabel}
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
  } else {
    projectSection = (
      <PortalCard
        title="Project kickoff"
        description="Stay tuned—project details appear for the supplier that wins the RFQ."
      >
        <p className="text-sm text-slate-300">
          Keep bidding with your best pricing and lead times. Once a customer selects your proposal, we’ll
          unlock the kickoff prep card automatically.
        </p>
      </PortalCard>
    );
  }

  const bidPanelSection = (
    <section className={clsx(cardClasses, "space-y-4")}>
      <header className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Bid
        </p>
        <h2 className="text-lg font-semibold text-white">
          Submit pricing and lead time
        </h2>
        <p className="text-sm text-slate-300">
          Only the Zartman team and the requesting customer can see these details.
        </p>
        <p className="text-xs text-slate-500">
          Share a unit price, realistic lead time, and highlight any certifications or notes that help
          the buyer approve your shop.
        </p>
      </header>
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
        bidLocked={acceptedLock || closedWindowLock}
      />
    </section>
  );

  const filesSection = (
    <QuoteFilesUploadsSection files={filePreviews} fileCountText={fileCountText} />
  );

  const rfqDetailsSection = (
    <CollapsibleCard
      title="RFQ details"
      description="Customer, process hints, and workflow snapshot."
      defaultOpen
      summary={
        <span className="rounded-full border border-blue-400/30 bg-blue-500/10 px-3 py-1 text-blue-100">
          {derived.statusLabel}
        </span>
      }
    >
      <div className="space-y-5">
        <dl className="grid gap-4 text-sm text-slate-200 sm:grid-cols-2">
          <DetailItem label="Customer" value={derived.customerName} />
          <DetailItem label="Company" value={derived.companyName ?? "Not provided"} />
          <DetailItem label="Files" value={fileCountText} />
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
            value={assignmentNames.length > 0 ? assignmentNames.join(", ") : "Pending assignment"}
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
      </div>
    </CollapsibleCard>
  );

  const notesSection = (
    <CollapsibleCard
      title="Notes"
      description="DFM feedback and intake notes."
      defaultOpen={false}
    >
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
    </CollapsibleCard>
  );

  let kickoffSection: ReactNode = null;
  if (showKickoffChecklist) {
    const tasksAvailable = Boolean(kickoffTasksResult?.ok);
    const kickoffTasks = kickoffTasksResult?.ok ? kickoffTasksResult.tasks : [];
    kickoffSection = (
      <CollapsibleCard
        id="kickoff"
        title="Kickoff checklist"
        description="Prep tasks unlock for the awarded supplier."
        className="scroll-mt-24"
        defaultOpen={awardedToSupplier}
        summary={
          <span
            className={clsx(
              "rounded-full border px-3 py-1",
              awardedToSupplier
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
                : "border-slate-800 bg-slate-950/50 text-slate-200",
            )}
          >
            {awardedToSupplier ? "Awarded" : "Locked"}
          </span>
        }
      >
        <div className="space-y-4">
          {projectSection}
          {awardedToSupplier ? (
            <SupplierKickoffChecklistCard
              quoteId={quote.id}
              tasks={tasksAvailable ? kickoffTasks : []}
              readOnly={false}
            />
          ) : (
            <SupplierKickoffLockedCard />
          )}
        </div>
      </CollapsibleCard>
    );
  }

  const timelineSection = (
    <CollapsibleCard
      title="Timeline"
      description="Updates and milestones for this RFQ."
      defaultOpen={false}
    >
      <QuoteTimeline
        quoteId={quote.id}
        actorRole="supplier"
        actorUserId={currentUserId}
        emptyState="No updates yet."
      />
    </CollapsibleCard>
  );

  return (
    <PortalShell
      workspace="supplier"
      title={headerTitle}
      subtitle="Everything you need to respond — files, DFM guidance, bids, and chat."
      headerContent={headerContent}
      actions={headerActions}
    >
      <div className="space-y-5 lg:grid lg:grid-cols-[minmax(0,0.65fr)_minmax(0,0.35fr)] lg:gap-5 lg:space-y-0">
        <div className="space-y-5">
          {winnerCallout}
          {bidPanelSection}
          {kickoffSection}
          {timelineSection}
          {messagesUnavailable ? (
            <p className="rounded-xl border border-yellow-500/30 bg-yellow-500/5 px-5 py-3 text-sm text-yellow-100">
              Messages are temporarily unavailable. Refresh the page to try again.
            </p>
          ) : null}
          <QuoteMessagesThread
            quoteId={quote.id}
            messages={quoteMessages}
            canPost={messagingUnlocked}
            postAction={postMessageAction}
            currentUserId={currentUserId}
            title="Shared chat"
            description="Customer, supplier, and admin updates for this RFQ."
            helperText="Your note pings the Zartman admin team instantly."
            disabledCopy={messagingDisabledReason ?? undefined}
            emptyStateCopy="No messages yet. Keep the project moving by posting build updates here."
          />
        </div>
        <div className="space-y-5">
          {filesSection}
          {rfqDetailsSection}
          {notesSection}
        </div>
      </div>
    </PortalShell>
  );
}

type SupplierKickoffVisibility = {
  quoteReadyForKickoff: boolean;
  showKickoffChecklist: boolean;
};

function deriveSupplierKickoffVisibility(
  awardedSupplierId?: string | null,
  awardedAt?: string | null,
  awardedBidId?: string | null,
  supplierId?: string,
): SupplierKickoffVisibility {
  const normalizedAwardedSupplierId =
    typeof awardedSupplierId === "string"
      ? awardedSupplierId.trim()
      : "";
  const normalizedAwardedAt = typeof awardedAt === "string" ? awardedAt.trim() : "";
  const normalizedAwardedBidId =
    typeof awardedBidId === "string" ? awardedBidId.trim() : "";
  const normalizedSupplierId =
    typeof supplierId === "string" ? supplierId.trim() : "";
  const quoteHasWinner = Boolean(normalizedAwardedSupplierId);
  const quoteReadyForKickoff =
    Boolean(normalizedAwardedSupplierId) &&
    Boolean(normalizedAwardedAt) &&
    Boolean(normalizedAwardedBidId);
  const showKickoffChecklist = true;

  return {
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

function SupplierKickoffLockedCard() {
  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-950/60 px-6 py-5">
      <header className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Kickoff checklist
        </p>
        <h2 className="text-lg font-semibold text-white">Kickoff checklist</h2>
        <p className="text-sm text-slate-300">
          Kickoff begins after you are selected.
        </p>
      </header>
    </section>
  );
}
