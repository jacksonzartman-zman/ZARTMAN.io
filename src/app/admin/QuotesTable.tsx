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
  bidCount: number;
  hasWinner: boolean;
  hasProject: boolean;
  needsDecision: boolean;
};

type QuotesTableProps = {
  quotes: QuoteRow[];
  totalCount: number;
};

const QUOTE_STATUS_VARIANTS: Record<QuoteStatus, string> = {
  submitted: "pill-info",
  in_review: "pill-info",
  quoted: "pill-info",
  approved: "pill-success",
  won: "pill-success",
  lost: "pill-warning",
  cancelled: "pill-muted",
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
      tableClassName="min-w-[1024px] w-full table-fixed border-separate border-spacing-0 text-sm"
      head={
        <tr>
          <th className="px-5 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">
            Customer
          </th>
          <th className="px-5 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">
            Company
          </th>
          <th className="px-5 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">
            File
          </th>
          <th className="px-5 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">
            Status
          </th>
          <th className="px-5 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">
            State
          </th>
          <th className="px-5 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">
            Price
          </th>
          <th className="px-5 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">
            Target date
          </th>
          <th className="px-5 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">
            Created
          </th>
          <th className="px-5 py-4 text-right text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">
            Open
          </th>
        </tr>
      }
      body={
        showEmptyState ? (
          <tr>
            <td
              colSpan={9}
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
            const bidSummary =
              row.bidCount === 0
                ? "No bids yet"
                : `${row.bidCount} bid${row.bidCount === 1 ? "" : "s"}`;
            const stateBadge = row.needsDecision
              ? { label: "Needs decision", className: "pill-warning" }
              : row.hasWinner
                ? { label: "Won", className: "pill-success" }
                : row.bidCount === 0
                  ? { label: "Awaiting bids", className: "pill-muted" }
                  : { label: "Bidding", className: "pill-info" };
            let secondaryStateText = bidSummary;
            if (row.needsDecision) {
              secondaryStateText = `${bidSummary} ready for review`;
            } else if (row.hasWinner) {
              secondaryStateText = row.hasProject
                ? "Kickoff scheduled"
                : "No kickoff yet";
            } else if (row.bidCount === 0) {
              secondaryStateText = "Invite suppliers to quote";
            } else if (row.hasProject) {
              secondaryStateText = "Kickoff scheduled";
            }

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
                  <div className="flex flex-col gap-1">
                    <span
                      className={clsx(
                        "pill pill-table",
                        QUOTE_STATUS_VARIANTS[row.status],
                      )}
                    >
                      {QUOTE_STATUS_LABELS[row.status]}
                    </span>
                    {isStale ? (
                      <span className="text-[11px] font-medium text-amber-200/80">
                        Aging — follow up
                      </span>
                    ) : null}
                  </div>
                </td>
                <td className={clsx(adminTableCellClass, "text-xs")}>
                  <div className="flex flex-col gap-1">
                    <span
                      className={clsx(
                        "pill pill-table",
                        stateBadge.className,
                      )}
                    >
                      {stateBadge.label}
                    </span>
                    <span className="text-[11px] text-slate-500">
                      {secondaryStateText}
                    </span>
                  </div>
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
