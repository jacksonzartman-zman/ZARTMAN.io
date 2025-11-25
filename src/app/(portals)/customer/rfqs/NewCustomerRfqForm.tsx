"use client";

import { useEffect, useRef } from "react";
import { useFormState } from "react-dom";
import type {
  CreateCustomerRfqActionState,
} from "./actions";
import {
  createCustomerRfqAction,
  INITIAL_CUSTOMER_RFQ_STATE,
} from "./actions";

type NewCustomerRfqFormProps = {
  action?: typeof createCustomerRfqAction;
};

export function NewCustomerRfqForm({
  action = createCustomerRfqAction,
}: NewCustomerRfqFormProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction] = useFormState<
    CreateCustomerRfqActionState,
    FormData
  >(action, INITIAL_CUSTOMER_RFQ_STATE);

  useEffect(() => {
    if (state.success) {
      formRef.current?.reset();
    }
  }, [state.success]);

  return (
    <form ref={formRef} action={formAction} className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-2">
          <label htmlFor="title" className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Project title
          </label>
          <input
            id="title"
            name="title"
            type="text"
            required
            placeholder="e.g. 6061 bracket"
            className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white outline-none ring-emerald-400/80 focus:border-emerald-400"
          />
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor="target_processes" className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Target processes (comma separated)
          </label>
          <input
            id="target_processes"
            name="target_processes"
            type="text"
            placeholder="cnc milling, anodizing"
            className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white outline-none ring-emerald-400/80 focus:border-emerald-400"
          />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="description" className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          Description
        </label>
        <textarea
          id="description"
          name="description"
          required
          minLength={20}
          rows={4}
          placeholder="Share context, tolerances, and expectations for this RFQ."
          className="w-full rounded-2xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white outline-none ring-emerald-400/80 focus:border-emerald-400"
        />
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="flex flex-col gap-2">
          <label htmlFor="budget_amount" className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Target budget (optional)
          </label>
          <input
            id="budget_amount"
            name="budget_amount"
            type="number"
            min="0"
            step="100"
            placeholder="5000"
            className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white outline-none ring-emerald-400/80 focus:border-emerald-400"
          />
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor="budget_currency" className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Currency
          </label>
          <input
            id="budget_currency"
            name="budget_currency"
            type="text"
            maxLength={3}
            placeholder="USD"
            className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm uppercase tracking-wide text-white outline-none ring-emerald-400/80 focus:border-emerald-400"
          />
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor="lead_time_days" className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Lead time target (days)
          </label>
          <input
            id="lead_time_days"
            name="lead_time_days"
            type="number"
            min="0"
            placeholder="21"
            className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white outline-none ring-emerald-400/80 focus:border-emerald-400"
          />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="file_label" className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          Attachment label (optional)
        </label>
        <input
          id="file_label"
          name="file_label"
          type="text"
          placeholder="e.g. assembly.zip (upload flow coming soon)"
          className="w-full rounded-xl border border-dashed border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white outline-none ring-emerald-400/80 focus:border-emerald-400"
        />
      </div>

      {state.error ? (
        <p className="rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          {state.error}
        </p>
      ) : null}
      {state.success ? (
        <p className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
          RFQ posted! It’s now visible in your workspace and the supplier marketplace.
        </p>
      ) : null}

      <div className="flex justify-end">
        <button
          type="submit"
          className="inline-flex items-center gap-2 rounded-full bg-emerald-500 px-5 py-2 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300"
        >
          Publish RFQ
        </button>
      </div>
    </form>
  );
}
