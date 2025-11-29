"use client";

import clsx from "clsx";
import { useEffect } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { formatCurrency } from "@/lib/formatCurrency";
import { formatDateTime } from "@/lib/formatDate";
import type { BidRow } from "@/server/bids";
import {
  submitCustomerSelectWinningBidAction,
  type CustomerSelectWinningBidState,
} from "./actions";
import { CUSTOMER_SELECT_WINNER_INITIAL_STATE } from "@/lib/customer/decisionState";

type CustomerBidSelectionCardProps = {
  quoteId: string;
  bids: BidRow[];
  canSelectWinner: boolean;
  disableReason?: string | null;
  winningBidId?: string | null;
  winningBidSelectedAt?: string | null;
  quoteWon: boolean;
};

export function CustomerBidSelectionCard({
  quoteId,
  bids,
  canSelectWinner,
  disableReason,
  winningBidId,
  winningBidSelectedAt,
  quoteWon,
}: CustomerBidSelectionCardProps) {
  const router = useRouter();
  const boundAction = submitCustomerSelectWinningBidAction.bind(null, quoteId);
  const [state, formAction] = useFormState<
    CustomerSelectWinningBidState,
    FormData
  >(boundAction, CUSTOMER_SELECT_WINNER_INITIAL_STATE);

  const successMessage = isSuccessState(state) ? state.message : "";
  const errorMessage = isErrorState(state) ? state.error : "";

  useEffect(() => {
    if (successMessage) {
      router.refresh();
    }
  }, [router, successMessage]);

  const winningTimestampText = winningBidSelectedAt
    ? formatDateTime(winningBidSelectedAt, { includeTime: true })
    : null;

  const showSelectControls = canSelectWinner && bids.length > 0;

  return (
    <div className="mt-5 space-y-4">
      {quoteWon ? (
        <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
          Winning supplier selected{" "}
          {winningTimestampText ? `on ${winningTimestampText}` : "successfully"}.
        </div>
      ) : null}

      {errorMessage ? (
        <p
          className="rounded-xl border border-red-500/40 bg-red-500/5 px-4 py-3 text-sm text-red-200"
          role="alert"
        >
          {errorMessage}
        </p>
      ) : null}

      {successMessage ? (
        <p className="rounded-xl border border-emerald-500/40 bg-emerald-500/5 px-4 py-3 text-sm text-emerald-100">
          {successMessage}
        </p>
      ) : null}

      {!showSelectControls && disableReason ? (
        <p className="rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-2 text-xs text-slate-400">
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
          const isWinner =
            bid.id === winningBidId ||
            (typeof bid.status === "string" &&
              bid.status.trim().toLowerCase() === "won");
          const showSelectButton = showSelectControls && !isWinner;

          return (
            <article
              key={bid.id}
              className={clsx(
                "rounded-2xl border px-4 py-4 shadow-sm transition",
                isWinner
                  ? "border-emerald-500/60 bg-emerald-500/5"
                  : "border-slate-900/60 bg-slate-950/40 hover:border-slate-700",
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
                  <span
                    className={clsx(
                      "rounded-full border px-3 py-1 text-xs font-semibold",
                      statusClasses,
                    )}
                  >
                    Status: {statusLabel}
                  </span>
                  {isWinner ? (
                    <span className="rounded-full border border-emerald-400/50 bg-emerald-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-emerald-100">
                      Winner
                    </span>
                  ) : null}
                </div>
              </div>

              {showSelectButton ? (
                <SelectWinnerForm bidId={bid.id} action={formAction} />
              ) : null}
            </article>
          );
        })}
      </div>
    </div>
  );
}

type SelectWinnerFormProps = {
  bidId: string;
  action: (formData: FormData) => void;
};

function isSuccessState(
  state: CustomerSelectWinningBidState,
): state is { ok: true; message: string } {
  return state.ok;
}

function isErrorState(
  state: CustomerSelectWinningBidState,
): state is { ok: false; error: string } {
  return !state.ok;
}

function SelectWinnerForm({ bidId, action }: SelectWinnerFormProps) {
  const { pending } = useFormStatus();
  return (
    <form action={action} className="mt-3">
      <input type="hidden" name="bidId" value={bidId} />
      <button
        type="submit"
        disabled={pending}
        className="inline-flex items-center rounded-full border border-emerald-400/50 bg-emerald-500/10 px-4 py-1.5 text-sm font-semibold text-emerald-100 transition hover:bg-emerald-500/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? "Selecting..." : "Select winner"}
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
  if (value === "won") {
    return "border-emerald-400/50 bg-emerald-500/10 text-emerald-100";
  }
  if (value === "lost" || value === "declined") {
    return "border-slate-700 bg-transparent text-slate-300";
  }
  if (value === "withdrawn") {
    return "border-amber-400/50 bg-amber-500/10 text-amber-100";
  }
  return "border-slate-800 bg-slate-900/40 text-slate-200";
}
