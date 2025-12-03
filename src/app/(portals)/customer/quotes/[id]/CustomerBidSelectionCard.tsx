import clsx from "clsx";
import { formatCurrency } from "@/lib/formatCurrency";
import { formatDateTime } from "@/lib/formatDate";
import type { BidRow } from "@/server/bids";
import { customerAwardBidAction } from "./actions";

type CustomerBidSelectionCardProps = {
  quoteId: string;
  bids: BidRow[];
  showAwardButtons: boolean;
  disableReason?: string | null;
  winningBidId?: string | null;
  quoteWon: boolean;
};

export function CustomerBidSelectionCard({
  quoteId,
  bids,
  showAwardButtons,
  disableReason,
  winningBidId,
  quoteWon,
}: CustomerBidSelectionCardProps) {
  const hasWinner =
    Boolean(winningBidId) ||
    bids.some(
      (bid) =>
        typeof bid.status === "string" &&
        bid.status.trim().toLowerCase() === "won",
    ) ||
    quoteWon;

  return (
    <div className="mt-5 space-y-4">
      {hasWinner ? (
        <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-6 py-4 text-sm text-emerald-100">
          Winning supplier selected. We notified the supplier to kick off the project.
        </div>
      ) : null}

      {!showAwardButtons && disableReason ? (
        <p className="rounded-xl border border-slate-800 bg-slate-950/60 px-6 py-3 text-xs text-slate-400">
          {disableReason}
        </p>
      ) : null}

      <div className="space-y-3">
        {bids.map((bid, index) => {
          const supplierLabel = `Supplier ${index + 1}`;
          const amountText = formatCurrency(bid.amount, bid.currency ?? undefined, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          });
          const leadTimeText =
            typeof bid.lead_time_days === "number" &&
            Number.isFinite(bid.lead_time_days)
              ? `${bid.lead_time_days} day${bid.lead_time_days === 1 ? "" : "s"}`
              : "Lead time pending";
          const submittedText = formatDateTime(bid.created_at, {
            includeTime: true,
          });
          const statusLabel = formatBidStatusLabel(bid.status);
          const statusClasses = getStatusClasses(bid.status);
          const normalizedBidStatus =
            typeof bid.status === "string" ? bid.status.trim().toLowerCase() : "";
          const isWinner =
            bid.id === winningBidId || normalizedBidStatus === "won";
          const showSelectButton =
            showAwardButtons &&
            !hasWinner &&
            normalizedBidStatus !== "won" &&
            normalizedBidStatus !== "lost";

          return (
            <article
              key={bid.id}
              className={clsx(
                "rounded-2xl border px-6 py-5 shadow-sm transition",
                isWinner
                  ? "border-emerald-500/60 bg-emerald-500/5"
                  : "border-slate-900/60 bg-slate-950/40 hover:border-slate-800",
              )}
            >
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                    {supplierLabel}
                  </p>
                  <p className="text-xl font-semibold text-white">{amountText}</p>
                  <p className="text-sm text-slate-300">
                    {leadTimeText} • Submitted {submittedText}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={clsx("pill px-3 py-1 text-[11px]", statusClasses)}>
                    Status: {statusLabel}
                  </span>
                  {isWinner ? (
                    <span className="pill pill-success px-3 py-1 text-[11px] uppercase tracking-wide">
                      Winner
                    </span>
                  ) : hasWinner ? (
                    <span className="pill pill-muted px-3 py-1 text-[11px] uppercase tracking-wide">
                      Not selected
                    </span>
                  ) : null}
                </div>
              </div>

              {showSelectButton ? (
                <SelectWinnerForm quoteId={quoteId} bidId={bid.id} />
              ) : null}
            </article>
          );
        })}
      </div>
    </div>
  );
}

type SelectWinnerFormProps = {
  quoteId: string;
  bidId: string;
};

function SelectWinnerForm({ quoteId, bidId }: SelectWinnerFormProps) {
  return (
    <form action={customerAwardBidAction} className="mt-3">
      <input type="hidden" name="quoteId" value={quoteId} />
      <input type="hidden" name="bidId" value={bidId} />
      <button
        type="submit"
        className="inline-flex items-center rounded-full border border-emerald-400/50 bg-emerald-500/10 px-4 py-1.5 text-sm font-semibold text-emerald-100 transition hover:bg-emerald-500/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-400"
      >
        Select as winner
      </button>
    </form>
  );
}

function formatBidStatusLabel(status?: string | null): string {
  const value = typeof status === "string" ? status.trim().toLowerCase() : "";
  switch (value) {
    case "won":
      return "Won";
    case "lost":
      return "Lost";
    case "revised":
      return "Revised";
    case "withdrawn":
      return "Withdrawn";
    case "accepted":
      return "Accepted";
    case "declined":
      return "Declined";
    case "submitted":
    default:
      return "Submitted";
  }
}

function getStatusClasses(status?: string | null) {
  const value = typeof status === "string" ? status.trim().toLowerCase() : "";
  if (value === "won" || value === "accepted") {
    return "pill-success";
  }
  if (value === "lost" || value === "declined") {
    return "pill-muted";
  }
  if (value === "withdrawn") {
    return "pill-warning";
  }
  return "pill-info";
}
