import Link from "next/link";
import AdminDashboardShell from "@/app/admin/AdminDashboardShell";
import { requireAdminUser } from "@/server/auth";
import { loadAdminSupplierDetail } from "@/server/admin/supplierDetail";
import { loadBenchHealthForSupplier, type SupplierBenchHealth } from "@/server/admin/benchHealth";
import { formatRelativeTimeFromTimestamp, toTimestamp } from "@/lib/relativeTime";

export const dynamic = "force-dynamic";

function formatHealthLabel(value: SupplierBenchHealth["health"]): string {
  switch (value) {
    case "healthy":
      return "Healthy";
    case "at_risk":
      return "At risk";
    case "unresponsive":
      return "Unresponsive";
    default:
      return "Healthy";
  }
}

function healthPillClasses(value: SupplierBenchHealth["health"]): string {
  switch (value) {
    case "healthy":
      return "border-emerald-500/40 bg-emerald-500/10 text-emerald-100";
    case "at_risk":
      return "border-amber-500/40 bg-amber-500/10 text-amber-100";
    case "unresponsive":
      return "border-red-500/40 bg-red-500/10 text-red-100";
    default:
      return "border-slate-800 bg-slate-950/60 text-slate-200";
  }
}

function formatRelative(value: string | null): string {
  if (!value) return "—";
  const relative = formatRelativeTimeFromTimestamp(toTimestamp(value));
  return relative ?? "—";
}

function buildQuotesDrilldownHref(args: {
  supplierId: string;
  msg: "needs_reply" | "overdue";
}): string {
  const params = new URLSearchParams();
  params.set("msg", args.msg);
  params.set("supplierId", args.supplierId);
  return `/admin/quotes?${params.toString()}`;
}

