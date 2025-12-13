"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import clsx from "clsx";

import {
  mergeKickoffTasksWithDefaults,
  summarizeKickoffTasks,
  formatKickoffSummaryLabel,
  type SupplierKickoffTask,
} from "@/lib/quote/kickoffChecklist";
import { formatRelativeTimeFromTimestamp, toTimestamp } from "@/lib/relativeTime";
import { completeKickoffTask } from "./actions";
import type { SupplierKickoffFormState } from "@/server/quotes/supplierQuoteServer";

type SupplierKickoffChecklistCardProps = {
  quoteId: string;
  tasks: SupplierKickoffTask[];
  readOnly?: boolean;
};

export function SupplierKickoffChecklistCard({
  quoteId,
  tasks,
  readOnly = false,
}: SupplierKickoffChecklistCardProps) {
  const mergedTasks = useMemo(
    () => mergeKickoffTasksWithDefaults(tasks),
    [tasks],
  );
  const [localTasks, setLocalTasks] = useState(mergedTasks);
  const [pendingTaskKey, setPendingTaskKey] = useState<string | null>(null);
  const [result, setResult] = useState<SupplierKickoffFormState | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    setLocalTasks(mergedTasks);
  }, [mergedTasks]);

  const summary = useMemo(
    () => summarizeKickoffTasks(localTasks),
    [localTasks],
  );
  const summaryLabel = formatKickoffSummaryLabel(summary);
  const lastUpdatedLabel = useMemo(() => {
    return (
      formatRelativeTimeFromTimestamp(toTimestamp(summary.lastUpdatedAt)) ?? "—"
    );
  }, [summary.lastUpdatedAt]);

  const handleToggle = (task: SupplierKickoffTask, nextCompleted: boolean) => {
    if (readOnly) {
      return;
    }
    setResult(null);
    setPendingTaskKey(task.taskKey);
    setLocalTasks((current) =>
      current.map((entry) =>
        entry.taskKey === task.taskKey
          ? { ...entry, completed: nextCompleted }
          : entry,
      ),
    );

    startTransition(() => {
      completeKickoffTask({
        quoteId,
        taskKey: task.taskKey,
        completed: nextCompleted,
        title: task.title,
        description: task.description,
        sortOrder: task.sortOrder,
      })
        .then((actionResult) => {
          setResult(actionResult);
          if (!actionResult.ok) {
            setLocalTasks((current) =>
              current.map((entry) =>
                entry.taskKey === task.taskKey
                  ? { ...entry, completed: !nextCompleted }
                  : entry,
              ),
            );
          }
        })
        .catch((error) => {
          console.error("[supplier kickoff tasks] action crashed", {
            quoteId,
            taskKey: task.taskKey,
            error,
          });
          setResult({
            ok: false,
            error: "We couldn’t update that task. Please try again.",
          });
          setLocalTasks((current) =>
            current.map((entry) =>
              entry.taskKey === task.taskKey
                ? { ...entry, completed: !nextCompleted }
                : entry,
            ),
          );
        })
        .finally(() => setPendingTaskKey(null));
    });
  };

  const successMessage = result && result.ok ? result.message : null;
  const errorMessage = result && !result.ok ? result.error : null;

  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-950/60 px-6 py-5">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Kickoff checklist
            </p>
            <h2 className="text-lg font-semibold text-white">
              Align on the five go-live checks
            </h2>
          </div>
          <span
            className={clsx(
              "rounded-full px-3 py-1 text-xs font-semibold",
              summary.status === "complete"
                ? "border border-emerald-400/40 bg-emerald-400/10 text-emerald-100"
                : summary.status === "in-progress"
                  ? "border border-blue-400/40 bg-blue-400/10 text-blue-100"
                  : "border border-slate-800 bg-slate-900/60 text-slate-200",
            )}
          >
            {summaryLabel}
          </span>
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-400">
          <span>
            Completed{" "}
            <span className="font-semibold text-slate-200">
              {summary.completedCount}/{summary.totalCount}
            </span>
          </span>
          <span>
            Last updated{" "}
            <span className="font-semibold text-slate-200">
              {summary.lastUpdatedAt ? lastUpdatedLabel : "—"}
            </span>
          </span>
        </div>
        <p className="text-sm text-slate-300">
          We&apos;ll share this progress with the customer and Zartman admin
          team so everyone stays in sync.
        </p>
      </header>

      {successMessage ? (
        <p className="mt-3 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-100">
          {successMessage}
        </p>
      ) : null}
      {errorMessage ? (
        <p className="mt-3 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-100">
          {errorMessage}
        </p>
      ) : null}
      {readOnly ? (
        <p className="mt-3 rounded-xl border border-slate-800 bg-black/30 px-4 py-2 text-xs text-slate-400">
          Read-only: only the awarded supplier can update kickoff progress.
        </p>
      ) : null}

      <ul className="mt-4 space-y-3">
        {localTasks.map((task) => {
          const checkboxId = `kickoff-task-${task.taskKey}`;
          const disabled =
            readOnly ||
            isPending ||
            pendingTaskKey === task.taskKey ||
            !task.taskKey;
          return (
            <li
              key={task.taskKey}
              className="flex items-start gap-3 rounded-2xl border border-slate-800 bg-slate-950/50 px-4 py-3"
            >
              <div className="pt-0.5">
                <input
                  id={checkboxId}
                  type="checkbox"
                  className="size-4 rounded border-slate-700 bg-slate-900 text-emerald-400 focus:ring-emerald-500"
                  checked={task.completed}
                  disabled={disabled}
                  onChange={(event) =>
                    handleToggle(task, event.currentTarget.checked)
                  }
                />
              </div>
              <div className="space-y-1">
                <label
                  htmlFor={checkboxId}
                  className="text-sm font-semibold text-white"
                >
                  {task.title}
                </label>
                {task.description ? (
                  <p className="text-sm text-slate-300">{task.description}</p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
