"use client";

/**
 * Supplier kickoff checklist UX (Phase 18.2.2).
 */

import { useMemo } from "react";
import { useRouter } from "next/navigation";

import {
  KickoffTasksChecklist,
  type KickoffTaskRow,
  type KickoffTasksChecklistUpdate,
  type KickoffTasksChecklistUpdateResult,
} from "@/components/KickoffTasksChecklist";
import { updateSupplierKickoffTaskStatusAction } from "./actions";

type SupplierKickoffChecklistCardProps = {
  quoteId: string;
  tasks: KickoffTaskRow[];
  readOnly?: boolean;
};

export function SupplierKickoffChecklistCard({
  quoteId,
  tasks,
  readOnly = false,
}: SupplierKickoffChecklistCardProps) {
  const router = useRouter();
  const hasTasks = Array.isArray(tasks) && tasks.length > 0;

  const completedCount = useMemo(
    () => (Array.isArray(tasks) ? tasks.filter((t) => t.status === "complete").length : 0),
    [tasks],
  );
  const totalCount = Array.isArray(tasks) ? tasks.length : 0;

  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-950/60 px-6 py-5">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Kickoff tasks
            </p>
            <h2 className="text-lg font-semibold text-white">
              Work starts now
            </h2>
          </div>
          <span className="rounded-full border border-slate-800 bg-slate-950/50 px-3 py-1 text-xs font-semibold text-slate-200">
            {totalCount > 0 ? `${completedCount}/${totalCount} complete` : "—"}
          </span>
        </div>
        <p className="text-sm text-slate-300">
          Confirm timing, materials, and handoff details so the project can move forward.
        </p>
      </header>

      {readOnly ? (
        <p className="mt-3 rounded-xl border border-slate-800 bg-black/30 px-4 py-2 text-xs text-slate-400">
          Read-only: only the awarded supplier can update kickoff progress.
        </p>
      ) : null}

      {!hasTasks ? (
        <p className="mt-4 rounded-xl border border-dashed border-slate-800/70 bg-black/30 px-4 py-3 text-sm text-slate-300">
          Kickoff not ready yet. Refresh in a moment.
        </p>
      ) : (
        <div className="mt-4">
          <KickoffTasksChecklist
            tasks={tasks}
            role={readOnly ? "customer" : "supplier"}
            onUpdate={async (
              update: KickoffTasksChecklistUpdate,
            ): Promise<KickoffTasksChecklistUpdateResult> => {
              const result = await updateSupplierKickoffTaskStatusAction({
                quoteId,
                taskKey: update.taskKey,
                status: update.status,
                blockedReason: update.blockedReason ?? null,
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
