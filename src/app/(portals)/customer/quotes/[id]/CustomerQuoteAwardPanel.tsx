"use client";

/**
 * Phase 1 Polish checklist
 * - Done: Confirmation feedback for award (success banner + refresh + scroll to Kickoff)
 * - Done: Error copy is calm + actionable
 */

import { useEffect, useMemo, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import clsx from "clsx";
import { useRouter } from "next/navigation";
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
  const router = useRouter();
  const action = useMemo(() => awardQuoteToBidAction, []);
  const [state, formAction] = useFormState<AwardActionState, FormData>(
    action,
    INITIAL_AWARD_STATE,
  );
  const [confirmingBidId, setConfirmingBidId] = useState<string | null>(null);

  const resolvedWinnerId = state.selectedBidId ?? winningBidId ?? null;
  const selectionLocked = Boolean(resolvedWinnerId);
  const showDisableNotice = Boolean(disableReason) && (!canSubmit || selectionLocked);
  const winnerSupplierName =
    selectionLocked && resolvedWinnerId
      ? bids.find((bid) => bid.id === resolvedWinnerId)?.supplierName ?? null
      : null;
  const confirmingBid =
    confirmingBidId && !selectionLocked
      ? bids.find((bid) => bid.id === confirmingBidId) ?? null
      : null;

  useEffect(() => {
    if (state.ok && state.selectedBidId) {
      setConfirmingBidId(null);
    }
  }, [state.ok, state.selectedBidId]);

  useEffect(() => {
    if (!state.ok || !state.selectedBidId) return;
    // Re-fetch server-rendered status + pills, then guide attention to Kickoff.
    router.refresh();
    const kickoff = document.getElementById("kickoff");
    kickoff?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [router, state.ok, state.selectedBidId]);

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
        <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
          <p>{state.message}</p>
          <a href="#kickoff" className="mt-2 inline-flex text-xs font-semibold text-emerald-200 hover:underline">
            Jump to kickoff
          </a>
        </div>
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

      {selectionLocked && winnerSupplierName ? (
        <p className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-5 py-3 text-sm text-emerald-100">
          Winner selected: <span className="font-semibold text-white">{winnerSupplierName}</span>
        </p>
      ) : null}

      <div className="overflow-x-auto rounded-2xl border border-slate-900/60 bg-slate-950/40">
        <table className="w-full min-w-[720px] border-collapse text-left text-sm">
          <thead className="border-b border-slate-900/60 bg-slate-950/70">
            <tr className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
              <th className="px-5 py-3">Supplier</th>
              <th className="px-5 py-3">Price</th>
              <th className="px-5 py-3">Lead time</th>
              <th className="px-5 py-3">Notes</th>
              <th className="px-5 py-3">Status</th>
              <th className="px-5 py-3 text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {bids.map((bid) => {
              const isWinner = resolvedWinnerId === bid.id;
              const submittedText =
                formatDateTime(bid.createdAt, { includeTime: true }) ?? "Just now";
              const statusLabel = formatBidStatusLabel(bid.status);
              const statusClasses = getStatusClasses(bid.status);
              const priceText = bid.priceDisplay ?? "Price pending";
              const leadTimeText = bid.leadTimeDisplay ?? "Lead time pending";
              const awardDisabled = !canSubmit || selectionLocked;
              const rowClasses = clsx(
                "border-b border-slate-900/60",
                isWinner
                  ? "bg-emerald-500/5"
                  : "bg-transparent",
              );

              return (
                <tr key={bid.id} className={rowClasses}>
                  <td className="px-5 py-4 align-top">
                    <p className="text-base font-semibold text-white">{bid.supplierName}</p>
                    <p className="mt-1 text-xs text-slate-400">
                      Submitted {submittedText}
                    </p>
                    {isWinner ? (
                      <div className="mt-2">
                        <span className="pill pill-success px-3 py-1 text-[11px] uppercase tracking-wide">
                          Winner selected
                        </span>
                      </div>
                    ) : null}
                  </td>
                  <td className="px-5 py-4 align-top text-slate-100">
                    <span className="font-semibold text-white">{priceText}</span>
                  </td>
                  <td className="px-5 py-4 align-top text-slate-100">
                    <span className="font-semibold text-white">{leadTimeText}</span>
                  </td>
                  <td className="px-5 py-4 align-top text-slate-200">
                    <span className="line-clamp-3">{bid.notes ?? "—"}</span>
                  </td>
                  <td className="px-5 py-4 align-top">
                    <span className={clsx("pill px-3 py-1 text-[11px]", statusClasses)}>
                      {statusLabel}
                    </span>
                  </td>
                  <td className="px-5 py-4 align-top text-right">
                    {awardDisabled ? (
                      <button
                        type="button"
                        disabled
                        className="inline-flex items-center rounded-full border border-slate-800/80 px-4 py-2 text-sm font-semibold text-slate-400 opacity-70"
                      >
                        {isWinner ? "Winner selected" : "Locked"}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmingBidId(bid.id)}
                        className="inline-flex items-center rounded-full border border-emerald-400/50 bg-emerald-500/10 px-4 py-2 text-sm font-semibold text-emerald-100 transition hover:bg-emerald-500/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-400"
                      >
                        Award
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {confirmingBid ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 py-6">
          <div className="w-full max-w-lg space-y-4 rounded-2xl border border-slate-800 bg-slate-950 px-6 py-5 shadow-xl">
            <div className="space-y-1">
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">
                Confirm award
              </p>
              <h3 className="text-xl font-semibold text-white">
                Award to {confirmingBid.supplierName}?
              </h3>
              <p className="text-sm text-slate-300">
                This locks the RFQ and starts kickoff.
              </p>
            </div>
            <form action={formAction} className="space-y-3">
              <input type="hidden" name="quoteId" value={quoteId} />
              <input type="hidden" name="bidId" value={confirmingBid.id} />
              <p className="text-xs text-slate-400">
                You’re awarding to{" "}
                <span className="font-semibold text-slate-200">{confirmingBid.supplierName}</span>. This can’t be
                undone from the customer portal.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <ConfirmAwardButton />
                <CancelConfirmButton onClick={() => setConfirmingBidId(null)} />
              </div>
            </form>
          </div>
        </div>
      ) : null}

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

function ConfirmAwardButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex items-center rounded-full border border-emerald-400/50 bg-emerald-500/10 px-4 py-2 text-sm font-semibold text-emerald-100 transition hover:bg-emerald-500/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "Awarding..." : "Confirm award"}
    </button>
  );
}

function CancelConfirmButton({ onClick }: { onClick: () => void }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className="inline-flex items-center rounded-full border border-slate-800/80 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:border-slate-700 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
    >
      Cancel
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
