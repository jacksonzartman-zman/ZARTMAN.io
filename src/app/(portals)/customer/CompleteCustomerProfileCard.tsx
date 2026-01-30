"use client";

import { useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useFormState, useFormStatus } from "react-dom";
import PortalCard from "../PortalCard";
import {
  completeCustomerProfileAction,
  type CompleteCustomerProfileActionState,
} from "./actions";

type CompleteCustomerProfileCardProps = {
  sessionEmail: string | null;
  defaultCompanyName?: string | null;
};

const INITIAL_STATE: CompleteCustomerProfileActionState = {
  ok: false,
  error: null,
};

export function CompleteCustomerProfileCard({
  sessionEmail,
  defaultCompanyName,
}: CompleteCustomerProfileCardProps) {
  const router = useRouter();
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

  useEffect(() => {
    if (state.ok) {
      router.refresh();
    }
  }, [state.ok, router]);

  return (
    <PortalCard
      title="Complete your workspace"
      description="Share the basics about your company so we can link RFQs, projects, and future orders to your account."
    >
      <form action={formAction} className="space-y-4">
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
        {!state.ok && state.error ? (
          <p className="text-sm text-red-300">{state.error}</p>
        ) : null}
        <SubmitButton />
      </form>
    </PortalCard>
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
