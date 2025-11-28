"use client";

import { useFormState, useFormStatus } from "react-dom";
import { formatCurrency } from "@/lib/formatCurrency";
import { formatDateTime } from "@/lib/formatDate";
import type { BidRow } from "@/server/bids";
import type { QuoteStatus } from "@/server/quotes/status";
import {
  initialAdminSelectWinningBidState,
  submitSelectWinningBidAction,
  type AdminSelectWinningBidState,
} from "./actions";

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
  const boundAction = submitSelectWinningBidAction.bind(null, quoteId);
  const [state, formAction] = useFormState<
    AdminSelectWinningBidState,
    FormData
  >(boundAction, initialAdminSelectWinningBidState);

  const selectionLocked = TERMINAL_STATUSES.includes(quoteStatus);
  const showSuccess = state.ok && Boolean(state.message);
  const showError = !state.ok && Boolean(state.error);

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

      {showSuccess ? (
        <p className="mb-3 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs font-medium text-emerald-200">
          {state.message}
        </p>
      ) : null}

      {showError ? (
        <p className="mb-3 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs font-medium text-red-200">
          {state.error}
        </p>
      ) : null}

      {errorMessage && bidsLoaded ? (
        <p className="text-xs text-slate-400">{errorMessage}</p>
      ) : null}

      {bidsLoaded && bids.length === 0 ? (
        <p className="text-xs text-slate-400">
          No bids have been submitted for this quote yet.
        </p>
      ) : null}

      {bidsLoaded && bids.length > 0 ? (
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
              {bids.map((bid) => {
                const formattedAmount =
                  typeof bid.amount === "number"
                    ? formatCurrency(bid.amount, bid.currency, {
                        maximumFractionDigits: 2,
                      })
                    : "—";
                const submittedAt = bid.created_at
                  ? formatDateTime(bid.created_at)
                  : "—";
                const bidStatus = (bid.status ?? "submitted").toString();
                const bidWon = bidStatus.toLowerCase() === "won";
                const canSelect = !selectionLocked && !bidWon;

                return (
                  <tr
                    key={bid.id}
                    className="border-b border-slate-900/60 last:border-0"
                  >
                    <td className="py-2 pr-3">
                      <span className="font-mono text-[11px] text-slate-400">
                        {bid.supplier_id}
                      </span>
                    </td>
                    <td className="py-2 pr-3">
                      {formattedAmount}
                      {bid.currency ? (
                        <span className="ml-1 text-[11px] text-slate-400">
                          {bid.currency}
                        </span>
                      ) : null}
                    </td>
                    <td className="py-2 pr-3">
                      {typeof bid.lead_time_days === "number"
                        ? `${bid.lead_time_days} day${
                            bid.lead_time_days === 1 ? "" : "s"
                          }`
                        : "—"}
                    </td>
                    <td className="py-2 pr-3">
                      <span className="inline-flex rounded-full bg-slate-800/60 px-2 py-0.5 text-[11px] capitalize">
                        {bidStatus}
                      </span>
                    </td>
                    <td className="py-2 pr-3">{submittedAt}</td>
                    <td className="py-2 pr-3">
                      {bidWon ? (
                        <span className="inline-flex items-center justify-end rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-200">
                          Winner
                        </span>
                      ) : canSelect ? (
                        <form
                          action={formAction}
                          className="flex justify-end"
                        >
                          <input type="hidden" name="bidId" value={bid.id} />
                          <MarkWinnerButton />
                        </form>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

function MarkWinnerButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="text-xs font-medium text-emerald-300 transition hover:text-emerald-200 disabled:cursor-not-allowed disabled:text-slate-500"
    >
      {pending ? "Selecting..." : "Mark as winner"}
    </button>
  );
}
