"use client";

import clsx from "clsx";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createExternalOfferAction, type CreateExternalOfferResult } from "./actions";

type ProcessOption = "" | "CNC" | "3DP" | "Sheet Metal" | "Injection Molding";
type SourceTypeOption = "" | "manual" | "marketplace" | "network";

const INITIAL_STATE: Required<Pick<
  Draft,
  "price" | "leadTimeDays" | "process" | "notes" | "sourceType" | "sourceName"
  | "internalCost"
  | "sourceUrl"
  | "internalNotes"
>> = {
  price: "",
  leadTimeDays: "",
  process: "",
  notes: "",
  sourceType: "",
  sourceName: "",
  internalCost: "",
  sourceUrl: "",
  internalNotes: "",
};

type Draft = {
  price: string;
  leadTimeDays: string;
  process: ProcessOption;
  notes: string;
  sourceType: SourceTypeOption;
  sourceName: string;
  internalCost: string;
  sourceUrl: string;
  internalNotes: string;
};

function normalizeNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeInt(value: string): number | null {
  const parsed = normalizeNumber(value);
  if (parsed === null) return null;
  return Number.isInteger(parsed) ? parsed : null;
}

export function AddExternalOfferButton({
  quoteId,
  excludedSourceNames,
  className,
  buttonSize = "sm",
}: {
  quoteId: string;
  excludedSourceNames?: string[];
  className?: string;
  buttonSize?: "sm" | "xs";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState<Draft>(INITIAL_STATE);
  const [state, setState] = useState<CreateExternalOfferResult | null>(null);

  useEffect(() => {
    if (!open) return;
    setDraft(INITIAL_STATE);
    setState(null);
  }, [open]);

  const fieldErrors = state && !state.ok ? state.fieldErrors ?? {} : {};
  const errorMessage = state && !state.ok ? state.error : null;
  const success = state && state.ok;

  const canSubmit = useMemo(() => {
    const price = normalizeNumber(draft.price);
    const leadTimeDays = normalizeInt(draft.leadTimeDays);
    return (
      !pending &&
      Boolean(quoteId) &&
      typeof price === "number" &&
      price > 0 &&
      typeof leadTimeDays === "number" &&
      leadTimeDays > 0
    );
  }, [draft.leadTimeDays, draft.price, pending, quoteId]);

  const excludedSourceWarning = useMemo(() => {
    const excluded = Array.isArray(excludedSourceNames) ? excludedSourceNames : [];
    if (excluded.length === 0) return null;
    const normalized = draft.sourceName.trim().toLowerCase();
    if (!normalized) return null;
    const match = excluded.find((name) => name.trim().toLowerCase() === normalized) ?? null;
    if (!match) return null;
    return `This customer excludes “${match.trim() || draft.sourceName.trim()}”.`;
  }, [draft.sourceName, excludedSourceNames]);

  const submit = () => {
    if (!canSubmit) return;
    const price = normalizeNumber(draft.price);
    const leadTimeDays = normalizeInt(draft.leadTimeDays);
    if (typeof price !== "number" || typeof leadTimeDays !== "number") return;

    startTransition(async () => {
      const internalCost = normalizeNumber(draft.internalCost);
      const result = await createExternalOfferAction({
        quoteId,
        price,
        leadTimeDays,
        process: draft.process || null,
        notes: draft.notes.trim() || null,
        sourceType: draft.sourceType || null,
        sourceName: draft.sourceName.trim() || null,
        internalCost,
        sourceUrl: draft.sourceUrl.trim() || null,
        internalNotes: draft.internalNotes.trim() || null,
      });
      setState(result);
      if (result.ok) {
        router.refresh();
      }
    });
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={clsx(
          "rounded-full border border-emerald-500/50 bg-emerald-500/10 font-semibold uppercase tracking-wide text-emerald-100 transition hover:bg-emerald-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400",
          buttonSize === "xs" ? "px-3 py-1 text-[11px]" : "px-4 py-2 text-xs",
          className,
        )}
      >
        Add external offer
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-6"
          role="dialog"
          aria-modal="true"
          aria-label="Add external offer"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <div className="w-full max-w-2xl rounded-2xl border border-slate-800 bg-slate-950/95 p-5 text-slate-100 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
                  External offer
                </p>
                <h3 className="mt-1 text-lg font-semibold text-white">
                  {success ? "External offer saved" : "Add external offer"}
                </h3>
                <p className="mt-1 text-sm text-slate-300">
                  This creates an offer record that can be compared alongside supplier offers.
                  Customer-visible fields include price, lead time, and notes.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-full border border-slate-800 bg-slate-950/60 px-3 py-1 text-xs font-semibold text-slate-200 hover:border-slate-600 hover:text-white"
              >
                Close
              </button>
            </div>

            <div className="mt-5 space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="space-y-1">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Price (required)
                  </span>
                  <input
                    type="number"
                    inputMode="decimal"
                    value={draft.price}
                    onChange={(e) => setDraft((prev) => ({ ...prev, price: e.target.value }))}
                    className={clsx(
                      "w-full rounded-xl border bg-slate-950/40 px-3 py-2 text-sm text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400",
                      fieldErrors.price ? "border-amber-500/50" : "border-slate-800",
                    )}
                    placeholder="0"
                  />
                  {fieldErrors.price ? (
                    <p className="text-xs text-amber-300" aria-live="polite">
                      {fieldErrors.price}
                    </p>
                  ) : null}
                </label>

                <label className="space-y-1">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Lead time (days, required)
                  </span>
                  <input
                    type="number"
                    inputMode="numeric"
                    step={1}
                    value={draft.leadTimeDays}
                    onChange={(e) =>
                      setDraft((prev) => ({ ...prev, leadTimeDays: e.target.value }))
                    }
                    className={clsx(
                      "w-full rounded-xl border bg-slate-950/40 px-3 py-2 text-sm text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400",
                      fieldErrors.leadTimeDays ? "border-amber-500/50" : "border-slate-800",
                    )}
                    placeholder="0"
                  />
                  {fieldErrors.leadTimeDays ? (
                    <p className="text-xs text-amber-300" aria-live="polite">
                      {fieldErrors.leadTimeDays}
                    </p>
                  ) : null}
                </label>
              </div>

              <label className="space-y-1 block">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Process (optional)
                </span>
                <select
                  value={draft.process}
                  onChange={(e) =>
                    setDraft((prev) => ({ ...prev, process: e.target.value as ProcessOption }))
                  }
                  className={clsx(
                    "w-full rounded-xl border bg-slate-950/40 px-3 py-2 text-sm text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400",
                    fieldErrors.process ? "border-amber-500/50" : "border-slate-800",
                  )}
                >
                  <option value="">—</option>
                  <option value="CNC">CNC</option>
                  <option value="3DP">3DP</option>
                  <option value="Sheet Metal">Sheet Metal</option>
                  <option value="Injection Molding">Injection Molding</option>
                </select>
                {fieldErrors.process ? (
                  <p className="text-xs text-amber-300" aria-live="polite">
                    {fieldErrors.process}
                  </p>
                ) : null}
              </label>

              <label className="space-y-1 block">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Notes (optional, customer-visible)
                </span>
                <textarea
                  rows={4}
                  maxLength={2000}
                  value={draft.notes}
                  onChange={(e) => setDraft((prev) => ({ ...prev, notes: e.target.value }))}
                  className={clsx(
                    "w-full resize-none rounded-xl border bg-slate-950/40 px-3 py-2 text-sm text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400",
                    fieldErrors.notes ? "border-amber-500/50" : "border-slate-800",
                  )}
                  placeholder="Source details, assumptions, etc."
                />
                {fieldErrors.notes ? (
                  <p className="text-xs text-amber-300" aria-live="polite">
                    {fieldErrors.notes}
                  </p>
                ) : null}
              </label>

              <details className="rounded-xl border border-slate-900/60 bg-slate-950/40 px-4 py-3">
                <summary className="cursor-pointer select-none text-sm font-semibold text-slate-100">
                  Internal source fields (hidden from customer)
                </summary>
                <div className="mt-4 space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="space-y-1 block">
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        Internal cost (optional)
                      </span>
                      <input
                        type="number"
                        inputMode="decimal"
                        value={draft.internalCost}
                        onChange={(e) =>
                          setDraft((prev) => ({ ...prev, internalCost: e.target.value }))
                        }
                        className={clsx(
                          "w-full rounded-xl border bg-slate-950/40 px-3 py-2 text-sm text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400",
                          fieldErrors.internalCost ? "border-amber-500/50" : "border-slate-800",
                        )}
                        placeholder="0"
                      />
                      {fieldErrors.internalCost ? (
                        <p className="text-xs text-amber-300" aria-live="polite">
                          {fieldErrors.internalCost}
                        </p>
                      ) : null}
                    </label>

                    <label className="space-y-1 block">
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        Source URL (optional)
                      </span>
                      <input
                        value={draft.sourceUrl}
                        onChange={(e) =>
                          setDraft((prev) => ({ ...prev, sourceUrl: e.target.value }))
                        }
                        className={clsx(
                          "w-full rounded-xl border bg-slate-950/40 px-3 py-2 text-sm text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400",
                          fieldErrors.sourceUrl ? "border-amber-500/50" : "border-slate-800",
                        )}
                        placeholder="https://…"
                      />
                      {fieldErrors.sourceUrl ? (
                        <p className="text-xs text-amber-300" aria-live="polite">
                          {fieldErrors.sourceUrl}
                        </p>
                      ) : null}
                    </label>
                  </div>

                  <label className="space-y-1 block">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      Internal notes (optional)
                    </span>
                    <textarea
                      rows={3}
                      maxLength={5000}
                      value={draft.internalNotes}
                      onChange={(e) =>
                        setDraft((prev) => ({ ...prev, internalNotes: e.target.value }))
                      }
                      className={clsx(
                        "w-full resize-none rounded-xl border bg-slate-950/40 px-3 py-2 text-sm text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400",
                        fieldErrors.internalNotes ? "border-amber-500/50" : "border-slate-800",
                      )}
                      placeholder="Margin notes, vendor constraints, etc."
                    />
                    {fieldErrors.internalNotes ? (
                      <p className="text-xs text-amber-300" aria-live="polite">
                        {fieldErrors.internalNotes}
                      </p>
                    ) : null}
                  </label>

                  <label className="space-y-1 block">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      source_type
                    </span>
                    <select
                      value={draft.sourceType}
                      onChange={(e) =>
                        setDraft((prev) => ({
                          ...prev,
                          sourceType: e.target.value as SourceTypeOption,
                        }))
                      }
                      className={clsx(
                        "w-full rounded-xl border bg-slate-950/40 px-3 py-2 text-sm text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400",
                        fieldErrors.sourceType ? "border-amber-500/50" : "border-slate-800",
                      )}
                    >
                      <option value="">—</option>
                      <option value="manual">manual</option>
                      <option value="marketplace">marketplace</option>
                      <option value="network">network</option>
                    </select>
                    {fieldErrors.sourceType ? (
                      <p className="text-xs text-amber-300" aria-live="polite">
                        {fieldErrors.sourceType}
                      </p>
                    ) : null}
                  </label>

                  <label className="space-y-1 block">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      source_name (optional)
                    </span>
                    <input
                      value={draft.sourceName}
                      onChange={(e) =>
                        setDraft((prev) => ({ ...prev, sourceName: e.target.value }))
                      }
                      maxLength={200}
                      className={clsx(
                        "w-full rounded-xl border bg-slate-950/40 px-3 py-2 text-sm text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400",
                        fieldErrors.sourceName ? "border-amber-500/50" : "border-slate-800",
                      )}
                      placeholder='e.g. “Xometry”, “Direct supplier – ABC Machining”'
                    />
                    {excludedSourceWarning ? (
                      <p className="text-xs text-amber-200" aria-live="polite">
                        {excludedSourceWarning}
                      </p>
                    ) : null}
                    {fieldErrors.sourceName ? (
                      <p className="text-xs text-amber-300" aria-live="polite">
                        {fieldErrors.sourceName}
                      </p>
                    ) : null}
                  </label>
                </div>
              </details>

              {errorMessage ? (
                <p className="text-sm text-amber-200" role="alert" aria-live="polite">
                  {errorMessage}
                </p>
              ) : null}

              <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  disabled={pending}
                  className={clsx(
                    "rounded-full border border-slate-800 bg-slate-950/60 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-200 hover:border-slate-600 hover:text-white",
                    pending ? "cursor-not-allowed opacity-60" : "",
                  )}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={submit}
                  disabled={!canSubmit}
                  className={clsx(
                    "rounded-full border border-emerald-500/60 bg-emerald-500/10 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-emerald-100 transition hover:bg-emerald-500/20",
                    !canSubmit ? "cursor-not-allowed opacity-60" : "",
                  )}
                >
                  {pending ? "Saving..." : "Save offer"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

