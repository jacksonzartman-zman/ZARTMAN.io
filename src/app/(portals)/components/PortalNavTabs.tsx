"use client";

import clsx from "clsx";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";

export type PortalNavLink = {
  label: string;
  href: string;
  badge?: ReactNode;
};

type PortalNavTabsProps = {
  links: PortalNavLink[];
  moreLinks?: PortalNavLink[];
  moreLabel?: string;
  currentPath: string;
  className?: string;
  linkClassName?: string;
  isActive?: (href: string, currentPath: string) => boolean;
};

export function PortalNavTabs({
  links,
  moreLinks,
  moreLabel = "More",
  currentPath,
  className,
  linkClassName,
  isActive,
}: PortalNavTabsProps) {
  const hasPrimaryLinks = links.length > 0;
  const hasMoreLinks = Boolean(moreLinks && moreLinks.length > 0);
  if (!hasPrimaryLinks && !hasMoreLinks) {
    return null;
  }

  const path = currentPath || "/";
  const resolveActive =
    isActive ??
    ((href: string, pathname: string) => defaultIsPortalNavLinkActive(pathname, href));

  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function handleClick(event: MouseEvent) {
      if (!moreRef.current?.contains(event.target as Node)) {
        setMoreOpen(false);
      }
    }
    if (moreOpen) {
      document.addEventListener("mousedown", handleClick);
    }
    return () => document.removeEventListener("mousedown", handleClick);
  }, [moreOpen]);

  useEffect(() => {
    setMoreOpen(false);
  }, [path]);

  const moreLinksActive = (moreLinks ?? []).some((link) =>
    resolveActive(link.href, path),
  );

  return (
    <nav
      className={clsx(
        "flex flex-wrap items-center gap-2 text-sm font-medium text-slate-400",
        className,
      )}
    >
      {links.map((link) => {
        const active = resolveActive(link.href, path);
        return (
          <Link
            key={link.href}
            href={link.href}
            className={clsx(
              "inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300",
              active ? "bg-slate-900 text-white" : "text-slate-400 hover:text-white",
              linkClassName,
            )}
          >
            <span>{link.label}</span>
            {link.badge ?? null}
          </Link>
        );
      })}

      {hasMoreLinks ? (
        <div className="relative" ref={moreRef}>
          <button
            type="button"
            onClick={() => setMoreOpen((prev) => !prev)}
            className={clsx(
              "inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300",
              moreLinksActive || moreOpen
                ? "bg-slate-900 text-white"
                : "text-slate-400 hover:text-white",
              linkClassName,
            )}
            aria-haspopup="menu"
            aria-expanded={moreOpen}
          >
            <span>{moreLabel}</span>
            <svg
              className={clsx(
                "h-4 w-4 transition-transform",
                moreOpen ? "rotate-180" : "rotate-0",
              )}
              viewBox="0 0 20 20"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M5 7l5 5 5-5"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>

          {moreOpen ? (
            <div className="absolute left-0 z-50 mt-2 w-64 rounded-2xl border border-slate-900 bg-slate-950/95 p-2 text-sm shadow-lg shadow-black/40">
              {(moreLinks ?? []).map((link) => {
                const active = resolveActive(link.href, path);
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    onClick={() => setMoreOpen(false)}
                    className={clsx(
                      "flex items-center justify-between gap-3 rounded-xl px-3 py-2 font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300",
                      active
                        ? "bg-slate-900/70 text-white"
                        : "text-slate-200 hover:bg-slate-900/50 hover:text-white",
                    )}
                  >
                    <span>{link.label}</span>
                    {link.badge ?? null}
                  </Link>
                );
              })}
            </div>
          ) : null}
        </div>
      ) : null}
    </nav>
  );
}

export function defaultIsPortalNavLinkActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
