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
    className: "bg-slate-900 text-slate-100 border-slate-700",
  },
  in_review: {
    label: "In review",
    className: "bg-slate-900 text-slate-100 border-slate-700",
  },
  quoted: {
    label: "Quoted",
    className: "bg-sky-950/60 text-sky-200 border-sky-500/50",
  },
  approved: {
    label: "Approved",
    className: "bg-emerald-950/60 text-emerald-200 border-emerald-500/60",
  },
  won: {
    label: "Won",
    className: "bg-emerald-950/60 text-emerald-200 border-emerald-500/60",
  },
  lost: {
    label: "Lost",
    className: "bg-rose-950/60 text-rose-200 border-rose-500/60",
  },
  cancelled: {
    label: "Closed",
    className: "bg-slate-900/60 text-slate-300 border-slate-600",
  },
  default: {
    label: "Needs quote",
    className: "bg-slate-900 text-slate-100 border-slate-700",
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
          <th className="px-4 py-3">RFQ</th>
          <th className="px-4 py-3">Process</th>
          <th className="px-4 py-3">Files &amp; value</th>
          <th className="px-4 py-3">Bids</th>
          <th className="px-4 py-3">Status</th>
          <th className="px-4 py-3 text-right">Workspace</th>
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
        const statusVariant =
          STATUS_BADGE_VARIANTS[row.status] ?? STATUS_BADGE_VARIANTS.default;

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
              <span
                className={clsx(
                  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
                  statusVariant.className,
                )}
              >
                {statusVariant.label}
              </span>
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
