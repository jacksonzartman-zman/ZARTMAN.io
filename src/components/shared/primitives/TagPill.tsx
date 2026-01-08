import clsx from "clsx";
import type { HTMLAttributes, ReactNode } from "react";

export type TagPillTone = "slate" | "blue" | "amber" | "emerald" | "red" | "purple";
export type TagPillSize = "sm" | "md";
export type TagPillBorderStyle = "solid" | "dashed";

export function TagPill({
  children,
  tone = "slate",
  size = "sm",
  borderStyle = "solid",
  className,
  ...props
}: {
  children: ReactNode;
  tone?: TagPillTone;
  size?: TagPillSize;
  borderStyle?: TagPillBorderStyle;
  className?: string;
} & Omit<HTMLAttributes<HTMLSpanElement>, "children">) {
  const toneClasses =
    tone === "blue"
      ? "border-blue-500/30 bg-blue-500/10 text-blue-100"
      : tone === "amber"
        ? "border-amber-500/30 bg-amber-500/10 text-amber-100"
        : tone === "emerald"
          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-100"
          : tone === "red"
            ? "border-red-500/30 bg-red-500/10 text-red-100"
            : tone === "purple"
              ? "border-purple-500/30 bg-purple-500/10 text-purple-100"
              : "border-slate-800 bg-slate-950/40 text-slate-200";

  const sizeClasses =
    size === "md" ? "px-3 py-1 text-[11px]" : "px-2 py-0.5 text-[10px]";

  return (
    <span
      {...props}
      className={clsx(
        "inline-flex items-center rounded-full border font-semibold uppercase tracking-wide",
        borderStyle === "dashed" && "border-dashed bg-slate-950/20",
        sizeClasses,
        toneClasses,
        className,
      )}
    >
      {children}
    </span>
  );
}

