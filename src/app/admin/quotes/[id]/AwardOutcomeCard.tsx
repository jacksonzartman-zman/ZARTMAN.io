"use client";

import clsx from "clsx";
import { useMemo, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import {
  AWARD_FEEDBACK_CONFIDENCE_OPTIONS,
  AWARD_FEEDBACK_MAX_NOTES_LENGTH,
  AWARD_FEEDBACK_REASON_OPTIONS,
  formatAwardFeedbackConfidenceLabel,
  formatAwardFeedbackReasonLabel,
} from "@/lib/awardFeedback";
import type { AwardFeedbackSnapshot } from "@/server/quotes/awardFeedback";
import { submitAwardFeedbackAction, type AwardFeedbackFormState } from "./actions";

type AwardOutcomeCardProps = {
  quoteId: string;
  awardedSupplierId: string | null;
  awardedSupplierLabel: string;
  awardedAtLabel: string;
  awardedByLabel: string;
  feedback: AwardFeedbackSnapshot | null;
  className?: string;
};

export function AwardOutcomeCard({
  quoteId,
  awardedSupplierId,
  awardedSupplierLabel,
  awardedAtLabel,
  awardedByLabel,
  feedback,
  className,
}: AwardOutcomeCardProps) {
  const hasWinner = Boolean((awardedSupplierId ?? "").trim());
  const [showForm, setShowForm] = useState(!feedback && hasWinner);
  const [notes, setNotes] = useState("");

  const action = useMemo(
    () => submitAwardFeedbackAction.bind(null, quoteId),
    [quoteId],
  );
  const [state, formAction] = useFormState<AwardFeedbackFormState, FormData>(
    action,
    { status: "idle" },
  );

  const reasonLabel = feedback
    ? formatAwardFeedbackReasonLabel(feedback.reason) ?? feedback.reason
    : null;
  const confidenceLabel = feedback
    ? feedback.confidence
      ? formatAwardFeedbackConfidenceLabel(feedback.confidence) ?? feedback.confidence
      : null
    : null;

  return (
    <section
      className={clsx(
        "rounded-2xl border border-slate-900 bg-slate-950/40 px-6 py-4 text-sm text-slate-200",
        className,
      )}
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-100">Award outcome</h2>
          <p className="mt-1 text-xs text-slate-400">
            Capture why this supplier won (admin-only).
          </p>
        </div>
        {hasWinner && !feedback ? (
          <button
            type="button"
            onClick={() => setShowForm((v) => !v)}
            className="rounded-full border border-slate-800 bg-slate-900/40 px-3 py-1 text-[11px] font-semibold text-slate-100 hover:border-emerald-400 hover:text-emerald-100"
          >
            {showForm ? "Hide" : "Add feedback"}
          </button>
        ) : null}
      </header>

      {!hasWinner ? (
        <p className="mt-4 text-sm text-slate-400">No winner selected yet.</p>
      ) : (
        <dl className="mt-4 grid gap-3 text-slate-100 sm:grid-cols-3">
          <Field label="Awarded supplier" value={awardedSupplierLabel || "Supplier selected"} />
          <Field label="Awarded at" value={awardedAtLabel || "—"} />
          <Field label="Awarded by" value={awardedByLabel || "—"} />
        </dl>
      )}

      {hasWinner && feedback ? (
        <div className="mt-4 rounded-xl border border-slate-900/60 bg-slate-950/30 px-4 py-3">
          <dl className="grid gap-2 text-sm">
            <div className="flex items-start justify-between gap-3">
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Reason
              </dt>
              <dd className="text-right font-semibold text-slate-100">{reasonLabel}</dd>
            </div>
            {confidenceLabel ? (
              <div className="flex items-start justify-between gap-3">
                <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Confidence
                </dt>
                <dd className="text-right font-semibold text-slate-100">{confidenceLabel}</dd>
              </div>
            ) : null}
            {feedback.notes ? (
              <div className="space-y-1">
                <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Notes
                </dt>
                <dd className="whitespace-pre-line text-sm text-slate-200">
                  {feedback.notes}
                </dd>
              </div>
            ) : null}
          </dl>
        </div>
      ) : null}

      {hasWinner && !feedback && showForm ? (
        <form action={formAction} className="mt-4 space-y-3">
          <input type="hidden" name="supplierId" value={awardedSupplierId ?? ""} />

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Reason (required)
              </span>
              <select
                name="reason"
                required
                defaultValue=""
                className="w-full rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2 text-sm text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
              >
                <option value="" disabled>
                  Select a reason…
                </option>
                {AWARD_FEEDBACK_REASON_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-1">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Confidence (optional)
              </span>
              <select
                name="confidence"
                defaultValue=""
                className="w-full rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2 text-sm text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
              >
                <option value="">—</option>
                {AWARD_FEEDBACK_CONFIDENCE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="space-y-1 block">
            <span className="flex items-center justify-between gap-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              <span>Notes (optional)</span>
              <span className="normal-case text-slate-400">
                {Math.min(notes.length, AWARD_FEEDBACK_MAX_NOTES_LENGTH)}/{AWARD_FEEDBACK_MAX_NOTES_LENGTH}
              </span>
            </span>
            <textarea
              name="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={AWARD_FEEDBACK_MAX_NOTES_LENGTH}
              rows={3}
              placeholder="Optional context for why this shop won…"
              className="w-full resize-none rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2 text-sm text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
            />
          </label>

          <div className="flex flex-wrap items-center gap-3">
            <SubmitButton />
            {state.status === "error" && state.error ? (
              <span className="text-xs text-amber-300" aria-live="polite">
                {state.error}
              </span>
            ) : null}
            {state.status === "success" && state.message ? (
              <span className="text-xs text-emerald-300" aria-live="polite">
                {state.message}
              </span>
            ) : null}
          </div>
        </form>
      ) : null}
    </section>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-900/60 bg-slate-950/30 px-3 py-2">
      <dt className="text-[11px] uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-1 font-medium text-slate-100">{value}</dd>
    </div>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={clsx(
        "rounded-full border border-emerald-500/60 bg-emerald-500/10 px-4 py-2 text-xs font-semibold text-emerald-100 transition",
        pending
          ? "cursor-not-allowed opacity-70"
          : "hover:bg-emerald-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400",
      )}
    >
      {pending ? "Saving..." : "Save feedback"}
    </button>
  );
}

