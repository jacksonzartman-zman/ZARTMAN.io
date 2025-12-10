import clsx from "clsx";
import Link from "next/link";
import { formatDateTime } from "@/lib/formatDate";
import AdminTableShell, {
  adminTableCellClass,
} from "@/app/admin/AdminTableShell";
import { ctaSizeClasses, secondaryCtaClasses } from "@/lib/ctas";
import { QuoteStatusBadge } from "../components/QuoteStatusBadge";
import { formatRelativeTimeFromTimestamp } from "@/lib/relativeTime";
import type { QuoteStatus } from "@/server/quotes/status";

export type SupplierInboxRow = {
  id: string;
  quoteId: string;
  companyName: string;
  processHint: string | null;
  materials: string[];
  quantityHint: string | null;
  fileCount: number;
  priceLabel: string;
  createdAt: string | null;
  status: QuoteStatus;
  bidCount: number;
  lastBidAt: string | null;
  hasWinningBid: boolean;
  fairnessReason?: string | null;
  targetDate: string | null;
  dueSoon: boolean;
  lastActivityAt: string | null;
  lastActivityTimestamp: number | null;
};

type SupplierInboxTableProps = {
  rows: SupplierInboxRow[];
};

export default function SupplierInboxTable({ rows }: SupplierInboxTableProps) {
  if (rows.length === 0) {
    return null;
  }

  return (
    <AdminTableShell
      head={
        <tr>
          <th className="px-5 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">
            RFQ
          </th>
          <th className="px-5 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">
            Process
          </th>
          <th className="px-5 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">
            Files &amp; value
          </th>
          <th className="px-5 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">
            Bids
          </th>
          <th className="px-5 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">
            Status
          </th>
          <th className="px-5 py-4 text-right text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">
            Workspace
          </th>
        </tr>
      }
      body={rows.map((row) => {
        const href = `/supplier/quotes/${row.quoteId}`;
        const filesLabel =
          row.fileCount > 0
            ? `${row.fileCount} file${row.fileCount === 1 ? "" : "s"}`
            : "No files";
        const materialsLabel =
          row.materials.length > 0
            ? `Materials: ${row.materials.join(", ")}`
            : "Materials: —";
        const quantityLabel = row.quantityHint
          ? `Qty: ${row.quantityHint}`
          : "Qty: —";
        const fairnessLabel = row.fairnessReason
          ? `Fairness boost: ${row.fairnessReason}`
          : null;
        const createdLabel =
          formatDateTime(row.createdAt, { includeTime: false }) ?? "—";
        const targetDateLabel = row.targetDate
          ? formatDateTime(row.targetDate, { includeTime: false })
          : null;
        const bidSummary =
          row.bidCount === 0
            ? "No bids"
            : `${row.bidCount} bid${row.bidCount === 1 ? "" : "s"}${
                row.hasWinningBid ? " • winner selected" : ""
              }`;
        const formattedLastBid = row.lastBidAt
          ? formatDateTime(row.lastBidAt, { includeTime: true })
          : null;
        const lastBidLabel =
          row.bidCount > 0 && formattedLastBid
            ? `Last bid: ${formattedLastBid}`
            : "Last bid: —";
        const lastActivityLabel =
          typeof row.lastActivityTimestamp === "number"
            ? formatRelativeTimeFromTimestamp(row.lastActivityTimestamp)
            : row.lastActivityAt
              ? formatDateTime(row.lastActivityAt, { includeTime: true })
              : null;

        return (
          <tr
            key={row.id}
            className="bg-slate-950/40 transition hover:bg-slate-900/40"
          >
            <td className={`${adminTableCellClass} text-slate-100`}>
              <p className="text-sm font-semibold text-white">
                {row.companyName}
              </p>
              <div className="mt-1 flex flex-wrap gap-2 text-xs text-slate-500">
                <span className="text-slate-400">Submitted {createdLabel}</span>
                {lastActivityLabel ? (
                  <span>Updated {lastActivityLabel}</span>
                ) : null}
              </div>
              {row.dueSoon && targetDateLabel ? (
                <span className="mt-2 inline-flex w-fit items-center rounded-full border border-amber-400/30 bg-amber-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-amber-100">
                  Due soon · {targetDateLabel}
                </span>
              ) : null}
            </td>
            <td className={`${adminTableCellClass} text-slate-200`}>
              <p>{row.processHint ?? "Process TBD"}</p>
              <p className="text-xs text-slate-500">{quantityLabel}</p>
            </td>
            <td className={`${adminTableCellClass} text-slate-200`}>
              <p className="text-sm font-medium text-slate-100">
                {row.priceLabel}
              </p>
              <p className="text-xs text-slate-400">{filesLabel}</p>
              <p className="text-xs text-slate-500">{materialsLabel}</p>
              {fairnessLabel ? (
                <p className="text-[11px] text-blue-200/80">{fairnessLabel}</p>
              ) : null}
            </td>
            <td className={adminTableCellClass}>
              <div className="flex flex-col">
                <span className="text-sm font-medium text-slate-100">
                  {bidSummary}
                </span>
                <span className="text-xs text-slate-400">{lastBidLabel}</span>
              </div>
            </td>
            <td className={adminTableCellClass}>
              <QuoteStatusBadge status={row.status} size="sm" />
            </td>
            <td className={`${adminTableCellClass} text-right`}>
              <Link
                href={href}
                className={clsx(
                  secondaryCtaClasses,
                  ctaSizeClasses.sm,
                  "inline-flex min-w-[8.5rem] justify-center",
                )}
              >
                View quote
              </Link>
            </td>
          </tr>
        );
      })}
    />
  );
}
