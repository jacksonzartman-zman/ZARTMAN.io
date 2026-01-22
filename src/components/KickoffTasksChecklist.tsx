"use client";

import clsx from "clsx";
import { useEffect, useMemo, useState, useTransition } from "react";

import { formatRelativeTimeFromTimestamp, toTimestamp } from "@/lib/relativeTime";

export type KickoffTaskStatus = "pending" | "complete" | "blocked";

export type KickoffTaskRow = {
  taskKey: string;
  title: string;
  description: string | null;
  sortOrder: number;
  status: KickoffTaskStatus;
  completedAt: string | null;
  blockedReason: string | null;
  updatedAt: string;
};

export type KickoffTasksChecklistRole = "supplier" | "admin" | "customer";

export type KickoffTasksChecklistUpdate = {
  taskKey: string;
  status: KickoffTaskStatus;
  blockedReason?: string | null;
};

export type KickoffTasksChecklistUpdateResult =
  | { ok: true }
  | { ok: false; error: string };

export type KickoffTasksChecklistProps = {
  tasks: KickoffTaskRow[];
  role: KickoffTasksChecklistRole;
  onUpdate: (
    update: KickoffTasksChecklistUpdate,
  ) => Promise<KickoffTasksChecklistUpdateResult>;
};

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function sortTasks(tasks: KickoffTaskRow[]): KickoffTaskRow[] {
  return [...tasks].sort((a, b) => {
    const aSort = Number.isFinite(a.sortOrder) ? a.sortOrder : Number.MAX_SAFE_INTEGER;
    const bSort = Number.isFinite(b.sortOrder) ? b.sortOrder : Number.MAX_SAFE_INTEGER;
    if (aSort !== bSort) return aSort - bSort;
    return a.taskKey.localeCompare(b.taskKey);
  });
}

function formatCompletedAtLabel(completedAt: string | null): string | null {
  const iso = normalizeText(completedAt);
  if (!iso) return null;
  return formatRelativeTimeFromTimestamp(toTimestamp(iso)) ?? iso;
}

