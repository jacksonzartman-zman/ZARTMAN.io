"use client";

import { useMemo } from "react";
import { useFormState, useFormStatus } from "react-dom";
import clsx from "clsx";
import { formatDateTime } from "@/lib/formatDate";
import type { CustomerQuoteBidSummary } from "@/server/customers/bids";
import {
  awardQuoteToBidAction,
  type AwardActionState,
} from "./actions";

const INITIAL_AWARD_STATE: AwardActionState = { ok: true, message: null };

export type CustomerQuoteAwardPanelProps = {
  quoteId: string;
  bids: CustomerQuoteBidSummary[];
  canSubmit: boolean;
  disableReason?: string | null;
  winningBidId?: string | null;
};

export function CustomerQuoteAwardPanel({
  quoteId,
  bids,
  canSubmit,
  disableReason,
  winningBidId,
}: CustomerQuoteAwardPanelProps) {
  const action = useMemo(() => awardQuoteToBidAction, []);
  const [state, formAction] = useFormState<AwardActionState, FormData>(
    action,
    INITIAL_AWARD_STATE,
  );

  const resolvedWinnerId = state.selectedBidId ?? winningBidId ?? null;
  const selectionLocked = Boolean(resolvedWinnerId);
  const showDisableNotice = Boolean(disableReason) && (!canSubmit || selectionLocked);

  return (
    <section className="space-y-5 rounded-2xl border border-slate-900 bg-slate-950/40 px-6 py-5">
      <header className="space-y-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">
            Supplier decisions
          </p>
          <h2 className="text-2xl font-semibold text-white heading-tight">
            Review bids & award a winner
          </h2>
        </div>
        <p className="text-sm text-slate-300">
          Compare bids, pick the supplier that feels right, and we’ll mark this RFQ as awarded.
        </p>
        <p className="text-xs text-slate-500">
          You’re never obligated to award—move forward only when price, lead time, and fit align.
        </p>
      </header>

      {state.ok && state.message ? (
        <p className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
          {state.message}
        </p>
      ) : null}

      {!state.ok && state.error ? (
        <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-100">
          {state.error}
        </p>
      ) : null}

      {showDisableNotice ? (
        <p className="rounded-xl border border-slate-800 bg-slate-950/60 px-5 py-3 text-xs text-slate-400">
          {disableReason}
        </p>
      ) : null}

      <ol className="space-y-4">
        {bids.map((bid) => {
          const isWinner = resolvedWinnerId === bid.id;
          const showActionButton = canSubmit && !selectionLocked;
          const priceText = bid.priceDisplay ?? "Price pending";
          const leadTimeText = bid.leadTimeDisplay ?? "Lead time pending";
          const submittedText = formatDateTime(bid.createdAt, { includeTime: true }) ?? "Just now";
          const statusLabel = formatBidStatusLabel(bid.status);
          const statusClasses = getStatusClasses(bid.status);

          return (
            <li
              key={bid.id}
              className={clsx(
                "space-y-3 rounded-2xl border px-5 py-4 transition",
                isWinner
                  ? "border-emerald-400/60 bg-emerald-500/5"
                  : "border-slate-900/60 bg-slate-950/40 hover:border-slate-800",
              )}
            >
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-500">
                    Supplier
                  </p>
                  <p className="text-xl font-semibold text-white heading-snug">
                    {bid.supplierName}
                  </p>
                  <p className="text-sm text-slate-300">
                    Submitted {submittedText}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={clsx("pill px-3 py-1 text-[11px]", statusClasses)}>
                    Status: {statusLabel}
                  </span>
                  {isWinner ? (
                    <span className="pill pill-success px-3 py-1 text-[11px] uppercase tracking-wide">
                      Selected winner
                    </span>
                  ) : null}
                </div>
              </div>

              <dl className="grid gap-3 text-sm text-slate-200 sm:grid-cols-3">
                <div>
                  <dt className="text-[11px] font-semibold uppercase tracking-[0.25em] text-slate-500">
                    Price
                  </dt>
                  <dd className="text-lg font-semibold text-white heading-snug">{priceText}</dd>
                </div>
                <div>
                  <dt className="text-[11px] font-semibold uppercase tracking-[0.25em] text-slate-500">
                    Lead time
                  </dt>
                  <dd className="text-lg font-semibold text-white heading-snug">{leadTimeText}</dd>
                </div>
                <div>
                  <dt className="text-[11px] font-semibold uppercase tracking-[0.25em] text-slate-500">
                    Notes
                  </dt>
                  <dd className="text-sm text-slate-200">
                    {bid.notes ?? "No notes shared."}
                  </dd>
                </div>
              </dl>

              {showActionButton ? (
                <AwardBidForm formAction={formAction} bidId={bid.id} quoteId={quoteId} />
              ) : null}
            </li>
          );
        })}
      </ol>

      <div className="space-y-2 rounded-2xl border border-dashed border-slate-800/70 bg-black/30 px-5 py-4">
        <p className="text-sm font-semibold text-slate-100">What happens when you award?</p>
        <ul className="list-disc space-y-1 pl-4 text-sm text-slate-300">
          <li>We notify your selected supplier so they can confirm scope.</li>
          <li>Your RFQ status updates to Won / Awarded for tracking.</li>
          <li>No purchase order or payment is triggered automatically.</li>
        </ul>
      </div>
    </section>
  );
}

type AwardBidFormProps = {
  formAction: (payload: FormData) => void;
  bidId: string;
  quoteId: string;
};

function AwardBidForm({ formAction, bidId, quoteId }: AwardBidFormProps) {
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-3 border-t border-slate-900/60 pt-4">
      <input type="hidden" name="quoteId" value={quoteId} />
      <input type="hidden" name="bidId" value={bidId} />
      <AwardSubmitButton />
    </form>
  );
}

type AwardSubmitButtonProps = {
  disabled?: boolean;
};

function AwardSubmitButton({ disabled = false }: AwardSubmitButtonProps) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={disabled || pending}
      className="inline-flex items-center rounded-full border border-emerald-400/50 bg-emerald-500/10 px-4 py-2 text-sm font-semibold text-emerald-100 transition hover:bg-emerald-500/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "Saving choice..." : "Choose this supplier"}
    </button>
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
