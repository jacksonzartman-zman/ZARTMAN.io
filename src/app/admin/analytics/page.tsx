import clsx from "clsx";
import type { ReactNode } from "react";
import AdminDashboardShell from "@/app/admin/AdminDashboardShell";
import { normalizeSearchParams } from "@/lib/route/normalizeSearchParams";
import { requireAdminUser } from "@/server/auth";
import {
  loadRfqAnalytics,
  type RfqAnalyticsFilters,
} from "@/server/admin/rfqAnalytics";
import {
  loadBenchAnalytics,
  type BenchAnalyticsFilters,
} from "@/server/admin/benchAnalytics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RangeValue = NonNullable<RfqAnalyticsFilters["range"]>;

function parseRfqRange(value: unknown): RangeValue {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (normalized === "7d" || normalized === "30d" || normalized === "90d" || normalized === "365d") {
    return normalized;
  }
  return "30d";
}

function parseBenchRangeFromRfqRange(range: RangeValue): BenchAnalyticsFilters["range"] {
  // Bench analytics views typically expose 30/90/365 windows; map 7d → 30d.
  if (range === "365d") return "365d";
  if (range === "90d") return "90d";
  return "30d";
}

function normalizeNullableString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function formatScore(value: number | null): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return `${Math.round(value * 10) / 10}`;
}

