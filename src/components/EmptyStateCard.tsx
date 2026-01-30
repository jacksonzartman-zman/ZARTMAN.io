/**
 * Phase 1 Polish checklist
 * - Done: Standard empty-state card primitive (headline + one-line guidance + optional action)
 */

import clsx from "clsx";
import Link from "next/link";
import type { ReactNode } from "react";
import { infoCtaClasses, primaryCtaClasses, secondaryCtaClasses } from "@/lib/ctas";

type EmptyStateTone = "neutral" | "info" | "success" | "warning";

export type EmptyStateCardProps = {
  title: string;
  description: string;
  tone?: EmptyStateTone;
  actionVariant?: "primary" | "info" | "secondary";
  action?: { label: string; href: string } | null;
  secondaryAction?: { label: string; href: string } | null;
  className?: string;
  footer?: ReactNode;
};

export function EmptyStateCard({
  title,
  description,
  tone = "neutral",
  actionVariant,
  action,
  secondaryAction,
  className,
  footer,
}: EmptyStateCardProps) {
  const toneClasses =
    tone === "success"
      ? "border-emerald-500/25 bg-emerald-500/5"
      : tone === "info"
        ? "border-blue-500/25 bg-blue-500/5"
        : tone === "warning"
          ? "border-amber-500/25 bg-amber-500/5"
          : "border-slate-900/60 bg-slate-950/30";

  const primaryActionClasses = (() => {
    if (actionVariant === "info" || tone === "info") {
      return infoCtaClasses;
    }
    if (actionVariant === "secondary") {
      return secondaryCtaClasses;
    }
    return primaryCtaClasses;
  })();

  return (
    <section className={clsx("rounded-2xl border px-5 py-4", toneClasses, className)}>
      <p className="text-sm font-semibold text-slate-100">{title}</p>
      <p className="mt-1 text-sm text-slate-400">{description}</p>
      {action || secondaryAction ? (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {action ? (
            <ActionLink
              href={action.href}
              className={clsx(primaryActionClasses, "text-xs font-semibold uppercase tracking-wide")}
            >
              {action.label}
            </ActionLink>
          ) : null}
          {secondaryAction ? (
            <ActionLink
              href={secondaryAction.href}
              className={clsx(
                secondaryCtaClasses,
                "text-xs font-semibold uppercase tracking-wide",
              )}
            >
              {secondaryAction.label}
            </ActionLink>
          ) : null}
        </div>
      ) : null}
      {footer ? <div className="mt-4">{footer}</div> : null}
    </section>
  );
}

function ActionLink({
  href,
  className,
  children,
}: {
  href: string;
  className: string;
  children: ReactNode;
}) {
  if (href.startsWith("#")) {
    return (
      <a href={href} className={className}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
}

