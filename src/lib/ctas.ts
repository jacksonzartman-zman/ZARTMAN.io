const CTA_BASE_CLASSES =
  "inline-flex items-center justify-center rounded-full font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-60";

const CTA_SIZE_VARIANTS = {
  md: "px-5 py-2 text-sm",
  sm: "px-4 py-1.5 text-xs",
} as const;

export const ctaSizeClasses = CTA_SIZE_VARIANTS;

export const primaryCtaClasses = `${CTA_BASE_CLASSES} ${CTA_SIZE_VARIANTS.md} bg-emerald-400 text-slate-950 shadow-lift-sm hover:bg-emerald-300 focus-visible:outline-emerald-300`;

export const secondaryCtaClasses = `${CTA_BASE_CLASSES} ${CTA_SIZE_VARIANTS.md} border border-emerald-400/60 bg-transparent text-emerald-200 hover:bg-emerald-400/10 focus-visible:outline-emerald-400`;

export const ghostCtaClasses =
  "inline-flex items-center justify-center rounded-full border border-ink-soft px-4 py-2 text-sm font-medium text-ink transition hover:bg-ink-soft/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";
