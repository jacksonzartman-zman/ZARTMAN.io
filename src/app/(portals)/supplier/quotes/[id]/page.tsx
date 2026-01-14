import clsx from "clsx";
import Link from "next/link";
import type { ReactNode } from "react";
import { EmptyStateCard } from "@/components/EmptyStateCard";

/**
 * Phase 1 Polish checklist
 * - Done: Empty states (Kickoff locked / no files / no messages)
 * - Done: Confirmations (bid saved, kickoff task updated) refresh server data
 * - Done: Copy normalization (Decision/Kickoff/Messages/Uploads match rail)
 */
import { formatDateTime } from "@/lib/formatDate";
import { formatCurrency } from "@/lib/formatCurrency";
import { formatAwardedByLabel } from "@/lib/awards";
import { QuoteFilesCard } from "@/app/admin/quotes/[id]/QuoteFilesCard";
import PortalCard from "@/app/(portals)/PortalCard";
import { PortalShell } from "@/app/(portals)/components/PortalShell";
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
  type SupplierAssignment,
} from "./supplierAccess";
import { loadSupplierProfileByUserId } from "@/server/suppliers";
import { assertSupplierQuoteAccess } from "@/server/quotes/access";
import {
  loadBidForSupplierAndQuote,
  type BidRow,
} from "@/server/bids";
import { SupplierBidPanel } from "./SupplierBidPanel";
import { BidWorkspace } from "./BidWorkspace";
import { PortalLoginPanel } from "@/app/(portals)/PortalLoginPanel";
import { getServerAuthUser } from "@/server/auth";
import { WorkflowStatusCallout } from "@/components/WorkflowStatusCallout";
import { getNextWorkflowState } from "@/lib/workflow";
import { canUserBid } from "@/lib/permissions";
import { approvalsEnabled } from "@/server/suppliers/flags";
import { QuoteTimeline } from "@/app/(portals)/components/QuoteTimeline";
import { CollapsibleCard } from "@/components/CollapsibleCard";
import { DisclosureSection } from "@/components/DisclosureSection";
import {
  loadSupplierCapacitySnapshotsForWeek,
  loadLatestCapacityUpdateRequestForSupplierWeek,
} from "@/server/suppliers/capacity";
import { getNextWeekStartDateIso } from "@/lib/dates/weekStart";
import {
  loadQuoteProjectForQuote,
  type QuoteProjectRecord,
} from "@/server/quotes/projects";
import { SupplierQuoteProjectCard } from "./SupplierQuoteProjectCard";
import { QuoteMessagesThread } from "@/app/(portals)/shared/QuoteMessagesThread";
import {
  loadQuoteMessages,
  type QuoteMessageRecord,
} from "@/server/quotes/messages";
import { getSupplierReplyToAddress } from "@/server/quotes/emailBridge";
import { CopyTextButton } from "@/components/CopyTextButton";
import {
  loadQuoteKickoffTasksForSupplier,
  type SupplierKickoffTasksResult,
  ensureKickoffTasksForQuote,
  isKickoffReadyForSupplier,
} from "@/server/quotes/kickoffTasks";
import { SupplierKickoffChecklistCard } from "./SupplierKickoffChecklistCard";
import {
  resolveKickoffProgressBasis,
  formatKickoffTasksRatio,
  summarizeKickoffTasks,
} from "@/lib/quote/kickoffChecklist";
import { postQuoteMessage as postSupplierQuoteMessage } from "./actions";
import type { QuoteMessageFormState } from "@/app/(portals)/components/QuoteMessagesThread.types";
import type { QuoteEventRecord } from "@/server/quotes/events";
import { getLatestKickoffNudgedAt } from "@/server/quotes/kickoffNudge";
import { QuoteFilesUploadsSection } from "@/app/(portals)/components/QuoteFilesUploadsSection";
import { FocusTabScroll } from "@/app/(portals)/shared/FocusTabScroll";
import { QuoteAtAGlanceBar } from "@/components/QuoteAtAGlanceBar";
import { resolvePrimaryAction } from "@/lib/quote/resolvePrimaryAction";
import { QuoteSectionRail } from "@/components/QuoteSectionRail";
import type { QuoteSectionRailSection } from "@/components/QuoteSectionRail";
import { computePartsCoverage } from "@/lib/quote/partsCoverage";
import { loadUnreadMessageSummary } from "@/server/quotes/messageReads";
import { loadSupplierBidDraft, type SupplierBidDraft } from "@/server/suppliers";
import { loadCadFeaturesForQuote, type CadFeatureSummary } from "@/server/quotes/cadFeatures";
import { getEmailOutboundStatus } from "@/server/quotes/emailOutbound";
import { canSupplierEmailCustomer, isCustomerEmailBridgeEnabled } from "@/server/quotes/customerEmailPrefs";
import { loadOutboundFileOptions } from "@/server/quotes/outboundFilePicker";
import { isPortalEmailSendEnabledFlag } from "@/server/quotes/emailOpsFlags";

