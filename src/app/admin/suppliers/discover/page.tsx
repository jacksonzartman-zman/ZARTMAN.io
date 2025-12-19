import clsx from "clsx";
import AdminDashboardShell from "@/app/admin/AdminDashboardShell";
import AdminTableShell, { adminTableCellClass } from "@/app/admin/AdminTableShell";
import { requireAdminUser } from "@/server/auth";
import { normalizeSearchParams } from "@/lib/route/normalizeSearchParams";
import {
  loadAdminSupplierDiscovery,
  type AdminSupplierDiscoveryRow,
} from "@/server/admin/supplierDiscovery";

export const dynamic = "force-dynamic";

type FilterReputation =
  | "all"
  | "excellent"
  | "good"
  | "fair"
  | "limited"
  | "unknown";

function parseReputationFilter(value: unknown): FilterReputation {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (
    normalized === "excellent" ||
    normalized === "good" ||
    normalized === "fair" ||
    normalized === "limited" ||
    normalized === "unknown"
  ) {
    return normalized;
  }
  return "all";
}

function formatReputationLabel(value: AdminSupplierDiscoveryRow["reputationLabel"]): string {
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

function reputationPillClasses(value: AdminSupplierDiscoveryRow["reputationLabel"]): string {
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
      return "border-slate-800 bg-slate-950/60 text-slate-200";
  }
}

function formatWinRate(value: number | null): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return `${Math.round(value * 10) / 10}%`;
}

export default async function AdminSupplierDiscoveryPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdminUser({ redirectTo: "/login" });

  const usp = normalizeSearchParams(searchParams ? await searchParams : undefined);
  const reputationFilter = parseReputationFilter(usp.get("reputation"));

  const allRows = await loadAdminSupplierDiscovery();
  const filtered = allRows.filter((row) => {
    if (reputationFilter !== "all" && row.reputationLabel !== reputationFilter) {
      return false;
    }
    return true;
  });

  filtered.sort((a, b) => {
    const sa = typeof a.reputationScore === "number" ? a.reputationScore : -1;
    const sb = typeof b.reputationScore === "number" ? b.reputationScore : -1;
    if (sb !== sa) return sb - sa;
    return (a.supplierName ?? "").localeCompare(b.supplierName ?? "");
  });

  const isEmpty = filtered.length === 0;

  return (
    <AdminDashboardShell
      title="Supplier discovery"
      description="Browse suppliers and compare fit, utilization, and reputation."
    >
      <section className="rounded-2xl border border-slate-900/60 bg-slate-950/30 px-6 py-5">
        <form
          method="GET"
          action="/admin/suppliers/discover"
          className="flex flex-col gap-3 sm:flex-row sm:items-end"
        >
          <label className="flex flex-col gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Reputation
            </span>
            <select
              name="reputation"
              defaultValue={reputationFilter === "all" ? "" : reputationFilter}
              className="w-full min-w-56 rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white focus:border-emerald-400 focus:outline-none"
            >
              <option value="">All</option>
              <option value="excellent">Excellent</option>
              <option value="good">Good</option>
              <option value="fair">Fair</option>
              <option value="limited">Limited</option>
              <option value="unknown">Unknown</option>
            </select>
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
            <th className="px-5 py-4">Reputation</th>
            <th className="px-5 py-4">Match</th>
            <th className="px-5 py-4">Bench</th>
            <th className="px-5 py-4">RFQs (90d)</th>
            <th className="px-5 py-4">Win rate (90d)</th>
          </tr>
        }
        body={
          isEmpty ? (
            <tr>
              <td colSpan={6} className="px-6 py-12 text-center text-base text-slate-300">
                <p className="font-medium text-slate-100">No suppliers match this filter yet</p>
                <p className="mt-2 text-sm text-slate-400">
                  Try clearing filters to see the full supplier list.
                </p>
              </td>
            </tr>
          ) : (
            filtered.map((row) => (
              <tr
                key={row.supplierId}
                className="bg-slate-950/40 transition hover:bg-slate-900/40"
              >
                <td className={clsx(adminTableCellClass, "px-5 py-4 text-slate-100")}>
                  <div className="space-y-1">
                    <p className="font-medium text-slate-100">{row.supplierName}</p>
                    <p className="font-mono text-[11px] text-slate-500">{row.supplierId}</p>
                  </div>
                </td>
                <td className={clsx(adminTableCellClass, "px-5 py-4")}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={clsx(
                        "inline-flex rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-wide",
                        reputationPillClasses(row.reputationLabel),
                      )}
                    >
                      {formatReputationLabel(row.reputationLabel)}
                    </span>
                    <span className="text-xs text-slate-300 tabular-nums">
                      {typeof row.reputationScore === "number" ? `${row.reputationScore}/100` : "—"}
                    </span>
                  </div>
                </td>
                <td className={clsx(adminTableCellClass, "px-5 py-4 text-slate-200")}>
                  {row.matchHealth}
                </td>
                <td className={clsx(adminTableCellClass, "px-5 py-4 text-slate-200")}>
                  {row.benchStatus}
                </td>
                <td className={clsx(adminTableCellClass, "px-5 py-4 text-slate-200")}>
                  {row.rfqsConsidered} / {row.rfqsBid} / {row.rfqsWon}
                </td>
                <td className={clsx(adminTableCellClass, "px-5 py-4 text-slate-200")}>
                  {formatWinRate(row.winRatePct)}
                </td>
              </tr>
            ))
          )
        }
      />
    </AdminDashboardShell>
  );
}

