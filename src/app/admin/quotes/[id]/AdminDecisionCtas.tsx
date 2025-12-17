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
  archiveAdminQuoteAction,
  reopenAdminQuoteAction,
  type QuoteStatusTransitionState,
} from "./actions";

const INITIAL_STATE: QuoteStatusTransitionState = { ok: true, message: "" };

type AdminDecisionCtasProps = {
  quoteId: string;
  status: QuoteStatus;
  awardAnchorId?: string;
  showAwardLink?: boolean;
  className?: string;
};

export function AdminDecisionCtas({
  quoteId,
  status,
  awardAnchorId = "bids-panel",
  showAwardLink = true,
  className,
}: AdminDecisionCtasProps) {
  const canReopen = status === "lost" || status === "cancelled";
  const canArchive = status !== "cancelled";

  const reopenAction = useMemo(
    () => reopenAdminQuoteAction.bind(null, quoteId),
    [quoteId],
  );
  const [reopenState, reopenFormAction] = useFormState<
    QuoteStatusTransitionState,
    FormData
  >(reopenAction, INITIAL_STATE);

  const archiveAction = useMemo(
    () => archiveAdminQuoteAction.bind(null, quoteId),
    [quoteId],
  );
  const [archiveState, archiveFormAction] = useFormState<
    QuoteStatusTransitionState,
    FormData
  >(archiveAction, INITIAL_STATE);

  return (
    <div className={clsx("flex flex-wrap items-center gap-2", className)}>
      {showAwardLink ? (
        <a
          href={`#${awardAnchorId}`}
          className={clsx(primaryCtaClasses, "whitespace-nowrap")}
        >
          Award
        </a>
      ) : null}

      <form
        action={reopenFormAction}
        onSubmit={(event) => {
          if (!canReopen) {
            event.preventDefault();
            return;
          }
          const confirmed = window.confirm(
            "Reopen this RFQ?\n\nReopening means invited suppliers can bid again.",
          );
          if (!confirmed) {
            event.preventDefault();
          }
        }}
        className="flex items-center gap-2"
      >
        <StatusButton
          disabled={!canReopen}
          className={clsx(infoCtaClasses, "whitespace-nowrap")}
        >
          Reopen
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
            "Archive this RFQ?\n\nArchiving hides it from active lists, but keeps its timeline and files available.",
          );
          if (!confirmed) {
            event.preventDefault();
          }
        }}
        className="flex items-center gap-2"
      >
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

