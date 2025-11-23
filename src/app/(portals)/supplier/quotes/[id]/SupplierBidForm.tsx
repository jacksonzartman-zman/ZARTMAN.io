"use client";

import { useEffect, useRef } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { ctaSizeClasses, primaryCtaClasses } from "@/lib/ctas";
import {
  submitSupplierBidAction,
  type SupplierBidActionState,
} from "./actions";
import type { SupplierBidRow } from "@/server/suppliers";

type SupplierBidFormProps = {
  quoteId: string;
  supplierEmail: string;
  existingBid: SupplierBidRow | null;
  isLocked: boolean;
};

const INITIAL_STATE: SupplierBidActionState = {
  success: false,
  error: null,
  status: null,
};

export function SupplierBidForm({
  quoteId,
  supplierEmail,
  existingBid,
  isLocked,
}: SupplierBidFormProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction] = useFormState<
    SupplierBidActionState,
    FormData
  >(submitSupplierBidAction, INITIAL_STATE);

  useEffect(() => {
    if (state.success && !isLocked) {
      formRef.current?.reset();
    }
  }, [state.success, isLocked]);

  const buttonLabel = existingBid ? "Update bid" : "Submit bid";

  return (
    <form ref={formRef} action={formAction} className="space-y-4">
      <input type="hidden" name="quote_id" value={quoteId} />
      <input type="hidden" name="supplier_email" value={supplierEmail} />
      <div className="grid gap-4 md:grid-cols-3">
        <TextField
          label="Unit price"
          name="unit_price"
          type="number"
          step="0.01"
          placeholder="15000"
          defaultValue={
            typeof existingBid?.unit_price === "number"
              ? existingBid.unit_price.toString()
              : typeof existingBid?.unit_price === "string"
                ? existingBid.unit_price
                : undefined
          }
          disabled={isLocked}
          prefix="$"
        />
        <TextField
          label="Currency"
          name="currency"
          placeholder="USD"
          defaultValue={existingBid?.currency ?? "USD"}
          disabled={isLocked}
        />
        <TextField
          label="Lead time (days)"
          name="lead_time_days"
          type="number"
          placeholder="14"
          defaultValue={
            typeof existingBid?.lead_time_days === "number"
              ? existingBid.lead_time_days.toString()
              : undefined
          }
          disabled={isLocked}
        />
      </div>
      <div>
        <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Notes
        </label>
        <textarea
          name="notes"
          defaultValue={existingBid?.notes ?? ""}
          rows={4}
          disabled={isLocked}
          className="mt-1 w-full rounded-lg border border-slate-800 bg-black/40 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-blue-400 focus:outline-none disabled:opacity-60"
          placeholder="Add scope details, payment terms, or anything the customer should know."
        />
      </div>

      {state.error ? (
        <p className="text-sm text-red-300" role="alert">
          {state.error}
        </p>
      ) : null}

      {state.success && !state.error ? (
        <p className="text-sm text-emerald-300" role="status">
          Bid saved — we’ll notify the customer.
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton label={buttonLabel} disabled={isLocked} />
        {existingBid?.status ? (
          <StatusChip status={existingBid.status} />
        ) : null}
      </div>
    </form>
  );
}

function TextField({
  label,
  name,
  type = "text",
  placeholder,
  defaultValue,
  disabled,
  step,
  prefix,
}: {
  label: string;
  name: string;
  type?: string;
  placeholder?: string;
  defaultValue?: string;
  disabled?: boolean;
  step?: string;
  prefix?: string;
}) {
  return (
    <div>
      <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </label>
      <div className="mt-1 flex items-center rounded-lg border border-slate-800 bg-black/40 px-3 py-2 text-sm text-slate-100 focus-within:border-blue-400">
        {prefix ? <span className="mr-1 text-slate-500">{prefix}</span> : null}
        <input
          type={type}
          name={name}
          placeholder={placeholder}
          defaultValue={defaultValue}
          disabled={disabled}
          step={step}
          className="w-full bg-transparent text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none"
        />
      </div>
    </div>
  );
}

function SubmitButton({ label, disabled }: { label: string; disabled?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || disabled}
      className={`${primaryCtaClasses} ${ctaSizeClasses.md} ${disabled ? "opacity-60" : ""}`}
    >
      {pending ? "Saving..." : label}
    </button>
  );
}

function StatusChip({ status }: { status: string }) {
  const colors: Record<string, string> = {
    accepted: "bg-emerald-500/20 text-emerald-200 border-emerald-500/30",
    pending: "bg-blue-500/10 text-blue-200 border-blue-500/30",
    declined: "bg-red-500/10 text-red-200 border-red-500/30",
    withdrawn: "bg-slate-500/10 text-slate-200 border-slate-500/30",
  };

  return (
    <span
      className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${
        colors[status] ?? "bg-slate-500/10 text-slate-200 border-slate-500/30"
      }`}
    >
      Status: {status}
    </span>
  );
}