export function KickoffTasksChecklist({ tasks, role, onUpdate }: KickoffTasksChecklistProps) {
  const canEdit = role === "supplier" || role === "admin";

  const sorted = useMemo(() => sortTasks(Array.isArray(tasks) ? tasks : []), [tasks]);
  const [localTasks, setLocalTasks] = useState(sorted);
  const [pendingTaskKey, setPendingTaskKey] = useState<string | null>(null);
  const [result, setResult] = useState<KickoffTasksChecklistUpdateResult | null>(null);
  const [isPending, startTransition] = useTransition();

  const [blockingTaskKey, setBlockingTaskKey] = useState<string | null>(null);
  const [blockReasonDraft, setBlockReasonDraft] = useState<string>("");

  useEffect(() => {
    setLocalTasks(sorted);
  }, [sorted]);

  const disabledAll = !canEdit || isPending;

  function applyLocalPatch(taskKey: string, patch: Partial<KickoffTaskRow>) {
    setLocalTasks((current) =>
      current.map((t) => (t.taskKey === taskKey ? { ...t, ...patch } : t)),
    );
  }

  function revertLocalTask(taskKey: string, previous: KickoffTaskRow) {
    setLocalTasks((current) => current.map((t) => (t.taskKey === taskKey ? previous : t)));
  }

  async function submitUpdate(task: KickoffTaskRow, update: KickoffTasksChecklistUpdate) {
    if (!canEdit) return;
    if (!task.taskKey) return;

    setResult(null);
    setPendingTaskKey(task.taskKey);

    const previous = task;
    const nowIso = new Date().toISOString();
    const nextStatus = update.status;
    const nextBlockedReason = normalizeText(update.blockedReason) || null;

    // Optimistic patch.
    if (nextStatus === "complete") {
      applyLocalPatch(task.taskKey, {
        status: "complete",
        completedAt: nowIso,
        blockedReason: null,
        updatedAt: nowIso,
      });
    } else if (nextStatus === "blocked") {
      applyLocalPatch(task.taskKey, {
        status: "blocked",
        blockedReason: nextBlockedReason,
        completedAt: null,
        updatedAt: nowIso,
      });
    } else {
      applyLocalPatch(task.taskKey, {
        status: "pending",
        blockedReason: null,
        completedAt: null,
        updatedAt: nowIso,
      });
    }

    startTransition(() => {
      onUpdate(update)
        .then((res) => {
          if (!res.ok) {
            setResult(res);
            revertLocalTask(task.taskKey, previous);
            return;
          }
          setResult({ ok: true });
        })
        .catch((error) => {
          console.error("[kickoff checklist] update failed", { taskKey: task.taskKey, error });
          setResult({ ok: false, error: "We couldn’t update that task. Please try again." });
          revertLocalTask(task.taskKey, previous);
        })
        .finally(() => {
          setPendingTaskKey(null);
        });
    });
  }

  if (localTasks.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-slate-800/70 bg-black/30 px-4 py-3 text-sm text-slate-300">
        Kickoff tasks aren’t available yet. Refresh in a moment.
      </p>
    );
  }

  const successMessage = result && result.ok ? "Saved." : null;
  const errorMessage = result && !result.ok ? result.error : null;

  return (
    <div className="space-y-3">
      {successMessage ? (
        <p className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-100">
          {successMessage}
        </p>
      ) : null}
      {errorMessage ? (
        <p className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-100">
          {errorMessage}
        </p>
      ) : null}

      <ul className="space-y-3">
        {localTasks.map((task) => {
          const isRowPending = pendingTaskKey === task.taskKey;
          const disabledRow = disabledAll || isRowPending || !task.taskKey;

          const statusTone =
            task.status === "complete"
              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-100"
              : task.status === "blocked"
                ? "border-amber-500/40 bg-amber-500/10 text-amber-100"
                : "border-slate-800 bg-slate-950/50 text-slate-200";

          const completedAtLabel = formatCompletedAtLabel(task.completedAt);
          const showBlockEditor = canEdit && blockingTaskKey === task.taskKey;

          const primaryAction = (() => {
            if (!canEdit) return null;
            if (task.status === "pending") {
              return (
                <button
                  type="button"
                  disabled={disabledRow}
                  onClick={() => void submitUpdate(task, { taskKey: task.taskKey, status: "complete" })}
                  className={clsx(
                    "rounded-full border px-3 py-1 text-xs font-semibold transition",
                    "border-slate-700 bg-slate-950/40 text-slate-200 hover:border-slate-500 hover:text-white",
                    "disabled:cursor-not-allowed disabled:opacity-60",
                  )}
                >
                  Mark complete
                </button>
              );
            }

            if (task.status === "blocked") {
              return (
                <button
                  type="button"
                  disabled={disabledRow}
                  onClick={() => void submitUpdate(task, { taskKey: task.taskKey, status: "pending" })}
                  className={clsx(
                    "rounded-full border px-3 py-1 text-xs font-semibold transition",
                    "border-slate-700 bg-slate-950/40 text-slate-200 hover:border-slate-500 hover:text-white",
                    "disabled:cursor-not-allowed disabled:opacity-60",
                  )}
                >
                  Clear block
                </button>
              );
            }

            if (role === "admin" && task.status === "complete") {
              return (
                <button
                  type="button"
                  disabled={disabledRow}
                  onClick={() => void submitUpdate(task, { taskKey: task.taskKey, status: "pending" })}
                  className={clsx(
                    "rounded-full border px-3 py-1 text-xs font-semibold transition",
                    "border-slate-700 bg-slate-950/40 text-slate-200 hover:border-slate-500 hover:text-white",
                    "disabled:cursor-not-allowed disabled:opacity-60",
                  )}
                >
                  Reopen
                </button>
              );
            }

            return null;
          })();

          return (
            <li
              key={task.taskKey}
              className="rounded-2xl border border-slate-800 bg-slate-950/50 px-4 py-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="text-sm font-semibold text-white">{task.title}</p>
                  {task.description ? (
                    <p className="text-sm text-slate-300">{task.description}</p>
                  ) : null}
                  {task.status === "blocked" && task.blockedReason ? (
                    <p className="text-xs text-amber-200/90">{task.blockedReason}</p>
                  ) : null}
                  {task.status === "complete" ? (
                    <p className="text-xs text-slate-400">
                      {completedAtLabel ? `Completed ${completedAtLabel}` : "Completed"}
                    </p>
                  ) : null}

                  {canEdit && task.status === "pending" ? (
                    <div className="pt-1">
                      {showBlockEditor ? (
                        <div className="space-y-2">
                          <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                            Block reason
                          </label>
                          <div className="flex flex-wrap items-center gap-2">
                            <input
                              value={blockReasonDraft}
                              onChange={(e) => setBlockReasonDraft(e.target.value)}
                              disabled={disabledRow}
                              className="min-w-[240px] flex-1 rounded-lg border border-slate-800 bg-black/40 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-blue-400 focus:outline-none disabled:opacity-60"
                              placeholder="What’s blocking this task?"
                              maxLength={240}
                            />
                            <button
                              type="button"
                              disabled={disabledRow || !normalizeText(blockReasonDraft)}
                              onClick={() => {
                                const reason = normalizeText(blockReasonDraft);
                                if (!reason) return;
                                void submitUpdate(task, {
                                  taskKey: task.taskKey,
                                  status: "blocked",
                                  blockedReason: reason,
                                }).finally(() => {
                                  setBlockingTaskKey(null);
                                  setBlockReasonDraft("");
                                });
                              }}
                              className={clsx(
                                "rounded-full border px-3 py-2 text-xs font-semibold transition",
                                "border-amber-500/40 bg-amber-500/10 text-amber-100 hover:border-amber-400 hover:text-white",
                                "disabled:cursor-not-allowed disabled:opacity-60",
                              )}
                            >
                              Block task
                            </button>
                            <button
                              type="button"
                              disabled={disabledRow}
                              onClick={() => {
                                setBlockingTaskKey(null);
                                setBlockReasonDraft("");
                              }}
                              className="text-xs font-semibold text-slate-400 underline-offset-4 hover:text-slate-200 hover:underline disabled:opacity-60"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          type="button"
                          disabled={disabledRow}
                          onClick={() => {
                            setResult(null);
                            setBlockingTaskKey(task.taskKey);
                            setBlockReasonDraft("");
                          }}
                          className="text-xs font-semibold text-slate-400 underline-offset-4 hover:text-slate-200 hover:underline disabled:opacity-60"
                        >
                          Block…
                        </button>
                      )}
                    </div>
                  ) : null}
                </div>

                <div className="shrink-0 space-y-2 text-right">
                  <span className={clsx("inline-flex rounded-full border px-3 py-1 text-xs font-semibold", statusTone)}>
                    {task.status === "complete" ? "Complete" : task.status === "blocked" ? "Blocked" : "Pending"}
                  </span>
                  <div className="flex justify-end">{primaryAction}</div>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

