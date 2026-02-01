import clsx from "clsx";
import Link from "next/link";
import { formatDateTime } from "@/lib/formatDate";
import AdminTableShell, {
  adminTableCellClass,
} from "@/app/admin/AdminTableShell";
import { ctaSizeClasses, primaryCtaClasses } from "@/lib/ctas";
import { QuoteStatusBadge } from "../components/QuoteStatusBadge";
import {
  formatRelativeTimeFromTimestamp,
  toTimestamp,
} from "@/lib/relativeTime";
import type { QuoteStatus } from "@/server/quotes/status";
import type { MatchHealth } from "@/lib/supplier/matchHealth";
import {
  getSupplierBidSummaryLabel,
  type SupplierBidSummaryState,
} from "@/lib/bids/status";
import {
  PORTAL_DIVIDER,
  PORTAL_ROW,
  PORTAL_TH,
  PORTAL_TH_RIGHT,
} from "@/app/(portals)/components/portalTableRhythm";

export type SupplierInboxRow = {
  id: string;
  quoteId: string;
  rfqLabel: string;
  fileNames: string[];
  primaryFileName: string | null;
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
  matchHealth: MatchHealth | null;
  matchHealthHint?: string | null;
  supplierBidState: SupplierBidSummaryState;
};

type SupplierInboxTableProps = {
  rows: SupplierInboxRow[];
};

const MATCH_HEALTH_PILL_META: Record<
  MatchHealth,
  { label: string; pillClass: string }
> = {
  excellent: { label: "Excellent fit", pillClass: "pill-success" },
  good: { label: "Good fit", pillClass: "pill-info" },
  limited: { label: "Limited fit", pillClass: "pill-warning" },
  poor: { label: "Poor fit", pillClass: "pill-muted" },
};

