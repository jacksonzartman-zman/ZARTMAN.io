/**
 * Phase 1 Polish checklist
 * - Done: Standard empty-state card primitive (headline + one-line guidance + optional action)
 */

import clsx from "clsx";
import Link from "next/link";
import type { ReactNode } from "react";

type EmptyStateTone = "neutral" | "info" | "success" | "warning";

export type EmptyStateCardProps = {
  title: string;
  description: string;
  tone?: EmptyStateTone;
  action?: { label: string; href: string } | null;
  secondaryAction?: { label: string; href: string } | null;
  className?: string;
  footer?: ReactNode;
};

export function EmptyStateCard({
  title,
  description,
  tone = "neutral",
  action,
  secondaryAction,
  className,
  footer,
}: EmptyStateCardProps) {
  const toneClasses =
    tone === "success"
      ? "border-emerald-500/30 bg-emerald-500/5"
      : tone === "info"
        ? "border-blue-500/30 bg-blue-500/5"
        : tone === "warning"
          ? "border-amber-500/30 bg-amber-500/5"
          : "border-dashed border-slate-800/70 bg-black/30";

  return (
    <section className={clsx("rounded-2xl border px-5 py-4", toneClasses, className)}>
      <p className="text-base font-semibold text-slate-100">{title}</p>
      <p className="mt-1 text-sm text-slate-400">{description}</p>
      {action || secondaryAction ? (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {action ? (
            <ActionLink
              href={action.href}
              className="inline-flex items-center justify-center rounded-full bg-emerald-500 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-black transition hover:bg-emerald-400"
            >
              {action.label}
            </ActionLink>
          ) : null}
          {secondaryAction ? (
            <ActionLink
              href={secondaryAction.href}
              className="inline-flex items-center justify-center rounded-full border border-slate-700 bg-slate-950/40 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-200 transition hover:border-slate-500 hover:text-white"
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

