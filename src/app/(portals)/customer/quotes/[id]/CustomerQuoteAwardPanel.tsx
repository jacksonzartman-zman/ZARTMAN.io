"use client";

/**
 * Phase 1 Polish checklist
 * - Done: Confirmation feedback for award (success banner + refresh + scroll to Kickoff)
 * - Done: Error copy is calm + actionable
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import clsx from "clsx";
import { useRouter } from "next/navigation";
import { formatDateTime } from "@/lib/formatDate";
import type { CustomerQuoteBidSummary } from "@/server/customers/bids";
import {
  awardQuoteToBidAction,
  type AwardActionState,
} from "./actions";
import { SectionHeader } from "@/components/shared/primitives/SectionHeader";
import { TagPill, type TagPillTone } from "@/components/shared/primitives/TagPill";

const INITIAL_AWARD_STATE: AwardActionState = { ok: true, message: null };

function isFiniteNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function nearlyEqual(a: number, b: number) {
  return Math.abs(a - b) < 1e-6;
}

export type CustomerQuoteAwardPanelProps = {
  quoteId: string;
  bids: CustomerQuoteBidSummary[];
  canSubmit: boolean;
  disableReason?: string | null;
  winningBidId?: string | null;
  anchorId?: string;
  preselectBidId?: string | null;
};

export function CustomerQuoteAwardPanel({
  quoteId,
  bids,
  canSubmit,
  disableReason,
  winningBidId,
  anchorId,
  preselectBidId,
}: CustomerQuoteAwardPanelProps) {
  const router = useRouter();
  const action = useMemo(() => awardQuoteToBidAction, []);
  const [state, formAction] = useFormState<AwardActionState, FormData>(
    action,
    INITIAL_AWARD_STATE,
  );
  const [confirmingBidId, setConfirmingBidId] = useState<string | null>(null);
  const didAutoPreselect = useRef(false);

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

  const comparisonLeaders = useMemo(() => {
    const prices = bids
      .map((bid) => bid.priceValue)
      .filter(isFiniteNonNegativeNumber);
    const leadTimes = bids
      .map((bid) => bid.leadTimeDays)
      .filter(isFiniteNonNegativeNumber);

    return {
      bestPrice: prices.length > 0 ? Math.min(...prices) : null,
      fastestLeadTimeDays: leadTimes.length > 0 ? Math.min(...leadTimes) : null,
    };
  }, [bids]);

  useEffect(() => {
    if (state.ok && state.selectedBidId) {
      setConfirmingBidId(null);
    }
  }, [state.ok, state.selectedBidId]);

  useEffect(() => {
    if (didAutoPreselect.current) return;
    if (!preselectBidId) return;
    if (!canSubmit) return;
    if (selectionLocked) return;
    didAutoPreselect.current = true;
    setConfirmingBidId(preselectBidId);
  }, [preselectBidId, selectionLocked, canSubmit]);

  useEffect(() => {
    if (!state.ok || !state.selectedBidId) return;
    // Re-fetch server-rendered status + pills, then guide attention to Kickoff.
    router.refresh();
    const kickoff = document.getElementById("kickoff");
    kickoff?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [router, state.ok, state.selectedBidId]);

  return (
    <section
      id={anchorId ?? undefined}
      className="space-y-6 rounded-2xl border border-slate-900 bg-slate-950/40 px-6 py-5"
    >
      <header className="space-y-2">
        <SectionHeader
          variant="card"
          kicker="Supplier decisions"
          title="Review bids and select a supplier"
          subtitle={
            <>
              <p className="text-sm text-slate-300">
                Compare bids, select the supplier that fits best, and we’ll record your selection.
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Select supplier only when price, lead time, and fit align. Your selection will show in Timeline and unlock kickoff steps.
              </p>
            </>
          }
        />
      </header>

      {state.ok && state.message ? (
        <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
          <p className="flex items-start gap-2">
            <InlineStatusIcon tone="success" className="mt-0.5" />
            <span>{state.message}</span>
          </p>
          <p className="mt-2 text-xs text-emerald-200">
            Recorded for this RFQ. You can track progress in Kickoff and Timeline below.
          </p>
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
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-5 py-3 text-sm text-emerald-100">
          <p className="flex items-start gap-2">
            <InlineStatusIcon tone="success" className="mt-0.5" />
            <span>
              Selection confirmed:{" "}
              <span className="font-semibold text-white">{winnerSupplierName}</span>
            </span>
          </p>
          <p className="mt-2 text-xs text-emerald-200">
            This does not place an order or payment automatically.
          </p>
        </div>
      ) : null}

      <div className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-slate-900/60 bg-black/20 px-5 py-4">
        <div className="space-y-1">
          <p className="text-sm font-semibold text-white">
            Select supplier
          </p>
          <p className="text-xs text-slate-400">
            {selectionLocked
              ? "Selection confirmed. Other bids are shown for reference."
              : "Review the bids below, then select a supplier to confirm."}
          </p>
        </div>
        <TagPill
          size="md"
          tone={selectionLocked ? "emerald" : "slate"}
        >
          {selectionLocked ? "Selection confirmed" : "Decision"}
        </TagPill>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {bids.map((bid) => {
          const isWinner = resolvedWinnerId === bid.id;
          const dimNonWinner = selectionLocked && !isWinner;
          const submittedText =
            formatDateTime(bid.createdAt, { includeTime: true }) ?? "Just now";
          const statusLabel = formatBidStatusLabel(bid.status);
          const priceText = bid.priceDisplay ?? "Price pending";
          const leadTimeText = bid.leadTimeDisplay ?? "Lead time pending";
          const awardDisabled = !canSubmit || selectionLocked;
          const isBestPrice =
            comparisonLeaders.bestPrice !== null &&
            isFiniteNonNegativeNumber(bid.priceValue) &&
            nearlyEqual(bid.priceValue, comparisonLeaders.bestPrice);
          const isFastest =
            comparisonLeaders.fastestLeadTimeDays !== null &&
            isFiniteNonNegativeNumber(bid.leadTimeDays) &&
            bid.leadTimeDays === comparisonLeaders.fastestLeadTimeDays;

          return (
            <article
              key={bid.id}
              className={clsx(
                "relative flex h-full flex-col rounded-2xl border px-5 py-4 transition",
                isWinner
                  ? "overflow-hidden border-emerald-300/70 bg-gradient-to-b from-emerald-500/15 to-slate-950/40 shadow-lg shadow-emerald-500/15 ring-2 ring-emerald-400/30 before:absolute before:inset-y-0 before:left-0 before:w-1 before:bg-emerald-400/60 before:content-['']"
                  : dimNonWinner
                    ? "border-slate-900/40 bg-slate-950/20 opacity-55"
                    : "border-slate-900/60 bg-slate-950/40 hover:border-slate-700/70",
              )}
            >
              <header className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-base font-semibold text-white" title={bid.supplierName}>
                    {bid.supplierName}
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    Submitted {submittedText}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <div className="flex flex-wrap justify-end gap-2">
                    <TagPill size="md" tone={getBidStatusTone(bid.status)}>
                      {statusLabel}
                    </TagPill>
                    {isBestPrice ? (
                      <TagPill tone="muted">Best price</TagPill>
                    ) : null}
                    {isFastest ? (
                      <TagPill tone="muted">Fastest</TagPill>
                    ) : null}
                  </div>
                  {isWinner ? (
                    <TagPill size="md" tone="emerald">
                      Selection confirmed
                    </TagPill>
                  ) : null}
                </div>
              </header>

              <div className="mt-4 rounded-xl border border-slate-900/50 bg-slate-950/25 px-3 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                  At a glance
                </p>
                <dl className="mt-1 grid grid-cols-[5.5rem_minmax(0,1fr)_6.5rem_minmax(0,1fr)] items-baseline gap-x-3 gap-y-1 text-xs tabular-nums">
                  <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Price
                  </dt>
                  <dd className="min-w-0 truncate text-right font-semibold text-white">
                    {priceText}
                  </dd>
                  <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Lead time
                  </dt>
                  <dd className="min-w-0 truncate text-right font-semibold text-white">
                    {leadTimeText}
                  </dd>
                </dl>
              </div>

              <div className="mt-4 flex-1">
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                  Notes
                </p>
                <p className="mt-2 line-clamp-3 text-sm text-slate-200">
                  {bid.notes ?? "—"}
                </p>
              </div>

              <div className="mt-auto flex items-center justify-end gap-2 pt-5">
                {awardDisabled ? (
                  <button
                    type="button"
                    disabled
                    className="inline-flex items-center rounded-full border border-slate-800/80 px-4 py-2 text-sm font-semibold text-slate-400 opacity-70"
                  >
                    {isWinner ? "Selection confirmed" : "Locked"}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmingBidId(bid.id)}
                    className="inline-flex items-center rounded-full border border-emerald-400/50 bg-emerald-500/10 px-4 py-2 text-sm font-semibold text-emerald-100 transition hover:bg-emerald-500/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-400"
                  >
                    Select supplier
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>

      {confirmingBid ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 py-6">
          <div className="w-full max-w-lg space-y-4 rounded-2xl border border-slate-800 bg-slate-950 px-6 py-5 shadow-xl">
            <div className="space-y-1">
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">
                Confirm selection
              </p>
              <h3 className="text-lg font-semibold text-white">
                Select {confirmingBid.supplierName}?
              </h3>
              <p className="text-sm text-slate-300">
                This records your selection and starts kickoff.
              </p>
            </div>
            <form action={formAction} className="space-y-3">
              <input type="hidden" name="quoteId" value={quoteId} />
              <input type="hidden" name="bidId" value={confirmingBid.id} />
              <div className="space-y-2 rounded-xl border border-slate-800 bg-slate-950/40 px-4 py-3 text-xs text-slate-300">
                <p className="font-semibold text-slate-100">What this does</p>
                <ul className="space-y-1">
                  <li className="flex gap-2">
                    <InlineStatusIcon tone="neutral" className="mt-0.5" />
                    <span>
                      Starts kickoff so final details can be confirmed.
                    </span>
                  </li>
                  <li className="flex gap-2">
                    <InlineStatusIcon tone="neutral" className="mt-0.5" />
                    <span>
                      Does not place a purchase order or payment automatically.
                    </span>
                  </li>
                  <li className="flex gap-2">
                    <InlineStatusIcon tone="neutral" className="mt-0.5" />
                    <span>
                      Logs the change in Timeline for shared visibility.
                    </span>
                  </li>
                </ul>
                <p className="text-slate-400">
                  You’re selecting{" "}
                  <span className="font-semibold text-slate-200">{confirmingBid.supplierName}</span>. If you need to adjust after confirming, use Messages.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <ConfirmAwardButton />
                <CancelConfirmButton onClick={() => setConfirmingBidId(null)} />
              </div>
            </form>
          </div>
        </div>
      ) : null}

      <div className="space-y-2 rounded-2xl border border-dashed border-slate-800/70 bg-black/30 px-5 py-4">
        <p className="text-sm font-semibold text-slate-100">What happens after you select?</p>
        <ul className="list-disc space-y-1 pl-5 text-sm text-slate-300">
          <li>We notify your selected supplier to confirm scope.</li>
          <li>Your RFQ updates to Awarded for tracking.</li>
          <li>No purchase order or payment is placed automatically.</li>
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
      className="inline-flex items-center rounded-full border border-emerald-400/50 bg-emerald-500 px-4 py-2 text-sm font-semibold text-emerald-950 transition hover:bg-emerald-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-300 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "Confirming..." : "Confirm selection"}
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

function getBidStatusTone(status?: string | null): TagPillTone {
  const value = typeof status === "string" ? status.trim().toLowerCase() : "";
  if (value === "won" || value === "accepted") {
    return "emerald";
  }
  if (value === "lost" || value === "declined") {
    return "slate";
  }
  if (value === "withdrawn") {
    return "amber";
  }
  return "blue";
}

function InlineStatusIcon({
  tone,
  className,
}: {
  tone: "success" | "neutral";
  className?: string;
}) {
  const stroke = tone === "success" ? "stroke-emerald-200" : "stroke-slate-300";
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      className={clsx("shrink-0", stroke, className)}
    >
      <path
        d="M4.5 10.5l3.1 3.1L15.5 6.9"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
