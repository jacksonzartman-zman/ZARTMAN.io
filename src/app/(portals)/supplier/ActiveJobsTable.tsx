import Link from "next/link";
import clsx from "clsx";
import AdminTableShell, { adminTableCellClass } from "@/app/admin/AdminTableShell";
import { ctaSizeClasses, infoCtaClasses } from "@/lib/ctas";
import { formatRelativeTimeFromTimestamp, toTimestamp } from "@/lib/relativeTime";
import type { SupplierQuoteListRow } from "@/server/suppliers/quotesList";
import {
  PORTAL_ROW,
  PORTAL_TH,
  PORTAL_TH_RIGHT,
} from "@/app/(portals)/components/portalTableRhythm";

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
      className="border-slate-900/35 bg-transparent shadow-none"
      tableClassName="table-fixed"
      head={
        <tr>
          <th className={PORTAL_TH}>
            Project
          </th>
          <th className={PORTAL_TH}>
            Awarded
          </th>
          <th className={PORTAL_TH}>
            Kickoff
          </th>
          <th className={PORTAL_TH}>
            Last update
          </th>
          <th className={PORTAL_TH_RIGHT}>
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
          <tr
            key={row.quoteId}
            className={clsx("bg-transparent", PORTAL_ROW)}
          >
            <td className={clsx(adminTableCellClass, "px-6 py-4")}>
              <Link
                href={href}
                className="block truncate font-semibold leading-tight text-white underline-offset-4 hover:underline"
              >
                {row.rfqLabel}
              </Link>
            </td>
            <td
              className={clsx(
                adminTableCellClass,
                "px-6 py-4 text-xs text-slate-500 tabular-nums whitespace-nowrap",
              )}
            >
              {awardedLabel}
            </td>
            <td
              className={clsx(
                adminTableCellClass,
                "px-6 py-4 text-xs text-slate-300 whitespace-nowrap",
              )}
            >
              {formatKickoffStatus(row.kickoffStatus)}
            </td>
            <td
              className={clsx(
                adminTableCellClass,
                "px-6 py-4 text-xs text-slate-500 tabular-nums whitespace-nowrap",
              )}
            >
              {lastUpdateLabel}
            </td>
            <td className={clsx(adminTableCellClass, "px-6 py-4 text-right")}>
              <Link
                href={href}
                className={clsx(
                  infoCtaClasses,
                  ctaSizeClasses.sm,
                  "inline-flex min-w-[8.5rem] justify-center border-blue-400/45 text-blue-100 hover:bg-blue-500/15",
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

