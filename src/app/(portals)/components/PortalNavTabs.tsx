"use client";

import clsx from "clsx";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  isNavHrefActive,
  normalizePathname,
  pickBestActiveHref,
} from "@/lib/navigation/portalNav";

export type PortalNavLink = {
  label: string;
  href: string;
  badge?: ReactNode;
};

type PortalNavTabsProps = {
  links: PortalNavLink[];
  moreLinks?: PortalNavLink[];
  moreLabel?: string;
  maxVisibleLinks?: number;
  currentPath: string;
  className?: string;
  linkClassName?: string;
  isActive?: (href: string, currentPath: string) => boolean;
};

export function PortalNavTabs({
  links,
  moreLinks,
  moreLabel = "More",
  maxVisibleLinks = 4,
  currentPath,
  className,
  linkClassName,
  isActive,
}: PortalNavTabsProps) {
  const path = normalizePathname(currentPath || "/");
  const resolveActive =
    isActive ??
    ((href: string, pathname: string) => isNavHrefActive(pathname, href));

  const dedupeLinksByHref = (input: PortalNavLink[]) => {
    const seen = new Set<string>();
    const output: PortalNavLink[] = [];
    for (const link of input) {
      if (!link || typeof link.href !== "string" || !link.href) continue;
      const href = normalizePathname(link.href);
      if (seen.has(href)) continue;
      seen.add(href);
      output.push({ ...link, href });
    }
    return output;
  };

  const maxVisible = Math.max(0, Math.floor(maxVisibleLinks));

  const primaryLinks = dedupeLinksByHref(links);
  const primaryHrefSet = new Set(primaryLinks.map((link) => link.href));
  const extraMoreLinks = dedupeLinksByHref(
    (moreLinks ?? []).filter((link) => !primaryHrefSet.has(normalizePathname(link.href))),
  );

  const initialVisibleLinks = maxVisible > 0 ? primaryLinks.slice(0, maxVisible) : [];
  const overflowLinks = maxVisible > 0 ? primaryLinks.slice(maxVisible) : primaryLinks;

  const initialMoreLinks = dedupeLinksByHref([...overflowLinks, ...extraMoreLinks]);

  const activeHref = pickBestActiveHref(
    path,
    [...primaryLinks, ...extraMoreLinks].map((link) => link.href),
    (pathname, href) => resolveActive(href, pathname),
  );

  // If the active link is in "More", surface it in the main row so location is obvious.
  const activeInMoreLink =
    activeHref && !initialVisibleLinks.some((link) => link.href === activeHref)
      ? initialMoreLinks.find((link) => link.href === activeHref) ?? null
      : null;

  const visibleLinks =
    activeInMoreLink && initialVisibleLinks.length > 0
      ? [...initialVisibleLinks.slice(0, Math.max(0, maxVisible - 1)), activeInMoreLink]
      : initialVisibleLinks;

  const computedMoreLinks = (() => {
    if (!activeInMoreLink) {
      return initialMoreLinks;
    }
    const remaining = initialMoreLinks.filter((link) => link.href !== activeInMoreLink.href);
    const displaced = initialVisibleLinks.length === maxVisible ? initialVisibleLinks[maxVisible - 1] : null;
    return displaced ? [displaced, ...remaining] : remaining;
  })();

  const hasPrimaryLinks = visibleLinks.length > 0;
  const hasMoreLinks = computedMoreLinks.length > 0;

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

  const moreLinksActive = activeHref
    ? computedMoreLinks.some((link) => link.href === activeHref)
    : computedMoreLinks.some((link) => resolveActive(link.href, path));

  if (!hasPrimaryLinks && !hasMoreLinks) {
    return null;
  }

  return (
    <nav
      className={clsx(
        "flex flex-wrap items-center gap-1 rounded-xl bg-white/[0.015] p-1 text-sm font-medium text-slate-300 ring-1 ring-inset ring-white/[0.08]",
        className,
      )}
    >
      {visibleLinks.map((link) => {
        const active = activeHref ? link.href === activeHref : resolveActive(link.href, path);
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            className={clsx(
              "inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-semibold text-slate-200/90 transition-colors motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-200/50",
              active
                ? "bg-white/[0.07] text-white ring-1 ring-inset ring-white/[0.12]"
                : "hover:bg-white/[0.04] hover:text-white",
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
              "inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-semibold text-slate-200/90 transition-colors motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-200/50",
              moreLinksActive || moreOpen
                ? "bg-white/[0.07] text-white ring-1 ring-inset ring-white/[0.12]"
                : "hover:bg-white/[0.04] hover:text-white",
              linkClassName,
            )}
            aria-haspopup="menu"
            aria-expanded={moreOpen}
            aria-label="More navigation links"
          >
            <span>{moreLabel}</span>
            <svg
              className="h-4 w-4 opacity-70"
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
            <div className="absolute left-0 z-50 mt-2 w-64 rounded-2xl border border-white/[0.08] bg-slate-950/95 p-2 text-sm shadow-lg shadow-black/40">
              {computedMoreLinks.map((link) => {
                const active = activeHref ? link.href === activeHref : resolveActive(link.href, path);
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    aria-current={active ? "page" : undefined}
                    onClick={() => setMoreOpen(false)}
                    className={clsx(
                      "flex items-center justify-between gap-3 rounded-xl px-3 py-2 font-semibold text-slate-200/90 transition-colors motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-200/50",
                      active
                        ? "bg-white/[0.07] text-white"
                        : "hover:bg-white/[0.04] hover:text-white",
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
  return isNavHrefActive(pathname, href);
}
