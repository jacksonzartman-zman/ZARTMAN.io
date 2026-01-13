import clsx from "clsx";

import type { SupplierKickoffTask } from "@/lib/quote/kickoffChecklist";
import { formatRelativeTimeFromTimestamp, toTimestamp } from "@/lib/relativeTime";

export function AdminKickoffTasksCard({
  hasWinner,
  tasks,
  unavailable,
  className,
}: {
  hasWinner: boolean;
  tasks: SupplierKickoffTask[];
  unavailable?: boolean;
  className?: string;
}) {
  if (!hasWinner) {
    return (
      <section className={clsx(className, "rounded-2xl border border-slate-800 bg-slate-950/40 px-6 py-5")}>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Kickoff tasks
        </p>
        <h2 className="mt-1 text-lg font-semibold text-slate-100">
          Award a supplier to begin kickoff.
        </h2>
        <p className="mt-2 text-sm text-slate-400">
          Once a winner is selected, you’ll see a structured checklist and completion history here.
        </p>
      </section>
    );
  }

  if (unavailable) {
    return (
      <section className={clsx(className, "rounded-2xl border border-slate-800 bg-slate-950/40 px-6 py-5")}>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Kickoff tasks
        </p>
        <h2 className="mt-1 text-lg font-semibold text-slate-100">
          Kickoff tasks unavailable
        </h2>
        <p className="mt-2 text-sm text-slate-400">
          This environment doesn’t have kickoff tasks enabled or they could not be loaded.
        </p>
      </section>
    );
  }

  const total = Array.isArray(tasks) ? tasks.length : 0;
  const completed = Array.isArray(tasks)
    ? tasks.reduce((count, task) => count + (task?.completed ? 1 : 0), 0)
    : 0;

  return (
    <section className={clsx(className, "rounded-2xl border border-slate-800 bg-slate-950/40 px-6 py-5")}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Kickoff tasks
          </p>
          <h2 className="mt-1 text-lg font-semibold text-slate-100">
            Checklist progress
          </h2>
          <p className="mt-1 text-sm text-slate-400">
            Completed{" "}
            <span className="font-semibold text-slate-200">
              {completed}/{total}
            </span>
          </p>
        </div>
        <span
          className={clsx(
            "rounded-full border px-3 py-1 text-xs font-semibold",
            total > 0 && completed >= total
              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-100"
              : "border-blue-500/40 bg-blue-500/10 text-blue-100",
          )}
        >
          {total > 0 && completed >= total ? "Complete" : "In progress"}
        </span>
      </header>

      <ul className="mt-4 space-y-3">
        {tasks.map((task) => {
          const completedAt =
            typeof task.completedAt === "string" && task.completedAt.trim().length > 0
              ? task.completedAt
              : null;
          const completedAtLabel = completedAt
            ? formatRelativeTimeFromTimestamp(toTimestamp(completedAt)) ?? completedAt
            : "—";
          const byRole =
            typeof task.completedByRole === "string" && task.completedByRole.trim().length > 0
              ? task.completedByRole
              : null;
          const byLabel = byRole ? byRole.charAt(0).toUpperCase() + byRole.slice(1) : "—";

          return (
            <li
              key={task.taskKey}
              className="rounded-2xl border border-slate-900/60 bg-slate-950/30 px-4 py-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-100">{task.title}</p>
                  {task.description ? (
                    <p className="mt-1 text-sm text-slate-400">{task.description}</p>
                  ) : null}
                </div>
                <div className="shrink-0 text-right">
                  <p
                    className={clsx(
                      "text-xs font-semibold",
                      task.completed ? "text-emerald-200" : "text-slate-400",
                    )}
                  >
                    {task.completed ? "Complete" : "Pending"}
                  </p>
                  {task.completed ? (
                    <p className="mt-1 text-[11px] text-slate-400">
                      {byLabel} · {completedAtLabel}
                    </p>
                  ) : (
                    <p className="mt-1 text-[11px] text-slate-500">{completedAtLabel}</p>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

