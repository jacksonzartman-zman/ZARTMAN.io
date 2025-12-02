import { formatCurrency } from "@/lib/formatCurrency";
import { formatDateTime } from "@/lib/formatDate";
import type { BidRow } from "@/server/bids";
import type { QuoteStatus } from "@/server/quotes/status";
import { awardBidFormAction } from "./actions";

type SupplierBidsCardProps = {
  quoteId: string;
  quoteStatus: QuoteStatus;
  bids: BidRow[];
  bidsLoaded: boolean;
  errorMessage?: string | null;
};

const TERMINAL_STATUSES: QuoteStatus[] = ["won", "lost", "cancelled"];

export function SupplierBidsCard({
  quoteId,
  quoteStatus,
  bids,
  bidsLoaded,
  errorMessage,
}: SupplierBidsCardProps) {
  const quoteIsInTerminalStatus = TERMINAL_STATUSES.includes(quoteStatus);
  const bidsAvailable = bidsLoaded && bids.length > 0;
  const hasWinner =
    bidsAvailable &&
    bids.some((bid) => (bid.status ?? "").toLowerCase() === "won");

  return (
    <section className="mt-8 rounded-2xl border border-slate-900 bg-slate-950/40 p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-100">Supplier bids</h2>
        {!bidsLoaded ? (
          <span className="text-xs text-slate-400">
            We had trouble loading bids. Check logs and try again.
          </span>
        ) : null}
      </div>

      {errorMessage && bidsLoaded ? (
        <p className="text-xs text-slate-400">{errorMessage}</p>
      ) : null}

      {bidsLoaded && bids.length === 0 ? (
        <p className="text-xs text-slate-400">
          No bids have been submitted for this quote yet.
        </p>
      ) : null}

      {bidsAvailable ? (
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-xs text-slate-200">
            <thead className="border-b border-slate-800 text-[11px] uppercase tracking-wide text-slate-400">
              <tr>
                <th className="py-2 pr-3">Supplier</th>
                <th className="py-2 pr-3">Amount</th>
                <th className="py-2 pr-3">Lead time</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3">Submitted</th>
                <th className="py-2 pr-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {bids.map((bid) => (
                <BidRow
                  key={bid.id}
                  bid={bid}
                  quoteId={quoteId}
                  hasWinner={hasWinner}
                  quoteIsLocked={quoteIsInTerminalStatus}
                />
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

type BidRowProps = {
  bid: BidRow;
  quoteId: string;
  hasWinner: boolean;
  quoteIsLocked: boolean;
};

function BidRow({ bid, quoteId, hasWinner, quoteIsLocked }: BidRowProps) {
  const formattedAmount =
    typeof bid.amount === "number"
      ? formatCurrency(bid.amount, bid.currency, {
          maximumFractionDigits: 2,
        })
      : "—";
  const submittedAt = bid.created_at ? formatDateTime(bid.created_at) : "—";
  const bidStatus = (bid.status ?? "submitted").toString();
  const isWinner = bidStatus.toLowerCase() === "won";

  return (
    <tr className="border-b border-slate-900/60 last:border-0">
      <td className="py-2 pr-3">
        <span className="font-mono text-[11px] text-slate-400">
          {bid.supplier_id}
        </span>
      </td>
      <td className="py-2 pr-3">
        {formattedAmount}
        {bid.currency ? (
          <span className="ml-1 text-[11px] text-slate-400">{bid.currency}</span>
        ) : null}
      </td>
      <td className="py-2 pr-3">
        {typeof bid.lead_time_days === "number"
          ? `${bid.lead_time_days} day${bid.lead_time_days === 1 ? "" : "s"}`
          : "—"}
      </td>
      <td className="py-2 pr-3">
        <span className="inline-flex rounded-full bg-slate-800/60 px-2 py-0.5 text-[11px] capitalize">
          {bidStatus}
        </span>
      </td>
      <td className="py-2 pr-3">{submittedAt}</td>
      <td className="py-2 pr-3 text-right">
        {renderBidAction({
          quoteId,
          bidId: bid.id,
          isWinner,
          hasWinner,
          quoteIsLocked,
        })}
      </td>
    </tr>
  );
}

type BidActionProps = {
  quoteId: string;
  bidId: string;
  isWinner: boolean;
  hasWinner: boolean;
  quoteIsLocked: boolean;
};

function renderBidAction({
  quoteId,
  bidId,
  isWinner,
  hasWinner,
  quoteIsLocked,
}: BidActionProps) {
  if (isWinner) {
    return (
      <span className="rounded-full border border-emerald-500/60 bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-100">
        Winner
      </span>
    );
  }

  if (hasWinner) {
    return (
      <span className="rounded-full border border-slate-700 bg-slate-900/40 px-2 py-0.5 text-xs text-slate-400">
        Not selected
      </span>
    );
  }

  if (quoteIsLocked) {
    return (
      <span className="rounded-full border border-slate-800/60 bg-slate-900/40 px-2 py-0.5 text-xs text-slate-400">
        Quote closed
      </span>
    );
  }

  return (
    <form action={awardBidFormAction} className="flex justify-end">
      <input type="hidden" name="quoteId" value={quoteId} />
      <input type="hidden" name="bidId" value={bidId} />
      <button
        type="submit"
        className="rounded-full border border-emerald-500/60 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-100 hover:bg-emerald-500/20"
      >
        Select as winner
      </button>
    </form>
  );
}
