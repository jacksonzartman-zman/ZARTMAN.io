import Link from "next/link";
import clsx from "clsx";
import AdminTableShell, { adminTableCellClass } from "@/app/admin/AdminTableShell";
import { ctaSizeClasses } from "@/lib/ctas";
import { formatRelativeTimeFromTimestamp, toTimestamp } from "@/lib/relativeTime";
import type { SupplierQuoteListRow } from "@/server/suppliers/quotesList";

type ActiveJobsTableProps = {
  rows: SupplierQuoteListRow[];
};

function formatKickoffStatus(value: SupplierQuoteListRow["kickoffStatus"]): string {
  switch (value) {
    case "complete":
      return "Complete";
    case "in_progress":
      return "In progress";
    case "not_started":
      return "Not started";
    default:
      return "—";
  }
}

export default function ActiveJobsTable({ rows }: ActiveJobsTableProps) {
  if (rows.length === 0) {
    return null;
  }

  return (
    <AdminTableShell
      className="border-slate-800/35 bg-slate-950/15 shadow-none"
      head={
        <tr>
          <th className="px-5 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">
            Job
          </th>
          <th className="px-5 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">
            Awarded
          </th>
          <th className="px-5 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">
            Kickoff
          </th>
          <th className="px-5 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">
            Last update
          </th>
          <th className="px-5 py-4 text-right text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">
            Action
          </th>
        </tr>
      }
      body={rows.map((row) => {
        const href = `/supplier/quotes/${row.quoteId}`;
        const awardedLabel =
          formatRelativeTimeFromTimestamp(toTimestamp(row.awardedAt)) ?? "—";
        const lastUpdateLabel =
          formatRelativeTimeFromTimestamp(toTimestamp(row.lastActivityAt)) ?? "—";

        return (
          <tr key={row.quoteId} className="bg-transparent transition hover:bg-slate-900/25">
            <td className={clsx(adminTableCellClass, "px-5 py-4")}>
              <Link
                href={href}
                className="block font-semibold text-white underline-offset-4 hover:underline"
              >
                {row.rfqLabel}
              </Link>
            </td>
            <td className={clsx(adminTableCellClass, "px-5 py-4 text-slate-400")}>
              {awardedLabel}
            </td>
            <td className={clsx(adminTableCellClass, "px-5 py-4 text-slate-200")}>
              {formatKickoffStatus(row.kickoffStatus)}
            </td>
            <td className={clsx(adminTableCellClass, "px-5 py-4 text-slate-400")}>
              {lastUpdateLabel}
            </td>
            <td className={clsx(adminTableCellClass, "px-5 py-4 text-right")}>
              <Link
                href={href}
                className={clsx(
                  ctaSizeClasses.sm,
                  "inline-flex min-w-[9rem] justify-center rounded-full border border-slate-700/70 bg-transparent text-slate-200 transition hover:border-slate-500 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-400",
                )}
              >
                Open job
              </Link>
            </td>
          </tr>
        );
      })}
    />
  );
}

