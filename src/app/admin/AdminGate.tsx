"use client";

import { useEffect } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { unlockAdminGateAction, type AdminGateState } from "./adminGateActions";

const INITIAL_STATE: AdminGateState = { ok: false, error: "Admin access required." };

export default function AdminGate() {
  const [state, action] = useFormState(unlockAdminGateAction, INITIAL_STATE);
  const router = useRouter();

  useEffect(() => {
    if (state.ok) {
      router.refresh();
    }
  }, [state.ok, router]);

  return (
    <div className="mx-auto w-full max-w-md px-6 py-12">
      <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-6">
        <h1 className="text-lg font-semibold text-white">Admin access</h1>
        <p className="mt-2 text-sm text-slate-400">
          Enter the admin password to continue.
        </p>

        <form action={action} className="mt-6 space-y-3">
          <label className="block text-sm font-medium text-slate-200">
            Password
            <input
              type="password"
              name="password"
              className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-emerald-400"
              autoComplete="current-password"
              required
            />
          </label>

          {state.ok ? null : (
            <p className="text-sm text-slate-400">{state.error}</p>
          )}

          <SubmitButton />
        </form>
      </div>
    </div>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className="w-full rounded-lg bg-emerald-500 px-3 py-2 text-sm font-semibold text-emerald-950 transition hover:bg-emerald-400 disabled:opacity-50"
      disabled={pending}
    >
      {pending ? "Unlocking..." : "Unlock admin"}
    </button>
  );
}

