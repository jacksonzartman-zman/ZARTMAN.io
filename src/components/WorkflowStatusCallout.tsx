import clsx from "clsx";
import { formatWorkflowStateLabel } from "@/lib/workflow";

type WorkflowStatusCalloutProps = {
  currentLabel: string;
  nextState: string | null;
  variant?: "emerald" | "blue";
  className?: string;
};

export function WorkflowStatusCallout({
  currentLabel,
  nextState,
  variant = "emerald",
  className,
}: WorkflowStatusCalloutProps) {
  const palette =
    variant === "blue"
      ? {
          currentBadge: "border-blue-500/40 bg-blue-500/10 text-blue-100",
          nextBadge: "border-slate-800 bg-slate-900/60 text-slate-200",
        }
      : {
          currentBadge: "border-emerald-500/40 bg-emerald-500/10 text-emerald-100",
          nextBadge: "border-slate-800 bg-slate-900/60 text-slate-200",
        };

  return (
    <div
      className={clsx(
        "rounded-xl border border-slate-900/60 bg-slate-950/40 p-3",
        className,
      )}
    >
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        Workflow
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs font-semibold">
        <span
          className={clsx(
            "inline-flex items-center rounded-full px-3 py-1",
            palette.currentBadge,
          )}
        >
          Current: {currentLabel}
        </span>
        <span className="text-slate-500">→</span>
        <span
          className={clsx(
            "inline-flex items-center rounded-full border px-3 py-1",
            nextState ? palette.nextBadge : "border-emerald-500/30 text-emerald-200",
          )}
        >
          {nextState ? formatWorkflowStateLabel(nextState) : "Final milestone"}
        </span>
      </div>
      <p className="mt-2 text-[11px] uppercase tracking-wide text-slate-500">
        {nextState
          ? "Up next once the team advances this RFQ."
          : "This RFQ has reached the end of the workflow."}
      </p>
    </div>
  );
}
