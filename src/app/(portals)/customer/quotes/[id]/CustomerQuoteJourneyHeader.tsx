"use client";
import {
  formatQuoteWorkspaceStatusLabel,
  type QuoteWorkspaceStatus,
} from "@/lib/quote/workspaceStatus";
import { StatusPill } from "@/components/shared/primitives/StatusPill";
import { TagPill } from "@/components/shared/primitives/TagPill";
import { ctaSizeClasses, secondaryCtaClasses } from "@/lib/ctas";

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
  nextStepChipText,
  completedChipTexts,
  primaryAction,
}: {
  partName: string;
  status: QuoteWorkspaceStatus;
  nextStepText: string;
  nextStepChipText?: string;
  completedChipTexts?: string[];
  primaryAction?: CustomerQuoteJourneyHeaderPrimaryAction;
}) {
  const safeNextStepChipText =
    typeof nextStepChipText === "string" && nextStepChipText.trim().length > 0
      ? nextStepChipText.trim()
      : null;
  const safeCompletedChipTexts = (Array.isArray(completedChipTexts) ? completedChipTexts : [])
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter(Boolean);

  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-950/60 px-5 py-4 sm:px-6 sm:py-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">
            Quote journey
          </p>
          <h2
            className="truncate text-lg font-semibold text-white heading-tight sm:text-xl"
            title={partName}
          >
            {partName}
          </h2>
          <p className="text-sm text-slate-300">{nextStepText}</p>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <StatusPill status={status} aria-label={formatQuoteWorkspaceStatusLabel(status)} />
          {safeNextStepChipText ? (
            <TagPill size="md" tone="blue" className="normal-case tracking-normal">
              {safeNextStepChipText}
            </TagPill>
          ) : null}
          {safeCompletedChipTexts.length > 0
            ? safeCompletedChipTexts.map((text) => (
                <TagPill
                  key={text}
                  size="md"
                  tone="slate"
                  borderStyle="dashed"
                  className="normal-case tracking-normal text-slate-300"
                >
                  {text}
                </TagPill>
              ))
            : null}
          {primaryAction ? (
            <button
              type="button"
              onClick={primaryAction.onClick}
              className={`${secondaryCtaClasses} ${ctaSizeClasses.sm}`}
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
  fileCount,
  hasWinner,
}: {
  partName: string;
  status: QuoteWorkspaceStatus;
  nextStepText: string;
  fileCount?: number | null;
  hasWinner?: boolean | null;
}) {
  const safeFileCount =
    typeof fileCount === "number" && Number.isFinite(fileCount) ? fileCount : null;
  const hasFiles = safeFileCount === null ? null : safeFileCount > 0;
  const winnerSelected = typeof hasWinner === "boolean" ? hasWinner : null;

  const nextStepTarget =
    status === "awarded" || winnerSelected === true
      ? "checkout"
      : status === "in_review"
        ? "decision"
        : status === "draft"
          ? hasFiles === true
            ? "decision"
            : "uploads"
          : "uploads";

  const completedChipTexts = [
    nextStepTarget !== "uploads" && hasFiles === true ? "Uploads completed" : null,
    nextStepTarget === "checkout" && winnerSelected === true ? "Selection confirmed" : null,
  ].filter((value): value is string => typeof value === "string");

  const primaryAction: CustomerQuoteJourneyHeaderPrimaryAction | undefined =
    nextStepTarget === "uploads"
      ? {
          label: "Complete request",
          onClick: () => {
            scrollToIdWithHash("uploads");
          },
        }
      : nextStepTarget === "decision"
        ? {
            label: "Review offers",
            onClick: () => {
              // Reuse existing bid review navigation (Decision section anchor).
              scrollToIdWithHash("decision");
            },
          }
        : nextStepTarget === "checkout"
          ? {
              label: "View kickoff",
              onClick: () => {
                scrollToIdWithHash("kickoff");
              },
            }
        : undefined;

  return (
    <CustomerQuoteJourneyHeader
      partName={partName}
      status={status}
      nextStepText={nextStepText}
      completedChipTexts={completedChipTexts.length > 0 ? completedChipTexts : undefined}
      primaryAction={primaryAction}
    />
  );
}

