import AdminDashboardShell from "@/app/admin/AdminDashboardShell";
import { requireAdminUser } from "@/server/auth";
import { loadAdminPricingMonitoring, type PricingMonitoringWindow } from "@/server/admin/pricingMonitoring";
import clsx from "clsx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WINDOW_ORDER: PricingMonitoringWindow[] = ["7d", "30d"];
const WINDOW_LABELS: Record<PricingMonitoringWindow, string> = {
  "7d": "Last 7 days",
  "30d": "Last 30 days",
};

export default async function AdminPricingMonitoringPage() {
  await requireAdminUser({ redirectTo: "/login" });

  const result = await loadAdminPricingMonitoring();
  const data = result.data;

  return (
    <AdminDashboardShell
      title="Pricing monitoring"
      description="Internal visibility into pricing priors coverage and freshness."
    >
      {!result.ok ? (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-950/30 px-6 py-4 text-sm text-amber-100">
          Pricing monitoring is unavailable in this environment. Check schema access and try again.
        </div>
      ) : null}

      <section className="rounded-2xl border border-slate-900 bg-slate-950/40 px-6 py-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-100">Priors status</h2>
            <p className="mt-1 text-xs text-slate-400">
              Counts are rows in <code className="text-slate-200">pricing_priors</code>.
            </p>
          </div>
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-3">
          <StatCard label="Priors freshness (max updated_at)" value={formatIsoDateTime(data.priors.freshnessUpdatedAt)} />
          <StatCard label="Total priors rows" value={data.priors.totalPriors.toLocaleString("en-US")} />
          <StatCard label="Distinct technologies" value={data.priors.countsByTechnology.length.toLocaleString("en-US")} />
        </div>

        <div className="mt-5 overflow-hidden rounded-2xl border border-slate-900/70 bg-black/20">
          <div className="grid grid-cols-[minmax(0,1fr)_140px] gap-3 border-b border-slate-900/60 px-5 py-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            <div>Technology</div>
            <div className="text-right">Priors</div>
          </div>
          <div className="divide-y divide-slate-900/60">
            {data.priors.countsByTechnology.length === 0 ? (
              <div className="px-5 py-4 text-sm text-slate-400">No priors found.</div>
            ) : (
              data.priors.countsByTechnology.map((row) => (
                <div key={row.technology} className="grid grid-cols-[minmax(0,1fr)_140px] gap-3 px-5 py-3">
                  <div className="min-w-0 truncate text-sm font-semibold text-slate-100" title={row.technology}>
                    {row.technology}
                  </div>
                  <div className="text-right text-sm font-semibold text-slate-100 tabular-nums">
                    {row.priorsCount.toLocaleString("en-US")}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-900 bg-slate-950/40 px-6 py-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-100">Top missing combinations</h2>
            <p className="mt-1 text-xs text-slate-400">
              Inferred from <code className="text-slate-200">ops_events</code> (<code className="text-slate-200">estimate_shown</code>). Shows combos encountered that don&apos;t exist in{" "}
              <code className="text-slate-200">pricing_priors</code>.
            </p>
          </div>
          <div className="text-xs text-slate-500">
            {data.missingCombinations.supported ? (
              <span>Scans up to {MAX_OPS_EVENTS_SCAN_DISPLAY.toLocaleString("en-US")} recent events per window.</span>
            ) : (
              <span>Not available in this environment.</span>
            )}
          </div>
        </div>

        {!data.missingCombinations.supported ? (
          <div className="mt-5 rounded-2xl border border-amber-500/30 bg-amber-950/30 px-6 py-4 text-sm text-amber-100">
            Missing-combo monitoring is unavailable. This typically means <code className="text-amber-50">ops_events</code> isn&apos;t accessible in this environment.
          </div>
        ) : (
          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            {WINDOW_ORDER.map((window) => (
              <WindowMissingCard
                key={window}
                title={WINDOW_LABELS[window]}
                rows={data.missingCombinations.windows[window] ?? []}
              />
            ))}
          </div>
        )}
      </section>
    </AdminDashboardShell>
  );
}

const MAX_OPS_EVENTS_SCAN_DISPLAY = 5000;

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-900/70 bg-black/20 px-5 py-4">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-base font-semibold text-white tabular-nums">{value}</p>
    </div>
  );
}

function WindowMissingCard({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ technology: string; material_canon: string; parts_bucket: string; count: number }>;
}) {
  return (
    <div className="rounded-2xl border border-slate-900/70 bg-black/20">
      <div className="flex items-baseline justify-between gap-2 border-b border-slate-900/60 px-5 py-3">
        <p className="text-sm font-semibold text-slate-100">{title}</p>
        <p className="text-xs text-slate-500">{rows.length ? `${rows.length} shown` : "None"}</p>
      </div>

      {rows.length === 0 ? (
        <div className="px-5 py-4 text-sm text-slate-400">No missing combinations detected.</div>
      ) : (
        <div className="divide-y divide-slate-900/60">
          {rows.map((row) => (
            <div key={comboKey(row)} className="px-5 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-100" title={row.technology}>
                    {row.technology}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-slate-400" title={row.material_canon}>
                    Material: {row.material_canon}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">Parts bucket: {row.parts_bucket}</p>
                </div>
                <div className={clsx("text-right text-sm font-semibold tabular-nums", "text-rose-200")}>
                  {row.count.toLocaleString("en-US")}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function comboKey(row: { technology: string; material_canon: string; parts_bucket: string }) {
  return `${row.technology}::${row.material_canon}::${row.parts_bucket}`;
}

function formatIsoDateTime(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

