import clsx from "clsx";
import Link from "next/link";
import AdminDashboardShell from "@/app/admin/AdminDashboardShell";
import AdminTableShell, { adminTableCellClass } from "@/app/admin/AdminTableShell";
import { normalizeSearchParams } from "@/lib/route/normalizeSearchParams";
import { requireAdminUser } from "@/server/auth";
import {
  listBenchGapTasks,
  type BenchGapTaskDimension,
  type BenchGapTaskRecord,
  type BenchGapTaskStatus,
} from "@/server/admin/benchGapTasks";
import { updateBenchGapTaskStatusAction } from "@/app/admin/bench-health/actions";

export const dynamic = "force-dynamic";

type DimensionFilter = BenchGapTaskDimension | "all";
type StatusFilter = BenchGapTaskStatus | "all";
type WindowFilter = "7d" | "30d" | "all";

function normalizeDimension(value: unknown): DimensionFilter {
  const v = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (v === "process" || v === "material" || v === "location") return v;
  return "all";
}

function normalizeStatus(value: unknown): StatusFilter {
  const v = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (v === "open" || v === "in_progress" || v === "closed") return v;
  return "all";
}

function normalizeWindow(value: unknown): WindowFilter {
  const v = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (v === "7d" || v === "30d") return v;
  return "all";
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function statusLabel(status: BenchGapTaskStatus): string {
  if (status === "in_progress") return "In progress";
  if (status === "closed") return "Closed";
  return "Open";
}

function statusPillClasses(status: BenchGapTaskStatus): string {
  switch (status) {
    case "closed":
      return "border-slate-800 bg-slate-950/60 text-slate-300";
    case "in_progress":
      return "border-blue-500/40 bg-blue-500/10 text-blue-100";
    case "open":
    default:
      return "border-amber-500/40 bg-amber-500/10 text-amber-100";
  }
}

function dimensionLabel(dimension: BenchGapTaskDimension): string {
  if (dimension === "process") return "Process";
  if (dimension === "material") return "Material";
  return "Location";
}

function taskKeyLabel(task: BenchGapTaskRecord): string {
  if (task.dimension === "process") return task.key.toUpperCase() === task.key ? task.key : task.key;
  return task.key;
}

export default async function AdminBenchHealthTasksPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdminUser({ redirectTo: "/login" });

  const usp = normalizeSearchParams(searchParams ? await searchParams : undefined);
  const dimension = normalizeDimension(usp.get("dimension"));
  const status = normalizeStatus(usp.get("status"));
  const window = normalizeWindow(usp.get("window"));
  const q = normalizeText(usp.get("q"));
  const highlight = normalizeText(usp.get("highlight"));

  const { supported, tasks } = await listBenchGapTasks({
    dimension,
    status,
    window,
    q: q || null,
    limit: 300,
  });

  return (
    <AdminDashboardShell
      title="Bench health tasks"
      description="Operational playbooks: track gaps from creation → discovery → closure."
    >
      {!supported ? (
        <section className="rounded-2xl border border-slate-900/60 bg-slate-950/30 px-6 py-5">
          <h2 className="text-base font-semibold text-white">Gap tasks unavailable</h2>
          <p className="mt-1 text-sm text-slate-400">
            `bench_gap_tasks` is not available on this schema.
          </p>
        </section>
      ) : null}

      <section className="rounded-2xl border border-slate-900/60 bg-slate-950/30 px-6 py-5">
        <form
          method="GET"
          action="/admin/bench-health/tasks"
          className="flex flex-col gap-3 lg:flex-row lg:items-end"
        >
          <label className="flex flex-col gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Dimension
            </span>
            <select
              name="dimension"
              defaultValue={dimension === "all" ? "all" : dimension}
              className="w-full min-w-48 rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white focus:border-emerald-400 focus:outline-none"
            >
              <option value="all">All</option>
              <option value="process">Process</option>
              <option value="material">Material</option>
              <option value="location">Location</option>
            </select>
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
              <option value="open">Open</option>
              <option value="in_progress">In progress</option>
              <option value="closed">Closed</option>
            </select>
          </label>

          <label className="flex flex-col gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Window
            </span>
            <select
              name="window"
              defaultValue={window === "all" ? "all" : window}
              className="w-full min-w-40 rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white focus:border-emerald-400 focus:outline-none"
            >
              <option value="all">All</option>
              <option value="7d">7d</option>
              <option value="30d">30d</option>
            </select>
          </label>

          <label className="flex flex-col gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Search key
            </span>
            <input
              name="q"
              defaultValue={q}
              placeholder="e.g. cnc, aluminum, US-CA…"
              className="w-full min-w-64 rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-emerald-400 focus:outline-none"
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
        className="mt-6"
        tableClassName="w-full border-separate border-spacing-0 text-sm min-w-[1100px]"
        head={
          <tr>
            <th className="px-5 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">
              Task
            </th>
            <th className="px-5 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">
              Status
            </th>
            <th className="px-5 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">
              Owner
            </th>
            <th className="px-5 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">
              Notes
            </th>
            <th className="px-5 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">
              Actions
            </th>
          </tr>
        }
        body={
          tasks.length === 0 ? (
            <tr>
              <td colSpan={5} className="px-6 py-12 text-center text-base text-slate-300">
                <p className="font-medium text-slate-100">No tasks match this filter.</p>
                <p className="mt-2 text-sm text-slate-400">
                  Create a gap task from `/admin/bench-health` → “Where are we thin?”
                </p>
              </td>
            </tr>
          ) : (
            tasks.map((task) => {
              const isHighlighted = Boolean(highlight && task.id === highlight);
              return (
                <tr
                  key={task.id}
                  className={clsx(
                    "border-b border-slate-800/60 bg-slate-950/40 transition hover:bg-slate-900/40",
                    isHighlighted ? "outline outline-2 outline-emerald-500/50" : null,
                  )}
                >
                  <td className={clsx(adminTableCellClass, "px-5 py-4")}>
                    <div className="space-y-1">
                      <p className="text-sm font-semibold text-slate-100">
                        {dimensionLabel(task.dimension)}:{" "}
                        <span className="font-mono text-[12px] text-emerald-200">
                          {taskKeyLabel(task)}
                        </span>{" "}
                        <span className="text-xs text-slate-500">({task.window})</span>
                      </p>
                      <p className="font-mono text-[11px] text-slate-500">{task.id}</p>
                      <Link
                        href="/admin/bench-health"
                        className="text-[11px] font-semibold text-slate-400 hover:text-emerald-200"
                      >
                        Back to bench health →
                      </Link>
                    </div>
                  </td>
                  <td className={clsx(adminTableCellClass, "px-5 py-4")}>
                    <span
                      className={clsx(
                        "inline-flex rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-wide",
                        statusPillClasses(task.status),
                      )}
                    >
                      {statusLabel(task.status)}
                    </span>
                  </td>
                  <td className={clsx(adminTableCellClass, "px-5 py-4 text-slate-300")}>
                    {task.owner ?? <span className="text-slate-500">—</span>}
                  </td>
                  <td className={clsx(adminTableCellClass, "px-5 py-4 text-slate-300")}>
                    {task.notes ? (
                      <p className="max-w-[34rem] whitespace-pre-wrap text-sm">{task.notes}</p>
                    ) : (
                      <span className="text-slate-500">—</span>
                    )}
                  </td>
                  <td className={clsx(adminTableCellClass, "px-5 py-4")}>
                    <div className="flex flex-wrap items-center gap-2">
                      {task.status === "open" ? (
                        <form action={updateBenchGapTaskStatusAction}>
                          <input type="hidden" name="taskId" value={task.id} />
                          <input type="hidden" name="status" value="in_progress" />
                          <input type="hidden" name="dimension" value={task.dimension} />
                          <input type="hidden" name="key" value={task.key} />
                          <input type="hidden" name="window" value={task.window} />
                          <button
                            type="submit"
                            className="inline-flex items-center justify-center rounded-md border border-slate-800 bg-slate-950/60 px-3 py-1.5 text-xs font-semibold text-slate-100 transition hover:border-blue-500/40 hover:text-blue-100"
                          >
                            Mark in progress
                          </button>
                        </form>
                      ) : null}

                      {task.status !== "closed" ? (
                        <form action={updateBenchGapTaskStatusAction}>
                          <input type="hidden" name="taskId" value={task.id} />
                          <input type="hidden" name="status" value="closed" />
                          <input type="hidden" name="dimension" value={task.dimension} />
                          <input type="hidden" name="key" value={task.key} />
                          <input type="hidden" name="window" value={task.window} />
                          <button
                            type="submit"
                            className="inline-flex items-center justify-center rounded-md border border-slate-800 bg-slate-950/60 px-3 py-1.5 text-xs font-semibold text-slate-100 transition hover:border-emerald-500/40 hover:text-emerald-200"
                          >
                            Close
                          </button>
                        </form>
                      ) : null}
                    </div>
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

