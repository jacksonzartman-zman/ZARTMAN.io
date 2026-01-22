import Link from "next/link";
import clsx from "clsx";
import { formatDateTime } from "@/lib/formatDate";
import PortalCard from "../PortalCard";
import SupplierInboxTable, { type SupplierInboxRow } from "./SupplierInboxTable";
import { buildSupplierInboxRows } from "./inboxRows";
import { WorkspaceWelcomeBanner } from "../WorkspaceWelcomeBanner";
import type { WorkspaceMetric } from "../WorkspaceMetrics";
import { EmptyStateNotice } from "../EmptyStateNotice";
import {
  getSearchParamValue,
  normalizeEmailInput,
  type SearchParamsLike,
} from "@/app/(portals)/quotes/pageUtils";
import {
  getSupplierApprovalStatus,
  loadSupplierInboxBidAggregates,
  listSupplierBidsForSupplier,
  loadSupplierProfileByUserId,
  matchQuotesToSupplier,
  type SupplierActivityResult,
  type SupplierApprovalGate,
  type SupplierApprovalStatus,
  type SupplierBidWithContext,
  type SupplierQuoteMatch,
} from "@/server/suppliers";
import {
  loadSupplierSelfBenchHealth,
  type SupplierSelfBenchHealth,
} from "@/server/suppliers/benchHealth";
import {
  loadSupplierReputationForSupplier,
  type SupplierReputationLabel,
  type SupplierReputationScore,
} from "@/server/suppliers/reputation";
import { getServerAuthUser } from "@/server/auth";
import { formatRelativeTimeFromTimestamp, toTimestamp } from "@/lib/relativeTime";
import { SystemStatusBar } from "../SystemStatusBar";
import { loadSupplierActivityFeed } from "@/server/activity";
import { loadRecentSupplierActivity } from "@/server/suppliers/activity";
import type { QuoteActivityEvent } from "@/types/activity";
import { resolveUserRoles } from "@/server/users/roles";
import { DataFallbackNotice } from "../DataFallbackNotice";
import { DEBUG_PORTALS } from "../debug";
import { approvalsEnabled } from "@/server/suppliers/flags";
import { PortalShell } from "../components/PortalShell";
import { PortalStatPills } from "../components/PortalStatPills";
import { resolveSupplierActivityEmptyState } from "./activityEmptyState";
import { loadSupplierOnboardingState } from "@/server/suppliers/onboarding";
import { refreshNotificationsForUser } from "@/server/notifications";

export const dynamic = "force-dynamic";

type SupplierDashboardPageProps = {
  searchParams?: SearchParamsLike;
};

