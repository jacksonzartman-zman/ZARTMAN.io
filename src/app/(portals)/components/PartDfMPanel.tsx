"use client";

import clsx from "clsx";
import { useMemo } from "react";
import {
  evaluatePartForDfM,
  type DfMCheckResult,
  type GeometryStats,
} from "@/lib/dfm/basicPartChecks";

type PartDfMPanelProps = {
  geometryStats?: GeometryStats | null;
  process?: string | null;
  material?: string | null;
  quantityHint?: string | number | null;
  targetDate?: string | null;
  className?: string;
};

export function PartDfMPanel({
  geometryStats,
  process,
  material,
  quantityHint,
  targetDate,
  className,
}: PartDfMPanelProps) {
  const evaluation = useMemo(
    () =>
      evaluatePartForDfM({
        geometry: geometryStats ?? null,
        process,
        material,
        quantityHint,
        targetDate,
      }),
    [geometryStats, material, process, quantityHint, targetDate],
  );

  const severityClass = getSummaryPillClass(evaluation);
  const hasChecks = evaluation.checks.length > 0;

  return (
    <section
      className={clsx(
        "rounded-2xl border border-slate-900/60 bg-slate-950/60 p-4",
        className,
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">
            Part DFM
          </p>
          <p className="text-sm text-slate-300">{evaluation.summary}</p>
        </div>
        <span className={clsx("pill text-xs font-semibold", severityClass)}>
          {evaluation.ok
            ? hasWarning(evaluation.checks)
              ? "Warnings"
              : "Ready"
            : "Issues"}
        </span>
      </div>
      <div className="mt-4 space-y-3">
        {hasChecks ? (
          evaluation.checks.map((check) => (
            <article
              key={check.id}
              className="rounded-xl border border-slate-900/60 bg-slate-950/50 p-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold text-white">{check.title}</p>
                <span
                  className={clsx(
                    "pill text-[11px] font-semibold uppercase tracking-wide",
                    getSeverityPillClass(check.severity),
                  )}
                >
                  {formatSeverityLabel(check.severity)}
                </span>
              </div>
              <p className="mt-1 text-sm text-slate-300">{check.message}</p>
            </article>
          ))
        ) : (
          <p className="rounded-xl border border-dashed border-slate-900/60 bg-slate-950/30 px-4 py-3 text-sm text-slate-400">
            No automated flags yet. Upload an STL to run geometry-based checks.
          </p>
        )}
      </div>
    </section>
  );
}

function hasWarning(checks: DfMCheckResult[]): boolean {
  return checks.some((check) => check.severity === "warning");
}

function getSummaryPillClass(evaluation: ReturnType<typeof evaluatePartForDfM>) {
  if (!evaluation.ok) {
    return "pill-danger";
  }
  return hasWarning(evaluation.checks) ? "pill-warning" : "pill-success";
}

function getSeverityPillClass(severity: DfMCheckResult["severity"]) {
  switch (severity) {
    case "error":
      return "pill-danger";
    case "warning":
      return "pill-warning";
    default:
      return "pill-info";
  }
}

function formatSeverityLabel(severity: DfMCheckResult["severity"]) {
  switch (severity) {
    case "error":
      return "Issue";
    case "warning":
      return "Warning";
    default:
      return "Note";
  }
}
