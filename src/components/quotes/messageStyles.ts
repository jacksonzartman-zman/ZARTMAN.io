import type { QuoteMessageSenderRole } from "@/server/quotes/messages";

const AUTHOR_BADGE_BASE_CLASSES =
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide";

const AUTHOR_BADGE_VARIANTS: Record<QuoteMessageSenderRole, string> = {
  admin: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  customer: "border-sky-500/40 bg-sky-500/10 text-sky-300",
  supplier: "border-amber-500/40 bg-amber-500/10 text-amber-200",
  system: "border-slate-500/30 bg-slate-500/10 text-slate-300",
};

export const QUOTE_AUTHOR_LABELS: Record<QuoteMessageSenderRole, string> = {
  admin: "Admin",
  customer: "Customer",
  supplier: "Supplier",
  system: "System",
};

const MESSAGE_BUBBLE_VARIANTS: Record<QuoteMessageSenderRole, string> = {
  admin:
    "bg-emerald-400 text-slate-950 border border-emerald-300/70 shadow-lift-sm",
  customer: "bg-slate-900 text-slate-100 border border-slate-800/80",
  supplier: "bg-blue-500/80 text-slate-950 border border-blue-300/70",
  system: "bg-slate-900/60 text-slate-200 border border-slate-700/60",
};

export function getAuthorBadgeClasses(type: QuoteMessageSenderRole): string {
  return `${AUTHOR_BADGE_BASE_CLASSES} ${
    AUTHOR_BADGE_VARIANTS[type] ?? AUTHOR_BADGE_VARIANTS.admin
  }`;
}

export function getMessageBubbleClasses(
  type: QuoteMessageSenderRole,
): string {
  return MESSAGE_BUBBLE_VARIANTS[type] ?? MESSAGE_BUBBLE_VARIANTS.customer;
}
