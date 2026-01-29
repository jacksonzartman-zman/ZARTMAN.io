import Link from "next/link";
import PortalCard from "../PortalCard";
import { WorkspaceWelcomeBanner } from "../WorkspaceWelcomeBanner";
import { EmptyStateNotice } from "../EmptyStateNotice";
import { SystemStatusBar } from "../SystemStatusBar";
import { DataFallbackNotice } from "../DataFallbackNotice";
import { PortalShell } from "../components/PortalShell";
import { PortalStatPills } from "../components/PortalStatPills";
import NewRfqsTable from "./NewRfqsTable";
import ActiveJobsTable from "./ActiveJobsTable";
import { getServerAuthUser } from "@/server/auth";
import { approvalsEnabled } from "@/server/suppliers/flags";
import { loadSupplierOnboardingState } from "@/server/suppliers/onboarding";
import { refreshNotificationsForUser } from "@/server/notifications";
import {
  getSupplierApprovalStatus,
  loadSupplierInboxBidAggregates,
  loadSupplierProfileByUserId,
  matchQuotesToSupplier,
  type SupplierActivityResult,
  type SupplierApprovalGate,
  type SupplierApprovalStatus,
  type SupplierQuoteMatch,
} from "@/server/suppliers";
import { loadSupplierQuotesList } from "@/server/suppliers/quotesList";
import { formatRelativeTimeFromTimestamp, toTimestamp } from "@/lib/relativeTime";
import {
  getSearchParamValue,
  normalizeEmailInput,
  type SearchParamsLike,
} from "@/app/(portals)/quotes/pageUtils";
import type { WorkspaceMetric } from "../WorkspaceMetrics";
import { buildSupplierInboxRows } from "./inboxRows";
import { InvitedSupplierWelcomePanel } from "./InvitedSupplierWelcomePanel";

export const dynamic = "force-dynamic";

type SupplierDashboardPageProps = {
  searchParams?: SearchParamsLike;
};

