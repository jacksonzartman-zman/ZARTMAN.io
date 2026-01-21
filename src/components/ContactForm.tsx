"use client";

import clsx from "clsx";
import Link from "next/link";
import { useFormState, useFormStatus } from "react-dom";
import type {
  InputHTMLAttributes,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import {
  submitContactRequest,
  type ContactFormState,
} from "@/app/actions";
import { CONTACT_FOCUS_OPTIONS } from "@/data/contact";
import { ghostCtaClasses, primaryCtaClasses } from "@/lib/ctas";
import { SHOW_LEGACY_QUOTE_ENTRYPOINTS } from "@/lib/ui/deprecation";

const INITIAL_STATE: ContactFormState = {
  success: false,
  error: null,
  message: null,
  fieldErrors: {},
};

export default function ContactForm() {
  const [state, formAction] = useFormState(
    submitContactRequest,
    INITIAL_STATE,
  );
  const fieldErrors = state.fieldErrors ?? {};
  const disableFields = Boolean(state.success);

  return (
    <form
      action={formAction}
      className="space-y-6 rounded-3xl border border-slate-900/70 bg-slate-950/70 p-6 shadow-[0_20px_55px_rgba(2,6,23,0.4)]"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="Name"
          name="name"
          placeholder="Casey Patel"
          autoComplete="name"
          required
          disabled={disableFields}
          error={fieldErrors.name}
        />
        <TextField
          label="Work email"
          name="email"
          type="email"
          placeholder="you@team.com"
          autoComplete="email"
          required
          disabled={disableFields}
          error={fieldErrors.email}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="Company"
          name="company"
          placeholder="Northwind Machining"
          autoComplete="organization"
          required
          disabled={disableFields}
          error={fieldErrors.company}
        />
        <TextField
          label="Role / title"
          name="role"
          placeholder="Head of Supply Chain"
          autoComplete="organization-title"
          disabled={disableFields}
          error={fieldErrors.role}
        />
      </div>

      <SelectField
        label="Are you mostly buying, supplying, or both?"
        name="focus"
        disabled={disableFields}
      >
        <option value="">Select one (optional)</option>
        {CONTACT_FOCUS_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </SelectField>

      <TextareaField
        label="What's on your mind?"
        name="message"
        placeholder="Share the search requests you're juggling, current supplier mix, or how you'd like us to help."
        rows={5}
        required
        disabled={disableFields}
        error={fieldErrors.message}
      />

      {state.error ? (
        <p className="rounded-3xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-100">
          {state.error}
        </p>
      ) : null}

      {state.success && state.message ? (
        <p className="rounded-3xl border border-emerald-400/40 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-100">
          {state.message}
        </p>
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row">
        <SubmitButton disabled={disableFields} />
        {SHOW_LEGACY_QUOTE_ENTRYPOINTS ? (
          <Link
            href="/quote"
            className={clsx(ghostCtaClasses, "w-full justify-center")}
          >
            Just start a search instead
          </Link>
        ) : null}
      </div>
      <p className="text-xs text-ink-soft">
        We reply with real project context—no auto-responders or marketing drip.
      </p>
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
    <label className="block text-sm text-ink">
      <span className="flex items-center justify-between text-xs font-semibold uppercase tracking-[0.3em] text-ink-soft">
        {label}
        {error ? (
          <span id={errorId} className="text-[11px] font-normal normal-case text-red-300">
            {error}
          </span>
        ) : null}
      </span>
      <input
        {...rest}
        className={clsx(
          "mt-2 w-full rounded-2xl border border-slate-900 bg-black/30 px-4 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-emerald-200 focus:outline-none disabled:opacity-60",
          error ? "border-red-500/70 focus:border-red-400" : undefined,
          className,
        )}
        aria-invalid={Boolean(error)}
        aria-describedby={errorId}
      />
    </label>
  );
}

type TextareaFieldProps = {
  label: string;
  error?: string;
} & TextareaHTMLAttributes<HTMLTextAreaElement>;

function TextareaField({ label, error, className, ...rest }: TextareaFieldProps) {
  const errorId = error && rest.name ? `${rest.name}-error` : undefined;
  return (
    <label className="block text-sm text-ink">
      <span className="flex items-center justify-between text-xs font-semibold uppercase tracking-[0.3em] text-ink-soft">
        {label}
        {error ? (
          <span id={errorId} className="text-[11px] font-normal normal-case text-red-300">
            {error}
          </span>
        ) : null}
      </span>
      <textarea
        {...rest}
        className={clsx(
          "mt-2 w-full rounded-2xl border border-slate-900 bg-black/30 px-4 py-3 text-sm text-slate-100 placeholder:text-slate-500 focus:border-emerald-200 focus:outline-none disabled:opacity-60",
          error ? "border-red-500/70 focus:border-red-400" : undefined,
          className,
        )}
        aria-invalid={Boolean(error)}
        aria-describedby={errorId}
      />
    </label>
  );
}

type SelectFieldProps = {
  label: string;
  error?: string;
} & SelectHTMLAttributes<HTMLSelectElement>;

function SelectField({ label, error, children, className, ...rest }: SelectFieldProps) {
  const errorId = error && rest.name ? `${rest.name}-error` : undefined;
  return (
    <label className="block text-sm text-ink">
      <span className="flex items-center justify-between text-xs font-semibold uppercase tracking-[0.3em] text-ink-soft">
        {label}
        {error ? (
          <span id={errorId} className="text-[11px] font-normal normal-case text-red-300">
            {error}
          </span>
        ) : null}
      </span>
      <select
        {...rest}
        className={clsx(
          "mt-2 w-full rounded-2xl border border-slate-900 bg-black/30 px-4 py-2 text-sm text-slate-100 focus:border-emerald-200 focus:outline-none disabled:opacity-60",
          error ? "border-red-500/70 focus:border-red-400" : undefined,
          className,
        )}
        aria-invalid={Boolean(error)}
        aria-describedby={errorId}
      >
        {children}
      </select>
    </label>
  );
}

function SubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  const isDisabled = disabled || pending;
  return (
    <button
      type="submit"
      className={clsx(primaryCtaClasses, "w-full justify-center sm:w-auto")}
      disabled={isDisabled}
    >
      {pending ? "Sending..." : "Request a walkthrough"}
    </button>
  );
}
