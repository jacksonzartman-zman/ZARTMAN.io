import Link from "next/link";
import PortalCard from "../../PortalCard";
import { PortalLoginPanel } from "../../PortalLoginPanel";
import { WorkspaceWelcomeBanner } from "../../WorkspaceWelcomeBanner";
import { SystemStatusBar } from "../../SystemStatusBar";
import { EmptyStateNotice } from "../../EmptyStateNotice";
import { PortalShell } from "../../components/PortalShell";
import { primaryCtaClasses } from "@/lib/ctas";
import { normalizeEmailInput } from "@/app/(portals)/quotes/pageUtils";
import { getServerAuthUser } from "@/server/auth";
import { resolveUserRoles } from "@/server/users/roles";
import { loadSupplierProfileByUserId } from "@/server/suppliers";
import {
  getSupplierDecisionQueue,
  type SupplierDecision,
} from "@/server/rfqs/decisions";
import { formatRelativeTimeFromTimestamp } from "@/lib/relativeTime";

export const dynamic = "force-dynamic";

export default async function SupplierDecisionsPage() {
  const { user } = await getServerAuthUser();

  if (!user) {
    return (
      <PortalLoginPanel
        role="supplier"
        fallbackRedirect="/supplier/decisions"
      />
    );
  }

  const roles = await resolveUserRoles(user.id);
  if (!roles?.isSupplier) {
    return (
      <PortalShell
        workspace="supplier"
        title="Decisions"
        subtitle="Actions that keep search requests moving."
      >
        <EmptyStateNotice
          title="Supplier workspace required"
          description="Switch to the customer portal or contact support if you need supplier access."
          action={
            <Link
              href="/customer"
              className="text-sm font-semibold text-blue-200 underline-offset-4 hover:underline"
            >
              Go to customer portal
            </Link>
          }
        />
      </PortalShell>
    );
  }

  const supplierEmail = normalizeEmailInput(user.email ?? null);
  if (!supplierEmail) {
    return (
      <PortalShell
        workspace="supplier"
        title="Decisions"
        subtitle="Actions that keep search requests moving."
      >
        <PortalCard
          title="Sign in with a supplier email"
          description="We couldn’t determine which supplier account to load."
          className="border-slate-900/45 bg-slate-950/30 shadow-none hover:border-slate-900/55 hover:bg-slate-950/35 hover:shadow-none"
        >
          <p className="text-sm text-slate-400">
            Sign out and back in with the verified email tied to your supplier workspace.
          </p>
        </PortalCard>
      </PortalShell>
    );
  }

  const profile = await loadSupplierProfileByUserId(user.id);
  if (!profile?.supplier) {
    return (
      <PortalShell
        workspace="supplier"
        title="Decisions"
        subtitle="Actions that keep search requests moving."
      >
        <PortalCard
          title="Finish supplier onboarding"
          description="Decisions unlock once we have your shop profile on file."
          action={
            <Link href="/supplier/onboarding" className={primaryCtaClasses}>
              Complete onboarding
            </Link>
          }
        >
          <p className="text-sm text-slate-400">
            Share capabilities, certifications, and documents so we know where to route search
            requests.
          </p>
        </PortalCard>
      </PortalShell>
    );
  }

  const decisions = await getSupplierDecisionQueue({
    supplierId: profile.supplier.id,
    supplierEmail: profile.supplier.primary_email ?? supplierEmail,
    limit: 12,
  });

  const winDecisions = decisions.filter((decision) => decision.type === "win");
  const lossDecisions = decisions.filter(
    (decision) => decision.type === "loss",
  );
  const attentionDecisions = decisions.filter(
    (decision) =>
      decision.type === "rfq_invite" || decision.type === "bid_follow_up",
  );
  const hasDecisions = decisions.length > 0;
  const decisionCallout = deriveDecisionCallout({
    total: decisions.length,
    wins: winDecisions.length,
    losses: lossDecisions.length,
    pending: attentionDecisions.length,
  });
  const companyName =
    sanitizeDisplayName(profile.supplier.company_name) ??
    sanitizeDisplayName(user.user_metadata?.company as string | null) ??
    sanitizeDisplayName(user.user_metadata?.full_name as string | null) ??
    "your shop";
  const statusMessage =
    attentionDecisions.length > 0
      ? "Action needed on matched search requests"
      : winDecisions.length > 0
        ? "Kickoff awarded work"
        : lossDecisions.length > 0
          ? "Review feedback and keep quoting"
          : "You’re caught up";
  const lastSyncedLabel =
    formatRelativeTimeFromTimestamp(Date.now()) ?? "Just now";

  return (
    <PortalShell
      workspace="supplier"
      title="Decisions"
      subtitle="Actions that keep search requests moving."
      headerContent={
        <div className="space-y-4">
          <WorkspaceWelcomeBanner role="supplier" companyName={companyName} />
          <SystemStatusBar
            role="supplier"
            statusMessage={statusMessage}
            syncedLabel={lastSyncedLabel}
          />
        </div>
      }
      actions={
        <Link
          href="/supplier"
          className="inline-flex items-center rounded-full border border-blue-400/40 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-blue-100 transition hover:border-blue-300 hover:text-white"
        >
          Back to dashboard
        </Link>
      }
    >
      <PortalCard
        title="Decisions queue"
        description="Every search request that needs pricing or a quick follow-up."
      >
        {hasDecisions ? (
          <div className="space-y-6">
            {decisionCallout ? (
              <DecisionCallout title={decisionCallout.title} description={decisionCallout.description} />
            ) : null}
            {winDecisions.length > 0 ? (
              <DecisionSection
                title="Awarded to you"
                subtitle="Kickoff next steps and keep projects moving."
                decisions={winDecisions}
              />
            ) : null}
            {lossDecisions.length > 0 ? (
              <DecisionSection
                title="Not selected this round"
                subtitle="Review feedback and stay ready for the next invite."
                decisions={lossDecisions}
              />
            ) : null}
            {attentionDecisions.length > 0 ? (
              <DecisionSection
                title="Needs attention"
                subtitle="Share pricing or refresh stale bids."
                decisions={attentionDecisions}
              />
            ) : null}
          </div>
        ) : (
          <EmptyStateNotice
            title="No decisions right now"
            description="Invites, follow-ups, and awards will show up here as soon as they’re ready."
          />
        )}
      </PortalCard>
      <PortalCard
        title="Stay in the rotation"
        description="A quick reminder on how the queue works."
      >
        <ul className="space-y-3 text-sm text-slate-300">
          <li className="flex gap-2">
            <span className="text-slate-500">•</span>
            <p>
              <span className="font-semibold text-white">Search request invites</span> appear when a
              buyer assigns your shop but hasn’t seen a bid yet.
            </p>
          </li>
          <li className="flex gap-2">
            <span className="text-slate-500">•</span>
            <p>
              <span className="font-semibold text-white">Bid follow-ups</span> nudge you when a pending
              proposal is older than a few days.
            </p>
          </li>
          <li className="flex gap-2">
            <span className="text-slate-500">•</span>
            <p>
              Clearing the queue keeps your shop top of mind when new search requests route through
              Zartman.
            </p>
          </li>
        </ul>
      </PortalCard>
    </PortalShell>
  );
}

