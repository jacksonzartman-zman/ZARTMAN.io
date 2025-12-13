"use client";

import clsx from "clsx";
import { useMemo } from "react";
import { useFormState, useFormStatus } from "react-dom";
import type { QuoteStatus } from "@/server/quotes/status";
import { dangerCtaClasses, infoCtaClasses } from "@/lib/ctas";
import {
  archiveCustomerQuoteAction,
  reopenCustomerQuoteAction,
  type QuoteStatusTransitionState,
} from "./actions";

const INITIAL_STATE: QuoteStatusTransitionState = { ok: true, message: "" };

export function CustomerQuoteStatusCtas({
  quoteId,
  status,
  disabled,
}: {
  quoteId: string;
  status: QuoteStatus;
  disabled?: boolean;
}) {
  const canReopen = status === "lost" || status === "cancelled";
  const canArchive = status !== "cancelled";

  const reopenAction = useMemo(
    () => reopenCustomerQuoteAction.bind(null, quoteId),
    [quoteId],
  );
  const [reopenState, reopenFormAction] = useFormState<
    QuoteStatusTransitionState,
    FormData
  >(reopenAction, INITIAL_STATE);

  const archiveAction = useMemo(
    () => archiveCustomerQuoteAction.bind(null, quoteId),
    [quoteId],
  );
  const [archiveState, archiveFormAction] = useFormState<
    QuoteStatusTransitionState,
    FormData
  >(archiveAction, INITIAL_STATE);

  if (disabled) {
    return null;
  }

  if (!canReopen && !canArchive) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {canReopen ? (
        <form
          action={reopenFormAction}
          onSubmit={(event) => {
            const confirmed = window.confirm(
              "Reopen this RFQ?\n\nReopening means invited suppliers can bid again.",
            );
            if (!confirmed) {
              event.preventDefault();
            }
          }}
          className="flex items-center gap-2"
        >
          <StatusButton className={clsx(infoCtaClasses, "whitespace-nowrap")}>Reopen</StatusButton>
          <InlineState state={reopenState} />
        </form>
      ) : null}

      {canArchive ? (
        <form
          action={archiveFormAction}
          onSubmit={(event) => {
            const confirmed = window.confirm(
              "Archive this RFQ?\n\nArchiving hides it from active lists, but keeps its timeline and files available.",
            );
            if (!confirmed) {
              event.preventDefault();
            }
          }}
          className="flex items-center gap-2"
        >
          <StatusButton className={clsx(dangerCtaClasses, "whitespace-nowrap")}>Archive</StatusButton>
          <InlineState state={archiveState} />
        </form>
      ) : null}
    </div>
  );
}

function StatusButton({
  className,
  children,
}: {
  className: string;
  children: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={clsx(className, pending ? "cursor-not-allowed opacity-70" : null)}
    >
      {pending ? "Working..." : children}
    </button>
  );
}

function InlineState({ state }: { state: QuoteStatusTransitionState }) {
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
