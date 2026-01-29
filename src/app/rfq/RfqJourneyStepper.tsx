import clsx from "clsx";

type RfqJourneyStepperProps = {
  // 0..5 inclusive:
  // Upload → Processing → Waiting on offers → Offers ready → Awarded → In progress
  stageIndex: number;
};

const STAGES: Array<{ label: string; helper: string }> = [
  { label: "Upload", helper: "Files received" },
  { label: "Processing", helper: "Preparing your RFQ" },
  { label: "Waiting on offers", helper: "Suppliers reviewing" },
  { label: "Offers ready", helper: "Review options" },
  { label: "Awarded", helper: "Supplier selected" },
  { label: "In progress", helper: "Project underway" },
];

function clampStageIndex(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(STAGES.length - 1, Math.round(value)));
}

function StepIcon({ state, index }: { state: "done" | "active" | "todo"; index: number }) {
  const base =
    "grid h-8 w-8 place-items-center rounded-full border text-xs font-semibold transition-colors duration-300 motion-reduce:transition-none";

  if (state === "done") {
    return (
      <span className={clsx(base, "border-emerald-400/35 bg-emerald-500/10 text-emerald-100")}>
        <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4" aria-hidden="true">
          <path
            d="M16.5 5.8 8.6 13.7 3.6 8.7"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span className="sr-only">Completed</span>
      </span>
    );
  }

  if (state === "active") {
    return (
      <span
        className={clsx(
          base,
          "border-slate-500/60 bg-slate-950/60 text-ink shadow-[0_0_0_4px_rgba(15,23,42,0.55)]",
          "animate-pulse motion-reduce:animate-none",
        )}
      >
        {index + 1}
        <span className="sr-only">Current step</span>
      </span>
    );
  }

  return (
    <span className={clsx(base, "border-slate-900/70 bg-slate-950/30 text-ink-soft")}>
      {index + 1}
      <span className="sr-only">Upcoming</span>
    </span>
  );
}

export function RfqJourneyStepper({ stageIndex }: RfqJourneyStepperProps) {
  const current = clampStageIndex(stageIndex);
  const percent = Math.round((current / (STAGES.length - 1)) * 100);

  return (
    <section className="rounded-3xl border border-slate-900/60 bg-slate-950/35 px-5 py-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.35em] text-ink-soft">
            Journey
          </p>
          <p className="mt-2 text-sm font-semibold text-ink">
            Step {current + 1} of {STAGES.length}
          </p>
          <p className="mt-1 text-xs text-ink-soft">
            {STAGES[current]?.label} — {STAGES[current]?.helper}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-ink-soft">
            Progress
          </p>
          <p className="mt-1 text-sm font-semibold text-ink tabular-nums">{percent}%</p>
        </div>
      </header>

      <div className="mt-4">
        <div className="relative">
          <div className="absolute left-4 right-4 top-4 h-[2px] bg-slate-900/60" aria-hidden="true" />
          <div
            className="absolute left-4 top-4 h-[2px] bg-emerald-400/50 transition-[width] duration-700 ease-out motion-reduce:transition-none"
            style={{ width: `${percent}%` }}
            aria-hidden="true"
          />

          <ol className="relative grid grid-cols-6 gap-2">
            {STAGES.map((stage, idx) => {
              const state = idx < current ? "done" : idx === current ? "active" : "todo";
              return (
                <li key={stage.label} className="min-w-0">
                  <div className="flex flex-col items-center text-center">
                    <StepIcon state={state} index={idx} />
                    <p
                      className={clsx(
                        "mt-2 text-[11px] font-semibold uppercase tracking-[0.12em] transition-colors duration-300 motion-reduce:transition-none",
                        state === "done" ? "text-emerald-100" : state === "active" ? "text-ink" : "text-ink-soft",
                      )}
                      title={stage.label}
                    >
                      <span className="block truncate">{stage.label}</span>
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </section>
  );
}

