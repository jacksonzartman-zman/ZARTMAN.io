import Link from "next/link";
import clsx from "clsx";
import type { BenchDemandSummary, BenchDemandBucketRow } from "@/server/admin/benchDemand";

function CountCell({ value }: { value: number }) {
  return <span className="font-semibold tabular-nums text-slate-100">{value.toLocaleString()}</span>;
}

function SecondaryStat({ label, value }: { label: string; value: number }) {
  return (
    <span className="text-[11px] text-slate-500">
      {label}: <span className="tabular-nums text-slate-300">{value.toLocaleString()}</span>
    </span>
  );
}

function Table({
  title,
  description,
  rows7,
  rows30,
  ctaMode,
}: {
  title: string;
  description: string;
  rows7: BenchDemandBucketRow[];
  rows30: BenchDemandBucketRow[];
  ctaMode: "process" | "none";
}) {
  const byKey7 = new Map(rows7.map((r) => [r.key, r]));
  const byKey30 = new Map(rows30.map((r) => [r.key, r]));
  const keys = Array.from(new Set([...byKey7.keys(), ...byKey30.keys()]));
  const combined = keys
    .map((key) => {
      const r7 = byKey7.get(key) ?? null;
      const r30 = byKey30.get(key) ?? null;
      const label = r30?.label ?? r7?.label ?? key;
      return { key, label, r7, r30 };
    })
    .sort((a, b) => {
      const aCount = (a.r30?.unmetSearchCount ?? 0) + (a.r7?.unmetSearchCount ?? 0);
      const bCount = (b.r30?.unmetSearchCount ?? 0) + (b.r7?.unmetSearchCount ?? 0);
      if (bCount !== aCount) return bCount - aCount;
      return a.label.localeCompare(b.label);
    })
    .slice(0, 10);

  return (
    <section className="rounded-2xl border border-slate-900/60 bg-slate-950/30 px-6 py-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-white">{title}</h2>
          <p className="mt-1 text-sm text-slate-400">{description}</p>
        </div>
      </div>

      {combined.length === 0 ? (
        <p className="mt-4 text-sm text-slate-400">No unmet demand detected in these windows.</p>
      ) : (
        <div className="mt-4 overflow-hidden rounded-xl border border-slate-900/60">
          <table className="w-full text-sm">
            <thead className="bg-slate-950/50 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 text-left">Gap</th>
                <th className="px-4 py-3 text-right">7d</th>
                <th className="px-4 py-3 text-right">30d</th>
                <th className="px-4 py-3 text-left">Detail</th>
                {ctaMode === "process" ? <th className="px-4 py-3 text-left">Action</th> : null}
              </tr>
            </thead>
            <tbody>
              {combined.map(({ key, label, r7, r30 }) => {
                const row = r30 ?? r7;
                const cta = row?.cta ?? null;
                const ctaHref =
                  ctaMode === "process" && cta?.process
                    ? (() => {
                        const params = new URLSearchParams();
                        params.append("process", cta.process);
                        if (cta.material) params.append("material", cta.material);
                        return `/admin/suppliers/discover?${params.toString()}`;
                      })()
                    : null;
                return (
                  <tr
                    key={key}
                    className={clsx(
                      "border-t border-slate-900/60 bg-slate-950/20 transition hover:bg-slate-900/30",
                    )}
                  >
                    <td className="px-4 py-3 text-slate-100">{label}</td>
                    <td className="px-4 py-3 text-right">
                      <CountCell value={r7?.unmetSearchCount ?? 0} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <CountCell value={r30?.unmetSearchCount ?? 0} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <SecondaryStat
                          label="No offers"
                          value={(r30?.noOfferAfterContactCount ?? 0) + (r7?.noOfferAfterContactCount ?? 0)}
                        />
                        <SecondaryStat
                          label="Mismatch-only"
                          value={(r30?.mismatchOnlyCount ?? 0) + (r7?.mismatchOnlyCount ?? 0)}
                        />
                        {row?.exampleQuoteId ? (
                          <Link
                            href={`/admin/quotes/${row.exampleQuoteId}`}
                            className="text-[11px] font-semibold text-emerald-200 hover:text-emerald-100"
                          >
                            Example →
                          </Link>
                        ) : null}
                      </div>
                    </td>
                    {ctaMode === "process" ? (
                      <td className="px-4 py-3">
                        {ctaHref ? (
                          <Link
                            href={ctaHref}
                            className="inline-flex rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-100 hover:border-emerald-400 hover:text-white"
                          >
                            Discover suppliers →
                          </Link>
                        ) : (
                          <span className="text-xs text-slate-500">—</span>
                        )}
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function BenchDemandGaps({ summary }: { summary: BenchDemandSummary }) {
  if (!summary.supported) {
    return (
      <section className="rounded-2xl border border-slate-900/60 bg-slate-950/30 px-6 py-5">
        <h2 className="text-base font-semibold text-white">Where are we thin?</h2>
        <p className="mt-1 text-sm text-slate-400">
          Unmet demand signals are unavailable on this schema.
        </p>
      </section>
    );
  }

  const w7 = summary.windows.d7;
  const w30 = summary.windows.d30;

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-900/60 bg-slate-950/30 px-6 py-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-white">Where are we thin?</h2>
            <p className="mt-1 text-sm text-slate-400">
              Recent searches with either (a) suppliers contacted but 0 offers, or (b) only mismatches available.
            </p>
          </div>
          {w7.note || w30.note ? (
            <p className="text-xs text-slate-500">{w7.note ?? w30.note}</p>
          ) : null}
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Table
          title="Top unmet processes"
          description="Gaps ops can fill by discovering suppliers for the process."
          rows7={w7.processes}
          rows30={w30.processes}
          ctaMode="process"
        />
        <Table
          title="Top unmet materials"
          description="Best-effort: inferred from intake notes and tags."
          rows7={w7.materials}
          rows30={w30.materials}
          ctaMode="none"
        />
      </div>

      <Table
        title="Top locations"
        description="Best-effort: ship-to state/country when available, otherwise coarse postal prefix."
        rows7={w7.locations}
        rows30={w30.locations}
        ctaMode="none"
      />
    </div>
  );
}

