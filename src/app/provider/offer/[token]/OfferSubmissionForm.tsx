"use client";

import type { InputHTMLAttributes, TextareaHTMLAttributes } from "react";
import { useFormState, useFormStatus } from "react-dom";
import clsx from "clsx";
import { formatDateTime } from "@/lib/formatDate";
import { primaryCtaClasses } from "@/lib/ctas";
import {
  submitOfferViaTokenAction,
  type ProviderOfferActionState,
} from "./actions";

type OfferSubmissionFormProps = {
  token: string;
  lastSubmittedAt?: string | null;
  initialValues?: {
    price?: string | number;
    leadTimeDays?: string | number;
    confidenceScore?: string | number;
    assumptions?: string;
    notes?: string;
  };
};

const INITIAL_STATE: ProviderOfferActionState = {
  ok: false,
  error: null,
  message: null,
  fieldErrors: {},
};

export function OfferSubmissionForm({
  token,
  lastSubmittedAt = null,
  initialValues,
}: OfferSubmissionFormProps) {
  const [state, formAction] = useFormState<
    ProviderOfferActionState,
    FormData
  >(submitOfferViaTokenAction, INITIAL_STATE);
  const fieldErrors = state.fieldErrors ?? {};
  const showSuccess = state.ok;
  const successMessage = state.message ?? "Offer submitted.";
  const submittedAtValue = state.submittedAt ?? lastSubmittedAt ?? null;
  const submittedAtLabel = submittedAtValue
    ? formatDateTime(submittedAtValue, { includeTime: true })
    : null;
  const hasExistingOffer = Boolean(submittedAtValue);
  const submitLabel = hasExistingOffer ? "Resubmit offer" : "Submit offer";

  return (
    <section className="space-y-4 rounded-3xl border border-slate-900 bg-slate-950/70 p-6 shadow-lift-sm">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-emerald-300">
          Offer details
        </p>
        <p className="mt-2 text-sm text-slate-300">
          Share pricing and lead time so we can evaluate your response quickly.
        </p>
        {submittedAtLabel ? (
          <p className="mt-2 text-xs text-slate-400">
            Last submitted at {submittedAtLabel}.
          </p>
        ) : null}
      </div>

      {showSuccess ? (
        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
          <p>{successMessage}</p>
        </div>
      ) : null}

      {!state.ok && state.error ? (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-100">
          {state.error}
        </div>
      ) : null}

      <form action={formAction} className="space-y-4">
        <input type="hidden" name="token" value={token} />
        <div className="grid gap-4 md:grid-cols-2">
          <InputField
            label="Price (USD)"
            name="price"
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            required
            prefix="$"
            error={fieldErrors.price}
            placeholder="15000"
            defaultValue={initialValues?.price}
          />
          <InputField
            label="Lead time (days)"
            name="leadTimeDays"
            type="number"
            inputMode="numeric"
            step="1"
            min="1"
            required
            error={fieldErrors.leadTimeDays}
            placeholder="10"
            defaultValue={initialValues?.leadTimeDays}
          />
        </div>

        <InputField
          label="Confidence score"
          name="confidenceScore"
          type="number"
          inputMode="numeric"
          step="1"
          min="0"
          max="100"
          error={fieldErrors.confidenceScore}
          placeholder="85"
          helper="Optional · 0–100"
          defaultValue={initialValues?.confidenceScore}
        />

        <TextAreaField
          label="Assumptions"
          name="assumptions"
          error={fieldErrors.assumptions}
          placeholder="Assumptions about tolerances, finishing, or quantities."
          helper="Optional"
          maxLength={2000}
          defaultValue={initialValues?.assumptions}
        />

        <TextAreaField
          label="Notes"
          name="notes"
          error={fieldErrors.notes}
          placeholder="Any extra context, risks, or questions to flag."
          helper="Optional"
          maxLength={2000}
          defaultValue={initialValues?.notes}
        />

        <SubmitButton label={submitLabel} />
      </form>
    </section>
  );
}

type InputFieldProps = {
  label: string;
  error?: string;
  prefix?: string;
  helper?: string;
} & InputHTMLAttributes<HTMLInputElement>;

function InputField({ label, error, prefix, helper, className, ...rest }: InputFieldProps) {
  const errorId = error && rest.name ? `${rest.name}-error` : undefined;
  return (
    <label className="block text-sm font-medium text-slate-200">
      <span className="flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-slate-400">
        <span>{label}</span>
        {helper ? <span className="text-[11px] font-normal normal-case">{helper}</span> : null}
        {error ? (
          <span
            id={errorId}
            className="text-[11px] font-normal normal-case text-red-300"
          >
            {error}
          </span>
        ) : null}
      </span>
      <div className="relative mt-2">
        {prefix ? (
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">
            {prefix}
          </span>
        ) : null}
        <input
          {...rest}
          className={clsx(
            "w-full rounded-2xl border border-slate-900 bg-black/30 px-4 py-2 text-sm text-white placeholder:text-slate-500 focus:border-white focus:outline-none disabled:opacity-60",
            prefix ? "pl-8" : "",
            error ? "border-red-500/60 focus:border-red-400" : "",
            className,
          )}
          aria-invalid={Boolean(error)}
          aria-describedby={errorId}
        />
      </div>
    </label>
  );
}

type TextAreaFieldProps = {
  label: string;
  error?: string;
  helper?: string;
} & TextareaHTMLAttributes<HTMLTextAreaElement>;

function TextAreaField({ label, error, helper, className, ...rest }: TextAreaFieldProps) {
  const errorId = error && rest.name ? `${rest.name}-error` : undefined;
  return (
    <label className="block text-sm font-medium text-slate-200">
      <span className="flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-slate-400">
        <span>{label}</span>
        {helper ? <span className="text-[11px] font-normal normal-case">{helper}</span> : null}
        {error ? (
          <span
            id={errorId}
            className="text-[11px] font-normal normal-case text-red-300"
          >
            {error}
          </span>
        ) : null}
      </span>
      <textarea
        {...rest}
        rows={4}
        className={clsx(
          "mt-2 w-full rounded-2xl border border-slate-900 bg-black/30 px-4 py-2 text-sm text-white placeholder:text-slate-500 focus:border-white focus:outline-none disabled:opacity-60",
          error ? "border-red-500/60 focus:border-red-400" : "",
          className,
        )}
        aria-invalid={Boolean(error)}
        aria-describedby={errorId}
      />
    </label>
  );
}

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className={clsx(primaryCtaClasses, "w-full justify-center")}
      disabled={pending}
    >
      {pending ? "Submitting..." : label}
    </button>
  );
}
