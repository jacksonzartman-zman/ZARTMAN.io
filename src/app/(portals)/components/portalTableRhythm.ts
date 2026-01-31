/**
 * Portal table/list rhythm primitives (UI-only).
 *
 * Goal: keep padding, dividers, typography hierarchy, and action alignment
 * consistent across customer + supplier portal tables without changing behavior.
 */
export const PORTAL_DIVIDER = "divide-y divide-slate-800/35";

export const PORTAL_ROW =
  "transition-colors hover:bg-slate-900/15 motion-reduce:transition-none";

export const PORTAL_CELL = "px-6 py-4 align-middle";
export const PORTAL_CELL_RIGHT = `${PORTAL_CELL} text-right`;

export const PORTAL_HEADER_ROW = "border-b border-slate-800/40";
export const PORTAL_TH =
  "px-6 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500";
export const PORTAL_TH_RIGHT = `${PORTAL_TH} text-right`;

export const PORTAL_TITLE =
  "text-sm font-semibold leading-tight text-slate-100";
export const PORTAL_META = "mt-1 text-xs text-slate-500";

export const PORTAL_ACTION_HINT =
  "text-xs font-semibold text-slate-300 whitespace-nowrap";
