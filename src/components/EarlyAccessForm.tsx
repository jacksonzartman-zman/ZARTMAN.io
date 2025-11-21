"use client";

import { useFormState, useFormStatus } from "react-dom";
import {
  requestEarlyAccess,
  type EarlyAccessFormState,
} from "@/app/actions";

const INITIAL_STATE: EarlyAccessFormState = {};

export default function EarlyAccessForm() {
  const [state, formAction] = useFormState(
    requestEarlyAccess,
    INITIAL_STATE,
  );

  return (
    <form
      action={formAction}
      className="space-y-3 rounded-2xl border border-slate-800 bg-slate-950/60 p-4 shadow-inner"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <label htmlFor="email" className="sr-only">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          placeholder="you@team.com"
          className="flex-1 rounded-full border border-slate-700 bg-black/30 px-4 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:border-emerald-400"
        />
        <SubmitButton />
      </div>

      {state?.error && (
        <p className="text-sm text-red-400">{state.error}</p>
      )}
      {state?.success && state.message && (
        <p className="text-sm text-emerald-300">{state.message}</p>
      )}
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex items-center justify-center rounded-full bg-emerald-400 px-5 py-2 text-sm font-semibold text-slate-950 transition hover:bg-emerald-300 disabled:opacity-60"
    >
      {pending ? "Sending..." : "Request early access"}
    </button>
  );
}
