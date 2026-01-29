"use client";

import clsx from "clsx";
import { useEffect, useMemo, useRef } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { inviteSupplierAction } from "./actions";
import {
  INVITE_SUPPLIER_INITIAL_STATE,
  type InviteSupplierActionState,
} from "./inviteSupplierActionState";

const PROCESS_OPTIONS = ["CNC", "3DP", "Sheet Metal", "Injection Molding"] as const;

export function InviteSupplierButton({ className }: { className?: string }) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const [state, formAction] = useFormState<InviteSupplierActionState, FormData>(
    inviteSupplierAction,
    INVITE_SUPPLIER_INITIAL_STATE,
  );

  const statusMessage = useMemo(() => {
    if (state.status === "success") return state.message ?? "Invite sent.";
    if (state.status === "error") return state.error ?? "Unable to send invite.";
    return null;
  }, [state]);

  useEffect(() => {
    if (state.status !== "success") return;
    // Keep it simple: close on success.
    dialogRef.current?.close();
  }, [state.status]);

  return (
    <>
      <button
        type="button"
        onClick={() => dialogRef.current?.showModal()}
        className={clsx(
          "rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-emerald-950 hover:bg-emerald-400",
          className,
        )}
      >
        Invite supplier
      </button>
      <dialog
        ref={dialogRef}
        className="w-full max-w-lg rounded-2xl border border-slate-900 bg-slate-950 p-0 text-white shadow-[0_18px_40px_rgba(2,6,23,0.85)] backdrop:bg-black/70"
      >
        <div className="border-b border-slate-900 px-6 py-5">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">Admin</p>
          <h2 className="mt-2 text-xl font-semibold text-white">Invite supplier</h2>
          <p className="mt-2 text-sm text-slate-400">
            We’ll create the supplier + provider records and email a magic link.
          </p>
        </div>

        <form action={formAction} className="space-y-5 px-6 py-5">
          <label className="flex flex-col gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Supplier name
            </span>
            <input
              name="supplierName"
              placeholder="Acme Manufacturing"
              required
              className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-emerald-400 focus:outline-none"
            />
          </label>

          <label className="flex flex-col gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Email
            </span>
            <input
              name="email"
              type="email"
              placeholder="ops@acme.com"
              required
              className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-emerald-400 focus:outline-none"
            />
          </label>

          <fieldset className="space-y-2">
            <legend className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Processes
            </legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {PROCESS_OPTIONS.map((value) => (
                <label
                  key={value}
                  className="flex items-center gap-2 rounded-xl border border-slate-900 bg-slate-950/40 px-3 py-2 text-sm text-slate-200"
                >
                  <input
                    type="checkbox"
                    name="processes"
                    value={value}
                    className="h-4 w-4 accent-emerald-400"
                  />
                  <span>{value}</span>
                </label>
              ))}
            </div>
          </fieldset>

          {statusMessage ? (
            <p
              className={clsx(
                "text-sm",
                state.status === "success" ? "text-emerald-300" : "text-amber-300",
              )}
              aria-live="assertive"
            >
              {statusMessage}
            </p>
          ) : null}

          <div className="flex flex-wrap justify-end gap-2 border-t border-slate-900 pt-4">
            <button
              type="button"
              onClick={() => dialogRef.current?.close()}
              className="rounded-xl border border-slate-800 bg-slate-950 px-4 py-2 text-sm font-semibold text-slate-200 hover:border-slate-700 hover:text-white"
            >
              Cancel
            </button>
            <InviteSubmitButton />
          </div>
        </form>
      </dialog>
    </>
  );
}

function InviteSubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={clsx(
        "rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-emerald-950",
        pending ? "cursor-not-allowed opacity-70" : "hover:bg-emerald-400",
      )}
    >
      {pending ? "Sending..." : "Send invite"}
    </button>
  );
}

