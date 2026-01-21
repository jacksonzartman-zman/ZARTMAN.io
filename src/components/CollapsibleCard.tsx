"use client";

import clsx from "clsx";
import type { ReactNode } from "react";
import { useEffect, useId, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

type CollapsibleCardProps = {
  title: string;
  description?: string;
  summary?: ReactNode;
  defaultOpen?: boolean;
  /**
   * When set, keep the open/closed state synced to a URL search param.
   * - Open: sets `<urlParamKey>=1`
   * - Closed: removes `<urlParamKey>`
   *
   * This lets server components decide whether to load expensive data.
   */
  urlParamKey?: string;
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
  urlParamKey,
  children,
  className,
  contentClassName,
  id,
}: CollapsibleCardProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const stableId = useId();
  const panelId = useMemo(
    () => `${stableId}-panel`,
    [stableId],
  );
  const [open, setOpen] = useState(() => {
    if (!urlParamKey) return defaultOpen;
    const value = searchParams?.get(urlParamKey);
    const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
    if (normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on") {
      return true;
    }
    if (normalized === "0" || normalized === "false" || normalized === "no" || normalized === "off") {
      return false;
    }
    return defaultOpen;
  });

  useEffect(() => {
    if (!urlParamKey) return;
    const value = searchParams?.get(urlParamKey);
    const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
    const next =
      normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on"
        ? true
        : normalized === "0" || normalized === "false" || normalized === "no" || normalized === "off"
          ? false
          : null;
    if (next === null) return;
    setOpen((current) => (current === next ? current : next));
  }, [searchParams, urlParamKey]);

  useEffect(() => {
    if (!id) {
      return;
    }
    if (typeof window === "undefined") {
      return;
    }

    const expectedHash = `#${id}`;
    const maybeOpenFromHash = () => {
      if (window.location.hash === expectedHash) {
        setOpen(true);
      }
    };

    maybeOpenFromHash();
    window.addEventListener("hashchange", maybeOpenFromHash);
    return () => window.removeEventListener("hashchange", maybeOpenFromHash);
  }, [id]);

  const setOpenWithUrlSync = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!urlParamKey) return;
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    if (nextOpen) {
      params.set(urlParamKey, "1");
    } else {
      params.delete(urlParamKey);
    }
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

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
        onClick={() => setOpenWithUrlSync(!open)}
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

