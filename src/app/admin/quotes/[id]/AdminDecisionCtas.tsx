"use client";

import clsx from "clsx";
import { useMemo } from "react";
import { useFormState, useFormStatus } from "react-dom";
import type { QuoteStatus } from "@/server/quotes/status";
import {
  dangerCtaClasses,
  infoCtaClasses,
  primaryCtaClasses,
} from "@/lib/ctas";
import {
  submitAdminQuoteUpdateAction,
  type AdminQuoteUpdateState,
} from "./actions";

const INITIAL_STATE: AdminQuoteUpdateState = { ok: true, message: "" };

type AdminDecisionCtasProps = {
  quoteId: string;
  status: QuoteStatus;
  awardAnchorId?: string;
  className?: string;
};

export function AdminDecisionCtas({
  quoteId,
  status,
  awardAnchorId = "bids-panel",
  className,
}: AdminDecisionCtasProps) {
  const canReopen = status === "lost" || status === "cancelled";
  const canArchive = status !== "cancelled";

  const reopenAction = useMemo(
    () => submitAdminQuoteUpdateAction.bind(null, quoteId),
    [quoteId],
  );
  const [reopenState, reopenFormAction] = useFormState<
    AdminQuoteUpdateState,
    FormData
  >(reopenAction, INITIAL_STATE);

  const archiveAction = useMemo(
    () => submitAdminQuoteUpdateAction.bind(null, quoteId),
    [quoteId],
  );
  const [archiveState, archiveFormAction] = useFormState<
    AdminQuoteUpdateState,
    FormData
  >(archiveAction, INITIAL_STATE);

  return (
    <div className={clsx("flex flex-wrap items-center gap-2", className)}>
      <a
        href={`#${awardAnchorId}`}
        className={clsx(primaryCtaClasses, "whitespace-nowrap")}
      >
        Award
      </a>

      <form
        action={reopenFormAction}
        onSubmit={(event) => {
          if (!canReopen) {
            event.preventDefault();
            return;
          }
          const confirmed = window.confirm(
            "Re-open this RFQ? This will move the status back to Reviewing bids.",
          );
          if (!confirmed) {
            event.preventDefault();
          }
        }}
        className="flex items-center gap-2"
      >
        <input type="hidden" name="status" value="in_review" />
        <StatusButton
          disabled={!canReopen}
          className={clsx(infoCtaClasses, "whitespace-nowrap")}
        >
          Re-open
        </StatusButton>
        <InlineState state={reopenState} />
      </form>

      <form
        action={archiveFormAction}
        onSubmit={(event) => {
          if (!canArchive) {
            event.preventDefault();
            return;
          }
          const confirmed = window.confirm(
            "Archive this RFQ? This will set the quote status to Cancelled.",
          );
          if (!confirmed) {
            event.preventDefault();
          }
        }}
        className="flex items-center gap-2"
      >
        <input type="hidden" name="status" value="cancelled" />
        <StatusButton
          disabled={!canArchive}
          className={clsx(
            dangerCtaClasses,
            "whitespace-nowrap",
          )}
        >
          Archive
        </StatusButton>
        <InlineState state={archiveState} />
      </form>
    </div>
  );
}

function StatusButton({
  disabled,
  className,
  children,
}: {
  disabled?: boolean;
  className: string;
  children: string;
}) {
  const { pending } = useFormStatus();
  const isDisabled = pending || disabled;
  return (
    <button
      type="submit"
      disabled={isDisabled}
      className={clsx(
        className,
        isDisabled ? "cursor-not-allowed opacity-70" : null,
      )}
    >
      {pending ? "Working..." : children}
    </button>
  );
}

function InlineState({ state }: { state: AdminQuoteUpdateState }) {
  if (!state.ok && state.error) {
    return (
      <span className="text-[11px] text-amber-300" aria-live="polite">
        {state.error}
      </span>
    );
  }
  if (state.ok && state.message) {
    return (
      <span className="text-[11px] text-emerald-300" aria-live="polite">
        {state.message}
      </span>
    );
  }
  return null;
}