async function SupplierDashboardPage({
  searchParams,
}: SupplierDashboardPageProps) {
  const { user } = await getServerAuthUser();
  const roles = user ? await resolveUserRoles(user.id) : null;
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
  console.log("[portal] user id", user.id);
  console.log("[portal] email", user.email);
  console.log("[portal] isSupplier", roles?.isSupplier);
  console.log("[portal] isCustomer", roles?.isCustomer);
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

  if (!supplierEmail) {
    return (
      <PortalShell
        workspace="supplier"
        title="Dashboard"
        subtitle="Search requests, offers, and compliance docs stay aligned here."
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
  const activityHoldCopy = getApprovalHoldCopy(approvalGate?.status);

  const onboardingState = supplierExists
    ? await loadSupplierOnboardingState(user.id)
    : { hasAnyBids: false, hasAnyAwards: false, hasRecentCapacitySnapshot: false };
  const hasCapabilities = (profile?.capabilities ?? []).length > 0;
  const showGettingSetUp =
    supplierExists && (!onboardingState.hasAnyBids || !onboardingState.hasRecentCapacitySnapshot);

  let matchesResult: SupplierActivityResult<SupplierQuoteMatch[]> = {
    ok: true,
    data: [],
  };
  let bidsResult: SupplierActivityResult<SupplierBidWithContext[]> = {
    ok: true,
    data: [],
  };
  let benchHealth: SupplierSelfBenchHealth | null = null;
  let reputation: SupplierReputationScore | null = null;

  if (supplier) {
    try {
      const [resolvedMatches, resolvedBids, resolvedHealth, resolvedReputation] = await Promise.all([
        matchQuotesToSupplier({
          supplierId: supplier.id,
          supplierEmail: supplier.primary_email ?? supplierEmail,
        }),
        listSupplierBidsForSupplier({
          supplierId: supplier.id,
          supplierEmail: supplier.primary_email ?? supplierEmail,
        }),
        loadSupplierSelfBenchHealth(supplier.id).catch((error) => {
          console.error("[supplier dashboard] bench health failed", {
            supplierId: supplier.id,
            error,
          });
          return null;
        }),
        loadSupplierReputationForSupplier(supplier.id).catch((error) => {
          console.error("[supplier dashboard] reputation load failed", {
            supplierId: supplier.id,
            error,
          });
          return null;
        }),
      ]);
      matchesResult = resolvedMatches;
      bidsResult = resolvedBids;
      benchHealth = resolvedHealth;
      reputation = resolvedReputation;
    } catch (error) {
      console.error("[supplier dashboard] supplier loaders failed", {
        supplierId: supplier.id,
        error,
      });
    }
  }
  const matchesData = matchesResult.data ?? [];
  const bidsData = bidsResult.data ?? [];
  const matchQuoteIds = matchesData
    .map((match) => match.quoteId ?? match.quote?.id ?? null)
    .filter(
      (id): id is string => typeof id === "string" && id.trim().length > 0,
    );
  const bidAggregates =
    supplier && matchQuoteIds.length > 0
      ? await loadSupplierInboxBidAggregates(supplier.id, matchQuoteIds)
      : {};
  const supplierInboxRows = buildSupplierInboxRows({
    matches: matchesData,
    bidAggregates,
    capabilities: profile?.capabilities ?? [],
  });
  console.info("[supplier inbox] loaded", {
    supplierId: supplier?.id ?? null,
    totalQuotes: supplierInboxRows.length,
    withBids: supplierInboxRows.filter((row) => row.bidCount > 0).length,
  });
  const matchesUnavailable = supplierExists && !matchesResult.ok;
  const bidsUnavailable = supplierExists && !bidsResult.ok;
  const canLoadActivity =
    supplierExists && !isApprovalGateActive(approvalGate);
  let recentActivity: QuoteActivityEvent[] = [];
  let activityFeedMeta: SupplierActivityResult<unknown> | null = null;
  if (canLoadActivity && supplier) {
    try {
      activityFeedMeta = await loadSupplierActivityFeed({
        supplierId: supplier.id,
        supplierEmail: supplier.primary_email ?? supplierEmail,
        limit: 0,
      });
    } catch (error) {
      console.error("[supplier dashboard] activity meta load failed", {
        supplierId: supplier.id,
        error,
      });
    }

    if (activityFeedMeta?.reason !== "assignments-disabled") {
      try {
        recentActivity = await loadRecentSupplierActivity(supplier.id);
      } catch (error) {
        console.error("[supplier dashboard] activity feed failed", {
          supplierId: supplier.id,
          error,
        });
        recentActivity = [];
      }
    }
  }
  const activityEmptyState = resolveSupplierActivityEmptyState({
    supplierExists,
    hasEvents: recentActivity.length > 0,
    reason: activityFeedMeta?.reason ?? null,
  });
  console.log("[supplier dashboard] activity loaded", {
    supplierId: supplier?.id ?? null,
    eventCount: recentActivity.length,
    gateActive: isApprovalGateActive(approvalGate),
    reason: activityFeedMeta?.reason ?? null,
  });

  const signedInEmail = supplier?.primary_email ?? supplierEmail;
  const companyLabel =
    supplier?.company_name ?? supplier?.primary_email ?? supplierEmail;
  const workspaceCompanyName =
    sanitizeDisplayName(supplier?.company_name) ??
    sanitizeDisplayName(companyLabel) ??
    sessionCompanyName;
  const supplierMetrics = deriveSupplierMetrics(matchesData, bidsData);
  const lastUpdatedTimestamp = getLatestSupplierActivityTimestamp(
    matchesData,
    bidsData,
  );
  const lastUpdatedLabel = formatRelativeTimeFromTimestamp(lastUpdatedTimestamp);
  const hasActivity = matchesData.length > 0 || bidsData.length > 0;
  const systemStatusMessage = !supplier
    ? "Finish onboarding to unlock matches"
    : approvalsOn && !supplierApproved
      ? "Pending supplier review"
      : hasActivity
        ? "All systems operational"
        : "Waiting for your first match";

  console.info("[supplier dashboard] loaded", {
    userEmail: user.email ?? null,
    supplierId: supplier?.id ?? null,
    supplierEmail: supplier?.primary_email ?? supplierEmail ?? null,
    companyName: supplier?.company_name ?? null,
    hasProfile: Boolean(supplier),
    inboxRowCount: Array.isArray(supplierInboxRows) ? supplierInboxRows.length : null,
    activityEventCount: Array.isArray(recentActivity) ? recentActivity.length : null,
  });

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
      subtitle="Search requests, bids, and compliance docs stay aligned here."
      actions={headerActions}
      headerContent={headerContent}
    >
      <PortalStatPills
        role="supplier"
        metrics={supplierMetrics}
        lastUpdatedLabel={lastUpdatedLabel}
      />
      {showGettingSetUp ? (
        <PortalCard
          title="Getting set up"
          description="A few quick steps help us route the right work to you."
        >
          <ul className="space-y-3 text-sm">
            <li className="flex items-start gap-3">
              <span
                className={clsx(
                  "mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-full border text-xs font-semibold",
                  hasCapabilities
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-100"
                    : "border-slate-800 bg-slate-950/40 text-slate-300",
                )}
              >
                {hasCapabilities ? "✓" : "○"}
              </span>
              <div className="flex-1">
                <Link
                  href="/supplier/onboarding"
                  className="font-semibold text-blue-200 underline-offset-4 hover:underline"
                >
                  Complete your profile &amp; capabilities
                </Link>
                <p className="mt-0.5 text-xs text-slate-400">
                  Add processes and details so we can match search requests accurately.
                </p>
              </div>
            </li>
            <li className="flex items-start gap-3">
              <span
                className={clsx(
                  "mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-full border text-xs font-semibold",
                  onboardingState.hasRecentCapacitySnapshot
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-100"
                    : "border-slate-800 bg-slate-950/40 text-slate-300",
                )}
              >
                {onboardingState.hasRecentCapacitySnapshot ? "✓" : "○"}
              </span>
              <div className="flex-1">
                <Link
                  href="/supplier/settings/capacity"
                  className="font-semibold text-blue-200 underline-offset-4 hover:underline"
                >
                  Set your capacity for the upcoming weeks
                </Link>
                <p className="mt-0.5 text-xs text-slate-400">
                  Keep availability current so we don’t over-route work.
                </p>
              </div>
            </li>
            <li className="flex items-start gap-3">
              <span
                className={clsx(
                  "mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-full border text-xs font-semibold",
                  onboardingState.hasAnyBids
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-100"
                    : "border-slate-800 bg-slate-950/40 text-slate-300",
                )}
              >
                {onboardingState.hasAnyBids ? "✓" : "○"}
              </span>
              <div className="flex-1">
                <Link
                  href="/supplier/quotes?status=open"
                  className="font-semibold text-blue-200 underline-offset-4 hover:underline"
                >
                  Bid on your first search request
                </Link>
                <p className="mt-0.5 text-xs text-slate-400">
                  Open a matched search request and submit pricing to start building history.
                </p>
              </div>
            </li>
          </ul>
        </PortalCard>
      ) : null}
      <MatchHealthCard
        supplierExists={supplierExists}
        benchHealth={benchHealth}
      />
      <SupplierReputationCard supplierExists={supplierExists} reputation={reputation} />
      <section className="rounded-2xl border border-slate-900 bg-slate-950/40 p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-blue-300">
          Supplier workspace
        </p>
        <h2 className="mt-2 text-2xl font-semibold text-white">
          Search requests, bids, and compliance docs in one place
        </h2>
        <p className="mt-2 text-sm text-slate-400">
          Review matched search requests, submit bids, and keep your onboarding profile current
          without leaving this dashboard.
        </p>
        <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-xs text-slate-400">
          <span>
            Signed in as{" "}
            <span className="font-semibold text-white">{companyLabel}</span>{" "}
            (<span className="font-mono text-slate-200">{signedInEmail}</span>)
          </span>
          <span>
            Every “View quote” link below carries your identity so we can confirm assignments
            automatically.
          </span>
        </div>
        {approvalsOn && supplierExists ? (
          supplierApproved ? (
            <span className="mt-4 inline-flex w-fit rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-emerald-100">
              Status: Approved
            </span>
          ) : (
            <p className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-6 py-4 text-xs text-amber-100">
              Your supplier profile is pending review. You can keep editing your profile; search
              requests will start flowing in once you’re approved.
            </p>
          )
        ) : null}
        {onboardingJustCompleted ? (
          <p className="mt-4 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
            Profile updated! We’ll start routing matched search requests to you automatically.
          </p>
        ) : null}
        {inviteJustAccepted ? (
          <p className="mt-4 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
            Invite accepted! You’re now part of this supplier workspace.
          </p>
        ) : null}
      </section>

      <PortalCard
        title="Recent activity"
        description="Quick pulse on search requests, bids, and status changes routed to your shop."
      >
        {isApprovalGateActive(approvalGate) ? (
          <EmptyStateNotice
            title={activityHoldCopy.title}
            description={activityHoldCopy.description}
          />
        ) : recentActivity.length > 0 ? (
          <ul className="space-y-3">
            {recentActivity.map((item) => {
              const inner = (
                <div className="flex flex-col gap-2 rounded-2xl border border-slate-900/70 bg-slate-950/50 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <ActivityTypeBadge type={item.type} />
                    <p className="text-sm font-semibold text-white">{item.title}</p>
                    <p className="text-xs text-slate-400">{item.description}</p>
                  </div>
                  <p className="text-xs text-slate-500">
                    {formatActivityTimestamp(item.timestamp) ?? "Date pending"}
                  </p>
                </div>
              );
              return (
                <li key={item.id}>
                  {item.href ? (
                    <Link
                      href={item.href}
                      className="block focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-300"
                    >
                      {inner}
                    </Link>
                  ) : (
                    inner
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyStateNotice
            title={
              activityEmptyState?.title ??
              (supplierExists ? "No activity yet" : "Activity unlocks after onboarding")
            }
            description={
              activityEmptyState?.description ??
              (supplierExists
                ? "We’ll stream search request assignments and bid updates here as they happen."
                : "Finish onboarding to start tracking search requests and bids in this feed.")
            }
          />
        )}
      </PortalCard>

      <MatchesCard
        supplierEmail={supplier?.primary_email ?? supplierEmail}
        supplierExists={supplierExists}
        rows={supplierInboxRows}
        approvalGate={matchesResult.approvalGate ?? approvalGate}
      />
      {matchesUnavailable ? (
        <DataFallbackNotice className="mt-2" />
      ) : null}

      <BidsCard
        supplierEmail={supplier?.primary_email ?? supplierEmail}
        result={bidsResult}
        approvalGate={bidsResult.approvalGate ?? approvalGate}
      />
      {bidsUnavailable ? (
        <DataFallbackNotice className="mt-2" />
      ) : null}
      {DEBUG_PORTALS ? (
        <pre className="mt-4 overflow-x-auto rounded-2xl border border-slate-900 bg-black/40 p-4 text-xs text-slate-500">
          {JSON.stringify({ user, roles }, null, 2)}
        </pre>
      ) : null}
    </PortalShell>
  );
}

function formatReputationLabel(value: SupplierReputationLabel): string {
  switch (value) {
    case "excellent":
      return "Excellent";
    case "good":
      return "Good";
    case "fair":
      return "Fair";
    case "limited":
      return "Limited";
    default:
      return "Unknown";
  }
}

function reputationPillClasses(value: SupplierReputationLabel): string {
  switch (value) {
    case "excellent":
      return "border-emerald-500/40 bg-emerald-500/10 text-emerald-100";
    case "good":
      return "border-blue-500/40 bg-blue-500/10 text-blue-100";
    case "fair":
      return "border-amber-500/40 bg-amber-500/10 text-amber-100";
    case "limited":
      return "border-red-500/40 bg-red-500/10 text-red-100";
    default:
      return "border-slate-900/60 bg-slate-950/40 text-slate-200";
  }
}

function formatComponentHint(label: string, delta: number | null | undefined): string | null {
  if (typeof delta !== "number" || !Number.isFinite(delta)) return null;
  const sign = delta > 0 ? "+" : "";
  return `${label}: ${sign}${delta} pts`;
}

function winRateHint(delta: number | null | undefined): string | null {
  if (typeof delta !== "number" || !Number.isFinite(delta)) return null;
  if (delta >= 25) return "Recent win rate: ≥50%";
  if (delta >= 15) return "Recent win rate: 20–49%";
  if (delta >= 5) return "Recent win rate: 5–19%";
  if (delta >= 2) return "Recent win rate: 1–4%";
  return "Recent win rate: 0% (recent)";
}

function kickoffHint(delta: number | null | undefined): string | null {
  if (typeof delta !== "number" || !Number.isFinite(delta)) return null;
  if (delta >= 10) return "Kickoff follow-through: very reliable";
  if (delta >= 5) return "Kickoff follow-through: mostly on time";
  if (delta <= -10) return "Kickoff follow-through: often late";
  return "Kickoff follow-through: mixed";
}

function responsivenessHint(delta: number | null | undefined): string | null {
  if (typeof delta !== "number" || !Number.isFinite(delta)) return null;
  if (delta >= 10) return "Responsiveness: very responsive";
  if (delta >= 5) return "Responsiveness: normal";
  if (delta <= -10) return "Responsiveness: often slow";
  return "Responsiveness: mixed";
}

function SupplierReputationCard({
  supplierExists,
  reputation,
}: {
  supplierExists: boolean;
  reputation: SupplierReputationScore | null;
}) {
  if (!supplierExists) {
    return (
      <PortalCard
        title="Your Zartman reputation"
        description="We’ll show this once your supplier profile is active."
      >
        <EmptyStateNotice
          title="Reputation unlocks after onboarding"
          description="Finish onboarding and start bidding to build your reputation score over time."
          action={
            <Link
              href="/supplier/onboarding"
              className="text-sm font-semibold text-blue-200 underline-offset-4 hover:underline"
            >
              Complete onboarding
            </Link>
          }
        />
      </PortalCard>
    );
  }

  if (!reputation || reputation.score === null) {
    return (
      <PortalCard
        title="Your Zartman reputation"
        description="A read-only score derived from wins, follow-through, and responsiveness."
      >
        <EmptyStateNotice
          title="We’ll show your reputation here soon"
          description="We’ll show your reputation here once you’ve bid on a few search requests and completed work."
        />
      </PortalCard>
    );
  }

  const label = reputation.label ?? "unknown";
  const score = reputation.score;

  const bullets = [
    winRateHint(reputation.winRateScore ?? null),
    kickoffHint(reputation.kickoffScore ?? null),
    responsivenessHint(reputation.responsivenessScore ?? null),
    formatComponentHint("Participation", reputation.participationScore ?? null),
  ].filter((value): value is string => typeof value === "string" && value.length > 0);

  const improvementHints: string[] = [];
  if ((reputation.participationScore ?? 0) < 0) {
    improvementHints.push("Bid on more matched search requests to build recent participation.");
  }
  if ((reputation.kickoffScore ?? 0) < 0) {
    improvementHints.push("Tighten kickoff completion so projects move to production faster.");
  }
  if ((reputation.responsivenessScore ?? 0) < 0) {
    improvementHints.push("Reply faster in quote threads—aim for <48 hours when a customer messages.");
  }

  return (
    <PortalCard
      title="Your Zartman reputation"
      description="A read-only score derived from wins, follow-through, and responsiveness."
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-500">
              Reputation
            </p>
            <p className="mt-1 text-sm text-slate-300">
              {formatReputationLabel(label)}{" "}
              <span className="text-slate-400">({score}/100)</span>
            </p>
          </div>
          <span
            className={clsx(
              "inline-flex rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-wide",
              reputationPillClasses(label),
            )}
          >
            {formatReputationLabel(label)}
          </span>
        </div>

        {bullets.length > 0 ? (
          <ul className="list-disc space-y-1 pl-5 text-sm text-slate-300">
            {bullets.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        ) : null}

        {improvementHints.length > 0 ? (
          <div className="rounded-xl border border-slate-900/60 bg-slate-950/30 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              How to improve
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-300">
              {improvementHints.map((hint) => (
                <li key={hint}>{hint}</li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-xs text-slate-400">
            Keep bidding and completing kickoff tasks to maintain a strong reputation.
          </p>
        )}
      </div>
    </PortalCard>
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
    description: "Search requests and bids will appear here once your account is approved.",
  };
}

function MatchHealthCard({
  supplierExists,
  benchHealth,
}: {
  supplierExists: boolean;
  benchHealth: SupplierSelfBenchHealth | null;
}) {
  if (!supplierExists) {
    return (
      <PortalCard
        title="Match health"
        description="See how search requests align with your capabilities once onboarding is complete."
      >
        <EmptyStateNotice
          title="Share capabilities to unlock insights"
          description="Finish onboarding and add processes so we can compare incoming search requests against your shop."
          action={
            <Link
              href="/supplier/onboarding"
              className="text-sm font-semibold text-blue-200 underline-offset-4 hover:underline"
            >
              Complete onboarding
            </Link>
          }
        />
      </PortalCard>
    );
  }

  if (!benchHealth) {
    return (
      <PortalCard
        title="Match health"
        description="Your recent match + utilization signals across routed search requests."
      >
        <EmptyStateNotice
          title="We’ll show match health here once you start bidding"
          description="As you bid on more search requests, we’ll start to show how well you’re matched to the work coming through."
        />
      </PortalCard>
    );
  }

  const matchHealth = benchHealth.matchHealth;
  const rfqsBid = benchHealth.rfqsBid ?? 0;
  const rfqsWon = benchHealth.rfqsWon ?? 0;
  const benchStatus = benchHealth.benchStatus;

  return (
      <PortalCard
        title="Match health"
        description="Your recent match + utilization signals across routed search requests."
      >
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-500">
              Match health
            </p>
            <p className="mt-1 text-sm text-slate-300">
              You’ve bid on <span className="font-semibold text-white">{rfqsBid}</span>{" "}
              search requests and won{" "}
              <span className="font-semibold text-white">{rfqsWon}</span> in the last 90 days.
            </p>
          </div>
          <span
            className={clsx(
              "inline-flex rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-wide",
              supplierMatchHealthPillClasses(matchHealth),
            )}
          >
            {formatSupplierMatchHealthLabel(matchHealth)}
          </span>
        </div>

        <div className="rounded-xl border border-slate-900/60 bg-slate-950/30 px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Bench status
          </p>
          <p className="mt-1 text-sm text-slate-200">
            We currently see you as{" "}
            <span className="font-semibold text-white">
              {formatSupplierBenchStatusLabel(benchStatus)}
            </span>{" "}
            based on your recent capacity and awards.
          </p>
          <p className="mt-2 text-xs text-slate-400">
            {formatBenchStatusNudge(benchStatus)}
          </p>
        </div>
      </div>
    </PortalCard>
  );
}

function formatSupplierMatchHealthLabel(value: SupplierSelfBenchHealth["matchHealth"]): string {
  switch (value) {
    case "good":
      return "Good";
    case "caution":
      return "Caution";
    case "poor":
      return "Poor";
    default:
      return "Unknown";
  }
}

function supplierMatchHealthPillClasses(value: SupplierSelfBenchHealth["matchHealth"]): string {
  switch (value) {
    case "good":
      return "border-emerald-500/40 bg-emerald-500/10 text-emerald-100";
    case "caution":
      return "border-amber-500/40 bg-amber-500/10 text-amber-100";
    case "poor":
      return "border-red-500/40 bg-red-500/10 text-red-100";
    default:
      return "border-slate-900/60 bg-slate-950/40 text-slate-200";
  }
}

function formatSupplierBenchStatusLabel(value: SupplierSelfBenchHealth["benchStatus"]): string {
  switch (value) {
    case "underused":
      return "Underused";
    case "balanced":
      return "Balanced";
    case "overused":
      return "Overused";
    default:
      return "Unknown";
  }
}

function formatBenchStatusNudge(value: SupplierSelfBenchHealth["benchStatus"]): string {
  switch (value) {
    case "underused":
      return "Stay responsive and keep your capacity updated; we’ll route more work when you’re a strong fit.";
    case "overused":
      return "You’re winning a lot of work; consider tightening your availability so you don’t overcommit.";
    case "balanced":
      return "You’re in a good spot; keep your capacity updated to maintain a healthy mix of work.";
    default:
      return "As you bid on more search requests, we’ll start to show how well you’re matched to the work coming through.";
  }
}

function MatchesCard({
  supplierEmail: _supplierEmail,
  supplierExists,
  rows,
  approvalGate,
}: {
  supplierEmail: string;
  supplierExists: boolean;
  rows: SupplierInboxRow[];
  approvalGate?: SupplierApprovalGate | null;
}) {
  const matches = rows;
  if (isApprovalGateActive(approvalGate)) {
    const copy = getApprovalHoldCopy(approvalGate?.status);
    return (
      <PortalCard
        title="Inbound search requests"
        description="Search requests that match your verified processes, certifications, and compliance documents."
      >
        <EmptyStateNotice title={copy.title} description={copy.description} />
      </PortalCard>
    );
  }
  return (
    <PortalCard
      title="Inbound search requests"
      description={
        supplierExists
          ? "Search requests that match your verified processes, certifications, and compliance documents."
          : "Complete onboarding to start receiving filtered search requests."
      }
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
      {supplierExists && matches.length > 0 ? (
        <SupplierInboxTable rows={matches} />
      ) : supplierExists ? (
        <EmptyStateNotice
          title="No search requests matched yet"
          description="We’re scanning your capabilities constantly. The first compatible search request drops here immediately."
        />
      ) : (
        <EmptyStateNotice
          title="Unlock search matching"
          description="Share capabilities and certs to start routing search requests straight into this list."
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
    </PortalCard>
  );
}

function BidsCard({
  supplierEmail: _supplierEmail,
  result,
  approvalGate,
}: {
  supplierEmail: string;
  result: SupplierActivityResult<SupplierBidWithContext[]>;
  approvalGate?: SupplierApprovalGate | null;
}) {
  const bids = result.data ?? [];
  if (isApprovalGateActive(approvalGate)) {
    const copy = getApprovalHoldCopy(approvalGate?.status);
    return (
      <PortalCard
        title="Submitted bids"
        description="Track the quotes you’ve priced and see where each bid stands."
      >
        <EmptyStateNotice title={copy.title} description={copy.description} />
      </PortalCard>
    );
  }
  return (
    <PortalCard
      title="Submitted bids"
      description="Track the quotes you’ve priced and see where each bid stands."
      action={
        bids.length > 0 ? (
          <Link
            href="/supplier/quotes"
            className="text-sm font-semibold text-blue-200 underline-offset-4 hover:underline"
          >
            View all
          </Link>
        ) : null
      }
    >
      {bids.length > 0 ? (
        <ul className="space-y-3">
          {bids.slice(0, 8).map((bid) => (
            <li
              key={bid.id}
              className="rounded-2xl border border-slate-900/70 bg-black/20 px-6 py-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-white">
                    Quote {bid.quote_id.slice(0, 8)}
                  </p>
                  <p className="text-xs text-slate-400">
                    {formatCurrency(bid.unit_price, bid.currency)} · Lead time{" "}
                    {bid.lead_time_days ?? "—"} days
                  </p>
                </div>
                <StatusBadge status={bid.status} />
              </div>
              <Link
                href={`/supplier/quotes/${bid.quote_id}`}
                className="mt-2 inline-flex text-xs font-semibold text-blue-300 underline-offset-4 hover:underline"
              >
                View workspace
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyStateNotice
          title="No bids submitted"
          description="No bids yet. Open a matched search request to send pricing—every submission lands here."
        />
      )}
    </PortalCard>
  );
}

const BID_STATUS_VARIANTS: Record<string, string> = {
  accepted: "pill-success",
  declined: "pill-warning",
  withdrawn: "pill-muted",
  pending: "pill-info",
};

function StatusBadge({ status }: { status: string }) {
  const normalizedStatus = status.toLowerCase();
  const variant = BID_STATUS_VARIANTS[normalizedStatus] ?? "pill-muted";
  return (
    <span className={clsx("pill pill-table", variant)}>
      {normalizedStatus.charAt(0).toUpperCase() + normalizedStatus.slice(1)}
    </span>
  );
}

function ActivityTypeBadge({ type }: { type: QuoteActivityEvent["type"] }) {
  const labelMap: Record<QuoteActivityEvent["type"], string> = {
    rfq_submitted: "Search request",
    status_changed: "Status",
    message_posted: "Message",
    bid_received: "Bid",
    winner_selected: "Winner",
  };
  const colorMap: Record<QuoteActivityEvent["type"], string> = {
    rfq_submitted: "pill-info",
    status_changed: "pill-muted",
    message_posted: "pill-info",
    bid_received: "pill-success",
    winner_selected: "pill-warning",
  };
  return (
    <span className={clsx("pill mb-1 px-2 py-0.5 text-[10px]", colorMap[type])}>
      {labelMap[type]}
    </span>
  );
}

function formatActivityTimestamp(value: string | null): string | null {
  if (!value) {
    return null;
  }
  return (
    formatDateTime(value, {
      includeTime: true,
    }) ?? null
  );
}

function formatCurrency(
  value: number | string | null | undefined,
  currency?: string | null,
): string {
  const numericValue =
    typeof value === "string" ? Number(value) : value;
  if (typeof numericValue !== "number" || !Number.isFinite(numericValue)) {
    return "Value pending";
  }
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: (currency ?? "USD").toUpperCase(),
      maximumFractionDigits: 0,
    }).format(numericValue);
  } catch {
    return `$${numericValue.toFixed(0)}`;
  }
}

function sanitizeDisplayName(value?: string | null): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function deriveSupplierMetrics(
  matches: SupplierQuoteMatch[],
  bids: SupplierBidWithContext[],
): WorkspaceMetric[] {
  const rfqsMatched = matches.length;
  const bidsSubmitted = bids.length;
  const bidsAccepted = bids.filter((bid) => bid.status === "accepted").length;

  return [
    {
      label: "Search requests matched",
      value: rfqsMatched,
      helper:
        rfqsMatched > 0
          ? "Capability-aligned search requests waiting for review"
          : "We’ll auto-populate this once your profile attracts matches.",
    },
    {
      label: "Bids submitted",
      value: bidsSubmitted,
      helper:
        bidsSubmitted > 0
          ? "Tracked across every quote you’ve priced"
          : "Send your first bid from a search request match above.",
    },
    {
      label: "Bids accepted",
      value: bidsAccepted,
      helper:
        bidsAccepted > 0
          ? "Customers accepted these proposals"
          : "We’ll highlight wins to celebrate momentum.",
    },
  ];
}

function getLatestSupplierActivityTimestamp(
  matches: SupplierQuoteMatch[],
  bids: SupplierBidWithContext[],
): number | null {
  const timestamps: number[] = [];

  for (const match of matches) {
    const ts = toTimestamp(match.createdAt);
    if (typeof ts === "number") {
      timestamps.push(ts);
    }
  }

  for (const bid of bids) {
    const ts = toTimestamp(bid.updated_at ?? bid.created_at);
    if (typeof ts === "number") {
      timestamps.push(ts);
    }
  }

  if (timestamps.length === 0) {
    return null;
  }

  return Math.max(...timestamps);
}

type NextAppPage = (props: {
  params?: Promise<Record<string, unknown>>;
  searchParams?: Promise<any>;
}) => ReturnType<typeof SupplierDashboardPage>;

export default SupplierDashboardPage as unknown as NextAppPage;
