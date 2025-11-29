import Link from "next/link";
import PortalCard from "../../PortalCard";
import { PortalLoginPanel } from "../../PortalLoginPanel";
import { WorkspaceWelcomeBanner } from "../../WorkspaceWelcomeBanner";
import { SystemStatusBar } from "../../SystemStatusBar";
import { EmptyStateNotice } from "../../EmptyStateNotice";
import { primaryCtaClasses } from "@/lib/ctas";
import { normalizeEmailInput } from "@/app/(portals)/quotes/pageUtils";
import { getServerAuthUser } from "@/server/auth";
import { resolveUserRoles } from "@/server/users/roles";
import { loadSupplierProfile } from "@/server/suppliers";
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
      <PortalCard
        title="Supplier workspace required"
        description="This view is reserved for supplier accounts."
      >
        <p className="text-sm text-slate-400">
          Switch to the customer portal or contact support if you need supplier access.
        </p>
        <div className="mt-4 flex gap-3">
          <Link
            href="/customer"
            className="rounded-full border border-slate-800 px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-100 hover:border-slate-600"
          >
            Go to customer portal
          </Link>
        </div>
      </PortalCard>
    );
  }

  const supplierEmail = normalizeEmailInput(user.email ?? null);
  if (!supplierEmail) {
    return (
      <PortalCard
        title="Sign in with a supplier email"
        description="We couldn’t determine which supplier account to load."
      >
        <p className="text-sm text-slate-400">
          Sign out and back in with the verified email tied to your supplier workspace.
        </p>
      </PortalCard>
    );
  }

  const profile = await loadSupplierProfile(supplierEmail);
  if (!profile?.supplier) {
    return (
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
          Share capabilities, certifications, and documents so we know where to route RFQs.
        </p>
      </PortalCard>
    );
  }

  const decisions = await getSupplierDecisionQueue({
    supplierId: profile.supplier.id,
    supplierEmail: profile.supplier.primary_email ?? supplierEmail,
    limit: 12,
  });

  const hasDecisions = decisions.length > 0;
  const companyName =
    sanitizeDisplayName(profile.supplier.company_name) ??
    sanitizeDisplayName(user.user_metadata?.company as string | null) ??
    sanitizeDisplayName(user.user_metadata?.full_name as string | null) ??
    "your shop";
  const statusMessage = hasDecisions
    ? "Action needed on matched RFQs"
    : "You’re caught up";
  const lastSyncedLabel =
    formatRelativeTimeFromTimestamp(Date.now()) ?? "Just now";

  return (
    <div className="space-y-6">
      <WorkspaceWelcomeBanner role="supplier" companyName={companyName} />
      <SystemStatusBar
        role="supplier"
        statusMessage={statusMessage}
        syncedLabel={lastSyncedLabel}
      />
      <PortalCard
        title="Decisions queue"
        description="Every RFQ that needs pricing or a quick follow-up."
      >
        {hasDecisions ? (
          <DecisionList decisions={decisions} />
        ) : (
          <EmptyStateNotice
            title="No decisions pending"
            description="We’ll surface new RFQ invites and bid follow-ups the moment they exist."
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
              <span className="font-semibold text-white">RFQ invites</span> appear when a buyer assigns
              your shop but hasn’t seen a bid yet.
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
              Clearing the queue keeps your shop top of mind when new RFQs route through Zartman.
            </p>
          </li>
        </ul>
      </PortalCard>
    </div>
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
        const bidStatusLabel =
          typeof decision.metadata?.bidStatus === "string"
            ? decision.metadata.bidStatus
            : null;

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
              <span className="inline-flex items-center rounded-full border border-slate-800 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-300">
                {decision.type === "bid_follow_up" ? "Follow-up" : "RFQ invite"}
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
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
