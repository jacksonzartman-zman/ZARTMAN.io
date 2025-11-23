import type { QuoteMessageAuthorType } from "@/server/quotes/messages";

const AUTHOR_BADGE_BASE_CLASSES =
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide";

const AUTHOR_BADGE_VARIANTS: Record<QuoteMessageAuthorType, string> = {
  admin: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  customer: "border-sky-500/40 bg-sky-500/10 text-sky-300",
  supplier: "border-amber-500/40 bg-amber-500/10 text-amber-200",
};

export const QUOTE_AUTHOR_LABELS: Record<QuoteMessageAuthorType, string> = {
  admin: "Admin",
  customer: "Customer",
  supplier: "Supplier",
};

const MESSAGE_BUBBLE_VARIANTS: Record<QuoteMessageAuthorType, string> = {
  admin:
    "bg-emerald-400 text-slate-950 border border-emerald-300/70 shadow-lift-sm",
  customer: "bg-slate-900 text-slate-100 border border-slate-800/80",
  supplier: "bg-blue-500/80 text-slate-950 border border-blue-300/70",
};

export function getAuthorBadgeClasses(type: QuoteMessageAuthorType): string {
  return `${AUTHOR_BADGE_BASE_CLASSES} ${
    AUTHOR_BADGE_VARIANTS[type] ?? AUTHOR_BADGE_VARIANTS.admin
  }`;
}

export function getMessageBubbleClasses(type: QuoteMessageAuthorType): string {
  return MESSAGE_BUBBLE_VARIANTS[type] ?? MESSAGE_BUBBLE_VARIANTS.customer;
}
