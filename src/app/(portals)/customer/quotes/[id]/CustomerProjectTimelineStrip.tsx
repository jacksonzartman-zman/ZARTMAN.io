import clsx from "clsx";
import type { CustomerProjectTimelineStep } from "@/lib/quote/customerProjectTimeline";

export function CustomerProjectTimelineStrip({
  title = "Project timeline",
  steps,
  className,
}: {
  title?: string;
  steps: CustomerProjectTimelineStep[];
  className?: string;
}) {
  return (
    <section
      className={clsx(
        "rounded-2xl border border-slate-900/60 bg-slate-950/40 px-5 py-4",
        className,
      )}
    >
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-white">{title}</h2>
        <p className="text-xs text-slate-400">
          We’ll update this as your request moves forward.
        </p>
      </header>

      <ol className="mt-3 grid gap-2">
        {steps.map((step) => {
          const dotClass =
            step.status === "complete"
              ? "bg-emerald-400"
              : step.status === "current"
                ? "bg-blue-300"
                : "bg-slate-700";
          const textClass =
            step.status === "complete"
              ? "text-slate-200"
              : step.status === "current"
                ? "text-white"
                : "text-slate-500";

          return (
            <li key={step.id} className="flex items-center gap-3">
              <span className={clsx("h-2.5 w-2.5 shrink-0 rounded-full", dotClass)} />
              <span className={clsx("text-sm", textClass)}>{step.label}</span>
              {step.status === "current" ? (
                <span className="ml-auto rounded-full border border-blue-400/40 bg-blue-500/10 px-2 py-0.5 text-[11px] font-semibold text-blue-100">
                  Current
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

