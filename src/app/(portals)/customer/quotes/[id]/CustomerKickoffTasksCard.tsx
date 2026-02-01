"use client";

import clsx from "clsx";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import type { KickoffTaskRow } from "@/components/KickoffTasksChecklist";
import PortalCard from "../../../PortalCard";
import { upsertCustomerKickoffTaskCompletionAction } from "./actions";

type CustomerKickoffTasksCardProps = {
  quoteId: string;
  tasks: KickoffTaskRow[];
  readOnly?: boolean;
  title?: string;
};

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function CustomerKickoffTasksCard({
  quoteId,
  tasks,
  readOnly = false,
  title = "Kickoff tasks",
}: CustomerKickoffTasksCardProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [pendingTaskKey, setPendingTaskKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sortedRows = useMemo(() => {
    const safe = Array.isArray(tasks) ? tasks : [];
    return [...safe].sort((a, b) => {
      const aSort = Number.isFinite(a.sortOrder) ? a.sortOrder : Number.MAX_SAFE_INTEGER;
      const bSort = Number.isFinite(b.sortOrder) ? b.sortOrder : Number.MAX_SAFE_INTEGER;
      if (aSort !== bSort) return aSort - bSort;
      return normalizeText(a.taskKey).localeCompare(normalizeText(b.taskKey));
    });
  }, [tasks]);

  const [localRows, setLocalRows] = useState(sortedRows);

  useEffect(() => {
    setLocalRows(sortedRows);
  }, [sortedRows]);

  const summary = useMemo(() => {
    const completedCount = localRows.filter((t) => t.status === "complete").length;
    const total = localRows.length;
    return { completedCount, total };
  }, [localRows]);

  const disabledAll = readOnly || isPending;

  return (
    <PortalCard
      title={title}
      description="A calm checklist to keep kickoff moving after award."
      action={
        <span className="rounded-full border border-slate-800 bg-slate-950/50 px-3 py-1 text-xs font-semibold text-slate-200">
          {summary.total > 0 ? `${summary.completedCount}/${summary.total} complete` : "—"}
        </span>
      }
    >
      <div className="space-y-3">
        {readOnly ? (
          <p className="rounded-xl border border-slate-900/60 bg-slate-950/30 px-4 py-2 text-xs text-slate-400">
            Read-only in this view.
          </p>
        ) : null}

        {error ? (
          <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-xs text-red-100">
            {error}
          </p>
        ) : null}

        {localRows.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-800/70 bg-black/20 px-4 py-3 text-sm text-slate-300">
            Kickoff tasks aren’t available yet.
          </p>
        ) : (
          <ul className="divide-y divide-slate-900/60 overflow-hidden rounded-xl border border-slate-900/60 bg-slate-950/30">
            {localRows.map((task) => {
              const isComplete = task.status === "complete";
              const isRowPending = pendingTaskKey === task.taskKey;
              const disabledRow =
                disabledAll || isRowPending || !normalizeText(task.taskKey);

              return (
                <li
                  key={task.taskKey}
                  className={clsx(
                    "flex items-start justify-between gap-4 px-4 py-3",
                    "motion-reduce:transition-none",
                  )}
                >
                  <div className="min-w-0">
                    <p
                      className={clsx(
                        "text-sm font-semibold text-slate-100",
                        isComplete
                          ? "opacity-70 line-through decoration-slate-500/60"
                          : undefined,
                      )}
                    >
                      {normalizeText(task.title) || normalizeText(task.taskKey) || "Task"}
                    </p>
                    {normalizeText(task.description) ? (
                      <p className="mt-1 text-xs text-slate-400">
                        {normalizeText(task.description)}
                      </p>
                    ) : null}
                  </div>

                  <div className="shrink-0 pt-0.5">
                    <input
                      type="checkbox"
                      aria-label={`Mark "${normalizeText(task.title) || task.taskKey}" complete`}
                      checked={isComplete}
                      disabled={disabledRow}
                      onChange={(e) => {
                        const nextCompleted = e.target.checked;
                        setError(null);
                        setPendingTaskKey(task.taskKey);
                        const previous = task;
                        const nowIso = new Date().toISOString();
                        setLocalRows((current) =>
                          current.map((t) => {
                            if (t.taskKey !== task.taskKey) return t;
                            return {
                              ...t,
                              status: nextCompleted ? "complete" : "pending",
                              completedAt: nextCompleted ? nowIso : null,
                              blockedReason: null,
                              updatedAt: nowIso,
                            };
                          }),
                        );
                        startTransition(() => {
                          upsertCustomerKickoffTaskCompletionAction({
                            quoteId,
                            taskKey: task.taskKey,
                            completed: nextCompleted,
                          })
                            .then((res) => {
                              if (!res.ok) {
                                setError("We couldn’t update that task. Please try again.");
                                setLocalRows((current) =>
                                  current.map((t) => (t.taskKey === previous.taskKey ? previous : t)),
                                );
                                return;
                              }
                              router.refresh();
                            })
                            .catch((err) => {
                              console.error("[customer kickoff tasks] toggle failed", {
                                quoteId,
                                taskKey: task.taskKey,
                                err,
                              });
                              setError("We couldn’t update that task. Please try again.");
                              setLocalRows((current) =>
                                current.map((t) => (t.taskKey === previous.taskKey ? previous : t)),
                              );
                            })
                            .finally(() => {
                              setPendingTaskKey(null);
                            });
                        });
                      }}
                      className={clsx(
                        "h-4 w-4 rounded border-slate-700 bg-slate-950/50",
                        "accent-slate-200",
                        "disabled:opacity-60",
                      )}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <p className="text-xs text-slate-400">
          Completed items update quietly—no notifications.
        </p>
      </div>
    </PortalCard>
  );
}

