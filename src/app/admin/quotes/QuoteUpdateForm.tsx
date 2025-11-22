"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import clsx from "clsx";
import { handleQuoteFormSubmit, type QuoteFormState } from "@/app/admin/actions";
import { formatDateInputValue } from "@/lib/formatDate";
import {
  DEFAULT_UPLOAD_STATUS,
  type UploadStatus,
  UPLOAD_STATUS_LABELS,
  UPLOAD_STATUS_OPTIONS,
} from "../constants";
import { ctaSizeClasses, primaryCtaClasses } from "@/lib/ctas";

type QuoteUpdateFormProps = {
  quote: {
    id: string;
    status: UploadStatus;
    price: number | null;
    currency: string | null;
    targetDate: string | null;
    internalNotes: string | null;
    dfmNotes: string | null;
  };
};

const CURRENCY_OPTIONS = ["USD", "EUR", "GBP"];

const INITIAL_STATE: QuoteFormState = {};

export default function QuoteUpdateForm({ quote }: QuoteUpdateFormProps) {
  const [state, formAction] = useActionState(
    handleQuoteFormSubmit,
    INITIAL_STATE,
  );

    return (
      <form className="mt-4 space-y-4" action={formAction}>
      <input type="hidden" name="id" value={quote.id} />

      <div className="space-y-1.5">
        <label
          htmlFor="status"
          className="block text-sm font-medium text-slate-200"
        >
          Status
        </label>
        <select
          id="status"
          name="status"
          defaultValue={quote.status ?? DEFAULT_UPLOAD_STATUS}
          className="w-full rounded-md border border-slate-700 bg-black/40 px-3 py-2 text-sm text-slate-100 outline-none focus:border-emerald-400"
        >
          {UPLOAD_STATUS_OPTIONS.map((status) => (
            <option key={status} value={status}>
              {UPLOAD_STATUS_LABELS[status]}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1.5">
        <label
          htmlFor="price"
          className="block text-sm font-medium text-slate-200"
        >
          Price
        </label>
        <input
          id="price"
          name="price"
          type="number"
          step="0.01"
          inputMode="decimal"
          defaultValue={quote.price ?? ""}
          placeholder="0.00"
          className="w-full rounded-md border border-slate-700 bg-black/40 px-3 py-2 text-sm text-slate-100 outline-none focus:border-emerald-400"
        />
      </div>

      <div className="space-y-1.5">
        <label
          htmlFor="currency"
          className="block text-sm font-medium text-slate-200"
        >
          Currency
        </label>
        <select
          id="currency"
          name="currency"
          defaultValue={quote.currency || "USD"}
          className="w-full rounded-md border border-slate-700 bg-black/40 px-3 py-2 text-sm text-slate-100 outline-none focus:border-emerald-400"
        >
          {CURRENCY_OPTIONS.map((currency) => (
            <option value={currency} key={currency}>
              {currency}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1.5">
        <label
          htmlFor="target_date"
          className="block text-sm font-medium text-slate-200"
        >
          Target date
        </label>
        <input
          id="target_date"
          name="target_date"
          type="date"
          defaultValue={formatDateInputValue(quote.targetDate)}
          className="w-full rounded-md border border-slate-700 bg-black/40 px-3 py-2 text-sm text-slate-100 outline-none focus:border-emerald-400"
        />
      </div>

        <div className="space-y-1.5">
          <label
            htmlFor="dfm_notes"
            className="block text-sm font-medium text-slate-200"
          >
            DFM notes (visible to customer)
          </label>
          <textarea
            id="dfm_notes"
            name="dfm_notes"
            defaultValue={quote.dfmNotes ?? ""}
            rows={4}
            className="w-full rounded-md border border-slate-700 bg-black/40 px-3 py-2 text-sm text-slate-100 outline-none focus:border-emerald-400"
            placeholder="Call out manufacturability feedback you want to share"
          />
          <p className="text-xs text-slate-500">
            Customers will eventually see these notes on their quote.
          </p>
        </div>

      <div className="space-y-1.5">
        <label
          htmlFor="internal_notes"
          className="block text-sm font-medium text-slate-200"
        >
          Internal notes
        </label>
        <textarea
          id="internal_notes"
          name="internal_notes"
          defaultValue={quote.internalNotes ?? ""}
          rows={4}
          className="w-full rounded-md border border-slate-700 bg-black/40 px-3 py-2 text-sm text-slate-100 outline-none focus:border-emerald-400"
        />
      </div>

        {state?.error && <p className="text-sm text-red-400">{state.error}</p>}

        <div className="flex flex-col gap-3 pt-1 sm:flex-row sm:justify-end">
          <SubmitButton />
        </div>
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
        className={clsx(primaryCtaClasses, ctaSizeClasses.md, "w-full sm:w-auto")}
    >
      {pending ? "Saving..." : "Save changes"}
    </button>
  );
}