async function SupplierDashboardPage({
  searchParams,
}: SupplierDashboardPageProps) {
  const { user } = await getServerAuthUser();
  if (!user) {
    return (
      <section className="mx-auto max-w-3xl rounded-3xl border border-slate-900 bg-slate-950/70 p-8 text-center shadow-[0_18px_40px_rgba(2,6,23,0.85)]">
        <p className="text-xs font-semibold uppercase tracking-[0.35em] text-blue-300">
          Supplier workspace
        </p>
        <h1 className="mt-4 text-3xl font-semibold text-white">You&apos;re not logged in</h1>
        <p className="mt-3 text-sm text-slate-300">
          Use the email you onboarded with to request a magic link. We&apos;ll redirect you back to
          your supplier dashboard once you&apos;re in.
        </p>
        <Link
          href="/login?next=/supplier"
          className="mt-6 inline-flex items-center justify-center rounded-full bg-white/90 px-5 py-2 text-sm font-semibold text-slate-950 transition hover:bg-white"
        >
          Go to login
        </Link>
      </section>
    );
  }
  void refreshNotificationsForUser(user.id, "supplier").catch((error) => {
    console.error("[notifications] refresh failed (supplier)", { userId: user.id, error });
  });
  const sessionCompanyName =
    sanitizeDisplayName(user.user_metadata?.company) ??
    sanitizeDisplayName(user.user_metadata?.full_name) ??
    sanitizeDisplayName(user.email) ??
    "your team";
  const supplierEmail = normalizeEmailInput(user.email ?? null);
  const onboardingJustCompleted =
    getSearchParamValue(searchParams, "onboard") === "1";
  const inviteJustAccepted =
    getSearchParamValue(searchParams, "invite") === "accepted";
  const invitedJustCompleted =
    getSearchParamValue(searchParams, "invited") === "1";
  const offerJustSent = getSearchParamValue(searchParams, "offer") === "sent";

  if (!supplierEmail) {
    return (
      <PortalShell
        workspace="supplier"
        title="Dashboard"
        subtitle="Quote new RFQs and track active jobs in one place."
        headerContent={
          <WorkspaceWelcomeBanner
            role="supplier"
            companyName={sessionCompanyName}
          />
        }
      >
        <section className="rounded-2xl border border-slate-900 bg-slate-950/40 p-6 text-center">
          <p className="text-sm text-slate-300">
            Sign in with a verified supplier email address to load your workspace.
          </p>
        </section>
      </PortalShell>
    );
  }

  const profile = await loadSupplierProfileByUserId(user.id);
  const supplier = profile?.supplier ?? null;
  const supplierExists = Boolean(supplier);
  const approvalsOn = approvalsEnabled();
  const supplierStatus = supplier?.status ?? "pending";
  const approvalStatus: SupplierApprovalStatus =
    profile?.approvalStatus ??
    getSupplierApprovalStatus({ status: supplierStatus });
  const supplierApproved = approvalsOn ? approvalStatus === "approved" : true;
  const approvalGate: SupplierApprovalGate | undefined =
    approvalsOn && !supplierApproved
      ? {
          enabled: true,
          status: approvalStatus,
        }
      : undefined;

  const onboardingState = supplierExists
    ? await loadSupplierOnboardingState(user.id)
    : { hasAnyBids: false, hasAnyAwards: false, hasRecentCapacitySnapshot: false };
  const hasCapabilities = (profile?.capabilities ?? []).length > 0;
  const showGettingSetUp =
    supplierExists && (!onboardingState.hasAnyBids || !onboardingState.hasRecentCapacitySnapshot);

  let matchesResult: SupplierActivityResult<SupplierQuoteMatch[]> = { ok: true, data: [] };
  if (supplier && !isApprovalGateActive(approvalGate)) {
    try {
      matchesResult = await matchQuotesToSupplier({
        supplierId: supplier.id,
        supplierEmail: supplier.primary_email ?? supplierEmail,
      });
    } catch (error) {
      console.error("[supplier dashboard] matches load failed", {
        supplierId: supplier.id,
        error,
      });
      matchesResult = { ok: false, data: [] };
    }
  }
  const matchesData = matchesResult.data ?? [];
  const matchQuoteIds = matchesData
    .map((match) => match.quoteId ?? match.quote?.id ?? null)
    .filter((id): id is string => typeof id === "string" && id.trim().length > 0);
  const bidAggregates =
    supplier && matchQuoteIds.length > 0
      ? await loadSupplierInboxBidAggregates(supplier.id, matchQuoteIds)
      : {};
  const supplierInboxRows = buildSupplierInboxRows({
    matches: matchesData,
    bidAggregates,
    capabilities: profile?.capabilities ?? [],
  });
  const newRfqs = supplierInboxRows.filter((row) => row.supplierBidState === "no_bid");
  const matchesUnavailable = supplierExists && !matchesResult.ok;

  let quotesList: Awaited<ReturnType<typeof loadSupplierQuotesList>> = [];
  if (supplier) {
    try {
      quotesList = await loadSupplierQuotesList(user.id);
    } catch (error) {
      console.error("[supplier dashboard] quotes list load failed", {
        supplierId: supplier.id,
        error,
      });
      quotesList = [];
    }
  }

  const activeJobs = quotesList
    .filter((row) => row.isAwardedToSupplier)
    .sort((a, b) => (b.awardedAt ?? "").localeCompare(a.awardedAt ?? ""));

  const workspaceCompanyName =
    sanitizeDisplayName(supplier?.company_name) ??
    sessionCompanyName;
  const supplierMetrics = deriveSupplierDashboardMetrics({
    newRfqsCount: newRfqs.length,
    activeJobsCount: activeJobs.length,
  });
  const lastUpdatedTimestamp = getLatestDashboardTimestamp({
    inboxRows: newRfqs,
    activeJobs,
  });
  const lastUpdatedLabel = formatRelativeTimeFromTimestamp(lastUpdatedTimestamp);
  const hasActivity = newRfqs.length > 0 || activeJobs.length > 0;
  const systemStatusMessage = !supplier
    ? "Finish onboarding to see RFQs"
    : approvalsOn && !supplierApproved
      ? "Pending supplier review"
      : hasActivity
        ? `${newRfqs.length} new RFQ${newRfqs.length === 1 ? "" : "s"} waiting`
        : "All caught up";

  const headerContent = (
    <div className="space-y-4">
      <WorkspaceWelcomeBanner
        role="supplier"
        companyName={workspaceCompanyName}
      />
      <SystemStatusBar
        role="supplier"
        statusMessage={systemStatusMessage}
        syncedLabel={lastUpdatedLabel}
      />
    </div>
  );

  const headerActions = (
    <Link
      href="/supplier/onboarding"
      className="inline-flex items-center rounded-full border border-blue-400/40 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-blue-100 transition hover:border-blue-300 hover:text-white"
    >
      {supplierExists ? "Update profile" : "Finish onboarding"}
    </Link>
  );

  return (
    <PortalShell
      workspace="supplier"
      title="Dashboard"
      subtitle="Quote new RFQs and track active jobs in one place."
      actions={headerActions}
      headerContent={headerContent}
    >
      <PortalStatPills
        role="supplier"
        metrics={supplierMetrics}
        lastUpdatedLabel={lastUpdatedLabel}
      />
      <InvitedSupplierWelcomePanel enabled={invitedJustCompleted} />
      {showGettingSetUp ? (
        <PortalCard
          title="Quick setup"
          description="Two steps to ensure you receive the right RFQs."
        >
          <ul className="space-y-2 text-sm">
            {!hasCapabilities ? (
              <li>
                <Link
                  href="/supplier/onboarding"
                  className="font-semibold text-blue-200 underline-offset-4 hover:underline"
                >
                  Add capabilities &amp; processes
                </Link>
              </li>
            ) : null}
            {!onboardingState.hasRecentCapacitySnapshot ? (
              <li>
                <Link
                  href="/supplier/settings/capacity"
                  className="font-semibold text-blue-200 underline-offset-4 hover:underline"
                >
                  Update capacity
                </Link>
              </li>
            ) : null}
          </ul>
        </PortalCard>
      ) : null}

      <PortalCard
        title="New RFQs"
        description="RFQs waiting for your offer."
        action={
          supplierExists ? (
            <Link
              href="/supplier/quotes?status=open"
              className="text-sm font-semibold text-blue-200 underline-offset-4 hover:underline"
            >
              View all
            </Link>
          ) : null
        }
      >
        {isApprovalGateActive(approvalGate) ? (
          <EmptyStateNotice
            title={getApprovalHoldCopy(approvalGate?.status).title}
            description={getApprovalHoldCopy(approvalGate?.status).description}
          />
        ) : supplierExists && newRfqs.length > 0 ? (
          <NewRfqsTable rows={newRfqs.slice(0, 10)} />
        ) : supplierExists ? (
          <EmptyStateNotice
            title="No new RFQs"
            description="When a new RFQ is assigned to your shop, it appears here immediately."
          />
        ) : (
          <EmptyStateNotice
            title="Finish onboarding to receive RFQs"
            description="Complete your supplier profile so we can route the right requests to you."
            action={
              <Link
                href="/supplier/onboarding"
                className="text-sm font-semibold text-blue-200 underline-offset-4 hover:underline"
              >
                Finish onboarding
              </Link>
            }
          />
        )}
        {matchesUnavailable ? <DataFallbackNotice className="mt-3" /> : null}
      </PortalCard>

      <PortalCard
        title="Active jobs"
        description="Awarded RFQs in progress."
        action={
          supplierExists ? (
            <Link
              href="/supplier/quotes"
              className="text-sm font-semibold text-blue-200 underline-offset-4 hover:underline"
            >
              View all
            </Link>
          ) : null
        }
      >
        {supplierExists && activeJobs.length > 0 ? (
          <ActiveJobsTable rows={activeJobs.slice(0, 10)} />
        ) : supplierExists ? (
          <EmptyStateNotice
            title="No active jobs"
            description="Once you’re awarded an RFQ, it will show up here."
          />
        ) : (
          <EmptyStateNotice
            title="Active jobs unlock after onboarding"
            description="Sign in with your supplier email to see awarded work in progress."
            action={
              <Link
                href="/login?next=/supplier"
                className="text-sm font-semibold text-blue-200 underline-offset-4 hover:underline"
              >
                Go to login
              </Link>
            }
          />
        )}
      </PortalCard>

      {approvalsOn && supplierExists && !supplierApproved ? (
        <PortalCard
          title="Status"
          description="Your supplier profile is pending review."
        >
          <p className="text-sm text-slate-300">
            You can keep updating your profile. New RFQs will start flowing once you’re approved.
          </p>
        </PortalCard>
      ) : null}

      {onboardingJustCompleted ? (
        <PortalCard title="Profile updated">
          <p className="text-sm text-slate-300">
            Profile updated! We’ll start routing matched RFQs to you automatically.
          </p>
        </PortalCard>
      ) : null}
      {inviteJustAccepted ? (
        <PortalCard title="Invite accepted">
          <p className="text-sm text-slate-300">
            Invite accepted! You’re now part of this supplier workspace.
          </p>
        </PortalCard>
      ) : null}

      {offerJustSent ? (
        <PortalCard title="Offer sent">
          <p className="text-sm text-slate-300">
            Your offer is on file. This RFQ has been removed from your “New RFQs” list.
          </p>
        </PortalCard>
      ) : null}
    </PortalShell>
  );
}

