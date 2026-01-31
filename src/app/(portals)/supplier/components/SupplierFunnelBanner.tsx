import clsx from "clsx";

type FunnelStep = 1 | 2 | 3;

const STEPS: Array<{
  step: FunnelStep;
  title: string;
  context: string;
  helper: string;
}> = [
  {
    step: 1,
    title: "New RFQs",
    context: "Step 1 of 3 — Submit offer",
    helper: "Review assigned RFQs and submit pricing + lead time.",
  },
  {
    step: 2,
    title: "Quote submitted",
    context: "Step 2 of 3 — Awaiting customer decision",
    helper: "Stay responsive in messages while the buyer decides.",
  },
  {
    step: 3,
    title: "Active project",
    context: "Step 3 of 3 — Project in progress",
    helper: "Kickoff tasks unlock after award; keep the project moving.",
  },
];

export function SupplierFunnelBanner({
  activeStep,
  className,
}: {
  activeStep?: FunnelStep;
  className?: string;
}) {
  return (
    <section
      className={clsx(
        "rounded-2xl border border-slate-900/60 bg-slate-950/25 p-4 sm:p-5",
        className,
      )}
      aria-label="Supplier workflow funnel"
    >
      <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-500">
        One workflow
      </p>
      <ol className="mt-3 grid gap-3 sm:grid-cols-3">
        {STEPS.map((step) => {
          const isActive = activeStep === step.step;
          return (
            <li
              key={step.step}
              className={clsx(
                "rounded-2xl border px-4 py-3 transition motion-reduce:transition-none",
                isActive
                  ? "border-blue-400/35 bg-blue-500/5"
                  : "border-slate-900/70 bg-black/20",
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p
                    className={clsx(
                      "text-xs font-semibold",
                      isActive ? "text-slate-100" : "text-slate-200",
                    )}
                  >
                    {step.context}
                  </p>
                  <p
                    className={clsx(
                      "mt-1 text-sm font-semibold",
                      isActive ? "text-white" : "text-slate-100",
                    )}
                  >
                    {step.title}
                  </p>
                </div>
                <span
                  className={clsx(
                    "inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold",
                    isActive
                      ? "border-blue-400/40 bg-blue-500/10 text-blue-100"
                      : "border-slate-800 bg-slate-950/40 text-slate-400",
                  )}
                >
                  {step.step}/3
                </span>
              </div>
              <p className="mt-2 text-xs text-slate-500">{step.helper}</p>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

