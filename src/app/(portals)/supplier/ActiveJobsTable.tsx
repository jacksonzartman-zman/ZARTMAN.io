import Link from "next/link";
import clsx from "clsx";
import AdminTableShell, { adminTableCellClass } from "@/app/admin/AdminTableShell";
import { ctaSizeClasses, primaryCtaClasses } from "@/lib/ctas";
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
          <tr key={row.quoteId} className="bg-slate-950/40 transition hover:bg-slate-900/40">
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
                className={clsx(primaryCtaClasses, ctaSizeClasses.sm, "inline-flex min-w-[9rem] justify-center")}
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

