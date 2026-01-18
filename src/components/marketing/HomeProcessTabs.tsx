"use client";

import { useState } from "react";

type ProcessItem = {
  key: string;
  label: string;
  description: string;
  examples?: string[];
};

type HomeProcessTabsProps = {
  processes: ProcessItem[];
};

export default function HomeProcessTabs({ processes }: HomeProcessTabsProps) {
  const [activeKey, setActiveKey] = useState(processes[0]?.key ?? "");
  const activeProcess =
    processes.find((process) => process.key === activeKey) ?? processes[0];

  if (!activeProcess) {
    return null;
  }

  return (
    <div className="space-y-4">
      <div
        className="flex flex-wrap items-center gap-2"
        role="tablist"
        aria-label="Manufacturing processes"
      >
        {processes.map((process) => {
          const isActive = process.key === activeProcess.key;

          return (
            <button
              key={process.key}
              type="button"
              aria-pressed={isActive}
              aria-controls="process-panel"
              onClick={() => setActiveKey(process.key)}
              className={`rounded-full border px-4 py-2 text-xs font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300 ${
                isActive
                  ? "border-emerald-400/60 bg-emerald-400/10 text-emerald-100 shadow-[0_0_0_1px_rgba(16,185,129,0.25)]"
                  : "border-slate-900/70 bg-slate-900/40 text-ink-soft hover:border-slate-700/80 hover:bg-slate-900/70"
              }`}
            >
              {process.label}
            </button>
          );
        })}
      </div>
      <div
        id="process-panel"
        className="rounded-2xl border border-slate-900/70 bg-slate-950/80 p-4 sm:p-5"
      >
        <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-ink-soft">
          {activeProcess.label}
        </p>
        <p className="mt-2 text-sm text-ink-muted heading-snug">
          {activeProcess.description}
        </p>
        {activeProcess.examples && activeProcess.examples.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {activeProcess.examples.map((example) => (
              <span
                key={example}
                className="rounded-full border border-slate-900/70 bg-slate-900/40 px-3 py-1 text-[10px] font-semibold text-ink-soft"
              >
                {example}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