export default async function AdminSupplierDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdminUser({ redirectTo: "/login" });

  const { id } = await params;
  const [detail, benchHealth] = await Promise.all([
    loadAdminSupplierDetail({ supplierId: id }),
    loadBenchHealthForSupplier(id),
  ]);

  if (!detail) {
    return (
      <AdminDashboardShell
        title="Supplier not found"
        description="This supplier may have been removed or is unavailable."
        actions={
          <Link
            href="/admin/suppliers"
            className="text-sm font-semibold text-emerald-200 hover:text-emerald-100"
          >
            ← Back to suppliers
          </Link>
        }
      >
        <div className="rounded-2xl border border-slate-900/60 bg-slate-950/30 p-6 text-slate-300">
          No supplier record was returned for this id.
        </div>
      </AdminDashboardShell>
    );
  }

  const mismatchCount = detail.mismatchSummary?.mismatchCount ?? null;
  const lastMismatchAt = detail.mismatchSummary?.lastMismatchAt ?? null;

  const health = benchHealth?.health ?? "healthy";
  const reasons = Array.isArray(benchHealth?.reasons) ? benchHealth.reasons : [];
  const overdueThreadCount =
    benchHealth?.healthBreakdown?.overdueThreadCount ?? benchHealth?.overdueThreadCount ?? 0;
  const needsReplyThreadCount = benchHealth?.healthBreakdown?.needsReplyThreadCount ?? 0;

  return (
    <AdminDashboardShell
      title={detail.supplierName}
      description={detail.location ? `${detail.location} · ${detail.supplierId}` : detail.supplierId}
      actions={
        <Link
          href="/admin/suppliers"
          className="text-sm font-semibold text-emerald-200 hover:text-emerald-100"
        >
          ← Back to suppliers
        </Link>
      }
    >
      <section className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-5">
          <div className="rounded-2xl border border-slate-900/60 bg-slate-950/30 p-6">
            <h2 className="text-base font-semibold text-white">Capabilities</h2>
            {detail.capabilities ? (
              <div className="mt-4 space-y-3 text-sm text-slate-200">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Processes
                  </p>
                  <p className="mt-1">
                    {detail.capabilities.processes.length > 0
                      ? detail.capabilities.processes.join(", ")
                      : "—"}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Materials
                  </p>
                  <p className="mt-1">
                    {detail.capabilities.materials.length > 0
                      ? detail.capabilities.materials.join(", ")
                      : "—"}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Certifications
                  </p>
                  <p className="mt-1">
                    {detail.capabilities.certifications.length > 0
                      ? detail.capabilities.certifications.join(", ")
                      : "—"}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Notes
                  </p>
                  <p className="mt-1">{detail.capabilities.notes ?? "—"}</p>
                </div>
              </div>
            ) : (
              <p className="mt-3 text-sm text-slate-400">—</p>
            )}
          </div>

          <div className="rounded-2xl border border-slate-900/60 bg-slate-950/30 p-6">
            <h2 className="text-base font-semibold text-white">Recent activity</h2>
            {detail.recentActivity.length === 0 ? (
              <p className="mt-3 text-sm text-slate-400">—</p>
            ) : (
              <ul className="mt-4 space-y-3">
                {detail.recentActivity.map((event) => (
                  <li
                    key={event.bidId}
                    className="rounded-xl border border-slate-900/60 bg-slate-950/40 px-4 py-3"
                  >
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        {event.quoteId ? (
                          <Link
                            href={`/admin/quotes/${event.quoteId}`}
                            className="truncate text-sm font-semibold text-emerald-100 hover:text-emerald-300"
                          >
                            {event.quoteTitle ?? event.quoteId}
                          </Link>
                        ) : (
                          <p className="truncate text-sm font-semibold text-slate-200">
                            Quote —
                          </p>
                        )}
                        <p className="mt-1 text-xs text-slate-400">
                          Status: {event.status ?? "—"}
                        </p>
                      </div>
                      <div className="text-xs text-slate-400">
                        {formatRelative(event.updatedAt ?? event.createdAt)}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <aside className="space-y-5">
          <div className="rounded-2xl border border-slate-900/60 bg-slate-950/30 p-6">
            <h2 className="text-base font-semibold text-white">Bench health</h2>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <span
                className={[
                  "inline-flex rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-wide",
                  healthPillClasses(health),
                ].join(" ")}
              >
                {formatHealthLabel(health)}
              </span>

              {reasons.length > 0 ? (
                <div className="flex flex-wrap items-center gap-2">
                  {reasons.slice(0, 4).map((reason) => (
                    <span
                      key={reason}
                      className="inline-flex rounded-full border border-slate-800 bg-slate-950/60 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-200"
                    >
                      {reason}
                    </span>
                  ))}
                </div>
              ) : (
                <span className="text-xs text-slate-500">—</span>
              )}
            </div>

            <div className="mt-5 grid grid-cols-2 gap-4 text-sm text-slate-200">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Overdue threads
                </p>
                <p className="mt-1 tabular-nums text-slate-100">
                  {overdueThreadCount.toLocaleString()}
                </p>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Needs reply threads
                </p>
                <p className="mt-1 tabular-nums text-slate-100">
                  {needsReplyThreadCount.toLocaleString()}
                </p>
              </div>
            </div>

            <div className="mt-5 flex flex-wrap gap-3">
              <Link
                href={buildQuotesDrilldownHref({ supplierId: detail.supplierId, msg: "overdue" })}
                className="inline-flex items-center justify-center rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-2 text-sm font-semibold text-slate-100 transition hover:border-emerald-500/40 hover:text-emerald-200"
              >
                View overdue quotes
              </Link>
              <Link
                href={buildQuotesDrilldownHref({
                  supplierId: detail.supplierId,
                  msg: "needs_reply",
                })}
                className="inline-flex items-center justify-center rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-2 text-sm font-semibold text-slate-100 transition hover:border-emerald-500/40 hover:text-emerald-200"
              >
                View needs reply
              </Link>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-900/60 bg-slate-950/30 p-6">
            <h2 className="text-base font-semibold text-white">Match health</h2>
            <div className="mt-4 space-y-2 text-sm text-slate-200">
              <p>
                <span className="text-slate-400">Capability mismatches:</span>{" "}
                {typeof mismatchCount === "number" ? mismatchCount : "—"}
              </p>
              <p>
                <span className="text-slate-400">Last mismatch:</span> {formatRelative(lastMismatchAt)}
              </p>
            </div>
            <p className="mt-4 text-xs text-slate-500">
              This card only populates if mismatch logs are available in the database.
            </p>
          </div>

          <div className="rounded-2xl border border-slate-900/60 bg-slate-950/30 p-6">
            <h2 className="text-base font-semibold text-white">Supplier</h2>
            <div className="mt-4 space-y-2 text-sm text-slate-200">
              <p>
                <span className="text-slate-400">Email:</span> {detail.primaryEmail ?? "—"}
              </p>
              <p>
                <span className="text-slate-400">Joined:</span> {formatRelative(detail.createdAt)}
              </p>
            </div>
          </div>
        </aside>
      </section>
    </AdminDashboardShell>
  );
}

