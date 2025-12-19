import clsx from "clsx";
import Link from "next/link";
import type { ReactNode } from "react";
import AdminDashboardShell from "@/app/admin/AdminDashboardShell";
import { requireAdminUser } from "@/server/auth";
import { loadAdminOverview } from "@/server/admin/overview";
import type { SystemHealthStatus } from "@/server/admin/systemHealth";
import { refreshNotificationsForUser } from "@/server/notifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function AdminOverviewPage() {
  const admin = await requireAdminUser();
  void refreshNotificationsForUser(admin.id, "admin").catch((error) => {
    console.error("[notifications] refresh failed (admin)", { userId: admin.id, error });
  });
  const summary = await loadAdminOverview();

  return (
    <AdminDashboardShell
      title="Overview"
      description="Today’s RFQs, messages, kickoff, and supplier bench health at a glance."
    >
      <div className="grid gap-4 lg:grid-cols-12">
        <Card className="lg:col-span-6">
          <CardHeader title="Pipeline" ctaHref="/admin/quotes" ctaLabel="View all quotes" />
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Metric label="Total RFQs" value={summary.pipeline.totalQuotes} />
            <Metric label="Open RFQs" value={summary.pipeline.openQuotes} />
            <Metric label="Needs decision" value={summary.pipeline.needsDecisionQuotes} />
            <Metric label="Awarded" value={summary.pipeline.awardedQuotes} />
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
            <TextLink href="/admin/quotes?hasBids=1">Needs decision</TextLink>
            <span className="text-slate-700">·</span>
            <TextLink href="/admin/quotes?view=needs_attention">Needs attention</TextLink>
            <span className="text-slate-700">·</span>
            <TextLink href="/admin/analytics?range=30d">View full analytics</TextLink>
          </div>
        </Card>

        <Card className="lg:col-span-6">
          <CardHeader title="Messages & SLA" ctaHref="/admin/messages" ctaLabel="Open messages" />
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Metric label="Threads needing reply" value={summary.messaging.threadsNeedingReply} />
            <Metric label="Total unread" value={summary.messaging.totalUnread} />
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            <MiniStat label="Customer" value={summary.messaging.customerNeedingReply} />
            <MiniStat label="Supplier" value={summary.messaging.supplierNeedingReply} />
            <MiniStat label="Admin" value={summary.messaging.adminNeedingReply} />
          </div>
        </Card>

        <Card className="lg:col-span-4">
          <CardHeader
            title="Kickoff"
            ctaHref="/admin/quotes?awarded=1"
            ctaLabel="View awarded RFQs"
          />
          <div className="mt-4 grid gap-3">
            <Metric label="Not started" value={summary.kickoff.kickoffNotStarted} />
            <Metric label="In progress" value={summary.kickoff.kickoffInProgress} />
            <Metric label="Complete" value={summary.kickoff.kickoffComplete} />
          </div>
        </Card>

        <Card className="lg:col-span-4">
          <CardHeader
            title="Parts coverage"
            ctaHref="/admin/quotes?partsCoverage=needs_attention"
            ctaLabel="Review needs attention"
          />
          <div className="mt-4 grid gap-3">
            <Metric label="RFQs with parts" value={summary.partsCoverage.withParts} />
            <Metric label="Good coverage" value={summary.partsCoverage.goodCoverage} />
            <Metric label="Needs attention" value={summary.partsCoverage.needsAttention} />
          </div>
          <p className="mt-4 text-sm text-slate-400">
            Parts with incomplete CAD/drawings may need follow-up before award.
          </p>
        </Card>

        <Card className="lg:col-span-4">
          <CardHeader
            title="Bench health"
            ctaHref="/admin/suppliers/bench-health"
            ctaLabel="View bench health"
          />

          <div className="mt-4">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Match health
            </p>
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              <MiniStat label="Good" value={summary.benchHealth.good} />
              <MiniStat label="Caution" value={summary.benchHealth.caution} />
              <MiniStat label="Poor" value={summary.benchHealth.poor} />
            </div>
          </div>

          <div className="mt-5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Utilization
            </p>
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              <MiniStat label="Underused" value={summary.benchHealth.underused} />
              <MiniStat label="Balanced" value={summary.benchHealth.balanced} />
              <MiniStat label="Overused" value={summary.benchHealth.overused} />
            </div>
          </div>

          <div className="mt-4 text-sm">
            <TextLink href="/admin/analytics?range=90d">View full analytics</TextLink>
          </div>
        </Card>

        <Card className="lg:col-span-12">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-slate-100">System health</h2>
                <SystemHealthPill status={summary.systemHealth.status} />
              </div>
              <p className="mt-1 text-sm text-slate-400">
                OK / Degraded / Error from the same checks used on Activity.
              </p>
            </div>
            <Link
              href="/admin/system-health"
              className="inline-flex items-center justify-center rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2 text-sm font-semibold text-slate-100 transition hover:border-slate-700 hover:bg-slate-900/30"
            >
              System health details
            </Link>
          </div>
        </Card>
      </div>
    </AdminDashboardShell>
  );
}

function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <section
      className={clsx(
        "rounded-2xl border border-slate-900 bg-slate-950/40 px-6 py-4",
        className,
      )}
    >
      {children}
    </section>
  );
}

function CardHeader({
  title,
  ctaHref,
  ctaLabel,
}: {
  title: string;
  ctaHref: string;
  ctaLabel: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h2 className="text-sm font-semibold text-slate-100">{title}</h2>
      <TextLink href={ctaHref}>{ctaLabel}</TextLink>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-slate-900/70 bg-black/30 px-4 py-3">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold text-slate-100 tabular-nums">
        {Number.isFinite(value) ? value : 0}
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-slate-900/70 bg-black/30 px-4 py-2.5">
      <div className="text-xs font-semibold text-slate-300">{label}</div>
      <div className="text-sm font-semibold text-slate-100 tabular-nums">
        {Number.isFinite(value) ? value : 0}
      </div>
    </div>
  );
}

function TextLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="text-sm font-semibold text-emerald-200 underline-offset-4 hover:text-emerald-100 hover:underline"
    >
      {children}
    </Link>
  );
}

function SystemHealthPill({ status }: { status: SystemHealthStatus }) {
  const pillClass =
    status === "ok"
      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-100"
      : status === "degraded"
        ? "border-amber-500/30 bg-amber-500/10 text-amber-100"
        : "border-rose-500/30 bg-rose-500/10 text-rose-100";

  const label = status === "ok" ? "ok" : status === "degraded" ? "degraded" : "error";

  return (
    <span
      className={clsx(
        "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold",
        pillClass,
      )}
    >
      {label}
    </span>
  );
}