export default async function AdminAnalyticsPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdminUser({ redirectTo: "/login" });

  const usp = normalizeSearchParams(searchParams ? await searchParams : undefined);

  const range = parseRfqRange(usp.get("range"));
  const region = normalizeNullableString(usp.get("region"));
  const process = normalizeNullableString(usp.get("process"));
  const material = normalizeNullableString(usp.get("material"));

  const rfqFilters: RfqAnalyticsFilters = {
    range,
    region,
    process,
    material,
  };

  const benchFilters: BenchAnalyticsFilters = {
    range: parseBenchRangeFromRfqRange(range),
    region,
  };

  const [rfq, bench] = await Promise.all([
    loadRfqAnalytics(rfqFilters),
    loadBenchAnalytics(benchFilters),
  ]);

  const rfqIsEmpty = rfq.funnel.rfqsCreated <= 0;
  const benchUnavailable = bench.totalSuppliers <= 0;

  return (
    <AdminDashboardShell
      title="Analytics"
      description="Read-only RFQ pipeline quality and supplier bench health over time."
    >
      <section className="rounded-2xl border border-slate-900/60 bg-slate-950/30 px-6 py-5">
        <form method="GET" action="/admin/analytics" className="flex flex-col gap-3 lg:flex-row lg:items-end">
          <label className="flex flex-col gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              RFQ window
            </span>
            <select
              name="range"
              defaultValue={range}
              className="w-full min-w-44 rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white focus:border-emerald-400 focus:outline-none"
            >
              <option value="7d">Last 7d</option>
              <option value="30d">Last 30d</option>
              <option value="90d">Last 90d</option>
              <option value="365d">Last 365d</option>
            </select>
          </label>

          <label className="flex flex-col gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Region
            </span>
            <input
              name="region"
              defaultValue={region ?? ""}
              placeholder='e.g. "US", "ITAR", "94107"'
              className="w-full min-w-56 rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-emerald-400 focus:outline-none"
            />
          </label>

          <label className="flex flex-col gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Process (RFQ only)
            </span>
            <input
              name="process"
              list="process-options"
              defaultValue={process ?? ""}
              placeholder="e.g. CNC machining"
              className="w-full min-w-56 rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-emerald-400 focus:outline-none"
            />
            <datalist id="process-options">
              <option value="CNC machining" />
              <option value="3D printing" />
              <option value="Sheet metal" />
              <option value="Injection molding" />
            </datalist>
          </label>

          <label className="flex flex-col gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Material (RFQ only)
            </span>
            <input
              name="material"
              defaultValue={material ?? ""}
              placeholder="e.g. aluminum, ABS"
              className="w-full min-w-56 rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-emerald-400 focus:outline-none"
            />
          </label>

          <button
            type="submit"
            className="rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-emerald-950 hover:bg-emerald-400"
          >
            Apply
          </button>
        </form>

        <p className="mt-3 text-xs text-slate-500">
          RFQ filters apply to the RFQ cards only. Bench analytics uses the nearest available window (min 30d).
        </p>
      </section>

      <div className="mt-5 grid gap-4 lg:grid-cols-12">
        <section className="lg:col-span-7 space-y-4">
          <Card>
            <CardHeader title="RFQ funnel" subtitle={`${rfq.filters.from} → ${rfq.filters.to}`} />
            {rfqIsEmpty ? (
              <EmptyState
                title="No RFQs in this window"
                description="Try expanding the window (90d / 365d) or clearing filters."
              />
            ) : (
              <div className="mt-4 grid gap-3 sm:grid-cols-4">
                <Metric label="Created" value={rfq.funnel.rfqsCreated} />
                <Metric label="With bids" value={rfq.funnel.rfqsWithBids} />
                <Metric label="2+ bids" value={rfq.funnel.rfqsWith2PlusBids} />
                <Metric label="Awarded" value={rfq.funnel.rfqsAwarded} />
              </div>
            )}
          </Card>

          <Card>
            <CardHeader title="RFQ quality" subtitle="Quality score buckets from RFQ signals" />
            {rfqIsEmpty ? (
              <EmptyState
                title="No RFQs to score"
                description="Quality scoring is computed per RFQ; add RFQs or widen the window."
              />
            ) : (
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <div className="rounded-xl border border-slate-900/70 bg-black/30 px-4 py-3">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Average score
                  </div>
                  <div className="mt-1 text-2xl font-semibold text-slate-100 tabular-nums">
                    {formatScore(rfq.averageQualityScore)}
                  </div>
                </div>
                <div className="grid gap-2">
                  <MiniStat label="High (85+)" value={rfq.qualityBuckets.high} />
                  <MiniStat label="Medium (70–84)" value={rfq.qualityBuckets.medium} />
                  <MiniStat label="Low (50–69)" value={rfq.qualityBuckets.low} />
                  <MiniStat label="Very low (&lt;50)" value={rfq.qualityBuckets.veryLow} />
                </div>
              </div>
            )}
          </Card>

          <Card>
            <CardHeader title="Issue breakdown" subtitle="What’s dragging RFQs down" />
            {rfqIsEmpty ? (
              <EmptyState title="No RFQ issues yet" description="No RFQs in this window." />
            ) : (
              <div className="mt-4 grid gap-2">
                <MiniStat label="Missing CAD" value={rfq.issueBreakdown.missingCad} />
                <MiniStat label="Missing drawings" value={rfq.issueBreakdown.missingDrawings} />
                <MiniStat label="Parts need attention" value={rfq.issueBreakdown.partsNeedsAttention} />
                <MiniStat label="No parts defined" value={rfq.issueBreakdown.partsNone} />
                <MiniStat label="Supplier: scope unclear" value={rfq.issueBreakdown.supplierScopeUnclear} />
                <MiniStat label="Supplier: timeline unrealistic" value={rfq.issueBreakdown.supplierTimelineUnrealistic} />
                <MiniStat label="Supplier: outside capability" value={rfq.issueBreakdown.supplierOutsideCapability} />
              </div>
            )}
          </Card>
        </section>

        <section className="lg:col-span-5 space-y-4">
          <Card>
            <CardHeader title="Bench utilization" subtitle="Supplier bench status distribution" />
            {benchUnavailable ? (
              <EmptyState
                title="Bench analytics unavailable"
                description="This environment may be missing the bench summary views, or there are no suppliers in the selected region."
              />
            ) : (
              <div className="mt-4 grid gap-2">
                <MiniStat label="Underused" value={bench.utilizationBuckets.underused} />
                <MiniStat label="Balanced" value={bench.utilizationBuckets.balanced} />
                <MiniStat label="Overused" value={bench.utilizationBuckets.overused} />
                <MiniStat label="Unknown" value={bench.utilizationBuckets.unknown} />
              </div>
            )}
          </Card>

          <Card>
            <CardHeader title="Bench win-rate" subtitle="Win-rate buckets (windowed view)" />
            {benchUnavailable ? (
              <EmptyState
                title="Bench analytics unavailable"
                description="Win-rate bucketing requires match health summaries."
              />
            ) : (
              <div className="mt-4 grid gap-2">
                <MiniStat label="High (≥50%)" value={bench.winRateBuckets.high} />
                <MiniStat label="Medium (20–49%)" value={bench.winRateBuckets.medium} />
                <MiniStat label="Low (1–19%)" value={bench.winRateBuckets.low} />
                <MiniStat label="Zero (0%)" value={bench.winRateBuckets.zero} />
                <MiniStat label="Unknown" value={bench.winRateBuckets.unknown} />
              </div>
            )}
          </Card>

          <Card>
            <CardHeader title="Total suppliers" subtitle="Suppliers counted in this bench window" />
            <div className="mt-4">
              <Metric label="Suppliers" value={bench.totalSuppliers} />
            </div>
          </Card>
        </section>
      </div>
    </AdminDashboardShell>
  );
}

function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <section
      className={clsx("rounded-2xl border border-slate-900 bg-slate-950/40 px-6 py-4", className)}
    >
      {children}
    </section>
  );
}

function CardHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-sm font-semibold text-slate-100">{title}</h2>
        {subtitle ? <p className="mt-1 text-xs text-slate-400">{subtitle}</p> : null}
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-slate-900/70 bg-black/30 px-4 py-3">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold text-slate-100 tabular-nums">
        {Number.isFinite(value) ? value : 0}
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-slate-900/70 bg-black/30 px-4 py-2.5">
      <div className="text-xs font-semibold text-slate-300">{label}</div>
      <div className="text-sm font-semibold text-slate-100 tabular-nums">
        {Number.isFinite(value) ? value : 0}
      </div>
    </div>
  );
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="mt-4 rounded-xl border border-slate-900/60 bg-slate-950/30 px-4 py-4">
      <p className="font-medium text-slate-100">{title}</p>
      <p className="mt-1 text-sm text-slate-400">{description}</p>
    </div>
  );
}

