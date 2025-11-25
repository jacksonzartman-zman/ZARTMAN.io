"use client";

import { useEffect, useRef } from "react";
import { useFormState } from "react-dom";
import {
  INITIAL_SUPPLIER_BID_STATE,
  submitMarketplaceBidAction,
  type SubmitMarketplaceBidState,
} from "./actions";

type SubmitBidFormProps = {
  rfqId: string;
  defaultPrice?: number | null;
  defaultLeadTime?: number | null;
};

export function SubmitBidForm({
  rfqId,
  defaultPrice,
  defaultLeadTime,
}: SubmitBidFormProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction] = useFormState<
    SubmitMarketplaceBidState,
    FormData
  >(submitMarketplaceBidAction, INITIAL_SUPPLIER_BID_STATE);
  const isCurrentTarget = state.rfqId === rfqId;

  useEffect(() => {
    if (state.success && isCurrentTarget) {
      formRef.current?.reset();
    }
  }, [state.success, isCurrentTarget]);

  return (
    <form ref={formRef} action={formAction} className="space-y-3">
      <input type="hidden" name="rfq_id" value={rfqId} />
      <div className="grid gap-3 md:grid-cols-2">
        <div className="flex flex-col gap-2">
          <label htmlFor={`price-${rfqId}`} className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            Total price (USD)
          </label>
          <input
            id={`price-${rfqId}`}
            name="price_total"
            type="number"
            min="0"
            step="100"
            defaultValue={typeof defaultPrice === "number" ? defaultPrice : ""}
            placeholder="Enter total project price"
            className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white outline-none ring-blue-400/80 focus:border-blue-400"
          />
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor={`lead-${rfqId}`} className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            Lead time (days)
          </label>
          <input
            id={`lead-${rfqId}`}
            name="lead_time_days"
            type="number"
            min="0"
            defaultValue={typeof defaultLeadTime === "number" ? defaultLeadTime : ""}
            placeholder="21"
            className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white outline-none ring-blue-400/80 focus:border-blue-400"
          />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor={`notes-${rfqId}`} className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
          Notes (optional)
        </label>
        <textarea
          id={`notes-${rfqId}`}
          name="notes"
          rows={3}
          placeholder="Share certs, tooling, or schedule details."
          className="w-full rounded-2xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white outline-none ring-blue-400/80 focus:border-blue-400"
        />
      </div>

      {state.error && isCurrentTarget ? (
        <p className="rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">
          {state.error}
        </p>
      ) : null}
      {state.success && isCurrentTarget ? (
        <p className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
          Bid sent! You can update it any time before award.
        </p>
      ) : null}

      <div className="flex justify-end">
        <button
          type="submit"
          className="inline-flex items-center gap-2 rounded-full bg-blue-500 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-950 transition hover:bg-blue-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-300"
        >
          {defaultPrice ? "Update bid" : "Submit bid"}
        </button>
      </div>
    </form>
  );
}
