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
  suppressed?: boolean;
  lastRequestCreatedAt?: string | null;
}) {
  const suppressed = Boolean(props.suppressed);

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
  const disabled = sent || suppressed;

  const suppressedLabel = useMemo(() => {
    if (!suppressed) return null;
    return formatRequestedLabel(props.lastRequestCreatedAt ?? null);
  }, [suppressed, props.lastRequestCreatedAt]);

  const errorMessage = useMemo(() => {
    if (state.ok) return null;
    if ("error" in state && typeof state.error === "string") return state.error;
    if ("reason" in state && state.reason === "recent_request_exists") {
      return "A recent request already exists.";
    }
    return "We couldn't send that request right now.";
  }, [state]);

  return (
    <form action={formAction} className="flex items-center gap-2">
      <SubmitButton
        disabledOverride={disabled}
        suppressedLabel={suppressedLabel}
        tooltip={suppressed ? "Supplier hasn’t updated capacity yet" : undefined}
        canSubmit={!suppressed}
      />
      {sent ? (
        <span className="text-xs font-semibold text-emerald-200" role="status">
          Request sent
        </span>
      ) : null}
      {errorMessage ? (
        <span className="text-xs font-semibold text-amber-200" role="alert">
          {errorMessage}
        </span>
      ) : null}
    </form>
  );
}

function SubmitButton({
  disabledOverride,
  suppressedLabel,
  tooltip,
  canSubmit,
}: {
  disabledOverride: boolean;
  suppressedLabel: string | null;
  tooltip?: string;
  canSubmit: boolean;
}) {
  const { pending } = useFormStatus();
  const disabled = pending || disabledOverride;
  const label = pending
    ? "Sending..."
    : suppressedLabel
      ? suppressedLabel
      : "Request capacity update";

  return (
    <span title={tooltip}>
      <button
        type={canSubmit ? "submit" : "button"}
        disabled={disabled}
        className={clsx(
          secondaryCtaClasses,
          ctaSizeClasses.sm,
          "whitespace-nowrap",
          disabled ? "cursor-not-allowed opacity-70" : null,
        )}
      >
        {label}
      </button>
    </span>
  );
}

function formatRequestedLabel(createdAt: string | null): string {
  if (typeof createdAt !== "string" || !createdAt.trim()) {
    return "Requested recently";
  }
  const ts = Date.parse(createdAt);
  if (!Number.isFinite(ts)) {
    return "Requested recently";
  }
  const diffMs = Date.now() - ts;
  const days = Math.floor(diffMs / (24 * 60 * 60 * 1000));
  if (days <= 0) return "Requested today";
  if (days === 1) return "Requested 1 day ago";
  return `Requested ${days} days ago`;
}

