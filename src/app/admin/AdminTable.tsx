// src/app/admin/AdminTable.tsx
import clsx from "clsx";
import Link from "next/link";
import { formatDateTime } from "@/lib/formatDate";
import { UPLOAD_STATUS_LABELS, type UploadStatus } from "./constants";
import CreateQuoteButton from "./CreateQuoteButton";
import AdminTableShell, { adminTableCellClass } from "./AdminTableShell";
import { ctaSizeClasses, secondaryCtaClasses } from "@/lib/ctas";

export type InboxRow = {
  id: string;
  quoteId: string | null;
  createdAt: string | null;
  company: string | null;
  contactName: string;
  contactEmail: string | null;
  manufacturingProcess: string | null;
  quantity: string | null;
  status: UploadStatus;
  bidCount: number;
  lastBidAt: string | null;
  hasWinningBid: boolean;
};

type AdminTableProps = {
  rows: InboxRow[];
  hasActiveFilters: boolean;
};

export default function AdminTable({
  rows,
  hasActiveFilters,
}: AdminTableProps) {
  const isEmpty = rows.length === 0;
  const statusPillClass = "pill px-3 py-1 text-[11px]";

  const emptyHeadline = hasActiveFilters
    ? "No RFQs match your filters yet."
    : "No RFQs yet.";
  return (
    <AdminTableShell
      head={
        <tr>
          <th className="px-5 py-4">Created</th>
          <th className="px-5 py-4">Company</th>
          <th className="px-5 py-4">Contact</th>
          <th className="px-5 py-4">Process</th>
          <th className="px-5 py-4">Quantity / volumes</th>
          <th className="px-5 py-4">Bids</th>
          <th className="px-5 py-4">Status</th>
          <th className="px-5 py-4 text-right">Details</th>
        </tr>
      }
      body={
        isEmpty ? (
          <tr>
            <td
              colSpan={8}
              className="px-6 py-12 text-center text-base text-slate-300"
            >
              <p className="font-medium text-slate-100">{emptyHeadline}</p>
              <p className="mt-2 text-sm text-slate-400">
                Need to test the flow?{" "}
                <Link
                  href="/quote"
                  className="font-semibold text-emerald-300 hover:text-emerald-200"
                >
                  Submit a new RFQ
                </Link>{" "}
                from the public intake form.
              </p>
            </td>
          </tr>
        ) : (
          rows.map((row) => {
            const href = row.quoteId
              ? `/admin/quotes/${row.quoteId}`
              : `/admin/uploads/${row.id}`;
            const bidSummary =
              row.bidCount === 0
                ? "No bids"
                : `${row.bidCount} bid${row.bidCount === 1 ? "" : "s"}${
                    row.hasWinningBid ? " • winner selected" : ""
                  }`;
            const formattedLastBid = formatDateTime(row.lastBidAt);
            const lastBidLabel =
              row.bidCount > 0 && row.lastBidAt
                ? `Last bid: ${formattedLastBid}`
                : "Last bid: —";
            const statusVariant = STATUS_BADGE_VARIANTS[row.status];

            return (
              <tr
                key={row.id}
                className="bg-slate-950/40 transition hover:bg-slate-900/40"
              >
                <td className={`${adminTableCellClass} text-slate-400`}>
                  {formatDateTime(row.createdAt, { includeTime: true }) ?? "—"}
                </td>
                <td className={`${adminTableCellClass} text-slate-100`}>
                  {row.company || "—"}
                </td>
                <td className={`${adminTableCellClass} text-slate-100`}>
                  <div className="flex flex-col">
                    <Link
                      href={href}
                      className="text-sm font-medium text-emerald-100 hover:text-emerald-300"
                    >
                      {row.contactName}
                    </Link>
                    {row.contactEmail && (
                      <a
                        href={`mailto:${row.contactEmail}`}
                        className="text-xs text-slate-400 hover:text-emerald-200"
                      >
                        {row.contactEmail}
                      </a>
                    )}
                  </div>
                </td>
                <td className={`${adminTableCellClass} text-slate-200`}>
                  {row.manufacturingProcess || "—"}
                </td>
                <td className={`${adminTableCellClass} text-slate-200`}>
                  {row.quantity || "—"}
                </td>
                <td className={`${adminTableCellClass}`}>
                  <div className="flex flex-col">
                    <span className="text-sm font-medium text-slate-100">
                      {bidSummary}
                    </span>
                    <span className="text-xs text-slate-400">{lastBidLabel}</span>
                  </div>
                </td>
                <td className={adminTableCellClass}>
                  <span
                    className={clsx(statusPillClass, statusVariant.className)}
                  >
                    {statusVariant.label}
                  </span>
                </td>
                  <td className={`${adminTableCellClass} text-right`}>
                    <div className="flex justify-end">
                      {row.quoteId ? (
                        <Link
                          href={href}
                          className={clsx(
                            secondaryCtaClasses,
                            ctaSizeClasses.sm,
                            "min-w-[9.5rem] justify-center",
                          )}
                        >
                          Open quote
                        </Link>
                      ) : (
                        <CreateQuoteButton
                          uploadId={row.id}
                          size="sm"
                          align="end"
                          className="min-w-[9.5rem]"
                        />
                      )}
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

type StatusBadgeVariant = {
  label: string;
  className: string;
};

const STATUS_BADGE_VARIANTS: Record<UploadStatus, StatusBadgeVariant> = {
  submitted: {
    label: UPLOAD_STATUS_LABELS.submitted,
    className: "pill-info",
  },
  in_review: {
    label: UPLOAD_STATUS_LABELS.in_review,
    className: "pill-info",
  },
  quoted: {
    label: UPLOAD_STATUS_LABELS.quoted,
    className: "pill-warning",
  },
  approved: {
    label: "Won",
    className: "pill-success",
  },
  rejected: {
    label: "Lost",
    className: "pill-muted",
  },
};
