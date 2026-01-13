import clsx from "clsx";
import Link from "next/link";
import { formatDateTime } from "@/lib/formatDate";
import { formatRelativeTimeFromTimestamp, toTimestamp } from "@/lib/relativeTime";
import AdminTableShell, { adminTableCellClass } from "@/app/admin/AdminTableShell";
import type { SupplierBenchHealth } from "@/server/admin/benchHealth";

type AdminQuotesMessageFilter = "needs_reply" | "overdue";

function formatHealthLabel(value: SupplierBenchHealth["health"]): string {
  switch (value) {
    case "healthy":
      return "Healthy";
    case "at_risk":
      return "At risk";
    case "unresponsive":
      return "Unresponsive";
    default:
      return "Healthy";
  }
}

function healthPillClasses(value: SupplierBenchHealth["health"]): string {
  switch (value) {
    case "healthy":
      return "border-emerald-500/40 bg-emerald-500/10 text-emerald-100";
    case "at_risk":
      return "border-amber-500/40 bg-amber-500/10 text-amber-100";
    case "unresponsive":
      return "border-red-500/40 bg-red-500/10 text-red-100";
    default:
      return "border-slate-800 bg-slate-950/60 text-slate-200";
  }
}

function renderReasons(reasons: string[]) {
  if (!Array.isArray(reasons) || reasons.length === 0) {
    return <span className="text-xs text-slate-500">—</span>;
  }

  const shown = reasons.slice(0, 3);
  const remaining = reasons.length - shown.length;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {shown.map((reason) => (
        <span
          key={reason}
          className="inline-flex rounded-full border border-slate-800 bg-slate-950/60 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-200"
        >
          {reason}
        </span>
      ))}
      {remaining > 0 ? (
        <span className="text-xs font-semibold text-slate-500">+{remaining}</span>
      ) : null}
    </div>
  );
}

function buildQuotesDrilldownHref(args: {
  supplierId: string;
  msg: AdminQuotesMessageFilter;
}): string {
  const params = new URLSearchParams();
  params.set("msg", args.msg);
  params.set("supplierId", args.supplierId);
  return `/admin/quotes?${params.toString()}`;
}

function formatRelativeAbsolute(value: string | null): string {
  if (!value) return "—";
  const relative = formatRelativeTimeFromTimestamp(toTimestamp(value));
  const absolute = formatDateTime(value, { includeTime: true });
  if (!relative && !absolute) return "—";
  if (!relative) return absolute ?? "—";
  if (!absolute) return relative;
  return `${relative} · ${absolute}`;
}

function renderInlineQuoteLinks(quoteIds: string[] | undefined) {
  const ids = Array.isArray(quoteIds) ? quoteIds.filter(Boolean).slice(0, 3) : [];
  if (ids.length === 0) return null;

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      {ids.map((id) => (
        <Link
          key={id}
          href={`/admin/quotes/${id}#messages`}
          className="inline-flex rounded-md border border-slate-800 bg-slate-950/60 px-2 py-1 font-mono text-[11px] text-emerald-200 hover:text-emerald-100"
        >
          {id}
        </Link>
      ))}
    </div>
  );
}

