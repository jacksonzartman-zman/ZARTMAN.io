import type { WorkspaceMetric } from "../../WorkspaceMetrics";

function normalizeLabel(label: string): string {
  if (!label.length) {
    return "just now";
  }
  return label.charAt(0).toLowerCase() === label.charAt(0)
    ? label
    : label.charAt(0).toLowerCase() + label.slice(1);
}

type StatPillsProps = {
  metrics: WorkspaceMetric[];
  lastUpdatedLabel?: string | null;
};

export function StatPills({ metrics, lastUpdatedLabel }: StatPillsProps) {
  if (!metrics.length) {
    return null;
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-500">
          Live workspace stats
        </p>
        {lastUpdatedLabel ? (
          <p className="text-[11px] text-slate-500">
            Updated {normalizeLabel(lastUpdatedLabel)}
          </p>
        ) : null}
      </div>
      <div className="flex flex-col gap-3 sm:flex-row">
        {metrics.map((metric) => (
          <article
            key={metric.label}
            className="flex flex-1 flex-col gap-1 rounded-full border border-slate-900/60 bg-slate-950/60 px-4 py-3 shadow-[0_4px_30px_rgba(2,6,23,0.45)] sm:rounded-2xl"
          >
            <span className="text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-500">
              {metric.label}
            </span>
            <span className="text-2xl font-semibold text-white">
              {metric.value.toLocaleString("en-US")}
            </span>
            {metric.helper ? (
              <span className="text-[11px] text-slate-400">{metric.helper}</span>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}
