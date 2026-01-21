import type { ReactNode } from "react";
import clsx from "clsx";
import AdminDashboardShell from "@/app/admin/AdminDashboardShell";
import { requireAdminUser } from "@/server/auth";
import {
  loadAdminOpsMetrics,
  type OpsMetricsSnapshot,
  type OpsMetricsWindow,
} from "@/server/admin/opsMetrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WINDOW_ORDER: OpsMetricsWindow[] = ["7d", "30d"];
const WINDOW_LABELS: Record<OpsMetricsWindow, string> = {
  "7d": "Last 7 days",
  "30d": "Last 30 days",
};

export default async function AdminOpsMetricsPage() {
  await requireAdminUser({ redirectTo: "/login" });

  const metricsResult = await loadAdminOpsMetrics();
  const windows = WINDOW_ORDER.map((key) => metricsResult.data.windows[key]);

  return (
    <AdminDashboardShell
      title="Ops metrics"
      description="Funnel conversion and median time-to-step for newly created quotes."
    >
      {!metricsResult.ok ? (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-950/30 px-6 py-4 text-sm text-amber-100">
          Ops metrics are unavailable in this environment. Check schema access and try again.
        </div>
      ) : null}

      <Section
        title="Funnel conversion"
        subtitle="Counts are based on quotes created in each window."
      >
        <div className="grid gap-4 lg:grid-cols-2">
          {windows.map((snapshot) => (
            <WindowCard
              key={snapshot.window}
              title={WINDOW_LABELS[snapshot.window]}
              range={formatRange(snapshot)}
            >
              <div className="mt-4 grid gap-3">
                {buildFunnelRows(snapshot).map((row) => (
                  <FunnelCard
                    key={row.key}
                    label={row.label}
                    value={row.value}
                    conversion={row.conversion}
                  />
                ))}
              </div>
            </WindowCard>
          ))}
        </div>
      </Section>

      <Section
        title="Median time-to-step"
        subtitle="Computed from quotes with valid timestamps for each step."
      >
        <div className="grid gap-4 lg:grid-cols-2">
          {windows.map((snapshot) => (
            <WindowCard
              key={snapshot.window}
              title={WINDOW_LABELS[snapshot.window]}
              range={formatRange(snapshot)}
            >
              <div className="mt-4 grid gap-3">
                {buildTimeRows(snapshot).map((row) => (
                  <TimeCard key={row.label} label={row.label} value={row.value} />
                ))}
              </div>
            </WindowCard>
          ))}
        </div>
      </Section>
    </AdminDashboardShell>
  );
}

type FunnelRow = {
  key: string;
  label: string;
  value: number;
  conversion: number | null;
};

type TimeRow = {
  label: string;
  value: number | null;
};

function buildFunnelRows(snapshot: OpsMetricsSnapshot): FunnelRow[] {
  const steps = [
    { key: "quotes_created", label: "Quotes created", value: snapshot.funnel.quotes_created },
    {
      key: "destinations_added",
      label: "Destinations added",
      value: snapshot.funnel.destinations_added,
    },
    {
      key: "dispatch_started",
      label: "Dispatch started",
      value: snapshot.funnel.dispatch_started,
    },
    { key: "submitted", label: "Submitted", value: snapshot.funnel.submitted },
    {
      key: "offers_received",
      label: "Offers received",
      value: snapshot.funnel.offers_received,
    },
    {
      key: "offers_selected",
      label: "Offers selected",
      value: snapshot.funnel.offers_selected,
    },
  ];

  let previous: number | null = null;
  return steps.map((step) => {
    const conversion =
      typeof previous === "number" && previous > 0
        ? (step.value / previous) * 100
        : null;
    previous = step.value;
    return { ...step, conversion };
  });
}

function buildTimeRows(snapshot: OpsMetricsSnapshot): TimeRow[] {
  return [
    {
      label: "Created → destinations added",
      value: snapshot.timeToStepHours.created_to_destinations_added,
    },
    {
      label: "Destinations added → dispatch started",
      value: snapshot.timeToStepHours.destinations_added_to_dispatch_started,
    },
    {
      label: "Dispatch started → submitted",
      value: snapshot.timeToStepHours.dispatch_started_to_submitted,
    },
    {
      label: "Submitted → first offer received",
      value: snapshot.timeToStepHours.submitted_to_first_offer_received,
    },
  ];
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-slate-900 bg-slate-950/40 px-6 py-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-100">{title}</h2>
          {subtitle ? <p className="mt-1 text-xs text-slate-400">{subtitle}</p> : null}
        </div>
      </div>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function WindowCard({
  title,
  range,
  children,
}: {
  title: string;
  range: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-slate-900/70 bg-black/20 px-5 py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-semibold text-slate-100">{title}</p>
        <p className="text-xs text-slate-500">{range}</p>
      </div>
      {children}
    </div>
  );
}

function FunnelCard({
  label,
  value,
  conversion,
}: {
  label: string;
  value: number;
  conversion: number | null;
}) {
  return (
    <div className="rounded-xl border border-slate-900/70 bg-slate-950/60 px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            {label}
          </p>
          <p className="mt-1 text-2xl font-semibold text-white tabular-nums">{value}</p>
        </div>
        <div className="text-right">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-600">
            Conversion
          </p>
          <p
            className={clsx(
              "mt-1 text-sm font-semibold tabular-nums",
              conversion === null ? "text-slate-500" : "text-emerald-200",
            )}
          >
            {formatPercent(conversion)}
          </p>
        </div>
      </div>
    </div>
  );
}

function TimeCard({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="rounded-xl border border-slate-900/70 bg-slate-950/60 px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-white tabular-nums">
        {formatHours(value)}
      </p>
      <p className="text-[11px] text-slate-500">Median hours</p>
    </div>
  );
}

function formatRange(snapshot: OpsMetricsSnapshot): string {
  const from = formatDate(snapshot.funnel.from);
  const to = formatDate(snapshot.funnel.to);
  return `${from} → ${to}`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(date);
}

function formatPercent(value: number | null): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "—";
  }
  return `${Math.round(value * 10) / 10}%`;
}

function formatHours(value: number | null): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "—";
  }
  return `${Math.round(value * 10) / 10}h`;
}
