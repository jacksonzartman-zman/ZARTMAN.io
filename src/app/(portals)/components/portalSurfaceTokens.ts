import clsx from "clsx";

/**
 * Portal surface tokens (UI-only).
 *
 * These are intentionally string tokens so we can reuse them across
 * pages, cards, loading states, and list/table shells without
 * introducing layout shifts or styling drift.
 */
export const PORTAL_SURFACE_CARD =
  "rounded-2xl border border-slate-800/60 bg-slate-950/45 shadow-[0_8px_24px_rgba(2,6,23,0.28)]";

export const PORTAL_SURFACE_CARD_INTERACTIVE = clsx(
  "transition duration-200 ease-out motion-reduce:transition-none",
  "hover:border-slate-700/70 hover:bg-slate-950/55 hover:shadow-[0_10px_30px_rgba(2,6,23,0.34)]",
  "active:border-slate-700/65 active:bg-slate-950/52 active:shadow-[0_7px_20px_rgba(2,6,23,0.26)]",
  "focus-within:border-slate-600/80 focus-within:ring-1 focus-within:ring-slate-200/15",
);

/**
 * Secondary / supporting portal panels.
 * Intentionally quieter than the primary surface to reinforce hierarchy.
 *
 * NOTE: `PortalCard` applies `PORTAL_SURFACE_CARD_INTERACTIVE` by default, so this token is
 * designed to be passed via `className` to override the heavier background + shadow.
 */
export const PORTAL_SURFACE_CARD_INTERACTIVE_QUIET =
  "border-slate-900/40 bg-slate-950/18 shadow-[0_4px_14px_rgba(2,6,23,0.14)] hover:border-slate-900/50 hover:bg-slate-950/22 hover:shadow-[0_6px_18px_rgba(2,6,23,0.16)] active:border-slate-900/45 active:bg-slate-950/20 active:shadow-[0_3px_12px_rgba(2,6,23,0.12)] focus-within:border-slate-800/60 focus-within:ring-slate-200/10";

export const PORTAL_SURFACE_HEADER = clsx(
  PORTAL_SURFACE_CARD,
  "rounded-3xl border-slate-900/60 bg-slate-950/35 shadow-[0_10px_24px_rgba(2,6,23,0.35)]",
);

