"use client";

import clsx from "clsx";
import Link from "next/link";
import type { ReactNode } from "react";

export type PortalNavLink = {
  label: string;
  href: string;
  badge?: ReactNode;
};

type PortalNavTabsProps = {
  links: PortalNavLink[];
  currentPath: string;
  className?: string;
  linkClassName?: string;
  isActive?: (href: string, currentPath: string) => boolean;
};

export function PortalNavTabs({
  links,
  currentPath,
  className,
  linkClassName,
  isActive,
}: PortalNavTabsProps) {
  if (!links.length) {
    return null;
  }

  const path = currentPath || "/";
  const resolveActive =
    isActive ??
    ((href: string, pathname: string) => defaultIsPortalNavLinkActive(pathname, href));

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
    </nav>
  );
}

export function defaultIsPortalNavLinkActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
