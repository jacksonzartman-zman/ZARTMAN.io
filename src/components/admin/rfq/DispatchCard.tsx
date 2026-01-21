"use client";

import clsx from "clsx";
import type { ReactNode } from "react";

type DispatchMode = "email" | "mailto" | "web_form" | "api" | "unknown";
type DispatchStatus = "not_started" | "in_progress" | "submitted" | "offer_received";

type DispatchCardProps = {
  providerLabel: string;
  providerTypeLabel?: string | null;
  providerModeLabel?: string | null;
  dispatchMode: DispatchMode;
  dispatchStatus: DispatchStatus;
  dispatchStartedLabel: string;
  submittedLabel: string;
  submittedMetaLabel?: string;
  lastUpdateLabel: string;
  offerSummary: string | null;
  errorMessage?: string | null;
  primaryAction: ReactNode;
  secondaryAction: ReactNode;
  markSubmittedAction?: ReactNode;
  extraActions?: ReactNode;
  leadingControl?: ReactNode;
  statusBadgeAddon?: ReactNode;
};

const BADGE_BASE_CLASS =
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide";

const DISPATCH_MODE_META: Record<DispatchMode, { label: string; className: string }> = {
  email: {
    label: "Email",
    className: "border-indigo-500/40 bg-indigo-500/10 text-indigo-100",
  },
  mailto: {
    label: "Mailto",
    className: "border-indigo-500/40 bg-indigo-500/10 text-indigo-100",
  },
  web_form: {
    label: "Web form",
    className: "border-amber-500/40 bg-amber-500/10 text-amber-100",
  },
  api: {
    label: "API",
    className: "border-slate-700 bg-slate-900/60 text-slate-200",
  },
  unknown: {
    label: "Dispatch",
    className: "border-slate-700 bg-slate-900/60 text-slate-200",
  },
};

const DISPATCH_STATUS_META: Record<DispatchStatus, { label: string; className: string }> = {
  not_started: {
    label: "Not started",
    className: "border-slate-700 bg-slate-900/40 text-slate-200",
  },
  in_progress: {
    label: "In progress",
    className: "border-blue-500/40 bg-blue-500/10 text-blue-100",
  },
  submitted: {
    label: "Submitted",
    className: "border-teal-500/40 bg-teal-500/10 text-teal-100",
  },
  offer_received: {
    label: "Offer received",
    className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-100",
  },
};

export function DispatchCard({
  providerLabel,
  providerTypeLabel,
  providerModeLabel,
  dispatchMode,
  dispatchStatus,
  dispatchStartedLabel,
  submittedLabel,
  submittedMetaLabel,
  lastUpdateLabel,
  offerSummary,
  errorMessage,
  primaryAction,
  secondaryAction,
  markSubmittedAction,
  extraActions,
  leadingControl,
  statusBadgeAddon,
}: DispatchCardProps) {
  const subtitleParts = [providerTypeLabel, providerModeLabel].filter(Boolean);
  const subtitle = subtitleParts.length > 0 ? subtitleParts.join(" · ") : null;
  const dispatchModeMeta = DISPATCH_MODE_META[dispatchMode];
  const dispatchStatusMeta = DISPATCH_STATUS_META[dispatchStatus];
  const submittedMeta = submittedMetaLabel ?? `Submitted: ${submittedLabel}`;
  const hasActions = Boolean(primaryAction || secondaryAction || markSubmittedAction);

  const leadingContent = leadingControl ? (
    <label className="flex items-start gap-3">
      <span className="mt-1">{leadingControl}</span>
      <span>
        <span className="block text-sm font-semibold text-slate-100">{providerLabel}</span>
        {subtitle ? <span className="block text-[11px] text-slate-500">{subtitle}</span> : null}
      </span>
    </label>
  ) : (
    <div>
      <p className="text-sm font-semibold text-slate-100">{providerLabel}</p>
      {subtitle ? <p className="text-[11px] text-slate-500">{subtitle}</p> : null}
    </div>
  );

  return (
    <div className="rounded-2xl border border-slate-900/60 bg-slate-950/60 p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">{leadingContent}</div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex flex-wrap items-center justify-end gap-2">
            <span className={clsx(BADGE_BASE_CLASS, dispatchModeMeta.className)}>
              {dispatchModeMeta.label}
            </span>
            <span className={clsx(BADGE_BASE_CLASS, dispatchStatusMeta.className)}>
              {dispatchStatusMeta.label}
            </span>
            {statusBadgeAddon}
          </div>
        </div>
      </div>

      <div className="mt-3 grid gap-2 text-[11px] text-slate-500 sm:grid-cols-3">
        <div>Dispatch started: {dispatchStartedLabel}</div>
        <div>{submittedMeta}</div>
        <div>Last update: {lastUpdateLabel}</div>
      </div>

      {errorMessage ? (
        <p className="mt-2 text-[11px] text-red-200">Error: {errorMessage}</p>
      ) : null}

      <div className="mt-2 text-[11px] text-slate-400">
        Offer: {offerSummary ?? "No offer yet"}
      </div>

      {hasActions ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {primaryAction}
          {secondaryAction}
          {markSubmittedAction}
        </div>
      ) : null}

      {extraActions ? <div className="mt-3 flex flex-wrap gap-2">{extraActions}</div> : null}
    </div>
  );
}
