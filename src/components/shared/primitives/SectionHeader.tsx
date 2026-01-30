import clsx from "clsx";
import type { ReactNode } from "react";

export type SectionHeaderVariant = "hero" | "card" | "label";

export function SectionHeader({
  title,
  subtitle,
  kicker,
  variant = "card",
  as,
  className,
  titleClassName,
  subtitleClassName,
  kickerClassName,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  kicker?: ReactNode;
  variant?: SectionHeaderVariant;
  as?: "h2" | "h3" | "p";
  className?: string;
  titleClassName?: string;
  subtitleClassName?: string;
  kickerClassName?: string;
}) {
  const kickerClasses =
    variant === "label"
      ? "text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500"
      : "text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-500";

  const titleClasses =
    variant === "hero"
      ? "text-xl font-semibold text-white heading-tight sm:text-2xl"
      : variant === "label"
        ? "text-sm font-semibold text-slate-100 heading-tight"
        : "text-lg font-semibold text-slate-50 heading-tight";

  const subtitleClasses =
    variant === "label" ? "text-xs text-slate-400" : "text-sm text-slate-300";

  const TitleTag =
    as ?? (variant === "label" ? "p" : variant === "hero" ? "h2" : "h2");

  return (
    <div className={clsx("min-w-0", className)}>
      {kicker ? <p className={clsx(kickerClasses, kickerClassName)}>{kicker}</p> : null}
      <TitleTag
        className={clsx(kicker ? "mt-1" : undefined, titleClasses, titleClassName)}
      >
        {title}
      </TitleTag>
      {subtitle ? <div className={clsx("mt-1", subtitleClasses, subtitleClassName)}>{subtitle}</div> : null}
    </div>
  );
}

