import Link from "next/link";
import clsx from "clsx";
import AdminTableShell, { adminTableCellClass } from "@/app/admin/AdminTableShell";
import { ctaSizeClasses, primaryCtaClasses } from "@/lib/ctas";
import { formatDateTime } from "@/lib/formatDate";
import { formatRelativeTimeFromTimestamp, toTimestamp } from "@/lib/relativeTime";
import type { SupplierInboxRow } from "./SupplierInboxTable";

type NewRfqsTableProps = {
  rows: SupplierInboxRow[];
};

export default function NewRfqsTable({ rows }: NewRfqsTableProps) {
  if (rows.length === 0) {
    return null;
  }

  return (
    <AdminTableShell
      head={
        <tr>
          <th className="px-5 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">
            Files
          </th>
          <th className="px-5 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">
            Process
          </th>
          <th className="px-5 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">
            Qty
          </th>
          <th className="px-5 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">
            Need-by
          </th>
          <th className="px-5 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">
            Received
          </th>
          <th className="px-5 py-4 text-right text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">
            Action
          </th>
        </tr>
      }
      body={rows.map((row) => {
        const href = `/supplier/quotes/${row.quoteId}`;
        const fileCount = Math.max(0, row.fileCount ?? 0);
        const fileNames = Array.isArray(row.fileNames) ? row.fileNames : [];
        const primary =
          fileNames[0] ??
          row.primaryFileName ??
          row.rfqLabel ??
          `RFQ ${row.quoteId.slice(0, 8)}`;
        const extraCount = Math.max(0, fileNames.length - 1);
        const filesLabel = extraCount > 0 ? `${primary} +${extraCount}` : primary;
        const filesTitle =
          fileNames.length > 1 ? fileNames.join("\n") : undefined;

        const processLabel = row.processHint ?? "—";
        const quantityLabel = row.quantityHint ?? "—";
        const needByLabel = row.targetDate
          ? formatDateTime(row.targetDate, { includeTime: false }) ?? "—"
          : "—";
        const receivedLabel =
          formatRelativeTimeFromTimestamp(toTimestamp(row.createdAt)) ?? "—";

        return (
          <tr key={row.id} className="bg-slate-950/40 transition hover:bg-slate-900/40">
            <td className={clsx(adminTableCellClass, "px-5 py-4")}>
              <Link
                href={href}
                className="block font-semibold text-white underline-offset-4 hover:underline"
                title={filesTitle}
              >
                {filesLabel}
              </Link>
              <p className="mt-1 text-xs text-slate-400">
                {fileCount > 0 ? `${fileCount} file${fileCount === 1 ? "" : "s"}` : "Files pending"}
              </p>
            </td>
            <td className={clsx(adminTableCellClass, "px-5 py-4 text-slate-200")}>{processLabel}</td>
            <td className={clsx(adminTableCellClass, "px-5 py-4 text-slate-200")}>{quantityLabel}</td>
            <td className={clsx(adminTableCellClass, "px-5 py-4 text-slate-200")}>{needByLabel}</td>
            <td className={clsx(adminTableCellClass, "px-5 py-4 text-slate-400")}>{receivedLabel}</td>
            <td className={clsx(adminTableCellClass, "px-5 py-4 text-right")}>
              <Link
                href={href}
                className={clsx(primaryCtaClasses, ctaSizeClasses.sm, "inline-flex min-w-[9rem] justify-center")}
              >
                Submit offer
              </Link>
            </td>
          </tr>
        );
      })}
    />
  );
}