function isApprovalGateActive(gate?: SupplierApprovalGate | null): boolean {
  return Boolean(gate?.enabled && gate.status !== "approved");
}

function getApprovalHoldCopy(status?: SupplierApprovalStatus) {
  if (status === "rejected") {
    return {
      title: "Account needs review",
      description: "Reach out to our team so we can revisit your approval status.",
    };
  }
  return {
    title: "Search requests unlock after approval",
    description: "Search requests and quotes will appear here once your account is approved.",
  };
}

function sanitizeDisplayName(value?: string | null): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function deriveSupplierDashboardMetrics(input: {
  newRfqsCount: number;
  activeJobsCount: number;
}): WorkspaceMetric[] {
  return [
    {
      label: "New RFQs",
      value: Math.max(0, Math.floor(input.newRfqsCount)),
      helper: "RFQs awaiting your offer",
    },
    {
      label: "Active jobs",
      value: Math.max(0, Math.floor(input.activeJobsCount)),
      helper: "Awarded RFQs in progress",
    },
  ];
}

function getLatestDashboardTimestamp(input: {
  inboxRows: Array<{ createdAt: string | null }>;
  activeJobs: Array<{ lastActivityAt: string | null; awardedAt: string | null }>;
}): number | null {
  const timestamps: number[] = [];
  for (const row of input.inboxRows) {
    const ts = toTimestamp(row.createdAt);
    if (typeof ts === "number") timestamps.push(ts);
  }
  for (const row of input.activeJobs) {
    const ts1 = toTimestamp(row.lastActivityAt);
    const ts2 = toTimestamp(row.awardedAt);
    if (typeof ts1 === "number") timestamps.push(ts1);
    if (typeof ts2 === "number") timestamps.push(ts2);
  }
  if (timestamps.length === 0) return null;
  return Math.max(...timestamps);
}

type NextAppPage = (props: {
  params?: Promise<Record<string, unknown>>;
  searchParams?: Promise<any>;
}) => ReturnType<typeof SupplierDashboardPage>;

export default SupplierDashboardPage as unknown as NextAppPage;
