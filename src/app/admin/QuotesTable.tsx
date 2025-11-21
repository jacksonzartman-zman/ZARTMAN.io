import Link from "next/link";
import { formatDateTime } from "@/lib/formatDate";
import type { UploadStatus } from "./constants";
import { UPLOAD_STATUS_LABELS } from "./constants";

export type QuoteRow = {
  id: string;
  customerName: string;
  customerEmail: string;
  company: string;
  fileName: string;
  status: UploadStatus | null;
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
    <div className="mt-4 overflow-x-auto rounded-lg border border-slate-800 bg-slate-950/60">
      <table className="min-w-full text-left text-sm">
        <thead className="border-b border-slate-800 bg-slate-900/60 text-xs uppercase text-slate-400">
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
        </thead>
        <tbody className="divide-y divide-slate-900">
            {showEmptyState ? (
            <tr>
              <td
                colSpan={8}
                className="px-4 py-8 text-center text-sm text-slate-500"
              >
                  {emptyMessage}
              </td>
            </tr>
          ) : (
            quotes.map((row) => (
                <tr key={row.id} className="hover:bg-slate-900/60">
                <td className="px-4 py-3 align-top">
                    <div className="flex flex-col">
                      <Link
                        href={`/admin/quotes/${row.id}`}
                        className="text-sm text-slate-100 hover:text-emerald-300"
                      >
                        {row.customerName}
                      </Link>
                      {row.customerEmail && (
                        <a
                          href={`mailto:${row.customerEmail}`}
                          className="text-xs text-emerald-400 hover:underline"
                        >
                          {row.customerEmail}
                        </a>
                      )}
                    </div>
                </td>
                <td className="px-4 py-3 align-top text-sm text-slate-200">
                  {row.company || "—"}
                </td>
                <td className="px-4 py-3 align-top text-xs text-slate-300">
                  {row.fileName}
                </td>
                <td className="px-4 py-3 align-top">
                    <span className="inline-flex rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-300">
                      {UPLOAD_STATUS_LABELS[(row.status ?? "new") as UploadStatus]}
                  </span>
                </td>
                <td className="px-4 py-3 align-top text-xs text-slate-200">
                  {formatMoney(row.price, row.currency)}
                </td>
                <td className="px-4 py-3 align-top text-xs text-slate-400">
                    {formatDateTime(row.targetDate)}
                </td>
                <td className="px-4 py-3 align-top text-xs text-slate-400">
                    {formatDateTime(row.createdAt, { includeTime: true })}
                </td>
                <td className="px-4 py-3 align-top text-right text-xs">
                  <Link
                    href={`/admin/quotes/${row.id}`}
                    className="text-emerald-400 hover:underline"
                  >
                    View quote
                  </Link>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}