import clsx from "clsx";
import AdminDashboardShell from "@/app/admin/AdminDashboardShell";
import AdminTableShell, { adminTableCellClass } from "@/app/admin/AdminTableShell";
import { requireAdminUser } from "@/server/auth";
import {
  loadAdminSupplierBenchHealth,
  type SupplierBenchHealthRow,
} from "@/server/suppliers/benchHealth";
import {
  loadSupplierReputationForSuppliers,
  type SupplierReputationLabel,
} from "@/server/suppliers/reputation";
import { formatRelativeTimeFromTimestamp, toTimestamp } from "@/lib/relativeTime";
import { normalizeSearchParams } from "@/lib/route/normalizeSearchParams";

export const dynamic = "force-dynamic";

type FilterMatchHealth = SupplierBenchHealthRow["matchHealth"] | "all";
type FilterBenchStatus = SupplierBenchHealthRow["benchStatus"] | "all";

function parseMatchHealthFilter(value: unknown): FilterMatchHealth {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (
    normalized === "good" ||
    normalized === "caution" ||
    normalized === "poor" ||
    normalized === "unknown"
  ) {
    return normalized;
  }
  return "all";
}

function parseBenchStatusFilter(value: unknown): FilterBenchStatus {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (
    normalized === "underused" ||
    normalized === "balanced" ||
    normalized === "overused" ||
    normalized === "unknown"
  ) {
    return normalized;
  }
  return "all";
}

function formatMatchHealthLabel(value: SupplierBenchHealthRow["matchHealth"]): string {
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

function matchHealthPillClasses(value: SupplierBenchHealthRow["matchHealth"]): string {
  switch (value) {
    case "good":
      return "border-emerald-500/40 bg-emerald-500/10 text-emerald-100";
    case "caution":
      return "border-amber-500/40 bg-amber-500/10 text-amber-100";
    case "poor":
      return "border-red-500/40 bg-red-500/10 text-red-100";
    default:
      return "border-slate-800 bg-slate-950/60 text-slate-200";
  }
}

function formatBenchStatusLabel(value: SupplierBenchHealthRow["benchStatus"]): string {
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
      return "border-slate-800 bg-slate-950/60 text-slate-200";
  }
}

function formatReputationScore(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return `${value}/100`;
}

function benchStatusPillClasses(value: SupplierBenchHealthRow["benchStatus"]): string {
  switch (value) {
    case "underused":
      return "border-blue-500/40 bg-blue-500/10 text-blue-100";
    case "balanced":
      return "border-emerald-500/40 bg-emerald-500/10 text-emerald-100";
    case "overused":
      return "border-amber-500/40 bg-amber-500/10 text-amber-100";
    default:
      return "border-slate-800 bg-slate-950/60 text-slate-200";
  }
}

function normalizeDefaultSort(a: SupplierBenchHealthRow): number {
  // Lower is better.
  const isUnderused = a.benchStatus === "underused";
  const isGoodOrCaution = a.matchHealth === "good" || a.matchHealth === "caution";
  if (isUnderused && isGoodOrCaution) return 0;
  if (isUnderused) return 1;
  if (a.benchStatus === "balanced") return 2;
  if (a.benchStatus === "overused") return 3;
  return 4;
}

function formatWinRate(value: number | null): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return `${Math.round(value * 10) / 10}%`;
}

function formatCapacityUpdatedAt(value: string | null): string {
  if (!value) return "No recent update";
  const relative = formatRelativeTimeFromTimestamp(toTimestamp(value));
  return relative ?? "No recent update";
}

export default async function AdminSupplierBenchHealthPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdminUser({ redirectTo: "/login" });

  const usp = normalizeSearchParams(searchParams ? await searchParams : undefined);
  const matchHealthFilter = parseMatchHealthFilter(usp.get("matchHealth"));
  const benchStatusFilter = parseBenchStatusFilter(usp.get("benchStatus"));

  const allRows = await loadAdminSupplierBenchHealth();
  const filtered = allRows.filter((row) => {
    if (matchHealthFilter !== "all" && row.matchHealth !== matchHealthFilter) {
      return false;
    }
    if (benchStatusFilter !== "all" && row.benchStatus !== benchStatusFilter) {
      return false;
    }
    return true;
  });

  filtered.sort((a, b) => {
    const da = normalizeDefaultSort(a);
    const db = normalizeDefaultSort(b);
    if (da !== db) return da - db;

    const nameCmp = (a.supplierName ?? "").localeCompare(b.supplierName ?? "");
    if (nameCmp !== 0) return nameCmp;
    return a.supplierId.localeCompare(b.supplierId);
  });

  const isEmpty = filtered.length === 0;

  const reputationBySupplierId = await loadSupplierReputationForSuppliers(
    filtered.map((row) => row.supplierId),
  );
  const reputationCounts = filtered.reduce<Record<SupplierReputationLabel, number>>(
    (acc, row) => {
      const rep = reputationBySupplierId[row.supplierId] ?? null;
      const label = (rep?.label ?? "unknown") as SupplierReputationLabel;
      acc[label] += 1;
      return acc;
    },
    { excellent: 0, good: 0, fair: 0, limited: 0, unknown: 0 },
  );

  return (
    <AdminDashboardShell
      title="Bench health"
      description="Read-only match + utilization insights across suppliers."
    >
      <p className="text-sm text-slate-400">
        Reputation snapshot:{" "}
        <span className="text-slate-200">
          {reputationCounts.excellent} Excellent · {reputationCounts.good} Good ·{" "}
          {reputationCounts.fair} Fair · {reputationCounts.limited} Limited
        </span>
      </p>
      <section className="rounded-2xl border border-slate-900/60 bg-slate-950/30 px-6 py-5">
        <form
          method="GET"
          action="/admin/suppliers/bench-health"
          className="flex flex-col gap-3 sm:flex-row sm:items-end"
        >
          <label className="flex flex-col gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Match health
            </span>
            <select
              name="matchHealth"
              defaultValue={matchHealthFilter === "all" ? "" : matchHealthFilter}
              className="w-full min-w-56 rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white focus:border-emerald-400 focus:outline-none"
            >
              <option value="">All</option>
              <option value="good">Good</option>
              <option value="caution">Caution</option>
              <option value="poor">Poor</option>
              <option value="unknown">Unknown</option>
            </select>
          </label>

          <label className="flex flex-col gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Bench status
            </span>
            <select
              name="benchStatus"
              defaultValue={benchStatusFilter === "all" ? "" : benchStatusFilter}
              className="w-full min-w-56 rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white focus:border-emerald-400 focus:outline-none"
            >
              <option value="">All</option>
              <option value="underused">Underused</option>
              <option value="balanced">Balanced</option>
              <option value="overused">Overused</option>
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
            <th className="px-5 py-4">Match health</th>
            <th className="px-5 py-4">RFQs (90d)</th>
            <th className="px-5 py-4">Win rate (90d)</th>
            <th className="px-5 py-4">Bench status</th>
            <th className="px-5 py-4">Awards (30d)</th>
            <th className="px-5 py-4">Capacity update</th>
          </tr>
        }
        body={
          isEmpty ? (
            <tr>
              <td colSpan={8} className="px-6 py-12 text-center text-base text-slate-300">
                <p className="font-medium text-slate-100">
                  No suppliers match this filter yet
                </p>
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
                  {row.supplierName}
                </td>
                <td className={clsx(adminTableCellClass, "px-5 py-4")}>
                  {(() => {
                    const rep = reputationBySupplierId[row.supplierId] ?? null;
                    const label = (rep?.label ?? "unknown") as SupplierReputationLabel;
                    return (
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={clsx(
                            "inline-flex rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-wide",
                            reputationPillClasses(label),
                          )}
                        >
                          {formatReputationLabel(label)}
                        </span>
                        <span className="text-xs text-slate-300 tabular-nums">
                          {formatReputationScore(rep?.score ?? null)}
                        </span>
                      </div>
                    );
                  })()}
                </td>
                <td className={clsx(adminTableCellClass, "px-5 py-4")}>
                  <span
                    className={clsx(
                      "inline-flex rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-wide",
                      matchHealthPillClasses(row.matchHealth),
                    )}
                  >
                    {formatMatchHealthLabel(row.matchHealth)}
                  </span>
                </td>
                <td className={clsx(adminTableCellClass, "px-5 py-4 text-slate-200")}>
                  {row.rfqsConsidered} / {row.rfqsBid} / {row.rfqsWon}
                </td>
                <td className={clsx(adminTableCellClass, "px-5 py-4 text-slate-200")}>
                  {formatWinRate(row.winRatePct)}
                </td>
                <td className={clsx(adminTableCellClass, "px-5 py-4")}>
                  <span
                    className={clsx(
                      "inline-flex rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-wide",
                      benchStatusPillClasses(row.benchStatus),
                    )}
                  >
                    {formatBenchStatusLabel(row.benchStatus)}
                  </span>
                </td>
                <td className={clsx(adminTableCellClass, "px-5 py-4 text-slate-200")}>
                  {typeof row.awardsLast30d === "number" ? row.awardsLast30d : "—"}
                </td>
                <td className={clsx(adminTableCellClass, "px-5 py-4 text-slate-400")}>
                  {formatCapacityUpdatedAt(row.lastCapacityUpdateAt)}
                </td>
              </tr>
            ))
          )
        }
      />
    </AdminDashboardShell>
  );
}

