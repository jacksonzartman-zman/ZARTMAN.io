"use client";

import clsx from "clsx";
import Link from "next/link";
import type { InputHTMLAttributes } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { primaryCtaClasses } from "@/lib/ctas";
import {
  submitSupplierJoinRequest,
  type SupplierJoinActionState,
} from "./actions";

const INITIAL_STATE: SupplierJoinActionState = {
  success: false,
  error: null,
  fieldErrors: {},
};

type SupplierJoinFormProps = {
  supplierSlug?: string | null;
};

export function SupplierJoinForm({ supplierSlug }: SupplierJoinFormProps) {
  const [state, formAction] = useFormState(
    submitSupplierJoinRequest,
    INITIAL_STATE,
  );
  const fieldErrors = state.fieldErrors ?? {};
  const disableFields = state.success;

  return (
    <form
      action={formAction}
      className="space-y-6 rounded-3xl border border-slate-900 bg-slate-950/70 p-6 shadow-lift-sm"
    >
      {supplierSlug ? (
        <input type="hidden" name="supplier_slug" value={supplierSlug} />
      ) : null}
      <input type="hidden" name="source" value="suppliers/join" />

      <TextField
        label="Work email"
        name="work_email"
        type="email"
        autoComplete="email"
        required
        disabled={disableFields}
        error={fieldErrors.work_email}
        placeholder="you@yourshop.com"
      />

      {state.error && !state.success ? (
        <p className="rounded-2xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {state.error}
        </p>
      ) : null}

      {state.success ? (
        <div className="rounded-2xl border border-emerald-400/40 bg-emerald-400/10 px-4 py-4 text-sm text-emerald-100">
          Thanks! We will follow up at{" "}
          <span className="font-mono text-white">
            {state.submittedEmail ?? "your email"}
          </span>{" "}
          with next steps.
        </div>
      ) : null}

      <div className="space-y-3">
        <SubmitButton disabled={disableFields} />
        <p className="text-sm text-slate-400">
          Already onboarded?{" "}
          <Link
            href="/supplier"
            className="font-semibold text-white underline-offset-4 hover:underline"
          >
            Go to the supplier portal
          </Link>
        </p>
      </div>
    </form>
  );
}

type TextFieldProps = {
  label: string;
  error?: string;
} & InputHTMLAttributes<HTMLInputElement>;

function TextField({ label, error, className, ...rest }: TextFieldProps) {
  const errorId = error && rest.name ? `${rest.name}-error` : undefined;
  return (
    <label className="block text-sm font-medium text-slate-200">
      <span className="flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-slate-400">
        {label}
        {error ? (
          <span
            id={errorId}
            className="text-[11px] font-normal normal-case text-red-300"
          >
            {error}
          </span>
        ) : null}
      </span>
      <input
        {...rest}
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

function SubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  const isDisabled = disabled || pending;
  return (
    <button
      type="submit"
      className={clsx(primaryCtaClasses, "w-full justify-center")}
      disabled={isDisabled}
    >
      {pending ? "Sending..." : "Get RFQs"}
    </button>
  );
}