export const dynamic = "force-dynamic";

const UPLOAD_ACCEPT =
  ".pdf,.dwg,.dxf,.step,.stp,.igs,.iges,.sldprt,.prt,.stl,.zip";

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
  const tabParam = getSearchParamValue(resolvedSearchParams, "tab") ?? null;

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

  const workspaceResult = await loadQuoteWorkspaceData(quoteId, {
    viewerUserId: user.id,
    viewerRole: "supplier",
  });
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
  const cadFeaturesByFileId = await loadCadFeaturesForQuote(quoteId);

  const assignments = await loadSupplierAssignments(quoteId);

  const approvalsOn = approvalsEnabled();
  const approved = approvalsOn ? profile.approved : true;
  const [bidResult, draft] = await Promise.all([
    loadBidForSupplierAndQuote(profile.supplier.id, quoteId),
    loadSupplierBidDraft(quoteId, profile.supplier.id),
  ]);
  const initialBid = bidResult.ok ? bidResult.data : null;
  const bidsUnavailableMessage = bidResult.ok ? null : bidResult.error ?? null;
  const existingBid = initialBid;
  const nextWeekStartDate = getNextWeekStartDateIso();

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
  const outboundStatus = getEmailOutboundStatus();
  const portalEmailEnvEnabled = isPortalEmailSendEnabledFlag();
  let portalEmailEnabled = false;
  let portalEmailDisabledCopy: string | null = null;
  if (!portalEmailEnvEnabled) {
    portalEmailDisabledCopy = "Send via email is disabled on this environment.";
  } else if (!outboundStatus.enabled) {
    portalEmailDisabledCopy = "Email not configured.";
  } else if (!awardedToSupplier) {
    portalEmailDisabledCopy = "Email is available after this RFQ is awarded to you.";
  } else if (!isCustomerEmailBridgeEnabled()) {
    portalEmailDisabledCopy = "Customer email replies are off.";
  } else {
    const customerId =
      typeof workspaceData.quote.customer_id === "string"
        ? workspaceData.quote.customer_id.trim()
        : "";
    const policy = customerId
      ? await canSupplierEmailCustomer({ quoteId, customerId })
      : ({ ok: false, reason: "unsupported" } as const);
    if (!policy.ok) {
      portalEmailDisabledCopy =
        policy.reason === "unsupported"
          ? "Email replies unavailable for this quote."
          : "Customer email replies are off.";
    } else if (!policy.allowed) {
      portalEmailDisabledCopy = "Customer has email replies turned off.";
    } else {
      portalEmailEnabled = true;
      portalEmailDisabledCopy = null;
    }
  }
  const portalEmailFileOptions = portalEmailEnabled
    ? await loadOutboundFileOptions({ quoteId, limit: 50 })
    : [];

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

  const messagesResult = await loadQuoteMessages({
    quoteId,
    viewerUserId: user.id,
    viewerRole: "supplier",
  });
  if (!messagesResult.ok) {
    console.error("[supplier quote] messages load failed", {
      quoteId,
      error: messagesResult.error ?? messagesResult.reason,
    });
  }
  const quoteMessages = messagesResult.messages;
  const messagesUnavailable = !messagesResult.ok;

  const unreadSummary = await loadUnreadMessageSummary({
    quoteIds: [quoteId],
    userId: user.id,
  });
  const messagesUnreadCount = unreadSummary[quoteId]?.unreadCount ?? 0;

  const messagingUnlocked = true;
  const messagingDisabledReason = null;

  const supplierPostMessageAction =
    postSupplierQuoteMessage.bind(null, quoteId);

  const latestKickoffNudgedAt = await getLatestKickoffNudgedAt({
    quoteId,
    supplierId: profile.supplier.id,
  });

  const [capacitySnapshotsResult, latestCapacityRequest] = await Promise.all([
    loadSupplierCapacitySnapshotsForWeek({
      supplierId: profile.supplier.id,
      weekStartDate: nextWeekStartDate,
    }),
    loadLatestCapacityUpdateRequestForSupplierWeek({
      supplierId: profile.supplier.id,
      weekStartDate: nextWeekStartDate,
    }),
  ]);

  return (
    <SupplierQuoteWorkspace
      data={workspaceData}
      cadFeaturesByFileId={cadFeaturesByFileId}
      tabParam={tabParam}
      supplierEmail={
        profile.supplier.primary_email ??
        supplierEmail ??
        user.email ??
        "supplier"
      }
      supplierId={profile.supplier.id}
      nextWeekStartDate={nextWeekStartDate}
      assignments={assignments}
      supplierNameOverride={profile.supplier.company_name}
      existingBid={existingBid}
      initialBid={initialBid}
      initialDraft={draft}
      bidsUnavailableMessage={bidsUnavailableMessage}
      approvalsOn={approvalsOn}
      approved={approved}
      messagingUnlocked={messagingUnlocked}
      messagingDisabledReason={messagingDisabledReason}
      quoteMessages={quoteMessages}
      messagesUnavailable={messagesUnavailable}
      messagesUnreadCount={messagesUnreadCount}
      postMessageAction={supplierPostMessageAction}
      currentUserId={user.id}
      project={project}
      projectUnavailable={projectUnavailable}
      kickoffTasksResult={kickoffTasksResult}
      kickoffVisibility={kickoffVisibility}
      awardedSupplierId={workspaceData.quote.awarded_supplier_id ?? null}
      awardedToSupplier={awardedToSupplier}
      latestKickoffNudgedAt={latestKickoffNudgedAt}
      capacitySnapshotsResult={capacitySnapshotsResult}
      capacityRequestCreatedAt={latestCapacityRequest.createdAt}
      portalEmailEnabled={portalEmailEnabled}
      portalEmailDisabledCopy={portalEmailDisabledCopy}
      portalEmailFileOptions={portalEmailFileOptions}
    />
  );
}

