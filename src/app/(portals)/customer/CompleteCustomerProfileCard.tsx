"use client";

import { useMemo } from "react";
import { useFormState, useFormStatus } from "react-dom";
import {
  completeCustomerProfileAction,
  type CompleteCustomerProfileActionState,
} from "./actions";

type CompleteCustomerProfileCardProps = {
  sessionEmail: string | null;
  defaultCompanyName?: string | null;
};

const INITIAL_STATE: CompleteCustomerProfileActionState = {
  error: null,
};

export function CompleteCustomerProfileCard({
  sessionEmail,
  defaultCompanyName,
}: CompleteCustomerProfileCardProps) {
  const [state, formAction] = useFormState<
    CompleteCustomerProfileActionState,
    FormData
  >(completeCustomerProfileAction, INITIAL_STATE);
  const fallbackCompany = useMemo(() => {
    if (defaultCompanyName && defaultCompanyName.trim().length > 0) {
      return defaultCompanyName;
    }
    if (sessionEmail) {
      return sessionEmail.split("@")[0]?.replace(/\W+/g, " ").trim();
    }
    return "";
  }, [defaultCompanyName, sessionEmail]);

  return (
    <section className="rounded-2xl border border-slate-900 bg-slate-950/70 p-6">
      <p className="text-xs font-semibold uppercase tracking-[0.3em] text-emerald-300">
        Customer profile
      </p>
      <h2 className="mt-2 text-2xl font-semibold text-white">Complete your workspace</h2>
      <p className="mt-1 text-sm text-slate-400">
        Share the basics about your company so we can link RFQs, quotes, and future orders to your
        account.
      </p>

      <form action={formAction} className="mt-6 space-y-4">
        <div>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Company name
          </label>
          <input
            name="company_name"
            defaultValue={fallbackCompany ?? ""}
            required
            className="mt-1 w-full rounded-lg border border-slate-800 bg-black/40 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-emerald-400 focus:outline-none"
            placeholder="Acme Hardware"
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Phone" name="phone" placeholder="+1 (555) 555-1234" />
          <TextField label="Website" name="website" placeholder="https://acme-hardware.com" />
        </div>
        {sessionEmail ? (
          <p className="text-xs text-slate-500">
            Your profile will be tied to{" "}
            <span className="font-mono text-slate-300">{sessionEmail}</span>. Need to preview another
            account? Append{" "}
            <span className="font-mono text-slate-300">?email=you@company.com</span> to the URL.
          </p>
        ) : null}
        {state.error ? <p className="text-sm text-red-300">{state.error}</p> : null}
        <SubmitButton />
      </form>
    </section>
  );
}

function TextField({
  label,
  name,
  placeholder,
}: {
  label: string;
  name: string;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </label>
      <input
        name={name}
        placeholder={placeholder}
        className="mt-1 w-full rounded-lg border border-slate-800 bg-black/40 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-emerald-400 focus:outline-none"
      />
    </div>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-full border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-sm font-semibold text-emerald-200 transition hover:bg-emerald-500/20 disabled:opacity-60 sm:w-auto"
    >
      {pending ? "Saving..." : "Save profile"}
    </button>
  );
}
