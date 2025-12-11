import clsx from "clsx";
import Link from "next/link";
import { formatDateTime } from "@/lib/formatDate";
import type { AdminQuoteListStatus, AdminQuotesView } from "@/types/adminQuotes";
import AdminTableShell, { adminTableCellClass } from "./AdminTableShell";
import { ctaSizeClasses, secondaryCtaClasses } from "@/lib/ctas";

export type QuoteRow = {
  id: string;
  rfqLabel: string;
  createdAt: string | null;
  customerName?: string | null;
  customerEmail?: string | null;
  company?: string | null;
  fileCountLabel: string;
  status: AdminQuoteListStatus;
  statusLabel: string;
  statusHelper: string;
  statusClassName: string;
  bidSummary: string;
  bidCountLabel: string;
  bestPriceLabel: string;
  leadTimeLabel: string;
  hasWinningBid: boolean;
  ctaHref: string;
  bidsHref: string;
};

type QuotesTableProps = {
  quotes: QuoteRow[];
  totalCount: number;
  currentView: AdminQuotesView;
  searchTerm?: string;
};

export default function QuotesTable({
  quotes,
  totalCount,
  currentView,
  searchTerm,
}: QuotesTableProps) {
  const showEmptyState = quotes.length === 0;
  const emptyState = getEmptyStateCopy({ totalCount, currentView, searchTerm });

  return (
    <AdminTableShell
      tableClassName="min-w-[1024px] w-full border-separate border-spacing-0 text-sm"
      head={
        <tr>
          <th className="px-5 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">
            RFQ
          </th>
          <th className="px-5 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">
            Customer
          </th>
          <th className="px-5 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">
            Files
          </th>
          <th className="px-5 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">
            Status
          </th>
          <th className="px-5 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">
            Bids
          </th>
          <th className="px-5 py-4 text-right text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">
            Actions
          </th>
        </tr>
      }
      body={
        showEmptyState ? (
          <tr>
            <td
              colSpan={6}
              className="px-6 py-12 text-center text-base text-slate-300"
            >
              <p className="font-medium text-slate-100">{emptyState.title}</p>
              <p className="mt-2 text-sm text-slate-400">{emptyState.description}</p>
            </td>
          </tr>
        ) : (
          quotes.map((row) => {
            const createdAtLabel = formatDateTime(row.createdAt, {
              includeTime: true,
            });

            return (
              <tr
                key={row.id}
                className="border-b border-slate-800/60 bg-slate-950/40 transition hover:bg-slate-900/40"
              >
                <td className={adminTableCellClass}>
                  <div className="flex flex-col gap-1">
                    <Link
                      href={`/admin/quotes/${row.id}`}
                      className="text-sm font-semibold text-emerald-100 hover:text-emerald-300"
                    >
                      <span className="max-w-[240px] truncate">{row.rfqLabel}</span>
                    </Link>
                    <p className="text-[11px] uppercase tracking-wide text-slate-500">
                      Created {createdAtLabel ?? "—"}
                    </p>
                  </div>
                </td>
                <td className={adminTableCellClass}>
                  <div className="space-y-1 text-xs">
                    <p className="font-medium text-slate-100">
                      {row.company || "—"}
                    </p>
                    {row.customerEmail ? (
                      <a
                        href={`mailto:${row.customerEmail}`}
                        className="text-emerald-200 hover:underline"
                      >
                        {row.customerEmail}
                      </a>
                    ) : (
                      <p className="text-slate-500">Email unavailable</p>
                    )}
                    {row.customerName ? (
                      <p className="text-slate-500">{row.customerName}</p>
                    ) : null}
                  </div>
                </td>
                <td className={adminTableCellClass}>
                  <span className="inline-flex rounded-full border border-slate-800 bg-slate-900/50 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-300">
                    {row.fileCountLabel}
                  </span>
                </td>
                <td className={adminTableCellClass}>
                  <div className="space-y-1">
                    <span
                      className={clsx("pill pill-table", row.statusClassName)}
                    >
                      {row.statusLabel}
                    </span>
                    <p className="text-xs text-slate-400">{row.statusHelper}</p>
                  </div>
                </td>
                <td className={clsx(adminTableCellClass, "text-xs text-slate-200")}>
                  <p className="font-semibold text-slate-100">{row.bidCountLabel}</p>
                  <p className="text-slate-400">{row.bidSummary}</p>
                  <div className="mt-2 flex flex-col gap-1 text-slate-400">
                    <span>Best: {row.bestPriceLabel}</span>
                    <span>Lead: {row.leadTimeLabel}</span>
                  </div>
                </td>
                <td className={clsx(adminTableCellClass, "text-right")}>
                  <div className="flex flex-col items-end gap-2">
                    <Link
                      href={row.ctaHref}
                      className={clsx(
                        secondaryCtaClasses,
                        ctaSizeClasses.sm,
                        "inline-flex min-w-[11rem] justify-center",
                      )}
                    >
                      Open RFQ workspace
                    </Link>
                    <Link
                      href={row.bidsHref}
                      className="text-xs font-semibold text-emerald-200 hover:text-emerald-100"
                    >
                      View bids
                    </Link>
                  </div>
                </td>
              </tr>
            );
          })
        )
      }
    />
  );
}

function getEmptyStateCopy({
  totalCount,
  currentView,
  searchTerm,
}: {
  totalCount: number;
  currentView: AdminQuotesView;
  searchTerm?: string;
}) {
  if (totalCount === 0) {
    return {
      title: "No quotes yet.",
      description: "New RFQs will appear here as customers submit them.",
    };
  }

  if (searchTerm) {
    return {
      title: "No quotes match your search.",
      description: "Try another keyword or clear the search box.",
    };
  }

  if (currentView === "needs_attention") {
    return {
      title: "No RFQs need attention right now.",
      description:
        "Fresh uploads or in-flight bids will bubble back up here automatically.",
    };
  }

  if (currentView === "awarded") {
    return {
      title: "No awarded RFQs yet.",
      description: "Select a winning supplier to see those projects in this tab.",
    };
  }

  return {
    title: "No quotes match your filters.",
    description: "Try switching views or clearing filters to see more RFQs.",
  };
}
