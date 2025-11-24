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
  customer: "from-emerald-500/10 via-emerald-500/5 to-transparent",
  supplier: "from-blue-500/10 via-blue-500/5 to-transparent",
};

const ROLE_CARD_BORDER: Record<PortalRole, string> = {
  customer: "border-emerald-500/30",
  supplier: "border-blue-500/30",
};

const ROLE_LIVE_DOT: Record<PortalRole, string> = {
  customer: "bg-emerald-300",
  supplier: "bg-blue-300",
};

export function WorkspaceMetrics({
  role,
  metrics,
  lastUpdatedLabel,
}: WorkspaceMetricsProps) {
  return (
    <section className="rounded-2xl border border-slate-900 bg-slate-950/60 p-6 shadow-sm shadow-slate-950/40">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.35em] text-slate-500">
            Workspace metrics
          </p>
          <p className="mt-1 text-xs text-slate-400">
            {lastUpdatedLabel
              ? `Last updated ${lastUpdatedLabel}`
              : "We’ll refresh these counts as soon as activity arrives."}
          </p>
        </div>
        <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-300">
          <span
            className={clsx("h-2 w-2 rounded-full", ROLE_LIVE_DOT[role])}
            aria-hidden="true"
          />
          Live
        </span>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-3">
        {metrics.map((metric) => (
          <div
            key={metric.label}
            className={clsx(
              "rounded-2xl border bg-gradient-to-br p-4 shadow-inner shadow-black/20",
              ROLE_CARD_BORDER[role],
              ROLE_ACCENTS[role],
            )}
          >
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {metric.label}
            </p>
            <p className="mt-2 text-3xl font-semibold text-white">
              {metric.value.toLocaleString("en-US")}
            </p>
            {metric.helper ? (
              <p className="mt-1 text-xs text-slate-400">{metric.helper}</p>
            ) : null}
          </div>
        ))}
        {metrics.length === 0 ? (
          <div
            className={clsx(
              "rounded-2xl border bg-slate-950/70 p-4 text-sm text-slate-400",
              ROLE_CARD_BORDER[role],
            )}
          >
            No metrics yet. The dashboard will populate as soon as we see live data.
          </div>
        ) : null}
      </div>
    </section>
  );
}
