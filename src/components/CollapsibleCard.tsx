"use client";

import clsx from "clsx";
import type { ReactNode } from "react";
import { useId, useMemo, useState } from "react";

type CollapsibleCardProps = {
  title: string;
  description?: string;
  summary?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  id?: string;
};

export function CollapsibleCard({
  title,
  description,
  summary,
  defaultOpen = false,
  children,
  className,
  contentClassName,
  id,
}: CollapsibleCardProps) {
  const stableId = useId();
  const panelId = useMemo(
    () => `${stableId}-panel`,
    [stableId],
  );
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section
      id={id}
      className={clsx(
        "rounded-2xl border border-slate-800 bg-slate-950/60",
        className,
      )}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className={clsx(
          "flex w-full items-start justify-between gap-4 px-6 py-5 text-left",
          "focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-400/70",
        )}
      >
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            {title}
          </p>
          {description ? (
            <p className="mt-1 text-sm text-slate-400">{description}</p>
          ) : null}
        </div>
        <div className="flex items-center gap-3">
          {summary ? (
            <div className="hidden text-right text-xs text-slate-300 sm:block">
              {summary}
            </div>
          ) : null}
          <ChevronIcon className={clsx("h-5 w-5 text-slate-400 transition", open ? "rotate-180" : "rotate-0")} />
        </div>
      </button>

      <div
        id={panelId}
        className={clsx(open ? "block" : "hidden")}
        aria-hidden={!open}
      >
        <div className={clsx("border-t border-slate-900 px-6 py-5", contentClassName)}>
          {children}
        </div>
      </div>
    </section>
  );
}

function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M5.5 7.75l4.5 4.5 4.5-4.5"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

