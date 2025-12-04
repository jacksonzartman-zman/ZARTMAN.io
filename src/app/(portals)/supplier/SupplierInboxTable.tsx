import clsx from "clsx";
import Link from "next/link";
import { formatDateTime } from "@/lib/formatDate";
import AdminTableShell, {
  adminTableCellClass,
} from "@/app/admin/AdminTableShell";
import { ctaSizeClasses, secondaryCtaClasses } from "@/lib/ctas";
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
};

type SupplierInboxTableProps = {
  rows: SupplierInboxRow[];
};

const STATUS_BADGE_VARIANTS: Record<
  QuoteStatus | "default",
  { label: string; className: string }
> = {
  submitted: {
    label: "Needs quote",
    className: "pill-info",
  },
  in_review: {
    label: "In review",
    className: "pill-info",
  },
  quoted: {
    label: "Quoted",
    className: "pill-info",
  },
  approved: {
    label: "Approved",
    className: "pill-success",
  },
  won: {
    label: "Won",
    className: "pill-success",
  },
  lost: {
    label: "Lost",
    className: "pill-warning",
  },
  cancelled: {
    label: "Closed",
    className: "pill-muted",
  },
  default: {
    label: "Needs quote",
    className: "pill-info",
  },
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
        const bidIsWinner = row.hasWinningBid;
        const bidSummary =
          row.bidCount === 0
            ? "No bids"
            : `${row.bidCount} bid${row.bidCount === 1 ? "" : "s"}${
                bidIsWinner ? " • You won" : ""
              }`;
        const formattedLastBid = row.lastBidAt
          ? formatDateTime(row.lastBidAt, { includeTime: true })
          : null;
        const lastBidLabel =
          row.bidCount > 0 && formattedLastBid
            ? `Last bid: ${formattedLastBid}`
            : "Last bid: —";
        const statusVariant = bidIsWinner
          ? { label: "Won / Awarded", className: "pill-success" }
          : STATUS_BADGE_VARIANTS[row.status] ?? STATUS_BADGE_VARIANTS.default;
        const winnerHelperText = bidIsWinner
          ? "Customer selected this bid as the winner."
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
              <p className="text-xs text-slate-400">{createdLabel}</p>
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
              <div className="flex flex-col">
                <span
                  className={clsx("pill pill-table", statusVariant.className)}
                >
                  {statusVariant.label}
                </span>
                {winnerHelperText ? (
                  <span className="mt-1 text-[11px] text-slate-400">
                    {winnerHelperText}
                  </span>
                ) : null}
              </div>
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
