import Link from "next/link";
import clsx from "clsx";
import type { BenchDemandSummary, BenchDemandBucketRow } from "@/server/admin/benchDemand";
import { createBenchGapTaskAction, discoverSuppliersFromGapTaskAction } from "@/app/admin/bench-health/actions";
import {
  compositeKey,
  listBenchGapTasksByKeys,
  type BenchGapTaskRecord,
  type BenchGapTaskStatus,
} from "@/server/admin/benchGapTasks";

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

async function Table({
  title,
  description,
  rows7,
  rows30,
  ctaMode,
  dimension,
}: {
  title: string;
  description: string;
  rows7: BenchDemandBucketRow[];
  rows30: BenchDemandBucketRow[];
  ctaMode: "process" | "none";
  dimension: "process" | "material" | "location";
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

  // Load tasks for these gaps (best-effort, schema gated).
  const windows = ["7d", "30d"];
  let tasksSupported = false;
  let byCompositeKey = new Map<string, BenchGapTaskRecord>();
  try {
    const result = await listBenchGapTasksByKeys({
      dimension,
      keys: combined.map((r) => r.key),
      windows,
    });
    tasksSupported = result.supported;
    byCompositeKey = result.byCompositeKey;
  } catch {
    tasksSupported = false;
    byCompositeKey = new Map<string, BenchGapTaskRecord>();
  }

  function statusLabel(status: BenchGapTaskStatus): string {
    if (status === "in_progress") return "In progress";
    if (status === "closed") return "Closed";
    return "Open";
  }

  function statusPillClasses(status: BenchGapTaskStatus): string {
    switch (status) {
      case "closed":
        return "border-slate-800 bg-slate-950/60 text-slate-300";
      case "in_progress":
        return "border-blue-500/40 bg-blue-500/10 text-blue-100";
      case "open":
      default:
        return "border-amber-500/40 bg-amber-500/10 text-amber-100";
    }
  }

  function taskLinkHref(task: BenchGapTaskRecord): string {
    const params = new URLSearchParams();
    params.set("dimension", task.dimension);
    params.set("status", "all");
    params.set("window", task.window);
    params.set("q", task.key);
    params.set("highlight", task.id);
    return `/admin/bench-health/tasks?${params.toString()}`;
  }

  function renderTaskControls(args: {
    key: string;
    label: string;
    window: "7d" | "30d";
    unmet: number;
    ctaHref: string | null;
    ctaLabel: string | null;
  }) {
    const existing = tasksSupported
      ? byCompositeKey.get(compositeKey({ dimension, key: args.key, window: args.window }))
      : null;

    const canCreate = args.unmet > 0 && !existing;
    const canOpen = Boolean(existing);

    const createForm = canCreate ? (
      <form action={createBenchGapTaskAction} className="inline-flex">
        <input type="hidden" name="dimension" value={dimension} />
        <input type="hidden" name="key" value={args.key} />
        <input type="hidden" name="window" value={args.window} />
        <button
          type="submit"
          className="inline-flex rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-100 hover:border-emerald-400 hover:text-white"
        >
          Create gap task
        </button>
      </form>
    ) : null;

    const openLink = canOpen && existing ? (
      <div className="flex flex-wrap items-center gap-2">
        <Link href={taskLinkHref(existing)} className="inline-flex items-center gap-2">
          <span
            className={clsx(
              "inline-flex rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide",
              statusPillClasses(existing.status),
            )}
          >
            {statusLabel(existing.status)}
          </span>
          <span className="text-xs font-semibold text-emerald-200 hover:text-emerald-100">
            Open task →
          </span>
        </Link>
      </div>
    ) : null;

    const discover =
      args.ctaHref && args.ctaLabel && existing ? (
        <form action={discoverSuppliersFromGapTaskAction} className="inline-flex">
          <input type="hidden" name="href" value={args.ctaHref} />
          <input type="hidden" name="gapTaskId" value={existing.id} />
          <input type="hidden" name="dimension" value={dimension} />
          <input type="hidden" name="key" value={args.key} />
          <input type="hidden" name="window" value={args.window} />
          <button
            type="submit"
            className="inline-flex rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-100 hover:border-emerald-400 hover:text-white"
          >
            {args.ctaLabel} →
          </button>
        </form>
      ) : args.ctaHref && args.ctaLabel ? (
        <Link
          href={args.ctaHref}
          className="inline-flex rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-100 hover:border-emerald-400 hover:text-white"
        >
          {args.ctaLabel} →
        </Link>
      ) : null;

    return (
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            {args.window}
          </span>
          {openLink ?? createForm ?? <span className="text-xs text-slate-500">—</span>}
        </div>
        {discover ? <div className="pl-[3.1rem]">{discover}</div> : null}
      </div>
    );
  }

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
                <th className="px-4 py-3 text-left">Playbook</th>
              </tr>
            </thead>
            <tbody>
              {combined.map(({ key, label, r7, r30 }) => {
                const row = r30 ?? r7;
                const cta = row?.cta ?? null;
                const discoverHref =
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
                    <td className="px-4 py-3">
                      <div className="space-y-3">
                        {renderTaskControls({
                          key,
                          label,
                          window: "30d",
                          unmet: r30?.unmetSearchCount ?? 0,
                          ctaHref: discoverHref,
                          ctaLabel: ctaMode === "process" ? "Discover suppliers" : null,
                        })}
                        {renderTaskControls({
                          key,
                          label,
                          window: "7d",
                          unmet: r7?.unmetSearchCount ?? 0,
                          ctaHref: discoverHref,
                          ctaLabel: ctaMode === "process" ? "Discover suppliers" : null,
                        })}
                      </div>
                    </td>
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
          dimension="process"
        />
        <Table
          title="Top unmet materials"
          description="Best-effort: inferred from intake notes and tags."
          rows7={w7.materials}
          rows30={w30.materials}
          ctaMode="none"
          dimension="material"
        />
      </div>

      <Table
        title="Top locations"
        description="Best-effort: ship-to state/country when available, otherwise coarse postal prefix."
        rows7={w7.locations}
        rows30={w30.locations}
        ctaMode="none"
        dimension="location"
      />
    </div>
  );
}

