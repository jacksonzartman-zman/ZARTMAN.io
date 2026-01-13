import Link from "next/link";
import AdminDashboardShell from "@/app/admin/AdminDashboardShell";
import { requireAdminUser } from "@/server/auth";
import { loadAdminSupplierDetail } from "@/server/admin/supplierDetail";
import { formatRelativeTimeFromTimestamp, toTimestamp } from "@/lib/relativeTime";

export const dynamic = "force-dynamic";

function formatRelative(value: string | null): string {
  if (!value) return "—";
  const relative = formatRelativeTimeFromTimestamp(toTimestamp(value));
  return relative ?? "—";
}

export default async function AdminSupplierDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdminUser({ redirectTo: "/login" });

  const { id } = await params;
  const detail = await loadAdminSupplierDetail({ supplierId: id });

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

