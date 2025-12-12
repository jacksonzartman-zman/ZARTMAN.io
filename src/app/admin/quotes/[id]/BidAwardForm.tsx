"use client";

import clsx from "clsx";
import { useMemo } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { awardBidFormAction } from "./actions";
import { AWARD_BID_FORM_INITIAL_STATE } from "./awardFormState";

type BidAwardFormProps = {
  quoteId: string;
  bidId: string;
  supplierName?: string | null;
  className?: string;
};

export function BidAwardForm({
  quoteId,
  bidId,
  supplierName,
  className,
}: BidAwardFormProps) {
  const [state, formAction] = useFormState(
    awardBidFormAction,
    AWARD_BID_FORM_INITIAL_STATE,
  );

  const statusMessage = useMemo(() => {
    if (state.status === "success") {
      return state.message ?? "Winner recorded.";
    }
    if (state.status === "error") {
      return state.error ?? "Unable to update award state.";
    }
    return null;
  }, [state]);

  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        const label =
          typeof supplierName === "string" && supplierName.trim().length > 0
            ? supplierName.trim()
            : "this supplier";
        const confirmed = window.confirm(`Award this RFQ to ${label}?`);
        if (!confirmed) {
          event.preventDefault();
        }
      }}
      className={clsx("flex flex-col items-end gap-1", className)}
    >
      <input type="hidden" name="quoteId" value={quoteId} />
      <input type="hidden" name="bidId" value={bidId} />
      <SubmitButton />
      {statusMessage ? (
        <p
          className={clsx(
            "text-[11px]",
            state.status === "success" ? "text-emerald-300" : "text-amber-300",
          )}
          aria-live="assertive"
        >
          {statusMessage}
        </p>
      ) : null}
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className={clsx(
        "rounded-full border border-emerald-500/60 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-100 transition",
        pending
          ? "cursor-not-allowed opacity-70"
          : "hover:bg-emerald-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400",
      )}
    >
      {pending ? "Selecting..." : "Select as winner"}
    </button>
  );
}