function SupplierQuoteWorkspace({
  data,
  cadFeaturesByFileId,
  tabParam,
  supplierEmail,
  supplierId,
  nextWeekStartDate,
  assignments,
  supplierNameOverride,
  existingBid,
  initialBid,
  initialDraft,
  bidsUnavailableMessage,
  approvalsOn,
  approved,
  messagingUnlocked,
  messagingDisabledReason,
  quoteMessages,
  messagesUnavailable,
  messagesUnreadCount,
  postMessageAction,
  currentUserId,
  project,
  projectUnavailable,
  kickoffTasksResult,
  kickoffVisibility,
  awardedSupplierId,
  awardedToSupplier,
  latestKickoffNudgedAt,
  capacitySnapshotsResult,
  capacityRequestCreatedAt,
  portalEmailEnabled,
  portalEmailDisabledCopy,
  portalEmailFileOptions,
}: {
  data: QuoteWorkspaceData;
  cadFeaturesByFileId: Record<string, CadFeatureSummary>;
  tabParam: string | null;
  supplierEmail: string;
  supplierId: string;
  nextWeekStartDate: string;
  assignments: SupplierAssignment[];
  supplierNameOverride?: string | null;
  existingBid: BidRow | null;
  initialBid: BidRow | null;
  initialDraft: SupplierBidDraft | null;
  bidsUnavailableMessage: string | null;
  approvalsOn: boolean;
  approved: boolean;
  messagingUnlocked: boolean;
  messagingDisabledReason?: string | null;
  quoteMessages: QuoteMessageRecord[];
  messagesUnavailable: boolean;
  messagesUnreadCount: number;
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
  latestKickoffNudgedAt: string | null;
  capacitySnapshotsResult: Awaited<ReturnType<typeof loadSupplierCapacitySnapshotsForWeek>>;
  capacityRequestCreatedAt: string | null;
  portalEmailEnabled: boolean;
  portalEmailDisabledCopy: string | null;
  portalEmailFileOptions: Awaited<ReturnType<typeof loadOutboundFileOptions>>;
}) {
  const { quote, uploadMeta, filePreviews, uploadGroups, parts, filesMissingCanonical, legacyFileNames } = data;
  const quoteFiles = Array.isArray(quote.files) ? quote.files : [];
  const fileCount =
    typeof quote.fileCount === "number" ? quote.fileCount : quoteFiles.length;
  const derived = deriveQuotePresentation(quote, uploadMeta);
  const { summary: partsCoverageSummary } = computePartsCoverage(parts ?? []);
  const partsCoverageSummaryLine = partsCoverageSummary.anyParts
    ? [
        `${partsCoverageSummary.totalParts} part${
          partsCoverageSummary.totalParts === 1 ? "" : "s"
        }`,
        `${partsCoverageSummary.fullyCoveredParts} fully covered`,
        ...(partsCoverageSummary.partsNeedingCad > 0
          ? [`${partsCoverageSummary.partsNeedingCad} need CAD`]
          : []),
        ...(partsCoverageSummary.partsNeedingDrawing > 0
          ? [`${partsCoverageSummary.partsNeedingDrawing} need drawings`]
          : []),
      ].join(" • ")
    : null;
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

  const kickoffTasksAvailable = Boolean(kickoffTasksResult?.ok);
  const kickoffTasks = kickoffTasksResult?.ok ? kickoffTasksResult.tasks : [];
  const kickoffSummaryForRail = kickoffTasksAvailable ? summarizeKickoffTasks(kickoffTasks) : null;
  const kickoffProgressBasisForRail = resolveKickoffProgressBasis({
    kickoffCompletedAt:
      (quote as { kickoff_completed_at?: string | null })?.kickoff_completed_at ?? null,
    completedCount: kickoffSummaryForRail?.completedCount ?? null,
    totalCount: kickoffSummaryForRail?.totalCount ?? null,
  });
  const kickoffProgressRatioForRail = formatKickoffTasksRatio(kickoffProgressBasisForRail);
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
  const supplierPrimaryAction = resolvePrimaryAction({
    role: "supplier",
    quote: {
      id: quote.id,
      status: quote.status ?? null,
      awarded_supplier_id: quote.awarded_supplier_id ?? null,
      awarded_bid_id: quote.awarded_bid_id ?? null,
      awarded_at: quote.awarded_at ?? null,
      kickoff_completed_at:
        (quote as { kickoff_completed_at?: string | null })?.kickoff_completed_at ??
        null,
      primaryActionHints: {
        canSubmitBid,
        awardedToSupplier,
        hasWinner: quoteHasWinner,
      },
    },
  });
  const supplierWhatsNext = awardedToSupplier
    ? "Kickoff checklist is unlocked. Complete tasks and keep the thread updated."
    : canSubmitBid
      ? "Submit pricing and lead time when you’re ready."
      : acceptedLock
        ? "Bid is accepted — bidding is locked."
        : closedWindowLock
          ? "Bidding is closed for this RFQ."
          : "Follow updates in the shared thread below.";
  const bidPillValue =
    existingBid?.status && typeof existingBid.status === "string" && existingBid.status.trim()
      ? existingBid.status.trim()
      : existingBid
        ? "Submitted"
        : "Not submitted";
  const awardPillValue = awardedToSupplier
    ? "Awarded to you"
    : quoteHasWinner
      ? "Not selected"
      : "Pending";
  const supplierAtAGlancePills = [
    { key: "rfq", label: "RFQ", value: primaryFileName },
    { key: "files", label: "Files", value: fileCountText },
    {
      key: "bid",
      label: "Bid",
      value: bidPillValue,
      tone: existingBid ? "info" : "neutral",
      href: "#bid",
    },
    {
      key: "award",
      label: "Award",
      value: awardPillValue,
      tone: awardedToSupplier ? "success" : quoteHasWinner ? "neutral" : "info",
      href: "#kickoff",
    },
    {
      key: "supplier",
      label: "Working as",
      value: supplierDisplayName,
    },
  ] as const;
  const headerContent = (
    <QuoteAtAGlanceBar
      role="supplier"
      statusLabel={derived.statusLabel}
      whatsNext={supplierWhatsNext}
      pills={[...supplierAtAGlancePills]}
      primaryAction={supplierPrimaryAction}
      below={
        <QuoteSectionRail
          sections={buildSupplierQuoteSections({
            canSubmitBid,
            existingBidStatus: existingBid?.status ?? null,
            awardedToSupplier,
            kickoffRatio: kickoffProgressRatioForRail,
            kickoffComplete: kickoffProgressBasisForRail.isComplete,
            messageCount: quoteMessages.length,
            unreadCount: messagesUnreadCount,
            fileCount,
            messagesHref: buildQuoteTabHref(tabParam, "messages", "#messages"),
          })}
        />
      }
    />
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
    <DisclosureSection
      id="bid"
      className={clsx(cardClasses, "scroll-mt-24")}
      title="Bid"
      description="Submit pricing and lead time."
      defaultOpen={canSubmitBid}
      summary={
        <span className="rounded-full border border-slate-800 bg-slate-950/50 px-3 py-1 text-xs font-semibold text-slate-200">
          {bidPillValue}
        </span>
      }
    >
      <div className="space-y-4">
        <header className="space-y-1">
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
        {canSubmitBid && !acceptedLock && !closedWindowLock ? (
          <BidWorkspace
            quote={quote}
            parts={parts ?? []}
            initialDraft={initialDraft}
            uploadTargets={{ accept: UPLOAD_ACCEPT }}
            cadFeaturesByFileId={cadFeaturesByFileId}
          />
        ) : (
          <SupplierBidPanel
            quoteId={quote.id}
            initialBid={initialBid}
            approvalsOn={approvalsOn}
            approved={approved}
            bidsUnavailableMessage={bidsUnavailableMessage}
            bidLocked={true}
            showDecline={false}
          />
        )}
      </div>
    </DisclosureSection>
  );

  const filesSection = (
    <DisclosureSection
      id="uploads"
      className="scroll-mt-24"
      title="Uploads"
      description="Shared RFQ files and previews."
      defaultOpen={fileCount > 0}
      summary={
        <span className="rounded-full border border-slate-800 bg-slate-950/50 px-3 py-1">
          {fileCountText}
        </span>
      }
    >
      <QuoteFilesUploadsSection
        files={filePreviews}
        fileCountText={fileCountText}
        uploadGroups={uploadGroups}
        parts={parts ?? []}
        filesMissingCanonical={Boolean(filesMissingCanonical)}
        legacyFileNames={legacyFileNames}
      />
    </DisclosureSection>
  );

  const rfqDetailsSection = (
    <DisclosureSection
      id="details"
      className="scroll-mt-24"
      title="Details"
      description="Customer, process hints, and workflow snapshot."
      defaultOpen={false}
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
    </DisclosureSection>
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
    const kickoffProgressBasis = resolveKickoffProgressBasis({
      kickoffCompletedAt:
        (quote as { kickoff_completed_at?: string | null })?.kickoff_completed_at ?? null,
      completedCount: kickoffSummaryForRail?.completedCount ?? null,
      totalCount: kickoffSummaryForRail?.totalCount ?? null,
    });
    const kickoffProgressRatio = formatKickoffTasksRatio(kickoffProgressBasis);
    const kickoffSecondaryText = kickoffProgressBasis.isComplete
      ? "Kickoff complete"
      : kickoffProgressRatio
        ? `Kickoff in progress (${kickoffProgressRatio} tasks)`
        : "Kickoff in progress";

    const nudgedMs = latestKickoffNudgedAt ? Date.parse(latestKickoffNudgedAt) : Number.NaN;
    const hasRecentNudge =
      Boolean(latestKickoffNudgedAt) &&
      Number.isFinite(nudgedMs) &&
      Date.now() - nudgedMs < 7 * 24 * 60 * 60 * 1000;
    kickoffSection = (
      <DisclosureSection
        id="kickoff"
        className="scroll-mt-24"
        title="Kickoff"
        description="Prep tasks unlock for the awarded supplier."
        defaultOpen={awardedToSupplier && !kickoffProgressBasis.isComplete}
        summary={
          <span
            className={clsx(
              "rounded-full border px-3 py-1",
              awardedToSupplier
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
                : "border-slate-800 bg-slate-950/50 text-slate-200",
            )}
          >
            {awardedToSupplier ? (kickoffProgressBasis.isComplete ? "Complete" : "Awarded") : "Locked"}
          </span>
        }
      >
        <div className="space-y-4">
          {partsCoverageSummary.anyParts ? (
            <section className="rounded-2xl border border-slate-900 bg-slate-950/40 px-6 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Parts overview
                  </p>
                  <p className="mt-1 text-sm text-slate-200">
                    {partsCoverageSummaryLine}
                  </p>
                </div>
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
              </div>
            </section>
          ) : null}
          {projectSection}
          {awardedToSupplier ? (
            <>
              {hasRecentNudge && !kickoffProgressBasis.isComplete ? (
                <section className="rounded-2xl border border-blue-500/20 bg-blue-500/5 px-5 py-3 text-sm text-blue-50">
                  <p className="font-semibold text-blue-100">
                    Customer is waiting on kickoff completion.
                  </p>
                  <p className="mt-1 text-xs text-blue-100/80">
                    View tasks below.
                  </p>
                </section>
              ) : null}
              <section className="rounded-2xl border border-slate-900 bg-slate-950/40 px-6 py-4">
                <header className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Project status
                    </p>
                    <p className="mt-1 text-sm text-slate-200">
                      {kickoffSecondaryText}
                    </p>
                  </div>
                  <span
                    className={clsx(
                      "rounded-full border px-3 py-1 text-xs font-semibold",
                      kickoffProgressBasis.isComplete
                        ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-100"
                        : "border-blue-500/40 bg-blue-500/10 text-blue-100",
                    )}
                  >
                    {kickoffProgressBasis.isComplete ? "Complete" : "In progress"}
                  </span>
                </header>
              </section>
              <SupplierKickoffChecklistCard
                quoteId={quote.id}
                tasks={kickoffTasksAvailable ? kickoffTasks : []}
                readOnly={false}
              />
            </>
          ) : (
            <SupplierKickoffLockedCard hasWinner={quoteHasWinner} />
          )}
        </div>
      </DisclosureSection>
    );
  }

  const timelineSection = (
    <DisclosureSection
      id="timeline"
      className="scroll-mt-24"
      title="Timeline"
      description="Updates and milestones for this RFQ."
      defaultOpen={false}
    >
      <QuoteTimeline
        quoteId={quote.id}
        actorRole="supplier"
        actorUserId={currentUserId}
        emptyState="No events yet. Activity will appear here as your RFQ progresses."
      />
    </DisclosureSection>
  );

  const replyToResult = getSupplierReplyToAddress({
    quoteId: quote.id,
    supplierId,
  });
  const replyToAddress = replyToResult.ok ? replyToResult.address : "";
  const replyToStatusCopy = replyToResult.ok
    ? "Reply via email to update the thread."
    : replyToResult.reason === "disabled"
      ? "Email reply not configured."
      : "Email reply address unavailable.";

  const capacityLevelsByCapability = new Map<string, string>();
  const capacityUniverse = ["cnc_mill", "cnc_lathe", "mjp", "sla"] as const;
  const universeSet = new Set<string>(capacityUniverse);
  const coverage = new Set<string>();
  let lastUpdatedAt: string | null = null;
  let lastUpdatedMs = Number.NEGATIVE_INFINITY;

  if (capacitySnapshotsResult.ok) {
    for (const row of capacitySnapshotsResult.snapshots) {
      if (typeof row.capability === "string" && typeof row.capacityLevel === "string") {
        capacityLevelsByCapability.set(row.capability, row.capacityLevel);
      }
      if (typeof row.capability === "string" && universeSet.has(row.capability)) {
        coverage.add(row.capability);
      }
      if (typeof row.createdAt === "string") {
        const ms = Date.parse(row.createdAt);
        if (Number.isFinite(ms) && ms > lastUpdatedMs) {
          lastUpdatedMs = ms;
          lastUpdatedAt = row.createdAt;
        }
      }
    }
  }

  const coverageCount = coverage.size;
  const requestCreatedAt =
    typeof capacityRequestCreatedAt === "string" ? capacityRequestCreatedAt : null;
  const requestMs = requestCreatedAt ? Date.parse(requestCreatedAt) : Number.NaN;
  const staleMsThreshold = 14 * 24 * 60 * 60 * 1000;
  const isOlderThan14Days =
    Boolean(lastUpdatedAt) &&
    Number.isFinite(lastUpdatedMs) &&
    Date.now() - lastUpdatedMs > staleMsThreshold;
  const hasNewerRequest =
    Boolean(requestCreatedAt) &&
    (lastUpdatedAt === null ||
      (Number.isFinite(requestMs) && Number.isFinite(lastUpdatedMs) && requestMs > lastUpdatedMs));
  const shouldRecommendUpdate =
    coverageCount < 2 || lastUpdatedAt === null || isOlderThan14Days || hasNewerRequest;

  const capacityCapabilityOptions = [
    { key: "cnc_mill", label: "CNC Mill" },
    { key: "cnc_lathe", label: "CNC Lathe" },
    { key: "mjp", label: "MJP" },
    { key: "sla", label: "SLA" },
  ] as const;

  return (
    <PortalShell
      workspace="supplier"
      title={headerTitle}
      subtitle="Everything you need to respond — files, DFM guidance, bids, and chat."
      headerContent={headerContent}
      actions={headerActions}
    >
      <FocusTabScroll tab={tabParam} when="activity" targetId="timeline" />
      <FocusTabScroll tab={tabParam} when="messages" targetId="messages" />
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
          <DisclosureSection
            id="messages"
            className="scroll-mt-24"
            title="Messages"
            description="Customer, supplier, and admin updates for this RFQ."
            defaultOpen={tabParam === "messages"}
            summary={
              quoteMessages.length > 0 ? (
                <span className="rounded-full border border-slate-800 bg-slate-950/50 px-3 py-1">
                  {quoteMessages.length} message{quoteMessages.length === 1 ? "" : "s"}
                </span>
              ) : (
                <span className="rounded-full border border-slate-800 bg-slate-950/50 px-3 py-1">
                  No messages
                </span>
              )
            }
          >
            <QuoteMessagesThread
              quoteId={quote.id}
              messages={quoteMessages}
              canPost={messagingUnlocked}
              postAction={postMessageAction}
              currentUserId={currentUserId}
              viewerRole="supplier"
              markRead={tabParam === "messages"}
              title="Messages"
              description="Customer, supplier, and admin updates for this RFQ."
              portalEmail={{
                enabled: portalEmailEnabled,
                recipientRole: "customer",
                fileOptions: portalEmailFileOptions,
                disabledCopy: portalEmailDisabledCopy,
              }}
              emailReplyIndicator={
                replyToAddress
                  ? { state: "enabled", replyTo: replyToAddress }
                  : { state: "off", helper: "Reply-by-email not configured." }
              }
              helperText="Your note notifies the customer and the Zartman team."
              disabledCopy={messagingDisabledReason ?? undefined}
              emptyStateCopy="Send the first message to align on scope and timing."
            />
          </DisclosureSection>
        </div>
        <div className="space-y-5">
          <PortalCard
            title="Capacity (Next Week)"
            description="Advisory-only snapshot to help timeline planning."
          >
            <div className="space-y-4">
              <dl className="grid gap-3">
                {capacityCapabilityOptions.map((capability) => {
                  const raw = capacityLevelsByCapability.get(capability.key) ?? "";
                  const label = raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : "Not set";
                  return (
                    <div
                      key={capability.key}
                      className="flex items-center justify-between gap-3 rounded-xl border border-slate-900/60 bg-slate-950/30 px-4 py-3"
                    >
                      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        {capability.label}
                      </dt>
                      <dd className="text-sm font-semibold text-slate-100">{label}</dd>
                    </div>
                  );
                })}
              </dl>

              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-slate-500">
                  Week starts {nextWeekStartDate}.
                </p>
                <div className="flex items-center gap-2">
                  <Link
                    href={`/supplier/settings/capacity?week=${encodeURIComponent(nextWeekStartDate)}`}
                    className="text-sm font-semibold text-blue-200 underline-offset-4 hover:underline"
                  >
                    Update capacity
                  </Link>
                  {shouldRecommendUpdate ? (
                    <span className="rounded-full border border-yellow-500/30 bg-yellow-500/5 px-3 py-1 text-[11px] font-semibold text-yellow-100">
                      Update recommended
                    </span>
                  ) : null}
                </div>
              </div>
            </div>
          </PortalCard>
          <PortalCard title="Email this thread" description="Reply via email to post a supplier message.">
            <div className="space-y-3">
              <p className="text-xs text-slate-400">{replyToStatusCopy}</p>
              <div className="flex flex-col gap-2">
                <p className="break-anywhere rounded-xl border border-slate-900/60 bg-slate-950/30 px-3 py-2 text-xs text-slate-100">
                  {replyToAddress || "Not configured"}
                </p>
                <CopyTextButton text={replyToAddress} idleLabel="Copy email address" logPrefix="[email_bridge]" />
              </div>
              <p className="text-xs text-slate-500">
                Tip: keep the <span className="font-semibold text-slate-300">To</span> address unchanged so we can
                attach your reply to this RFQ.
              </p>
            </div>
          </PortalCard>
          {filesSection}
          {rfqDetailsSection}
          {notesSection}
        </div>
      </div>
    </PortalShell>
  );
}

