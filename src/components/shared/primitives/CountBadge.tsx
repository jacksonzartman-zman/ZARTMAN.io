import clsx from "clsx";
import type { HTMLAttributes, ReactNode } from "react";

export type CountBadgeTone = "neutral" | "info" | "warning";
export type CountBadgeSize = "sm" | "md";

export function CountBadge({
  children,
  tone = "info",
  size = "sm",
  className,
  ...props
}: {
  children: ReactNode;
  tone?: CountBadgeTone;
  size?: CountBadgeSize;
  className?: string;
} & Omit<HTMLAttributes<HTMLSpanElement>, "children">) {
  const toneClass =
    tone === "warning" ? "pill-warning" : tone === "neutral" ? "pill-muted" : "pill-info";
  const sizeClass = size === "sm" ? "px-2" : "";

  return (
    <span {...props} className={clsx("pill", sizeClass, toneClass, className)}>
      {children}
    </span>
  );
}

