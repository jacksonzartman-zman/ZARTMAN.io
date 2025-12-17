import clsx from "clsx";
import Link from "next/link";
import type { ReactNode } from "react";
import type { PrimaryAction, QuoteActorRole } from "@/lib/quote/resolvePrimaryAction";
import {
  infoCtaClasses,
  primaryCtaClasses,
  secondaryCtaClasses,
  ctaSizeClasses,
} from "@/lib/ctas";

export type QuoteAtAGlancePillTone = "neutral" | "info" | "success" | "warning";

export type QuoteAtAGlancePill = {
  key: string;
  label: string;
  value: string;
  tone?: QuoteAtAGlancePillTone;
  href?: string;
};

export function QuoteAtAGlanceBar({
  role,
  statusLabel,
  whatsNext,
  pills,
  primaryAction,
  className,
}: {
  role: QuoteActorRole;
  statusLabel: string;
  whatsNext: ReactNode;
  pills: QuoteAtAGlancePill[];
  primaryAction: PrimaryAction;
  className?: string;
}) {
  const statusBadgeClasses =
    role === "supplier"
      ? "border-blue-400/40 bg-blue-500/10 text-blue-100"
      : "border-emerald-500/40 bg-emerald-500/10 text-emerald-200";

  const ctaClasses =
    primaryAction.tone === "blue"
      ? infoCtaClasses
      : primaryAction.tone === "slate"
        ? clsx(secondaryCtaClasses, "border-slate-700/70 text-slate-200 hover:bg-slate-900/40")
        : primaryCtaClasses;

  return (
    <section
      className={clsx(
        "sticky top-4 z-30 rounded-2xl border border-slate-800 bg-slate-950/60 px-5 py-4 backdrop-blur",
        className,
      )}
      aria-label="Quote at a glance"
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className={clsx("rounded-full border px-3 py-1 text-xs font-semibold", statusBadgeClasses)}>
              {statusLabel}
            </span>
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              What&apos;s next
            </span>
          </div>
          <div className="text-sm text-slate-300">{whatsNext}</div>
          <div className="overflow-x-auto pb-1">
            <div className="flex min-w-max flex-wrap gap-2">
              {pills.map((pill) => (
                <Pill key={pill.key} pill={pill} />
              ))}
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-start gap-2 lg:justify-end">
          <PrimaryLink href={primaryAction.href} className={clsx(ctaClasses, ctaSizeClasses.sm, "whitespace-nowrap")}>
            {primaryAction.label}
          </PrimaryLink>
        </div>
      </div>
    </section>
  );
}

function PrimaryLink({
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

function Pill({ pill }: { pill: QuoteAtAGlancePill }) {
  const tone = pill.tone ?? "neutral";
  const base = "rounded-full border px-3 py-1 text-[11px] font-semibold";
  const classes =
    tone === "success"
      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
      : tone === "info"
        ? "border-blue-500/30 bg-blue-500/10 text-blue-100"
        : tone === "warning"
          ? "border-amber-500/30 bg-amber-500/10 text-amber-100"
          : "border-slate-800 bg-slate-950/50 text-slate-200";

  const content = (
    <span className="whitespace-nowrap">
      <span className="text-slate-400">{pill.label}: </span>
      <span className="text-slate-100">{pill.value}</span>
    </span>
  );

  if (pill.href) {
    return (
      <PrimaryLink
        href={pill.href}
        className={clsx(base, classes, "hover:border-emerald-400 hover:text-emerald-100")}
      >
        {content}
      </PrimaryLink>
    );
  }

  return <span className={clsx(base, classes)}>{content}</span>;
}