function buildSupplierQuoteSections(args: {
  canSubmitBid: boolean;
  existingBidStatus: string | null;
  awardedToSupplier: boolean;
  kickoffRatio: string | null;
  kickoffComplete: boolean;
  messageCount: number;
  unreadCount: number;
  fileCount: number;
  messagesHref: string;
}): QuoteSectionRailSection[] {
  const bidBadge = args.canSubmitBid
    ? "Open"
    : args.existingBidStatus
      ? "Submitted"
      : "Locked";
  const kickoffBadge = args.awardedToSupplier
    ? args.kickoffComplete
      ? "Complete"
      : args.kickoffRatio
        ? args.kickoffRatio
        : "In progress"
    : "Locked";
  const uploadsBadge = args.fileCount > 0 ? `${args.fileCount}` : undefined;

  return [
    {
      key: "bid",
      label: "Bid",
      href: "#bid",
      badge: bidBadge,
      tone: args.canSubmitBid ? "info" : "neutral",
    },
    {
      key: "kickoff",
      label: "Kickoff",
      href: "#kickoff",
      badge: kickoffBadge,
      tone: args.awardedToSupplier ? "info" : "neutral",
    },
    {
      key: "messages",
      label: "Messages",
      href: args.messagesHref,
      badge:
        args.unreadCount > 0
          ? `${args.unreadCount > 99 ? "99+" : args.unreadCount}`
          : args.messageCount > 0
            ? `${args.messageCount}`
            : undefined,
      tone: args.unreadCount > 0 ? "info" : "neutral",
    },
    { key: "uploads", label: "Uploads", href: "#uploads", badge: uploadsBadge },
    { key: "details", label: "Details", href: "#details" },
    { key: "timeline", label: "Timeline", href: "#timeline" },
  ];
}

function buildQuoteTabHref(
  currentTab: string | null | undefined,
  tabValue: string,
  hash: string,
): string {
  const params = new URLSearchParams();
  if (currentTab) {
    params.set("tab", currentTab);
  }
  params.set("tab", tabValue);
  const qs = params.toString();
  return qs ? `?${qs}${hash}` : `${hash}`;
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

function SupplierKickoffLockedCard({ hasWinner }: { hasWinner: boolean }) {
  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-950/60 px-6 py-5">
      <EmptyStateCard
        title={hasWinner ? "Not awarded" : "Kickoff locked"}
        description={
          hasWinner
            ? "This RFQ was awarded to another supplier. Kickoff tasks remain locked."
            : "Kickoff unlocks after you’re selected as the winning supplier."
        }
        secondaryAction={{ label: "Go to bid", href: "#bid" }}
      />
    </section>
  );
}
