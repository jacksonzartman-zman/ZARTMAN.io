"use client";

import clsx from "clsx";
import {
  formatQuoteWorkspaceStatusLabel,
  type QuoteWorkspaceStatus,
} from "@/lib/quote/workspaceStatus";

export type CustomerQuoteJourneyHeaderPrimaryAction = {
  label: string;
  onClick: () => void;
};

export function CustomerQuoteJourneyHeader({
  partName,
  status,
  nextStepText,
  primaryAction,
}: {
  partName: string;
  status: QuoteWorkspaceStatus;
  nextStepText: string;
  primaryAction?: CustomerQuoteJourneyHeaderPrimaryAction;
}) {
  const statusPillClass =
    status === "awarded"
      ? "pill-success"
      : status === "in_review"
        ? "pill-info"
        : "pill-muted";

  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-950/60 px-6 py-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">
            Quote journey
          </p>
          <h2 className="truncate text-xl font-semibold text-white heading-tight">
            {partName}
          </h2>
          <p className="text-sm text-slate-400">{nextStepText}</p>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <span className={clsx("pill px-3 py-1 uppercase tracking-wide", statusPillClass)}>
            {formatQuoteWorkspaceStatusLabel(status)}
          </span>
          {primaryAction ? (
            <button
              type="button"
              onClick={primaryAction.onClick}
              className="inline-flex items-center rounded-full border border-emerald-400/50 bg-emerald-500/10 px-4 py-2 text-sm font-semibold text-emerald-100 transition hover:bg-emerald-500/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-400"
            >
              {primaryAction.label}
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}

export function CustomerQuoteJourneyHeaderAuto({
  partName,
  status,
  nextStepText,
}: {
  partName: string;
  status: QuoteWorkspaceStatus;
  nextStepText: string;
}) {
  const primaryAction: CustomerQuoteJourneyHeaderPrimaryAction | undefined =
    status === "in_review"
      ? {
          label: "Review bids",
          onClick: () => {
            // Reuse existing bid review navigation (Decision section anchor).
            window.location.hash = "#decision";
            document.getElementById("decision")?.scrollIntoView({
              behavior: "smooth",
              block: "start",
            });
          },
        }
      : status === "awarded"
        ? {
            label: "Proceed to Order",
            onClick: () => {
              // Reuse existing Proceed-to-Order handler by clicking the existing button.
              const button = document.querySelector<HTMLButtonElement>(
                '[data-proceed-to-order="true"]',
              );
              if (button) {
                button.click();
                return;
              }
              window.location.hash = "#checkout";
              document.getElementById("checkout")?.scrollIntoView({
                behavior: "smooth",
                block: "start",
              });
            },
          }
        : undefined;

  return (
    <CustomerQuoteJourneyHeader
      partName={partName}
      status={status}
      nextStepText={nextStepText}
      primaryAction={primaryAction}
    />
  );
}

