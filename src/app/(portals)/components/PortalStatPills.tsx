import clsx from "clsx";
import type { WorkspaceMetric } from "../WorkspaceMetrics";

type PortalStatPillsProps = {
  role: "customer" | "supplier";
  metrics: WorkspaceMetric[];
  lastUpdatedLabel?: string | null;
};

const ROLE_ACCENT_BARS: Record<PortalStatPillsProps["role"], string> = {
  customer: "bg-emerald-400/60",
  supplier: "bg-blue-400/60",
};

const ROLE_LABEL_TEXT: Record<PortalStatPillsProps["role"], string> = {
  customer: "text-emerald-200",
  supplier: "text-blue-200",
};

export function PortalStatPills({
  role,
  metrics,
  lastUpdatedLabel,
}: PortalStatPillsProps) {
  if (!metrics.length) {
    return null;
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-500">
          Live workspace stats
        </p>
        {lastUpdatedLabel ? (
          <p className="text-[11px] text-slate-500">
            Updated {normalizeLabel(lastUpdatedLabel)}
          </p>
        ) : null}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {metrics.map((metric) => (
          <article
            key={metric.label}
            className="flex flex-1 flex-col gap-3 rounded-2xl border border-slate-900/70 bg-slate-950/60 px-6 py-5 shadow-[0_8px_30px_rgba(2,6,23,0.45)]"
          >
            <div className="flex items-center gap-2">
              <span
                className={clsx(
                  "h-1 w-8 rounded-full",
                  ROLE_ACCENT_BARS[role],
                )}
              />
              <span
                className={clsx(
                  "text-[11px] font-semibold uppercase tracking-[0.3em]",
                  ROLE_LABEL_TEXT[role],
                )}
              >
                {metric.label}
              </span>
            </div>
            <span className="text-3xl font-semibold text-white heading-tight">
              {metric.value.toLocaleString("en-US")}
            </span>
            {metric.helper ? (
              <span className="text-sm text-slate-400">{metric.helper}</span>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}

function normalizeLabel(label: string): string {
  if (!label.length) {
    return "just now";
  }
  return label.charAt(0).toLowerCase() === label.charAt(0)
    ? label
    : label.charAt(0).toLowerCase() + label.slice(1);
}

export { PortalStatPills as StatPills };
