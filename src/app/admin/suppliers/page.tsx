import clsx from "clsx";
import Link from "next/link";
import AdminDashboardShell from "@/app/admin/AdminDashboardShell";
import AdminTableShell, { adminTableCellClass } from "@/app/admin/AdminTableShell";
import { requireAdminUser } from "@/server/auth";
import { normalizeSearchParams } from "@/lib/route/normalizeSearchParams";
import {
  loadAdminSuppliersDirectory,
  type AdminSupplierDirectoryRow,
} from "@/server/admin/suppliersDirectory";
import { formatRelativeTimeFromTimestamp, toTimestamp } from "@/lib/relativeTime";

export const dynamic = "force-dynamic";

type StatusFilter = "all" | "active" | "paused" | "pending";

function parseStatusFilter(value: unknown): StatusFilter {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (
    normalized === "all" ||
    normalized === "active" ||
    normalized === "paused" ||
    normalized === "pending"
  ) {
    return normalized;
  }
  return "all";
}

function formatStatusLabel(value: AdminSupplierDirectoryRow["status"]): string {
  switch (value) {
    case "paused":
      return "Paused";
    case "pending":
      return "Pending";
    case "active":
      return "Active";
    default:
      return "Active";
  }
}

function statusPillClasses(value: AdminSupplierDirectoryRow["status"]): string {
  switch (value) {
    case "paused":
      return "border-amber-500/40 bg-amber-500/10 text-amber-100";
    case "pending":
      return "border-blue-500/40 bg-blue-500/10 text-blue-100";
    case "active":
      return "border-emerald-500/40 bg-emerald-500/10 text-emerald-100";
    default:
      return "border-emerald-500/40 bg-emerald-500/10 text-emerald-100";
  }
}

function matchHealthLabel(row: AdminSupplierDirectoryRow): "healthy" | "at_risk" | "unknown" {
  if (typeof row.mismatchCount !== "number" || !Number.isFinite(row.mismatchCount)) return "unknown";
  return row.mismatchCount > 0 ? "at_risk" : "healthy";
}

function matchHealthPill(value: ReturnType<typeof matchHealthLabel>): { label: string; className: string } {
  switch (value) {
    case "healthy":
      return { label: "Healthy", className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-100" };
    case "at_risk":
      return { label: "At risk", className: "border-red-500/40 bg-red-500/10 text-red-100" };
    default:
      return { label: "—", className: "border-slate-800 bg-slate-950/60 text-slate-200" };
  }
}

function formatLastActivity(value: string | null): string {
  if (!value) return "—";
  const relative = formatRelativeTimeFromTimestamp(toTimestamp(value));
  return relative ?? "—";
}

export default async function AdminSuppliersDirectoryPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdminUser({ redirectTo: "/login" });

  const usp = normalizeSearchParams(searchParams ? await searchParams : undefined);
  const q = usp.get("q") ?? "";
  const status = parseStatusFilter(usp.get("status"));
  const cap = usp.get("cap") ?? "";

  const rows = await loadAdminSuppliersDirectory({
    q: q || null,
    status,
    cap: cap || null,
    limit: 50,
  });

  const isEmpty = rows.length === 0;

  return (
    <AdminDashboardShell
      title="Suppliers"
      description="Discover and manage your supplier bench."
      actions={
        <div className="flex flex-col gap-2">
          <Link
            href="/admin/suppliers/bench-health"
            className="text-sm font-semibold text-emerald-200 hover:text-emerald-100"
          >
            Bench health →
          </Link>
        </div>
      }
    >
      <section className="rounded-2xl border border-slate-900/60 bg-slate-950/30 px-6 py-5">
        <form method="GET" action="/admin/suppliers" className="flex flex-col gap-3 lg:flex-row lg:items-end">
          <label className="flex flex-col gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Search
            </span>
            <input
              name="q"
              defaultValue={q}
              placeholder="Search suppliers..."
              className="w-full min-w-64 rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-emerald-400 focus:outline-none"
            />
          </label>

          <label className="flex flex-col gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Status
            </span>
            <select
              name="status"
              defaultValue={status}
              className="w-full min-w-48 rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white focus:border-emerald-400 focus:outline-none"
            >
              <option value="all">All</option>
              <option value="active">Active</option>
              <option value="paused">Paused</option>
              <option value="pending">Pending</option>
            </select>
          </label>

          <label className="flex flex-col gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Capability
            </span>
            <input
              name="cap"
              defaultValue={cap}
              placeholder="e.g. CNC"
              className="w-full min-w-56 rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-emerald-400 focus:outline-none"
            />
          </label>

          <button
            type="submit"
            className="rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-emerald-950 hover:bg-emerald-400"
          >
            Apply
          </button>
        </form>
      </section>

      <AdminTableShell
        className="mt-5"
        head={
          <tr>
            <th className="px-5 py-4">Supplier</th>
            <th className="px-5 py-4">Location</th>
            <th className="px-5 py-4">Capabilities</th>
            <th className="px-5 py-4">Last activity</th>
            <th className="px-5 py-4">Match health</th>
          </tr>
        }
        body={
          isEmpty ? (
            <tr>
              <td colSpan={5} className="px-6 py-12 text-center text-base text-slate-300">
                <p className="font-medium text-slate-100">No suppliers found</p>
                <p className="mt-2 text-sm text-slate-400">
                  Try clearing filters to see the full supplier list.
                </p>
              </td>
            </tr>
          ) : (
            rows.map((row) => {
              const health = matchHealthPill(matchHealthLabel(row));
              return (
                <tr key={row.supplierId} className="bg-slate-950/40 transition hover:bg-slate-900/40">
                  <td className={clsx(adminTableCellClass, "px-5 py-4")}>
                    <div className="space-y-2">
                      <Link
                        href={`/admin/suppliers/${row.supplierId}`}
                        className="text-sm font-semibold text-emerald-100 hover:text-emerald-300"
                      >
                        {row.supplierName}
                      </Link>
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={clsx(
                            "inline-flex rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-wide",
                            statusPillClasses(row.status),
                          )}
                        >
                          {formatStatusLabel(row.status)}
                        </span>
                        <span className="font-mono text-[11px] text-slate-500">{row.supplierId}</span>
                      </div>
                    </div>
                  </td>
                  <td className={clsx(adminTableCellClass, "px-5 py-4 text-slate-200")}>
                    {row.location ?? "—"}
                  </td>
                  <td className={clsx(adminTableCellClass, "px-5 py-4 text-slate-200")}>
                    {row.capabilitySummary ?? "—"}
                  </td>
                  <td className={clsx(adminTableCellClass, "px-5 py-4 text-slate-400")}>
                    {formatLastActivity(row.lastActivityAt)}
                  </td>
                  <td className={clsx(adminTableCellClass, "px-5 py-4")}>
                    <span
                      className={clsx(
                        "inline-flex rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-wide",
                        health.className,
                      )}
                      title={
                        typeof row.mismatchCount === "number"
                          ? `${row.mismatchCount} mismatches`
                          : "Match health unavailable"
                      }
                    >
                      {health.label}
                    </span>
                  </td>
                </tr>
              );
            })
          )
        }
      />
    </AdminDashboardShell>
  );
}

