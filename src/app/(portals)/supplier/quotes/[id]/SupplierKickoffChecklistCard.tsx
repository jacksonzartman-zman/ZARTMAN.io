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
import { EmptyStateCard } from "@/components/EmptyStateCard";
import { updateSupplierKickoffTaskStatusAction } from "./actions";
import PortalCard from "../../../PortalCard";

type SupplierKickoffChecklistCardProps = {
  quoteId: string;
  tasks: KickoffTaskRow[];
  summary?: {
    completedCount: number;
    blockedCount: number;
    pendingCount: number;
    total: number;
    percentComplete: number;
  } | null;
  readOnly?: boolean;
};

export function SupplierKickoffChecklistCard({
  quoteId,
  tasks,
  summary = null,
  readOnly = false,
}: SupplierKickoffChecklistCardProps) {
  const router = useRouter();
  const hasTasks = Array.isArray(tasks) && tasks.length > 0;

  const derived = useMemo(() => {
    if (summary) {
      return { completedCount: summary.completedCount, totalCount: summary.total };
    }
    const completedCount = Array.isArray(tasks)
      ? tasks.filter((t) => t.status === "complete").length
      : 0;
    const totalCount = Array.isArray(tasks) ? tasks.length : 0;
    return { completedCount, totalCount };
  }, [summary, tasks]);

  return (
    <PortalCard
      title="Kickoff tasks"
      description="Confirm timing, materials, and handoff details so the project can move forward."
      action={
        <span className="rounded-full border border-slate-800 bg-slate-950/50 px-3 py-1 text-xs font-semibold text-slate-200">
          {derived.totalCount > 0 ? `${derived.completedCount}/${derived.totalCount} complete` : "—"}
        </span>
      }
    >
      <div className="space-y-4">

        {readOnly ? (
          <p className="rounded-xl border border-slate-800 bg-black/30 px-4 py-2 text-xs text-slate-400">
            Read-only: only the awarded supplier can update kickoff progress.
          </p>
        ) : null}

        {!hasTasks ? (
          <EmptyStateCard
            title="Kickoff not ready yet"
            description="Refresh in a moment to load kickoff tasks."
            className="px-4 py-3"
          />
        ) : (
          <div>
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
      </div>
    </PortalCard>
  );
}
