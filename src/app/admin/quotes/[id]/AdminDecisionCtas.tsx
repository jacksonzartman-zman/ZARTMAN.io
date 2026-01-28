"use client";

import clsx from "clsx";
import { useMemo } from "react";
import { useFormState, useFormStatus } from "react-dom";
import type { QuoteStatus } from "@/server/quotes/status";
import {
  ActionGroup,
  ActionGroupSection,
  ActionPillButton,
  ActionPillLink,
} from "@/components/actions/ActionGroup";
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
    <ActionGroup className={className}>
      <ActionGroupSection title="Quote actions">
        {showAwardLink ? (
          <ActionPillLink
            href={`#${awardAnchorId}`}
            className="border-emerald-400/50 bg-emerald-500/10 text-emerald-100 hover:bg-emerald-500/20 focus-visible:outline-emerald-400"
          >
            Award
          </ActionPillLink>
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
          className="w-full space-y-1"
        >
          <StatusPillButton
            disabled={!canReopen}
            className="border-blue-400/70 bg-blue-500/10 text-blue-100 hover:bg-blue-500/20 focus-visible:outline-blue-300"
          >
            Reopen
          </StatusPillButton>
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
          className="w-full space-y-1"
        >
          <StatusPillButton
            disabled={!canArchive}
            className="border-red-400/60 bg-red-500/10 text-red-100 hover:bg-red-500/20 focus-visible:outline-red-300"
          >
            Archive
          </StatusPillButton>
          <InlineState state={archiveState} />
        </form>
      </ActionGroupSection>
    </ActionGroup>
  );
}

function StatusPillButton({
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
    <ActionPillButton
      type="submit"
      disabled={isDisabled}
      className={clsx(
        className,
        "items-center justify-center text-center",
        isDisabled ? "cursor-not-allowed opacity-70" : null,
      )}
    >
      {pending ? "Working..." : children}
    </ActionPillButton>
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