function DecisionList({ decisions }: { decisions: SupplierDecision[] }) {
  return (
    <ul className="space-y-3">
      {decisions.map((decision) => {
        const assignmentLabel =
          typeof decision.metadata?.assignment === "string"
            ? decision.metadata.assignment
            : null;
        const bidStatusLabel = formatDecisionBidStatus(
          typeof decision.metadata?.bidStatus === "string"
            ? decision.metadata.bidStatus
            : null,
        );
        const badgeMeta =
          DECISION_BADGE_META[decision.type] ?? DECISION_BADGE_META.rfq_invite;

        return (
          <li
            key={decision.id}
            className="rounded-2xl border border-slate-900/70 bg-slate-950/40 p-4"
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-white">{decision.title}</p>
                <p className="mt-1 text-xs text-slate-400">{decision.description}</p>
                {assignmentLabel ? (
                  <p className="mt-2 text-[11px] text-slate-500">Routed to {assignmentLabel}</p>
                ) : null}
                {bidStatusLabel ? (
                  <p className="mt-1 text-[11px] text-slate-500">Bid status: {bidStatusLabel}</p>
                ) : null}
              </div>
              <UrgencyBadge level={decision.urgencyLevel} />
            </div>
            <div className="mt-4 flex flex-wrap gap-3">
              <Link href={decision.href} className={primaryCtaClasses}>
                {decision.ctaLabel}
              </Link>
              <span
                className={`inline-flex items-center rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-wide ${badgeMeta.className}`}
              >
                {badgeMeta.label}
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function DecisionSection({
  title,
  subtitle,
  decisions,
}: {
  title: string;
  subtitle?: string;
  decisions: SupplierDecision[];
}) {
  if (decisions.length === 0) {
    return null;
  }
  return (
    <section className="space-y-3">
      <div>
        <p className="text-sm font-semibold text-white">{title}</p>
        {subtitle ? (
          <p className="text-xs text-slate-400">{subtitle}</p>
        ) : null}
      </div>
      <DecisionList decisions={decisions} />
    </section>
  );
}

function DecisionCallout({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-900/70 bg-slate-950/40 p-4">
      <p className="text-sm font-semibold text-white">{title}</p>
      <p className="mt-1 text-xs text-slate-400">{description}</p>
    </div>
  );
}

const DECISION_BADGE_META: Record<
  SupplierDecision["type"],
  { label: string; className: string }
> = {
  rfq_invite: {
    label: "Invite",
    className: "border-slate-800 text-slate-300",
  },
  bid_follow_up: {
    label: "Follow-up",
    className: "border-blue-500/40 bg-blue-500/10 text-blue-100",
  },
  win: {
    label: "Awarded",
    className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-100",
  },
  loss: {
    label: "Not selected",
    className: "border-amber-500/40 bg-amber-500/10 text-amber-100",
  },
};

function deriveDecisionCallout(args: {
  total: number;
  wins: number;
  losses: number;
  pending: number;
}): { title: string; description: string } | null {
  if (args.total === 0) {
    return null;
  }
  if (args.pending > 0 && args.wins === 0 && args.losses === 0) {
    return {
      title: "Bids submitted—waiting on buyer decisions",
      description:
        "We’ll notify you the moment a customer awards work or needs more info.",
    };
  }
  if (args.wins === 0 && args.losses > 0) {
    return {
      title: "Bids decided but none won yet",
      description:
        "Study pricing trends and keep quoting—momentum returns when you stay responsive.",
    };
  }
  return null;
}

function formatDecisionBidStatus(status: string | null): string | null {
  if (!status) {
    return null;
  }
  const trimmed = status.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

function UrgencyBadge({
  level,
}: {
  level: SupplierDecision["urgencyLevel"];
}) {
  const map: Record<SupplierDecision["urgencyLevel"], string> = {
    high: "bg-red-500/10 text-red-200 border-red-500/30",
    medium: "bg-yellow-400/10 text-yellow-100 border-yellow-400/30",
    low: "bg-blue-500/10 text-blue-200 border-blue-500/30",
  };
  return (
    <span
      className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wide ${map[level]}`}
    >
      {level === "high" ? "High priority" : level === "medium" ? "Medium priority" : "Low priority"}
    </span>
  );
}

function sanitizeDisplayName(value?: string | null): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
