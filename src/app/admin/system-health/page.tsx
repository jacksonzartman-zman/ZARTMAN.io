import clsx from "clsx";
import Link from "next/link";
import AdminDashboardShell from "@/app/admin/AdminDashboardShell";
import TryAgainButton from "@/app/admin/system-health/TryAgainButton";
import {
  loadSystemHealth,
  type HealthCheckResult,
  type SystemHealthStatus,
} from "@/server/admin/systemHealth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function statusSummary(status: SystemHealthStatus): string {
  if (status === "ok") return "All systems nominal";
  if (status === "degraded") return "Some signals are degraded";
  return "Issues detected";
}

function pillClass(status: SystemHealthStatus): string {
  if (status === "ok") {
    return "border-emerald-500/30 bg-emerald-500/10 text-emerald-100";
  }
  if (status === "degraded") {
    return "border-amber-500/30 bg-amber-500/10 text-amber-100";
  }
  return "border-rose-500/30 bg-rose-500/10 text-rose-100";
}

function statusLabel(status: SystemHealthStatus): string {
  if (status === "ok") return "ok";
  if (status === "degraded") return "degraded";
  return "error";
}

function renderDetails(check: HealthCheckResult): string {
  return (check.details ?? "").trim() || "—";
}

export default async function AdminSystemHealthPage() {
  try {
    const summary = await loadSystemHealth();

    return (
      <AdminDashboardShell
        eyebrow="Admin"
        title="System health"
        description={statusSummary(summary.status)}
        actions={
          <Link
            href="/admin/system-health"
            className="rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2 text-sm font-semibold text-slate-100 transition hover:border-slate-700 hover:bg-slate-900/30"
          >
            Refresh
          </Link>
        }
      >
        <section className="overflow-hidden rounded-2xl border border-slate-900 bg-slate-950/40">
          <div className="grid grid-cols-[minmax(0,1.2fr)_110px_minmax(0,1.5fr)_minmax(0,1.7fr)] gap-3 border-b border-slate-900/60 px-6 py-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            <div>Check</div>
            <div>Status</div>
            <div>Details</div>
            <div>Suggestion</div>
          </div>

          <div className="divide-y divide-slate-900/60">
            {summary.checks.map((check) => (
              <div
                key={check.id}
                className="grid grid-cols-[minmax(0,1.2fr)_110px_minmax(0,1.5fr)_minmax(0,1.7fr)] gap-3 px-6 py-4"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-100">
                    {check.label}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">{check.id}</p>
                </div>

                <div>
                  <span
                    className={clsx(
                      "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold",
                      pillClass(check.status),
                    )}
                  >
                    {statusLabel(check.status)}
                  </span>
                </div>

                <div className="text-sm text-slate-200">{renderDetails(check)}</div>

                <div className="text-sm text-slate-400">
                  {(check.suggestion ?? "").trim() || "—"}
                </div>
              </div>
            ))}
          </div>
        </section>
      </AdminDashboardShell>
    );
  } catch {
    return (
      <AdminDashboardShell
        eyebrow="Admin"
        title="System health"
        description="Unable to load system health right now."
        actions={<TryAgainButton />}
      >
        <div className="rounded-2xl border border-slate-900 bg-slate-950/40 p-6">
          <p className="text-sm text-slate-200">
            Unable to load system health right now.
          </p>
          <p className="mt-2 text-sm text-slate-400">
            Please try again in a moment.
          </p>
          <div className="mt-4">
            <TryAgainButton />
          </div>
        </div>
      </AdminDashboardShell>
    );
  }
}

