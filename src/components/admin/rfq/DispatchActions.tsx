"use client";

import type { ReactNode } from "react";
import type { DispatchReadinessResult, EffectiveDispatchMode } from "@/lib/ops/dispatchReadiness";

type DispatchActionsProps = {
  dispatchMode: EffectiveDispatchMode;
  dispatchReadiness: DispatchReadinessResult;
  pending: boolean;
  isEmailGenerating?: boolean;
  isWebFormGenerating?: boolean;
  providerEmail?: string;
  webFormUrl?: string;
  onCopyEmail?: () => void;
  onCopyMailto?: () => void;
  onCopyInstructions?: () => void;
  onMarkSubmitted?: () => void;
  onDispatchStarted?: () => void;
};

export function DispatchActions({
  dispatchMode,
  dispatchReadiness,
  pending,
  isEmailGenerating = false,
  isWebFormGenerating = false,
  providerEmail,
  webFormUrl,
  onCopyEmail,
  onCopyMailto,
  onCopyInstructions,
  onMarkSubmitted,
  onDispatchStarted,
}: DispatchActionsProps) {
  const isEmailMode = dispatchMode === "email";
  const isMailtoMode = dispatchMode === "mailto";
  const isWebFormMode = dispatchMode === "web_form";
  const isDispatchReady = dispatchReadiness.isReady;
  const blockingReasonsTitle = dispatchReadiness.blockingReasons
    .map((reason) => `- ${reason}`)
    .join("\n");

  const dispatchPrimaryButtonBase =
    "rounded-full border border-indigo-500/40 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-indigo-100 transition";
  const dispatchPrimaryEnabledClass = `${dispatchPrimaryButtonBase} hover:border-indigo-400 hover:text-white`;
  const dispatchPrimaryDisabledClass = `${dispatchPrimaryButtonBase} cursor-not-allowed opacity-60`;
  const dispatchSecondaryButtonBase =
    "rounded-full border border-slate-700 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-200 transition";
  const dispatchSecondaryEnabledClass = `${dispatchSecondaryButtonBase} hover:border-slate-500 hover:text-white`;
  const dispatchSecondaryDisabledClass = `${dispatchSecondaryButtonBase} cursor-not-allowed opacity-60`;
  const markSubmittedButtonBase =
    "rounded-full border border-teal-500/40 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-teal-100 transition";
  const markSubmittedEnabledClass = `${markSubmittedButtonBase} hover:border-teal-400 hover:text-white`;
  const markSubmittedDisabledClass = `${markSubmittedButtonBase} cursor-not-allowed opacity-60`;

  const handleExecution = (action?: () => void) => {
    if (!action) return;
    onDispatchStarted?.();
    action();
  };

  const renderDisabledPrimary = (label: string) => (
    <span title={blockingReasonsTitle} className="inline-flex">
      <button type="button" disabled className={dispatchPrimaryDisabledClass}>
        {label}
      </button>
    </span>
  );

  const renderMailtoButton = (buttonClass: string, disabled: boolean) => (
    <span title={providerEmail ? "" : "Provider email unavailable."} className="inline-flex">
      <button
        type="button"
        onClick={() => handleExecution(onCopyMailto)}
        disabled={disabled}
        className={buttonClass}
      >
        Copy mailto
      </button>
    </span>
  );

  let primaryAction: ReactNode = null;
  let secondaryAction: ReactNode = null;
  let markSubmittedAction: ReactNode = null;

  if (!isDispatchReady) {
    const label = isEmailMode
      ? "Copy email"
      : isMailtoMode
        ? "Copy mailto"
        : isWebFormMode
          ? "Open form"
          : "Dispatch unavailable";
    primaryAction = renderDisabledPrimary(label);
  } else if (isEmailMode) {
    primaryAction = (
      <button
        type="button"
        onClick={() => handleExecution(onCopyEmail)}
        disabled={pending || isEmailGenerating}
        className={
          pending || isEmailGenerating ? dispatchPrimaryDisabledClass : dispatchPrimaryEnabledClass
        }
      >
        {isEmailGenerating ? "Copying..." : "Copy email"}
      </button>
    );
  } else if (isMailtoMode) {
    const disabled = pending || isEmailGenerating || !providerEmail;
    primaryAction = renderMailtoButton(
      disabled ? dispatchPrimaryDisabledClass : dispatchPrimaryEnabledClass,
      disabled,
    );
  } else if (isWebFormMode && webFormUrl) {
    primaryAction = (
      <a
        href={webFormUrl}
        target="_blank"
        rel="noreferrer"
        onClick={(event) => {
          if (pending) {
            event.preventDefault();
            return;
          }
          onDispatchStarted?.();
        }}
        className={pending ? dispatchPrimaryDisabledClass : dispatchPrimaryEnabledClass}
      >
        Open form
      </a>
    );
  } else {
    primaryAction = (
      <button type="button" disabled className={dispatchPrimaryDisabledClass}>
        Dispatch unavailable
      </button>
    );
  }

  if (isEmailMode) {
    const disabled = pending || isEmailGenerating || !providerEmail;
    secondaryAction = renderMailtoButton(
      disabled ? dispatchSecondaryDisabledClass : dispatchSecondaryEnabledClass,
      disabled,
    );
  } else if (isWebFormMode) {
    secondaryAction = (
      <button
        type="button"
        onClick={() => handleExecution(onCopyInstructions)}
        disabled={pending || isWebFormGenerating}
        className={
          pending || isWebFormGenerating
            ? dispatchSecondaryDisabledClass
            : dispatchSecondaryEnabledClass
        }
      >
        {isWebFormGenerating ? "Copying..." : "Copy instructions"}
      </button>
    );
  }

  if (onMarkSubmitted && (isEmailMode || isMailtoMode || isWebFormMode)) {
    markSubmittedAction = (
      <button
        type="button"
        onClick={onMarkSubmitted}
        disabled={pending}
        className={pending ? markSubmittedDisabledClass : markSubmittedEnabledClass}
      >
        Mark submitted
      </button>
    );
  }

  return (
    <>
      {primaryAction}
      {secondaryAction}
      {markSubmittedAction}
    </>
  );
}
