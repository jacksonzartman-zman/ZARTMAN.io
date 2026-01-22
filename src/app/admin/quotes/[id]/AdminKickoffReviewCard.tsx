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

type AdminKickoffReviewCardProps = {
  quoteId: string;
  hasWinner: boolean;
  tasks: KickoffTaskRow[];
  unavailable?: boolean;
  className?: string;
};

export function AdminKickoffReviewCard({
  quoteId,
  hasWinner,
  tasks,
  unavailable = false,
  className,
}: AdminKickoffReviewCardProps) {
  const router = useRouter();
  const hasTasks = Array.isArray(tasks) && tasks.length > 0;

  const completedCount = useMemo(
    () => (Array.isArray(tasks) ? tasks.filter((t) => t.status === "complete").length : 0),
    [tasks],
  );
  const totalCount = Array.isArray(tasks) ? tasks.length : 0;

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
          <span className="rounded-full border border-slate-800 bg-slate-950/50 px-3 py-1 text-xs font-semibold text-slate-200">
            {totalCount > 0 ? `${completedCount}/${totalCount} complete` : "—"}
          </span>
        </div>
        <p className="text-sm text-slate-300">
          Update task status as you confirm progress with the awarded supplier. Admin edits revalidate this page.
        </p>
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

