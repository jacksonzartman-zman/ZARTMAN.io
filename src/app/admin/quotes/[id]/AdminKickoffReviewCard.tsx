"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";

import clsx from "clsx";

import {
  KickoffTasksChecklist,
  type KickoffTaskRow,
  type KickoffTasksChecklistUpdate,
  type KickoffTasksChecklistUpdateResult,
} from "@/components/KickoffTasksChecklist";
import { updateAdminKickoffTaskAction } from "./actions";
import { AdminKickoffUpdateRequestButton } from "./AdminKickoffUpdateRequestButton";

type AdminKickoffReviewCardProps = {
  quoteId: string;
  hasWinner: boolean;
  tasks: KickoffTaskRow[];
  summary?: {
    completedCount: number;
    blockedCount: number;
    pendingCount: number;
    total: number;
    percentComplete: number;
  } | null;
  kickoffStalled?: boolean;
  unavailable?: boolean;
  className?: string;
};

export function AdminKickoffReviewCard({
  quoteId,
  hasWinner,
  tasks,
  summary = null,
  kickoffStalled = false,
  unavailable = false,
  className,
}: AdminKickoffReviewCardProps) {
  const router = useRouter();
  const hasTasks = Array.isArray(tasks) && tasks.length > 0;

  const derived = useMemo(() => {
    if (summary) {
      return {
        completedCount: summary.completedCount,
        blockedCount: summary.blockedCount,
        totalCount: summary.total,
        percentComplete: summary.percentComplete,
      };
    }
    const completedCount = Array.isArray(tasks)
      ? tasks.filter((t) => t.status === "complete").length
      : 0;
    const blockedCount = Array.isArray(tasks)
      ? tasks.filter((t) => t.status === "blocked").length
      : 0;
    const totalCount = Array.isArray(tasks) ? tasks.length : 0;
    const percentComplete =
      totalCount > 0 ? Math.max(0, Math.min(100, Math.round((completedCount / totalCount) * 100))) : 0;
    return { completedCount, blockedCount, totalCount, percentComplete };
  }, [summary, tasks]);

  if (!hasWinner) {
    return (
      <section className={clsx(className, "rounded-2xl border border-slate-800 bg-slate-950/60 px-6 py-5")}>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Kickoff review
        </p>
        <h2 className="mt-1 text-lg font-semibold text-white">
          Award a supplier to begin kickoff.
        </h2>
        <p className="mt-2 text-sm text-slate-300">
          Once a winner is selected, ops can track kickoff progress and mark tasks pending, complete, or blocked.
        </p>
      </section>
    );
  }

  if (unavailable) {
    return (
      <section className={clsx(className, "rounded-2xl border border-slate-800 bg-slate-950/60 px-6 py-5")}>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Kickoff review
        </p>
        <h2 className="mt-1 text-lg font-semibold text-white">
          Kickoff tasks unavailable
        </h2>
        <p className="mt-2 text-sm text-slate-300">
          This environment doesn’t have kickoff tasks enabled or they could not be loaded.
        </p>
      </section>
    );
  }

  return (
    <section className={clsx(className, "rounded-2xl border border-slate-800 bg-slate-950/60 px-6 py-5")}>
      <header className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Kickoff review
            </p>
            <h2 className="text-lg font-semibold text-white">
              Is the winner moving?
            </h2>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {derived.totalCount > 0 ? (
              <span className="rounded-full border border-slate-800 bg-slate-950/50 px-3 py-1 text-xs font-semibold text-slate-200">
                {derived.completedCount}/{derived.totalCount} complete
              </span>
            ) : (
              <span className="rounded-full border border-slate-800 bg-slate-950/50 px-3 py-1 text-xs font-semibold text-slate-200">
                —
              </span>
            )}
            {derived.blockedCount > 0 ? (
              <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-100">
                {derived.blockedCount} blocked
              </span>
            ) : null}
            {kickoffStalled ? (
              <span className="rounded-full border border-red-500/30 bg-red-500/10 px-3 py-1 text-xs font-semibold text-red-100">
                Kickoff stalled
              </span>
            ) : null}
          </div>
        </div>
        <p className="text-sm text-slate-300">
          Update task status as you confirm progress with the awarded supplier. Admin edits revalidate this page.
        </p>
        {kickoffStalled ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/25 bg-amber-500/5 px-4 py-3 text-sm text-amber-50">
            <div className="min-w-0">
              <p className="font-semibold text-white">
                Kickoff looks stalled.
              </p>
              <p className="mt-1 text-xs text-amber-100/80">
                Awarded &gt; 72h ago, low completion (&lt; 40%), and no recent kickoff updates.
              </p>
            </div>
            <AdminKickoffUpdateRequestButton quoteId={quoteId} />
          </div>
        ) : null}
      </header>

      {!hasTasks ? (
        <p className="mt-4 rounded-xl border border-dashed border-slate-800/70 bg-black/30 px-4 py-3 text-sm text-slate-300">
          Kickoff tasks aren’t available yet. Refresh in a moment.
        </p>
      ) : (
        <div className="mt-4">
          <KickoffTasksChecklist
            tasks={tasks}
            role="admin"
            onUpdate={async (
              update: KickoffTasksChecklistUpdate,
            ): Promise<KickoffTasksChecklistUpdateResult> => {
              const result = await updateAdminKickoffTaskAction({
                quoteId,
                taskKey: update.taskKey,
                status: update.status,
                blockedReason: update.blockedReason ?? null,
                title: typeof update.title === "string" ? update.title : undefined,
                description:
                  typeof update.description === "undefined" ? undefined : update.description,
              });
              if (!result.ok) {
                return { ok: false, error: result.error };
              }
              router.refresh();
              return { ok: true };
            }}
          />
        </div>
      )}
    </section>
  );
}

