import Link from "next/link";
import PortalCard from "../PortalCard";
import { WorkspaceWelcomeBanner } from "../WorkspaceWelcomeBanner";
import { EmptyStateNotice } from "../EmptyStateNotice";
import { SystemStatusBar } from "../SystemStatusBar";
import { DataFallbackNotice } from "../DataFallbackNotice";
import { PortalShell } from "../components/PortalShell";
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
import { countUniqueSupplierProcessesFromCapabilities } from "@/lib/supplier/processes";
import {
  getSearchParamValue,
  normalizeEmailInput,
  type SearchParamsLike,
} from "@/app/(portals)/quotes/pageUtils";
import { buildSupplierInboxRows } from "./inboxRows";
import { InvitedSupplierWelcomePanel } from "./InvitedSupplierWelcomePanel";
import { SupplierOfferSentBanner } from "./SupplierOfferSentBanner";
import { AwardedJobSuccessBanner } from "./AwardedJobSuccessBanner";

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
  const supplierProcessCount = countUniqueSupplierProcessesFromCapabilities(profile?.capabilities ?? []);
  const showProfileCompletionNudge = supplierExists && supplierProcessCount < 2;
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

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const startOfTodayMs = startOfToday.getTime();
  const newRfqsTodayCount = newRfqs.filter((row) => {
    const ts = toTimestamp(row.createdAt);
    return typeof ts === "number" && ts >= startOfTodayMs;
  }).length;

  const sevenDaysAgoMs = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const quotesSentLast7DaysCount = quotesList.filter((row) => {
    const ts = toTimestamp(row.lastBidAt);
    return typeof ts === "number" && ts >= sevenDaysAgoMs;
  }).length;

  const responseDaysLast7 = countDistinctResponseDaysLast7Days(quotesList, sevenDaysAgoMs);
  const responseMomentumLabel =
    responseDaysLast7 >= 5
      ? "Great momentum this week"
      : responseDaysLast7 >= 3
        ? "Consistent this week"
        : null;

  const lastBidAtMs = quotesList.reduce<number | null>((best, row) => {
    const ts = toTimestamp(row.lastBidAt);
    if (typeof ts !== "number") return best;
    return best === null ? ts : Math.max(best, ts);
  }, null);
  const responseActivityLabel = (() => {
    if (typeof lastBidAtMs !== "number") return null;
    const now = Date.now();
    const last24HoursMs = now - 24 * 60 * 60 * 1000;
    if (lastBidAtMs >= last24HoursMs) return "Responding actively";
    if (lastBidAtMs >= sevenDaysAgoMs) return "Active this week";
    return null;
  })();

  const workspaceCompanyName =
    sanitizeDisplayName(supplier?.company_name) ??
    sessionCompanyName;
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
      bodyClassName="space-y-6"
    >
      <div className="space-y-3">
        <AwardedJobSuccessBanner awardedQuoteIds={activeJobs.map((row) => row.quoteId)} />
        <SupplierOfferSentBanner enabled={offerJustSent} />
      </div>
      <SupplierActivityRecapStats
        newRfqsTodayCount={newRfqsTodayCount}
        activeJobsCount={activeJobs.length}
        quotesSentLast7DaysCount={quotesSentLast7DaysCount}
        responseActivityLabel={responseActivityLabel}
        responseMomentumLabel={responseMomentumLabel}
      />
      <InvitedSupplierWelcomePanel enabled={invitedJustCompleted} />
      <div className="grid gap-6 lg:grid-cols-12 lg:items-start">
        <div className="space-y-6 lg:col-span-8">
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
            className="py-6"
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
        </div>

        <div className="space-y-6 lg:col-span-4">
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
            className="shadow-none hover:translate-y-0 hover:shadow-none"
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

          {showGettingSetUp ? (
            <PortalCard
              title="Quick setup"
              description="Two steps to ensure you receive the right RFQs."
              className="shadow-none hover:translate-y-0 hover:shadow-none"
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

          {showProfileCompletionNudge ? (
            <PortalCard
              title="Complete your profile to receive better matched RFQs"
              action={
                <Link
                  href="/supplier/settings/processes"
                  className="inline-flex items-center rounded-full border border-slate-700 bg-slate-950/40 px-4 py-2 text-xs font-semibold text-slate-100 transition hover:border-slate-500 hover:text-white"
                >
                  Update processes
                </Link>
              }
              className="py-4 shadow-none hover:translate-y-0 hover:shadow-none"
            />
          ) : null}

          {approvalsOn && supplierExists && !supplierApproved ? (
            <PortalCard
              title="Status"
              description="Your supplier profile is pending review."
              className="shadow-none hover:translate-y-0 hover:shadow-none"
            >
              <p className="text-sm text-slate-300">
                You can keep updating your profile. New RFQs will start flowing once you’re approved.
              </p>
            </PortalCard>
          ) : null}

          {onboardingJustCompleted ? (
            <PortalCard title="Profile updated" className="shadow-none hover:translate-y-0 hover:shadow-none">
              <p className="text-sm text-slate-300">
                Profile updated! We’ll start routing matched RFQs to you automatically.
              </p>
            </PortalCard>
          ) : null}
          {inviteJustAccepted ? (
            <PortalCard title="Invite accepted" className="shadow-none hover:translate-y-0 hover:shadow-none">
              <p className="text-sm text-slate-300">
                Invite accepted! You’re now part of this supplier workspace.
              </p>
            </PortalCard>
          ) : null}
        </div>
      </div>
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

function SupplierActivityRecapStats(props: {
  newRfqsTodayCount: number;
  activeJobsCount: number;
  quotesSentLast7DaysCount: number;
  responseActivityLabel: string | null;
  responseMomentumLabel: string | null;
}) {
  return (
    <section className="rounded-2xl border border-slate-900/60 bg-slate-950/35 px-4 py-2">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 sm:gap-0 sm:divide-x sm:divide-slate-900/60">
        <ActivityRecapStat
          label="New RFQs today"
          labelAddon={props.responseActivityLabel}
          labelSubtext={props.responseMomentumLabel}
          value={props.newRfqsTodayCount}
        />
        <ActivityRecapStat
          label="Active jobs"
          value={props.activeJobsCount}
        />
        <ActivityRecapStat
          label="Quotes sent (7d)"
          value={props.quotesSentLast7DaysCount}
        />
      </div>
    </section>
  );
}

function ActivityRecapStat(props: {
  label: string;
  labelAddon?: string | null;
  labelSubtext?: string | null;
  value: number;
  className?: string;
}) {
  return (
    <div
      className={[
        "flex items-center justify-between gap-3 rounded-xl py-1",
        "sm:px-4 sm:py-2",
        props.className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="text-[11px] font-semibold uppercase tracking-[0.26em] text-slate-400">
            {props.label}
          </span>
          {props.labelAddon ? (
            <span className="text-[11px] font-medium text-slate-500">
              {props.labelAddon}
            </span>
          ) : null}
        </div>
        {props.labelSubtext ? (
          <p className="mt-1 text-xs font-medium text-slate-500">
            {props.labelSubtext}
          </p>
        ) : null}
      </div>
      <span className="text-base font-semibold text-white tabular-nums">
        {Math.max(0, Math.floor(props.value)).toLocaleString("en-US")}
      </span>
    </div>
  );
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

function countDistinctResponseDaysLast7Days(
  rows: Array<{ lastBidAt: string | null }>,
  sevenDaysAgoMs: number,
): number {
  const days = new Set<string>();
  for (const row of rows ?? []) {
    const ts = toTimestamp(row?.lastBidAt);
    if (typeof ts !== "number" || ts < sevenDaysAgoMs) continue;
    days.add(new Date(ts).toISOString().slice(0, 10));
  }
  return days.size;
}

type NextAppPage = (props: {
  params?: Promise<Record<string, unknown>>;
  searchParams?: Promise<any>;
}) => ReturnType<typeof SupplierDashboardPage>;

export default SupplierDashboardPage as unknown as NextAppPage;
