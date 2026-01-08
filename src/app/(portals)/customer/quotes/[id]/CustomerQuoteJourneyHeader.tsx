"use client";
import {
  formatQuoteWorkspaceStatusLabel,
  type QuoteWorkspaceStatus,
} from "@/lib/quote/workspaceStatus";
import { StatusPill } from "@/components/shared/primitives/StatusPill";

function getScrollBehavior(): ScrollBehavior {
  if (typeof window === "undefined") return "auto";
  const prefersReducedMotion =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  return prefersReducedMotion ? "auto" : "smooth";
}

function scrollToIdWithHash(id: string) {
  if (typeof window === "undefined") return;
  const nextHash = `#${id}`;
  if (window.location.hash !== nextHash) {
    window.history.replaceState(null, "", nextHash);
    window.dispatchEvent(new Event("hashchange"));
  }
  document.getElementById(id)?.scrollIntoView({
    behavior: getScrollBehavior(),
    block: "start",
  });
}

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
          <StatusPill status={status} aria-label={formatQuoteWorkspaceStatusLabel(status)} />
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
            scrollToIdWithHash("decision");
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
              scrollToIdWithHash("checkout");
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

