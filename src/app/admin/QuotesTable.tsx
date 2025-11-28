import clsx from "clsx";
import Link from "next/link";
import { formatDateTime } from "@/lib/formatDate";
import {
  QUOTE_STATUS_LABELS,
  isOpenQuoteStatus,
  type QuoteStatus,
} from "@/server/quotes/status";
import AdminTableShell, { adminTableCellClass } from "./AdminTableShell";
import { ctaSizeClasses, secondaryCtaClasses } from "@/lib/ctas";

export type QuoteRow = {
  id: string;
  customerName: string;
  customerEmail: string;
  company: string;
  fileName: string;
  status: QuoteStatus;
  price: number | null;
  currency: string | null;
  targetDate: string | null;
  createdAt: string | null;
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
          quotes.map((row) => {
            const createdAtDate =
              typeof row.createdAt === "string" ? new Date(row.createdAt) : null;
            const isStale =
              createdAtDate &&
              !Number.isNaN(createdAtDate.getTime()) &&
              isOpenQuoteStatus(row.status) &&
              (Date.now() - createdAtDate.getTime()) / (1000 * 60 * 60) > 48;

            return (
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
                    {QUOTE_STATUS_LABELS[row.status]}
                  </span>
                  {isStale ? (
                    <span className="ml-2 rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-300">
                      Aging
                    </span>
                  ) : null}
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
                    className={clsx(
                      secondaryCtaClasses,
                      ctaSizeClasses.sm,
                      "inline-flex min-w-[9.5rem] justify-center",
                    )}
                  >
                    Open quote
                  </Link>
                </td>
              </tr>
            );
          })
        )
      }
    />
  );
}
