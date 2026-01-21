"use client";

import clsx from "clsx";
import { useEffect, useMemo, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import {
  supplierDeclineRfqWithFeedbackAction,
  type SupplierDeclineFeedbackFormState,
} from "./actions";

const INITIAL_STATE: SupplierDeclineFeedbackFormState = { ok: true, message: "" };

const CATEGORY_OPTIONS = [
  { value: "scope_unclear", label: "Scope unclear" },
  { value: "missing_drawings", label: "Missing drawings" },
  { value: "missing_cad", label: "Missing CAD" },
  { value: "timeline_unrealistic", label: "Timeline unrealistic" },
  { value: "materials_unclear", label: "Materials unclear" },
  { value: "pricing_risk", label: "Pricing risk" },
  { value: "outside_capability", label: "Outside capability" },
  { value: "other", label: "Other" },
] as const;

type CategoryValue = (typeof CATEGORY_OPTIONS)[number]["value"];

export function SupplierDeclineRfqModal({
  quoteId,
  open,
  onClose,
}: {
  quoteId: string;
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<CategoryValue>>(new Set());
  const [note, setNote] = useState("");

  const boundAction = useMemo(
    () => supplierDeclineRfqWithFeedbackAction.bind(null, quoteId),
    [quoteId],
  );
  const [state, formAction] = useFormState(boundAction, INITIAL_STATE);

  useEffect(() => {
    if (!open) return;
    // When opening fresh, clear previous state.
    setSelected(new Set());
    setNote("");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (state.ok && state.message) {
      router.refresh();
      onClose();
    }
  }, [open, onClose, router, state]);

  if (!open) return null;

  const toggle = (value: CategoryValue) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  };

  const selectedValues = Array.from(selected.values());

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4"
      role="dialog"
      aria-modal="true"
      aria-label="Decline search request"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-950/95 p-5 text-slate-100 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold text-white">
              Help improve your search request experience
            </h3>
            <p className="mt-1 text-sm text-slate-300">
              Share why you’re declining so we can route better search requests and improve intake
              quality.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-slate-800 bg-slate-950/60 px-3 py-1 text-xs font-semibold text-slate-200 hover:border-slate-600 hover:text-white"
          >
            Close
          </button>
        </div>

        <form action={formAction} className="mt-4 space-y-4">
          {selectedValues.map((value) => (
            <input key={value} type="hidden" name="categories" value={value} />
          ))}

          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Reasons (select any)
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {CATEGORY_OPTIONS.map((opt) => {
                const active = selected.has(opt.value);
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => toggle(opt.value)}
                    className={clsx(
                      "rounded-full border px-3 py-1 text-xs font-semibold transition",
                      active
                        ? "border-blue-400/50 bg-blue-500/15 text-blue-100"
                        : "border-slate-800 bg-slate-950/40 text-slate-200 hover:border-slate-600 hover:text-white",
                    )}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Optional note
            </label>
            <textarea
              name="note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={4}
              className="mt-1 w-full rounded-lg border border-slate-800 bg-black/40 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-blue-400 focus:outline-none"
              placeholder="Anything else we should know? (e.g., missing revision, unclear tolerances, material spec needed...)"
              maxLength={1000}
            />
          </div>

          {!state.ok ? (
            <p className="text-sm text-red-300" role="alert">
              {state.error}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-full border border-slate-800 bg-slate-950/60 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-200 hover:border-slate-600 hover:text-white"
            >
              Cancel
            </button>
            <SubmitButton />
          </div>
        </form>
      </div>
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
        "rounded-full border border-red-500/40 bg-red-500/10 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-red-100 transition hover:border-red-400 hover:text-white",
        pending ? "opacity-60" : "",
      )}
    >
      {pending ? "Submitting..." : "Decline search request"}
    </button>
  );
}