export default function BenchHealthTable({ rows }: { rows: SupplierBenchHealth[] }) {
  const isEmpty = rows.length === 0;

  return (
    <AdminTableShell
      tableClassName="min-w-[1400px] w-full border-separate border-spacing-0 text-sm"
      head={
        <tr>
          <th className="px-5 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">
            Supplier
          </th>
          <th className="px-5 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">
            Health
          </th>
          <th className="px-5 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">
            Reasons
          </th>
          <th className="px-5 py-4 text-right text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">
            Overdue threads
          </th>
          <th className="px-5 py-4 text-right text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">
            Last activity
          </th>
          <th className="px-5 py-4 text-right text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">
            Last inbound
          </th>
          <th className="px-5 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">
            Details
          </th>
        </tr>
      }
      body={
        isEmpty ? (
          <tr>
            <td colSpan={7} className="px-6 py-12 text-center text-base text-slate-300">
              <p className="font-medium text-slate-100">No suppliers match this filter.</p>
              <p className="mt-2 text-sm text-slate-400">
                Try clearing filters or broadening your search.
              </p>
            </td>
          </tr>
        ) : (
          rows.map((row) => (
            <tr
              key={row.supplierId}
              className="border-b border-slate-800/60 bg-slate-950/40 transition hover:bg-slate-900/40"
            >
              <td className={clsx(adminTableCellClass, "px-5 py-4")}>
                <div className="space-y-2">
                  <Link
                    href={`/admin/suppliers/${row.supplierId}`}
                    className="text-sm font-semibold text-emerald-100 hover:text-emerald-300"
                  >
                    {row.supplierName ?? row.supplierId}
                  </Link>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[11px] text-slate-500">{row.supplierId}</span>
                  </div>
                </div>
              </td>
              <td className={clsx(adminTableCellClass, "px-5 py-4")}>
                {(() => {
                  const needsReplyCount = row.healthBreakdown?.needsReplyThreadCount ?? 0;
                  const pillMsg: AdminQuotesMessageFilter | null =
                    row.overdueThreadCount > 0
                      ? "overdue"
                      : needsReplyCount > 0
                        ? "needs_reply"
                        : null;
                  const pillHref =
                    pillMsg && row.supplierId
                      ? buildQuotesDrilldownHref({
                          supplierId: row.supplierId,
                          msg: pillMsg,
                        })
                      : null;

                  const pill = (
                    <span
                      className={clsx(
                        "inline-flex rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-wide transition",
                        healthPillClasses(row.health),
                        pillHref ? "cursor-pointer hover:brightness-110" : null,
                      )}
                    >
                      {formatHealthLabel(row.health)}
                    </span>
                  );

                  return pillHref ? (
                    <Link href={pillHref} className="inline-flex">
                      {pill}
                    </Link>
                  ) : (
                    pill
                  );
                })()}
              </td>
              <td className={clsx(adminTableCellClass, "px-5 py-4")}>
                {renderReasons(row.reasons)}
              </td>
              <td className={clsx(adminTableCellClass, "px-5 py-4 text-right tabular-nums")}>
                {row.overdueThreadCount > 0 ? (
                  <Link
                    href={buildQuotesDrilldownHref({
                      supplierId: row.supplierId,
                      msg: "overdue",
                    })}
                    className="font-semibold text-slate-100 underline decoration-slate-600/40 underline-offset-2 transition hover:text-emerald-200 hover:decoration-emerald-400/70"
                  >
                    {row.overdueThreadCount.toLocaleString()}
                  </Link>
                ) : (
                  row.overdueThreadCount.toLocaleString()
                )}
              </td>
              <td className={clsx(adminTableCellClass, "px-5 py-4 text-right text-slate-400")}>
                {formatDateTime(row.lastActivityAt, { includeTime: true }) ?? "—"}
              </td>
              <td className={clsx(adminTableCellClass, "px-5 py-4 text-right text-slate-400")}>
                {formatDateTime(row.lastInboundAt, { includeTime: true }) ?? "—"}
              </td>
              <td className={clsx(adminTableCellClass, "px-5 py-4")}>
                {(() => {
                  const breakdown = row.healthBreakdown ?? null;
                  const overdueThreadCount = breakdown?.overdueThreadCount ?? row.overdueThreadCount;
                  const overdueQuoteIds = breakdown?.overdueQuoteIds;
                  const needsReplyThreadCount = breakdown?.needsReplyThreadCount ?? 0;
                  const needsReplyQuoteIds = breakdown?.needsReplyQuoteIds;
                  const lastInboundAt = breakdown?.lastInboundAt ?? row.lastInboundAt;
                  const lastActivityAt = breakdown?.lastActivityAt ?? row.lastActivityAt;
                  const mismatchCount = breakdown?.mismatchCount;
                  const lastMismatchAt = breakdown?.lastMismatchAt ?? null;

                  return (
                    <details className="group">
                      <summary className="cursor-pointer list-none text-sm font-semibold text-emerald-200 hover:text-emerald-100">
                        Why?
                      </summary>
                      <div className="mt-3 space-y-3 rounded-xl border border-slate-900/60 bg-slate-950/30 p-4 text-xs text-slate-200">
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                            Overdue threads
                          </p>
                          <p className="mt-1 tabular-nums">{overdueThreadCount.toLocaleString()}</p>
                          {renderInlineQuoteLinks(overdueQuoteIds)}
                        </div>
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                            Needs reply threads
                          </p>
                          <p className="mt-1 tabular-nums">
                            {needsReplyThreadCount.toLocaleString()}
                          </p>
                          {renderInlineQuoteLinks(needsReplyQuoteIds)}
                        </div>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                          <div>
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                              Last inbound
                            </p>
                            <p className="mt-1 text-slate-300">
                              {formatRelativeAbsolute(lastInboundAt)}
                            </p>
                          </div>
                          <div>
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                              Last activity
                            </p>
                            <p className="mt-1 text-slate-300">
                              {formatRelativeAbsolute(lastActivityAt)}
                            </p>
                          </div>
                        </div>
                        {typeof mismatchCount === "number" ? (
                          <div>
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                              Mismatch
                            </p>
                            <p className="mt-1 text-slate-300">
                              {mismatchCount.toLocaleString()} mismatches
                              {lastMismatchAt
                                ? `, last ${formatRelativeAbsolute(lastMismatchAt)}`
                                : ""}
                            </p>
                          </div>
                        ) : null}
                      </div>
                    </details>
                  );
                })()}
              </td>
            </tr>
          ))
        )
      }
    />
  );
}

