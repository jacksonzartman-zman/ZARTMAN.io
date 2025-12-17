"use client";

import clsx from "clsx";
import type { ReactNode } from "react";
import { useEffect, useId, useMemo, useState } from "react";

type DisclosureSectionProps = {
  id: string;
  title: string;
  description?: string;
  summary?: ReactNode;
  defaultOpen?: boolean;
  /** Optional legacy anchors that should also open this disclosure when hashed. */
  hashAliases?: string[];
  className?: string;
  contentClassName?: string;
  children: ReactNode;
};

export function DisclosureSection({
  id,
  title,
  description,
  summary,
  defaultOpen = false,
  hashAliases,
  className,
  contentClassName,
  children,
}: DisclosureSectionProps) {
  const stableId = useId();
  const panelId = useMemo(() => `${stableId}-panel`, [stableId]);
  const [open, setOpen] = useState(defaultOpen);

  useEffect(() => {
    if (!id) return;
    if (typeof window === "undefined") return;

    const expectedHashes = new Set<string>([
      `#${id}`,
      ...(Array.isArray(hashAliases)
        ? hashAliases
            .map((value) => (typeof value === "string" ? value.trim() : ""))
            .filter(Boolean)
            .map((value) => (value.startsWith("#") ? value : `#${value}`))
        : []),
    ]);

    const maybeOpenFromHash = () => {
      if (expectedHashes.has(window.location.hash)) {
        setOpen(true);
      }
    };

    maybeOpenFromHash();
    window.addEventListener("hashchange", maybeOpenFromHash);
    return () => window.removeEventListener("hashchange", maybeOpenFromHash);
  }, [hashAliases, id]);

  const aliasIds = Array.isArray(hashAliases)
    ? hashAliases
        .map((value) => (typeof value === "string" ? value.trim() : ""))
        .filter(Boolean)
        .map((value) => (value.startsWith("#") ? value.slice(1) : value))
        .filter((value) => value !== id)
    : [];

  return (
    <section
      id={id}
      className={clsx(
        "rounded-2xl border border-slate-800 bg-slate-950/60",
        className,
      )}
    >
      {aliasIds.length > 0 ? (
        <div aria-hidden="true">
          {aliasIds.map((alias) => (
            <span key={alias} id={alias} className="block scroll-mt-24" />
          ))}
        </div>
      ) : null}

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
          <ChevronIcon
            className={clsx(
              "h-5 w-5 text-slate-400 transition",
              open ? "rotate-180" : "rotate-0",
            )}
          />
        </div>
      </button>

      <div id={panelId} className={clsx(open ? "block" : "hidden")} aria-hidden={!open}>
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

