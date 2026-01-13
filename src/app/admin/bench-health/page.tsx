import AdminDashboardShell from "@/app/admin/AdminDashboardShell";
import { normalizeSearchParams } from "@/lib/route/normalizeSearchParams";
import BenchHealthTable from "./BenchHealthTable";
import {
  loadBenchHealthDirectory,
  type SupplierBenchHealth,
} from "@/server/admin/benchHealth";
import { requireAdminUser } from "@/server/auth";

export const dynamic = "force-dynamic";

type StatusFilter = SupplierBenchHealth["health"] | "all";
type SortKey = "health" | "overdue" | "activity";

function normalizeStatus(value: unknown): StatusFilter {
  const v = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (v === "healthy" || v === "at_risk" || v === "unresponsive") return v;
  return "all";
}

function normalizeSort(value: unknown): SortKey {
  const v = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (v === "health" || v === "overdue" || v === "activity") return v;
  return "health";
}

export default async function AdminBenchHealthPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdminUser({ redirectTo: "/login" });

  const usp = normalizeSearchParams(searchParams ? await searchParams : undefined);
  const q = usp.get("q") ?? "";
  const status = normalizeStatus(usp.get("status"));
  const sort = normalizeSort(usp.get("sort"));

  const rows = await loadBenchHealthDirectory({
    q: q.trim() || null,
    status,
    sort,
    limit: 200,
  });

  return (
    <AdminDashboardShell
      title="Bench health"
      description="Operational view of supplier responsiveness and activity."
    >
      <section className="rounded-2xl border border-slate-900/60 bg-slate-950/30 px-6 py-5">
        <form method="GET" action="/admin/bench-health" className="flex flex-col gap-3 lg:flex-row lg:items-end">
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
              defaultValue={status === "all" ? "all" : status}
              className="w-full min-w-48 rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white focus:border-emerald-400 focus:outline-none"
            >
              <option value="all">All</option>
              <option value="healthy">Healthy</option>
              <option value="at_risk">At risk</option>
              <option value="unresponsive">Unresponsive</option>
            </select>
          </label>

          <label className="flex flex-col gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Sort
            </span>
            <select
              name="sort"
              defaultValue={sort}
              className="w-full min-w-48 rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white focus:border-emerald-400 focus:outline-none"
            >
              <option value="health">Health</option>
              <option value="overdue">Overdue</option>
              <option value="activity">Activity</option>
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

      <div className="mt-6">
        <BenchHealthTable rows={rows} />
      </div>
    </AdminDashboardShell>
  );
}

