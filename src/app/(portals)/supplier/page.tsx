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
import { getDemoSupplierProviderIdFromCookie } from "@/server/demo/demoSupplierProvider";
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
import { SupplierFunnelBanner } from "./components/SupplierFunnelBanner";

export const dynamic = "force-dynamic";

const QUIET_CARD_CLASSNAME =
  "border-slate-900/45 bg-slate-950/25 shadow-none hover:border-slate-900/55 hover:bg-slate-950/30 hover:shadow-none";

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
        <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-sky-200">
          Supplier workspace
        </p>
        <h1 className="mt-4 text-3xl font-semibold text-white heading-tight sm:text-4xl">
          You&apos;re not logged in
        </h1>
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
  const invitedJustCompleted =
    getSearchParamValue(searchParams, "invited") === "1";
  const offerJustSent = getSearchParamValue(searchParams, "offer") === "sent";

  if (!supplierEmail) {
    return (
      <PortalShell
        workspace="supplier"
        title="Dashboard"
        subtitle="Quote new RFQs and track active projects in one place."
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

  let quotesList: Awaited<ReturnType<typeof loadSupplierQuotesList>> = [];
  if (supplier) {
    try {
      const demoProviderId = await getDemoSupplierProviderIdFromCookie();
      quotesList = await loadSupplierQuotesList(user.id, {
        providerIdOverride: demoProviderId,
      });
    } catch (error) {
      console.error("[supplier dashboard] quotes list load failed", {
        supplierId: supplier.id,
        error,
      });
      quotesList = [];
    }
  }

  // Align the dashboard “New RFQs” scope with the supplier quotes list scope.
  // This avoids routing to RFQs that appear in the match feed but are not actually
  // accessible for this supplier (which would surface “Not invited to this RFQ”).
  const visibleQuoteIds = new Set(quotesList.map((row) => row.quoteId));

  const supplierInboxRows = buildSupplierInboxRows({
    matches: matchesData,
    bidAggregates,
    capabilities: profile?.capabilities ?? [],
  });
  const newRfqs = supplierInboxRows.filter(
    (row) => row.supplierBidState === "no_bid" && visibleQuoteIds.has(row.quoteId),
  );
  const matchesUnavailable = supplierExists && !matchesResult.ok;

  const activeJobs = quotesList
    .filter((row) => row.isAwardedToSupplier)
    .sort((a, b) => (b.awardedAt ?? "").localeCompare(a.awardedAt ?? ""));

  const sevenDaysAgoMs = Date.now() - 7 * 24 * 60 * 60 * 1000;

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
      subtitle="Quote new RFQs and track active projects in one place."
      actions={headerActions}
      headerContent={headerContent}
      bodyClassName="space-y-6 sm:space-y-7"
    >
      <div className="space-y-3">
        <AwardedJobSuccessBanner awardedQuoteIds={activeJobs.map((row) => row.quoteId)} />
        <SupplierOfferSentBanner enabled={offerJustSent} />
      </div>
      <InvitedSupplierWelcomePanel enabled={invitedJustCompleted} />
      <div className="grid gap-7 lg:grid-cols-12 lg:items-start lg:gap-8">
        <div className="space-y-7 lg:col-span-9">
          <PortalCard
            title="Step 1 · New RFQs"
            description="RFQs waiting for your offer."
            className="p-7 sm:p-8 ring-1 ring-blue-400/10 border-slate-700/70 bg-slate-950/60 shadow-[0_16px_44px_rgba(2,6,23,0.4)] hover:border-slate-600/75 hover:bg-slate-950/65 hover:shadow-[0_18px_52px_rgba(2,6,23,0.48)]"
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

            <div className="mt-6 border-t border-slate-800/60 pt-5">
              <SupplierFunnelBanner
                activeStep={1}
                className="border-slate-900/55 bg-black/10"
              />
            </div>
          </PortalCard>
        </div>

        <div className="space-y-5 lg:col-span-3">
          <PortalCard
            title="Step 3 · Active projects"
            description="Awarded work in progress."
            className={`${QUIET_CARD_CLASSNAME} p-5`}
            action={
              supplierExists ? (
                <Link
                  href="/supplier/projects"
                  className="text-sm font-semibold text-slate-300 underline-offset-4 hover:text-white hover:underline"
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
                title="No active projects"
                description="Once you’re awarded an RFQ, it will show up here."
              />
            ) : (
              <EmptyStateNotice
                title="Projects unlock after onboarding"
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
              className={`${QUIET_CARD_CLASSNAME} p-5`}
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
    title: "RFQs unlock after approval",
    description: "RFQs and quotes will appear here once your account is approved.",
  };
}

function sanitizeDisplayName(value?: string | null): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
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
