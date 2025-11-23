"use client";

import { useFormState, useFormStatus } from "react-dom";
import {
  acceptSupplierBidAction,
  declineSupplierBidAction,
  type BidDecisionActionState,
} from "./actions";

const INITIAL_STATE: BidDecisionActionState = {
  success: false,
  error: null,
};

type BidDecisionButtonsProps = {
  bidId: string;
  quoteId: string;
  status: string;
  disabled?: boolean;
};

export function BidDecisionButtons({
  bidId,
  quoteId,
  status,
  disabled = false,
}: BidDecisionButtonsProps) {
  const [acceptState, acceptAction] = useFormState<
    BidDecisionActionState,
    FormData
  >(acceptSupplierBidAction, INITIAL_STATE);
  const [declineState, declineAction] = useFormState<
    BidDecisionActionState,
    FormData
  >(declineSupplierBidAction, INITIAL_STATE);

  const acceptDisabled = disabled || status === "accepted";
  const declineDisabled = disabled || status === "declined" || status === "withdrawn";

  return (
    <div className="space-y-2">
      <DecisionForm
        action={acceptAction}
        bidId={bidId}
        quoteId={quoteId}
        label="Accept bid"
        intent="primary"
        disabled={acceptDisabled}
        error={acceptState.error}
      />
      <DecisionForm
        action={declineAction}
        bidId={bidId}
        quoteId={quoteId}
        label="Decline"
        intent="secondary"
        disabled={declineDisabled}
        error={declineState.error}
      />
    </div>
  );
}

type DecisionFormProps = {
  action: (formData: FormData) => void;
  bidId: string;
  quoteId: string;
  label: string;
  intent: "primary" | "secondary";
  disabled?: boolean;
  error?: string | null;
};

function DecisionForm({
  action,
  bidId,
  quoteId,
  label,
  intent,
  disabled,
  error,
}: DecisionFormProps) {
  const { pending } = useFormStatus();
  const isDisabled = Boolean(disabled) || pending;
  const baseClasses =
    "w-full rounded-full px-4 py-1.5 text-xs font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2";
  const intentClasses =
    intent === "primary"
      ? "border border-emerald-500/50 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20 focus-visible:outline-emerald-400"
      : "border border-slate-700 bg-transparent text-slate-300 hover:border-red-400/60 hover:text-red-200 focus-visible:outline-red-400";

  return (
    <form action={action} className="space-y-1">
      <input type="hidden" name="bid_id" value={bidId} />
      <input type="hidden" name="quote_id" value={quoteId} />
      <button
        type="submit"
        disabled={isDisabled}
        className={`${baseClasses} ${intentClasses} disabled:cursor-not-allowed disabled:opacity-60`}
      >
        {pending ? "Working..." : label}
      </button>
      {error ? (
        <p className="text-[11px] text-red-300" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
