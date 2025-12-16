"use client";

import clsx from "clsx";
import { useMemo } from "react";
import { useFormState, useFormStatus } from "react-dom";
import {
  requestCapacityUpdateAction,
  type AdminCapacityUpdateRequestState,
} from "./actions";
import { ctaSizeClasses, secondaryCtaClasses } from "@/lib/ctas";
import type { CapacityUpdateRequestReason } from "@/server/admin/capacityRequests";

const INITIAL_STATE: AdminCapacityUpdateRequestState = { ok: true, message: "" };

export function RequestCapacityUpdateButton(props: {
  quoteId: string;
  supplierId: string;
  weekStartDate: string;
  reason: CapacityUpdateRequestReason;
}) {
  const action = useMemo(
    () =>
      requestCapacityUpdateAction.bind(
        null,
        props.quoteId,
        props.supplierId,
        props.weekStartDate,
        props.reason,
      ),
    [props.quoteId, props.supplierId, props.weekStartDate, props.reason],
  );

  const [state, formAction] = useFormState<AdminCapacityUpdateRequestState, FormData>(
    action,
    INITIAL_STATE,
  );

  const sent = state.ok && state.message === "Request sent";

  return (
    <form action={formAction} className="flex items-center gap-2">
      <SubmitButton disabledOverride={sent} />
      {sent ? (
        <span className="text-xs font-semibold text-emerald-200" role="status">
          Request sent
        </span>
      ) : null}
      {!state.ok ? (
        <span className="text-xs font-semibold text-amber-200" role="alert">
          {state.error}
        </span>
      ) : null}
    </form>
  );
}

function SubmitButton({ disabledOverride }: { disabledOverride: boolean }) {
  const { pending } = useFormStatus();
  const disabled = pending || disabledOverride;
  return (
    <button
      type="submit"
      disabled={disabled}
      className={clsx(
        secondaryCtaClasses,
        ctaSizeClasses.sm,
        "whitespace-nowrap",
        disabled ? "cursor-not-allowed opacity-70" : null,
      )}
    >
      {pending ? "Sending..." : "Request capacity update"}
    </button>
  );
}

