"use client";

import clsx from "clsx";
import { useMemo } from "react";
import { useFormState, useFormStatus } from "react-dom";
import {
  inviteSupplierToQuoteAction,
  type AdminInviteSupplierState,
} from "./actions";
import { ctaSizeClasses, secondaryCtaClasses } from "@/lib/ctas";

const INITIAL_STATE: AdminInviteSupplierState = { ok: true, message: "" };

export function AdminInviteSupplierCard({ quoteId }: { quoteId: string }) {
  const action = useMemo(
    () => inviteSupplierToQuoteAction.bind(null, quoteId),
    [quoteId],
  );
  const [state, formAction] = useFormState<AdminInviteSupplierState, FormData>(
    action,
    INITIAL_STATE,
  );

  return (
    <section className="rounded-2xl border border-slate-900 bg-slate-950/40 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Suppliers
          </p>
          <h2 className="text-base font-semibold text-slate-50">
            Invite supplier
          </h2>
          <p className="text-sm text-slate-400">
            Enter a supplier’s login email to grant them access to this RFQ.
          </p>
        </div>
      </div>

      <form action={formAction} className="mt-4 flex flex-wrap gap-2">
        <div className="min-w-[240px] flex-1">
          <label className="sr-only" htmlFor="supplier-email">
            Supplier email
          </label>
          <input
            id="supplier-email"
            name="supplierEmail"
            type="email"
            placeholder="supplier@example.com"
            className={clsx(
              "w-full rounded-xl border bg-black/40 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:border-emerald-400 focus:outline-none",
              state.ok
                ? "border-slate-800"
                : "border-amber-500/40 focus:border-amber-400",
            )}
            aria-invalid={!state.ok}
          />
          {!state.ok && state.fieldErrors?.supplierEmail ? (
            <p className="mt-1 text-xs text-amber-200" role="alert">
              {state.fieldErrors.supplierEmail}
            </p>
          ) : null}
        </div>

        <InviteButton />
      </form>

      {!state.ok && state.error ? (
        <p className="mt-3 text-sm text-amber-200" role="alert">
          {state.error}
        </p>
      ) : null}
      {state.ok && state.message ? (
        <p className="mt-3 text-sm text-emerald-200" role="status">
          {state.message}
        </p>
      ) : null}
    </section>
  );
}

function InviteButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={clsx(
        secondaryCtaClasses,
        ctaSizeClasses.sm,
        pending ? "cursor-not-allowed opacity-70" : null,
      )}
    >
      {pending ? "Inviting..." : "Invite"}
    </button>
  );
}

