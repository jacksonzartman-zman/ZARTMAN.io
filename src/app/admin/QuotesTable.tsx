import Link from "next/link";
import { formatDateTime } from "@/lib/formatDate";
import {
  UPLOAD_STATUS_LABELS,
  normalizeUploadStatus,
  type UploadStatus,
} from "./constants";
import AdminTableShell, { adminTableCellClass } from "./AdminTableShell";

export type QuoteRow = {
  id: string;
  customerName: string;
  customerEmail: string;
  company: string;
  fileName: string;
  status: UploadStatus;
  price: number | null;
  currency: string | null;
  targetDate: string | null;
  createdAt: string;
};

type QuotesTableProps = {
  quotes: QuoteRow[];
  totalCount: number;
};

function formatMoney(amount: number | null, currency: string | null) {
  if (amount == null) return "—";
  const value = Number(amount);
  if (Number.isNaN(value)) return "—";
  const cur = currency || "USD";
  return `${cur} ${value.toFixed(2)}`;
}

export default function QuotesTable({ quotes, totalCount }: QuotesTableProps) {
  const showEmptyState = quotes.length === 0;
  const emptyMessage =
    totalCount === 0
      ? "No quotes yet. Once customers upload files and request pricing, they’ll appear here."
      : "No quotes match your filters. Try clearing search or choosing a different status.";

  return (
    <AdminTableShell
      head={
        <tr>
          <th className="px-4 py-3">Customer</th>
          <th className="px-4 py-3">Company</th>
          <th className="px-4 py-3">File</th>
          <th className="px-4 py-3">Status</th>
          <th className="px-4 py-3">Price</th>
          <th className="px-4 py-3">Target date</th>
          <th className="px-4 py-3">Created</th>
          <th className="px-4 py-3 text-right">Open</th>
        </tr>
      }
      body={
        showEmptyState ? (
          <tr>
            <td
              colSpan={8}
              className="px-6 py-12 text-center text-base text-slate-300"
            >
              <p className="font-medium text-slate-100">
                {totalCount === 0
                  ? "No quotes yet."
                  : "No quotes match your filters."}
              </p>
              <p className="mt-2 text-sm text-slate-400">
                {emptyMessage}
              </p>
            </td>
          </tr>
        ) : (
          quotes.map((row) => (
            <tr
              key={row.id}
              className="bg-slate-950/40 transition hover:bg-slate-900/40"
            >
              <td className={adminTableCellClass}>
                <div className="flex flex-col">
                  <Link
                    href={`/admin/quotes/${row.id}`}
                    className="text-sm font-medium text-emerald-100 hover:text-emerald-300"
                  >
                    {row.customerName}
                  </Link>
                  {row.customerEmail && (
                    <a
                      href={`mailto:${row.customerEmail}`}
                      className="text-xs text-slate-400 hover:text-emerald-200"
                    >
                      {row.customerEmail}
                    </a>
                  )}
                </div>
              </td>
              <td className={`${adminTableCellClass} text-slate-100`}>
                {row.company || "—"}
              </td>
              <td className={`${adminTableCellClass} text-xs text-slate-300`}>
                {row.fileName || "—"}
              </td>
              <td className={adminTableCellClass}>
                <span className="inline-flex items-center rounded-full border border-transparent bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-200">
                  {UPLOAD_STATUS_LABELS[normalizeUploadStatus(row.status)]}
                </span>
              </td>
              <td className={`${adminTableCellClass} text-xs text-slate-200`}>
                {formatMoney(row.price, row.currency)}
              </td>
              <td className={`${adminTableCellClass} text-xs text-slate-400`}>
                {formatDateTime(row.targetDate)}
              </td>
              <td className={`${adminTableCellClass} text-xs text-slate-400`}>
                {formatDateTime(row.createdAt, { includeTime: true })}
              </td>
              <td className={`${adminTableCellClass} text-right`}>
                <Link
                  href={`/admin/quotes/${row.id}`}
                  className="text-sm font-semibold text-emerald-300 hover:text-emerald-200"
                >
                  Open quote
                </Link>
              </td>
            </tr>
          ))
        )
      }
    />
  );
}
