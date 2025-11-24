import clsx from "clsx";
import type { PortalRole } from "@/types/portal";

export type WorkspaceMetric = {
  label: string;
  value: number;
  helper?: string;
};

type WorkspaceMetricsProps = {
  role: PortalRole;
  metrics: WorkspaceMetric[];
  lastUpdatedLabel?: string | null;
};

const ROLE_ACCENTS: Record<PortalRole, string> = {
  customer: "bg-emerald-400/40",
  supplier: "bg-blue-400/40",
};

const ROLE_CARD_BORDER: Record<PortalRole, string> = {
  customer: "border-emerald-500/20",
  supplier: "border-blue-500/20",
};

const ROLE_LIVE_DOT: Record<PortalRole, string> = {
  customer: "bg-emerald-300/90",
  supplier: "bg-blue-300/90",
};

export function WorkspaceMetrics({
  role,
  metrics,
  lastUpdatedLabel,
}: WorkspaceMetricsProps) {
  return (
    <section className="rounded-2xl border border-slate-900/70 bg-slate-950/70 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-500">
            Workspace metrics
          </p>
          <p className="mt-1 text-xs text-slate-400">
            {lastUpdatedLabel
              ? `Tracking activity ${normalizeLastUpdatedLabel(lastUpdatedLabel)}`
              : "Counts refresh automatically as soon as we see activity."}
          </p>
        </div>
        <span className="inline-flex items-center gap-2 text-xs font-semibold text-slate-300">
          <span
            className={clsx("h-2 w-2 rounded-full", ROLE_LIVE_DOT[role])}
            aria-hidden="true"
          />
          Live
        </span>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        {metrics.map((metric) => (
          <article
            key={metric.label}
            className={clsx(
              "rounded-2xl border border-slate-900/70 bg-slate-950/60 p-4",
              ROLE_CARD_BORDER[role],
            )}
          >
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <span
                className={clsx("h-1 w-8 rounded-full", ROLE_ACCENTS[role])}
                aria-hidden="true"
              />
              {metric.label}
            </div>
            <p className="mt-3 text-3xl font-semibold text-white">
              {metric.value.toLocaleString("en-US")}
            </p>
            {metric.helper ? (
              <p className="mt-2 text-sm text-slate-400">{metric.helper}</p>
            ) : null}
          </article>
        ))}
        {metrics.length === 0 ? (
          <div className="rounded-2xl border border-slate-900/70 bg-slate-950/60 p-4 text-sm text-slate-400">
            No metrics yet. The dashboard will populate as soon as we see live data.
          </div>
        ) : null}
      </div>
    </section>
  );
}

function normalizeLastUpdatedLabel(label: string): string {
  if (!label.length) {
    return "just now";
  }
  return label.charAt(0).toLowerCase() === label.charAt(0)
    ? label
    : label.charAt(0).toLowerCase() + label.slice(1);
}