export default function SupplierInboxTable({ rows }: SupplierInboxTableProps) {
  if (rows.length === 0) {
    return null;
  }

  return (
    <AdminTableShell
      tableClassName="table-fixed"
      head={
        <tr>
          <th className={clsx(PORTAL_TH, "w-[14rem]")}>
            RFQ
          </th>
          <th className={PORTAL_TH}>
            Files &amp; value
          </th>
          <th className={clsx(PORTAL_TH, "w-[14rem]")}>
            Your offer
          </th>
          <th className={clsx(PORTAL_TH, "w-[10rem]")}>
            RFQ status
          </th>
          <th className={clsx(PORTAL_TH_RIGHT, "w-[12rem]")}>
            Action
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
          : "Qty pending";
        const fairnessLabel = row.fairnessReason
          ? `Fairness boost: ${row.fairnessReason}`
          : null;
        const createdLabel =
          formatDateTime(row.createdAt, { includeTime: false }) ?? "—";
        const targetDateLabel = row.targetDate
          ? formatDateTime(row.targetDate, { includeTime: false })
          : null;
        const lastActivityLabel =
          typeof row.lastActivityTimestamp === "number"
            ? formatRelativeTimeFromTimestamp(row.lastActivityTimestamp)
            : row.lastActivityAt
              ? formatDateTime(row.lastActivityAt, { includeTime: true })
              : null;
        const lastBidRelative =
          row.lastBidAt && toTimestamp(row.lastBidAt)
            ? formatRelativeTimeFromTimestamp(toTimestamp(row.lastBidAt))
            : null;
        const lastBidLabel =
          row.lastBidAt && lastBidRelative
            ? `Updated ${lastBidRelative}`
            : row.lastBidAt
              ? `Updated ${formatDateTime(row.lastBidAt, {
                  includeTime: true,
                })}`
              : "No quote on file yet";
        const bidStatusLabel = getSupplierBidSummaryLabel(row.supplierBidState);
        const bidStatusHint = resolveBidStatusHint({
          row,
          lastBidLabel,
          targetDateLabel,
        });
        const ctaLabel = getSupplierBidCtaLabel(row.supplierBidState);

        return (
          <tr
            key={row.id}
            className={clsx("bg-transparent", PORTAL_ROW)}
          >
            <td className={clsx(adminTableCellClass, "px-6 py-4 text-slate-100")}>
              <p className="text-sm font-semibold text-white">
                {row.rfqLabel}
              </p>
              <p className="text-xs text-slate-400">
                {row.companyName} • {quantityLabel} •{" "}
                {row.processHint ?? "Process TBD"}
              </p>
              <div className="mt-1 flex flex-wrap gap-2 text-xs text-slate-500">
                <span className="text-slate-400">Submitted {createdLabel}</span>
                {lastActivityLabel ? (
                  <span>Updated {lastActivityLabel}</span>
                ) : null}
              </div>
              {(row.dueSoon && targetDateLabel) ||
              row.matchHealth ||
              fairnessLabel ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {row.dueSoon && targetDateLabel ? (
                    <span className="inline-flex w-fit items-center rounded-full border border-amber-400/30 bg-amber-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-amber-100">
                      Due soon · {targetDateLabel}
                    </span>
                  ) : null}
                  {row.matchHealth ? (
                    <MatchHealthPill
                      health={row.matchHealth}
                      hint={row.matchHealthHint}
                    />
                  ) : null}
                  {fairnessLabel ? (
                    <span className="inline-flex w-fit items-center rounded-full border border-blue-500/30 bg-blue-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-blue-100">
                      {fairnessLabel}
                    </span>
                  ) : null}
                </div>
              ) : null}
            </td>
            <td className={clsx(adminTableCellClass, "px-6 py-4 text-slate-200")}>
              <p className="text-sm font-medium text-slate-100">
                {row.priceLabel}
              </p>
              <p className="text-xs text-slate-400">{filesLabel}</p>
              {row.primaryFileName ? (
                <p className="text-xs text-slate-500">
                  Primary: {row.primaryFileName}
                </p>
              ) : null}
              <p className="text-xs text-slate-500">{materialsLabel}</p>
            </td>
            <td className={clsx(adminTableCellClass, "px-6 py-4")}>
              <span
                className={clsx(
                  "inline-flex w-fit items-center rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-wide",
                  BID_STATUS_META[row.supplierBidState].pillClass,
                )}
              >
                {bidStatusLabel}
              </span>
              <p className="mt-2 text-xs text-slate-400">{bidStatusHint}</p>
            </td>
            <td className={clsx(adminTableCellClass, "px-6 py-4")}>
              <QuoteStatusBadge status={row.status} size="sm" />
            </td>
            <td className={clsx(adminTableCellClass, "px-6 py-4 text-right")}>
              <Link
                href={href}
                className={clsx(
                  primaryCtaClasses,
                  ctaSizeClasses.sm,
                  "inline-flex min-w-[8.5rem] justify-center",
                )}
              >
                {ctaLabel}
              </Link>
            </td>
          </tr>
        );
      })}
    />
  );
}

function MatchHealthPill({
  health,
  hint,
}: {
  health: MatchHealth;
  hint?: string | null;
}) {
  const meta = MATCH_HEALTH_PILL_META[health];
  return (
    <span
      className={clsx("pill pill-table", meta.pillClass)}
      title={hint ?? undefined}
    >
      {meta.label}
    </span>
  );
}

const BID_STATUS_META: Record<
  SupplierBidSummaryState,
  { pillClass: string }
> = {
  no_bid: { pillClass: "pill-info" },
  submitted: { pillClass: "pill-muted" },
  won: { pillClass: "pill-success" },
  lost: { pillClass: "pill-warning" },
};

function getSupplierBidCtaLabel(state: SupplierBidSummaryState): string {
  switch (state) {
    case "no_bid":
      return "Review & quote";
    case "won":
      return "Open workspace";
    default:
      return "View offer";
  }
}

function resolveBidStatusHint({
  row,
  lastBidLabel,
  targetDateLabel,
}: {
  row: SupplierInboxRow;
  lastBidLabel: string;
  targetDateLabel: string | null;
}): string {
  switch (row.supplierBidState) {
    case "no_bid":
      return "RFQ assigned—share a quote to stay in the rotation.";
    case "submitted":
      return lastBidLabel;
    case "won":
      return targetDateLabel
        ? `Awarded · Target ship ${targetDateLabel}`
        : "Awarded to your shop";
    case "lost":
    default:
      return "Customer selected another supplier.";
  }
}
