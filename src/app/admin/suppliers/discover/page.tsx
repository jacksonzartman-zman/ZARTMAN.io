import clsx from "clsx";
import Link from "next/link";
import AdminDashboardShell from "@/app/admin/AdminDashboardShell";
import AdminTableShell, { adminTableCellClass } from "@/app/admin/AdminTableShell";
import { normalizeSearchParams } from "@/lib/route/normalizeSearchParams";
import { requireAdminUser } from "@/server/auth";
import {
  loadSupplierDiscovery,
  type SupplierDiscoveryFilters,
  type SupplierDiscoveryRow,
} from "@/server/admin/supplierDiscovery";

export const dynamic = "force-dynamic";

type FilterMatchHealth = SupplierDiscoveryRow["matchHealth"] | "all";
type FilterBenchStatus = SupplierDiscoveryRow["benchStatus"] | "all";

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

function normalizeTextFilter(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function formatMatchHealthLabel(value: SupplierDiscoveryRow["matchHealth"]): string {
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

function matchHealthPillClasses(value: SupplierDiscoveryRow["matchHealth"]): string {
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

function formatBenchStatusLabel(value: SupplierDiscoveryRow["benchStatus"]): string {
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

function benchStatusPillClasses(value: SupplierDiscoveryRow["benchStatus"]): string {
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

function formatWinRatePct(value: number | null): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return `${Math.round(value * 10) / 10}%`;
}

function formatListPreview(values: string[], limit: number): string {
  const list = Array.isArray(values) ? values.filter(Boolean) : [];
  if (list.length === 0) return "—";
  if (list.length <= limit) return list.join(", ");
  const head = list.slice(0, Math.max(1, limit)).join(", ");
  return `${head} +${list.length - Math.max(1, limit)}`;
}

function buildDiscoveryFilters(args: {
  search: string | null;
  process: string | null;
  material: string | null;
  region: string | null;
  matchHealth: FilterMatchHealth;
  benchStatus: FilterBenchStatus;
}): SupplierDiscoveryFilters {
  return {
    search: args.search,
    process: args.process,
    material: args.material,
    region: args.region,
    matchHealth: args.matchHealth === "all" ? null : args.matchHealth,
    benchStatus: args.benchStatus === "all" ? null : args.benchStatus,
  };
}

export default async function AdminSupplierDiscoveryPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdminUser({ redirectTo: "/login" });

  const usp = normalizeSearchParams(searchParams ? await searchParams : undefined);

  const quoteId = normalizeTextFilter(usp.get("quoteId"));
  const search = normalizeTextFilter(usp.get("search"));
  const process = normalizeTextFilter(usp.get("process"));
  const material = normalizeTextFilter(usp.get("material"));
  const region = normalizeTextFilter(usp.get("region"));
  const matchHealth = parseMatchHealthFilter(usp.get("matchHealth"));
  const benchStatus = parseBenchStatusFilter(usp.get("benchStatus"));

  const suppliers = await loadSupplierDiscovery(
    buildDiscoveryFilters({
      search,
      process,
      material,
      region,
      matchHealth,
      benchStatus,
    }),
  );

  const isEmpty = suppliers.length === 0;

  const processOptions = Array.from(
    new Set(suppliers.flatMap((row) => row.processes ?? [])),
  ).sort((a, b) => a.localeCompare(b));
  const materialOptions = Array.from(
    new Set(suppliers.flatMap((row) => row.materials ?? [])),
  ).sort((a, b) => a.localeCompare(b));

  return (
    <AdminDashboardShell
      title="Supplier discovery"
      description="Bench + match + capabilities explorer across active suppliers."
    >
      <section className="rounded-2xl border border-slate-900/60 bg-slate-950/30 px-6 py-5">
        <form
          method="GET"
          action="/admin/suppliers/discover"
          className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end"
        >
          {quoteId ? <input type="hidden" name="quoteId" value={quoteId} /> : null}

          <label className="flex flex-col gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Search
            </span>
            <input
              name="search"
              defaultValue={search ?? ""}
              placeholder="Supplier name or email"
              className="w-full min-w-64 rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-emerald-400 focus:outline-none"
            />
          </label>

          <label className="flex flex-col gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Process
            </span>
            <select
              name="process"
              defaultValue={process ?? ""}
              className="w-full min-w-56 rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white focus:border-emerald-400 focus:outline-none"
            >
              <option value="">All</option>
              {processOptions.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Material
            </span>
            <select
              name="material"
              defaultValue={material ?? ""}
              className="w-full min-w-56 rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white focus:border-emerald-400 focus:outline-none"
            >
              <option value="">All</option>
              {materialOptions.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Region
            </span>
            <input
              name="region"
              defaultValue={region ?? ""}
              placeholder="e.g. US"
              className="w-full min-w-40 rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-emerald-400 focus:outline-none"
            />
          </label>

          <label className="flex flex-col gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Match health
            </span>
            <select
              name="matchHealth"
              defaultValue={matchHealth === "all" ? "" : matchHealth}
              className="w-full min-w-52 rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white focus:border-emerald-400 focus:outline-none"
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
              defaultValue={benchStatus === "all" ? "" : benchStatus}
              className="w-full min-w-52 rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white focus:border-emerald-400 focus:outline-none"
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

      {isEmpty ? (
        <section className="mt-5 rounded-2xl border border-dashed border-slate-800 bg-slate-950/30 px-6 py-10 text-center">
          <p className="text-base font-semibold text-slate-100">
            No suppliers match these filters yet.
          </p>
          <p className="mt-2 text-sm text-slate-400">
            Try clearing filters to see the full supplier list.
          </p>
          <div className="mt-4">
            <Link
              href="/admin/suppliers/discover"
              className="text-sm font-semibold text-emerald-200 underline-offset-4 hover:underline"
            >
              Clear filters
            </Link>
          </div>
        </section>
      ) : (
        <AdminTableShell
          className="mt-5"
          head={
            <tr>
              <th className="px-5 py-4">Supplier</th>
              <th className="px-5 py-4">Region</th>
              <th className="px-5 py-4">Processes</th>
              <th className="px-5 py-4">Materials</th>
              <th className="px-5 py-4">Match</th>
              <th className="px-5 py-4">Bench</th>
              <th className="px-5 py-4">90d RFQs</th>
              <th className="px-5 py-4">Awards (30d)</th>
              {quoteId ? <th className="px-5 py-4">Action</th> : null}
            </tr>
          }
          body={
            suppliers.map((row) => {
              const rfqsBid = typeof row.rfqsBid90d === "number" ? row.rfqsBid90d : null;
              const rfqsWon = typeof row.rfqsWon90d === "number" ? row.rfqsWon90d : null;
              const rfqsConsidered =
                typeof row.rfqsConsidered90d === "number" ? row.rfqsConsidered90d : null;
              const rfqsTitleParts = [
                rfqsConsidered != null ? `considered: ${rfqsConsidered}` : null,
                rfqsBid != null ? `bid: ${rfqsBid}` : null,
                rfqsWon != null ? `won: ${rfqsWon}` : null,
              ].filter(Boolean);
              const rfqsTitle = rfqsTitleParts.length > 0 ? rfqsTitleParts.join(" • ") : undefined;

              return (
                <tr
                  key={row.supplierId}
                  className="bg-slate-950/40 transition hover:bg-slate-900/40"
                >
                  <td className={clsx(adminTableCellClass, "px-5 py-4")}>
                    <div className="min-w-0">
                      <div className="truncate font-medium text-slate-100">{row.name}</div>
                      {row.primaryEmail ? (
                        <a
                          href={`mailto:${row.primaryEmail}`}
                          className="truncate text-xs text-slate-400 hover:text-emerald-200"
                        >
                          {row.primaryEmail}
                        </a>
                      ) : (
                        <div className="text-xs text-slate-500">—</div>
                      )}
                    </div>
                  </td>

                  <td className={clsx(adminTableCellClass, "px-5 py-4 text-slate-200")}>
                    {row.region ?? "—"}
                  </td>

                  <td
                    className={clsx(adminTableCellClass, "px-5 py-4 text-slate-200")}
                    title={row.processes.join(", ")}
                  >
                    {formatListPreview(row.processes, 3)}
                  </td>

                  <td
                    className={clsx(adminTableCellClass, "px-5 py-4 text-slate-200")}
                    title={row.materials.join(", ")}
                  >
                    {formatListPreview(row.materials, 3)}
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

                  <td
                    className={clsx(adminTableCellClass, "px-5 py-4 text-slate-200")}
                    title={rfqsTitle}
                  >
                    <div className="tabular-nums">
                      {rfqsBid ?? "—"} / {rfqsWon ?? "—"}
                    </div>
                    <div className="mt-0.5 text-xs text-slate-400">
                      Win rate: {formatWinRatePct(row.winRate90d)}
                    </div>
                  </td>

                  <td className={clsx(adminTableCellClass, "px-5 py-4 text-slate-200")}>
                    {typeof row.awardsLast30d === "number" ? row.awardsLast30d : "—"}
                  </td>

                  {quoteId ? (
                    <td className={clsx(adminTableCellClass, "px-5 py-4")}>
                      <Link
                        href={`/admin/quotes/${encodeURIComponent(quoteId)}#decision`}
                        className="text-sm font-semibold text-emerald-200 underline-offset-4 hover:underline"
                      >
                        Add to RFQ
                      </Link>
                    </td>
                  ) : null}
                </tr>
              );
            })
          }
        />
      )}
    </AdminDashboardShell>
  );
}

