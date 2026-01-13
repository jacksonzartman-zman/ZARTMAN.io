import clsx from "clsx";
import Link from "next/link";
import { formatDateTime } from "@/lib/formatDate";
import AdminTableShell, { adminTableCellClass } from "@/app/admin/AdminTableShell";
import type { SupplierBenchHealth } from "@/server/admin/benchHealth";

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

export default function BenchHealthTable({ rows }: { rows: SupplierBenchHealth[] }) {
  const isEmpty = rows.length === 0;

  return (
    <AdminTableShell
      tableClassName="min-w-[1240px] w-full border-separate border-spacing-0 text-sm"
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
        </tr>
      }
      body={
        isEmpty ? (
          <tr>
            <td colSpan={6} className="px-6 py-12 text-center text-base text-slate-300">
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
                <span
                  className={clsx(
                    "inline-flex rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-wide",
                    healthPillClasses(row.health),
                  )}
                >
                  {formatHealthLabel(row.health)}
                </span>
              </td>
              <td className={clsx(adminTableCellClass, "px-5 py-4")}>
                {renderReasons(row.reasons)}
              </td>
              <td className={clsx(adminTableCellClass, "px-5 py-4 text-right tabular-nums")}>
                {row.overdueThreadCount.toLocaleString()}
              </td>
              <td className={clsx(adminTableCellClass, "px-5 py-4 text-right text-slate-400")}>
                {formatDateTime(row.lastActivityAt, { includeTime: true }) ?? "—"}
              </td>
              <td className={clsx(adminTableCellClass, "px-5 py-4 text-right text-slate-400")}>
                {formatDateTime(row.lastInboundAt, { includeTime: true }) ?? "—"}
              </td>
            </tr>
          ))
        )
      }
    />
  );
}

