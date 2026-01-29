"use client";

import { useFormState, useFormStatus } from "react-dom";
import clsx from "clsx";
import { formatDateInputValue } from "@/lib/formatDate";
import {
  DEFAULT_QUOTE_STATUS,
  QUOTE_STATUS_LABELS,
  QUOTE_STATUS_OPTIONS,
  normalizeQuoteStatus,
  type QuoteStatus,
} from "@/server/quotes/status";
import { ctaSizeClasses, primaryCtaClasses } from "@/lib/ctas";
import {
  submitAdminQuoteUpdateAction,
  type AdminQuoteUpdateState,
} from "./[id]/actions";

type QuoteUpdateFormProps = {
  quote: {
    id: string;
    status: QuoteStatus;
    price: number | null;
    currency: string | null;
    targetDate: string | null;
    internalNotes: string | null;
    dfmNotes: string | null;
    opsStatus: string | null;
    opsStatusSuggestion?: string | null;
  };
};

const CURRENCY_OPTIONS = ["USD", "EUR", "GBP"];

const OPS_STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "needs_sourcing", label: "Needs sourcing" },
  { value: "waiting_on_quotes", label: "Waiting on quotes" },
  { value: "ready_for_review", label: "Ready for review" },
  { value: "awaiting_award", label: "Awaiting award" },
  { value: "awaiting_order_details", label: "Awaiting order details" },
  { value: "placed", label: "Placed" },
  { value: "in_production", label: "In production" },
  { value: "shipped", label: "Shipped" },
  { value: "delivered", label: "Delivered" },
];

const STATUS_OPTIONS: { value: QuoteStatus; label: string }[] =
  QUOTE_STATUS_OPTIONS.map((status) => ({
    value: status,
    label: QUOTE_STATUS_LABELS[status],
  }));

const INITIAL_ADMIN_QUOTE_UPDATE_STATE: AdminQuoteUpdateState = {
  ok: true,
  message: "",
};

export default function QuoteUpdateForm({ quote }: QuoteUpdateFormProps) {
  const boundAction = submitAdminQuoteUpdateAction.bind(null, quote.id);
  const [state, formAction] = useFormState<AdminQuoteUpdateState, FormData>(
    boundAction,
    INITIAL_ADMIN_QUOTE_UPDATE_STATE,
  );

  return (
    <form className="mt-4 space-y-4" action={formAction}>
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
          defaultValue={normalizeQuoteStatus(quote.status ?? DEFAULT_QUOTE_STATUS)}
          className="w-full rounded-md border border-slate-700 bg-black/40 px-3 py-2 text-sm text-slate-100 outline-none focus:border-emerald-400"
        >
          {STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
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
          htmlFor="targetDate"
          className="block text-sm font-medium text-slate-200"
        >
          Target date
        </label>
        <input
          id="targetDate"
          name="targetDate"
          type="date"
          defaultValue={formatDateInputValue(quote.targetDate)}
          className="w-full rounded-md border border-slate-700 bg-black/40 px-3 py-2 text-sm text-slate-100 outline-none focus:border-emerald-400"
        />
      </div>

      <div className="space-y-1.5">
        <label
          htmlFor="opsStatus"
          className="block text-sm font-medium text-slate-200"
        >
          Ops status (admin-only)
        </label>
        <select
          id="opsStatus"
          name="opsStatus"
          defaultValue={quote.opsStatus ?? ""}
          className="w-full rounded-md border border-slate-700 bg-black/40 px-3 py-2 text-sm text-slate-100 outline-none focus:border-emerald-400"
        >
          <option value="">—</option>
          {OPS_STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {!quote.opsStatus && quote.opsStatusSuggestion ? (
          <p className="text-xs text-slate-500">
            Suggested:{" "}
            <span className="font-semibold text-slate-200">
              {quote.opsStatusSuggestion}
            </span>
          </p>
        ) : null}
      </div>

      <div className="space-y-1.5">
        <label
          htmlFor="dfmNotes"
          className="block text-sm font-medium text-slate-200"
        >
          DFM notes (visible to customer)
        </label>
        <textarea
          id="dfmNotes"
          name="dfmNotes"
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
          htmlFor="internalNotes"
          className="block text-sm font-medium text-slate-200"
        >
          Internal notes
        </label>
        <textarea
          id="internalNotes"
          name="internalNotes"
          defaultValue={quote.internalNotes ?? ""}
          rows={4}
          className="w-full rounded-md border border-slate-700 bg-black/40 px-3 py-2 text-sm text-slate-100 outline-none focus:border-emerald-400"
        />
      </div>

      {!state.ok && state.error && (
        <p className="text-sm text-red-400">{state.error}</p>
      )}
      {state.ok && state.message && (
        <p className="text-sm text-emerald-300">{state.message}</p>
      )}

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
