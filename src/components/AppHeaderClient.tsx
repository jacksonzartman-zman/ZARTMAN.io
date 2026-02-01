"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import type { PortalRole } from "@/types/portal";
import { primaryCtaClasses } from "@/lib/ctas";
import type { HeaderUser } from "./AppHeader";
import { BrandMark } from "@/components/BrandMark";
import { NotificationsTray } from "@/components/notifications/NotificationsTray";
import { CountBadge } from "@/components/shared/primitives/CountBadge";
import {
  PortalNavTabs,
  type PortalNavLink,
} from "@/app/(portals)/components/PortalNavTabs";

const ROLE_BADGE_COPY: Record<PortalRole, string> = {
  customer: "Customer workspace",
  supplier: "Supplier workspace",
};

const ROLE_BADGE_CLASSES: Record<PortalRole, string> = {
  customer:
    "text-emerald-100/90 bg-emerald-500/[0.08] ring-emerald-300/[0.16]",
  supplier:
    "text-sky-100/90 bg-sky-500/[0.08] ring-sky-300/[0.16]",
};

const NAV_LINKS: Record<PortalRole, PortalNavLink[]> = {
  customer: [
    { label: "RFQs", href: "/customer/quotes" },
    { label: "Projects", href: "/customer/projects" },
    { label: "Messages", href: "/customer/messages" },
  ],
  supplier: [
    { label: "RFQs", href: "/supplier/quotes" },
    { label: "Projects", href: "/supplier/projects" },
    { label: "Messages", href: "/supplier/messages" },
  ],
};

const CUSTOMER_MORE_LINKS: PortalNavLink[] = [
  { label: "Search", href: "/customer/search" },
  { label: "Saved Searches", href: "/customer/saved" },
  { label: "Settings", href: "/customer/settings" },
];

const SUPPLIER_MORE_LINKS: PortalNavLink[] = [
  { label: "Dashboard", href: "/supplier" },
  { label: "Notifications", href: "/supplier/notifications" },
  { label: "Decisions", href: "/supplier/decisions" },
  { label: "Settings", href: "/supplier/settings" },
];

export type AppHeaderClientProps = {
  user: HeaderUser | null;
  signOutAction?: () => Promise<void> | void;
  supplierDecisionCount?: number;
};

export default function AppHeaderClient({
  user,
  signOutAction,
  supplierDecisionCount,
}: AppHeaderClientProps) {
  const pathname = usePathname() ?? "/";
  const role = useMemo(() => deriveRoleFromPath(pathname), [pathname]);
  const navLinks: PortalNavLink[] = role ? NAV_LINKS[role] : [];
  const moreLinks: PortalNavLink[] = role
    ? role === "customer"
      ? CUSTOMER_MORE_LINKS
      : SUPPLIER_MORE_LINKS
    : [];

  const addSupplierBadges = (links: PortalNavLink[]) =>
    links.map((link) => {
      const showBadge =
        role === "supplier" &&
        link.href === "/supplier/decisions" &&
        typeof supplierDecisionCount === "number" &&
        supplierDecisionCount > 0;

      if (!showBadge) {
        return link;
      }

      return {
        ...link,
        badge: (
          <CountBadge
            tone="warning"
            size="sm"
            className="min-w-[1.6rem] tabular-nums"
          >
            {formatBadgeCount(supplierDecisionCount)}
          </CountBadge>
        ),
      };
    });

  const navLinksWithBadges = addSupplierBadges(navLinks);
  const moreLinksWithBadges = addSupplierBadges(moreLinks);

  const brandHref =
    role === "customer"
      ? "/customer/quotes"
      : role === "supplier"
        ? "/supplier"
        : "/";

  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-neutral-950/80 backdrop-blur supports-[backdrop-filter]:bg-neutral-950/70">
      <div className="mx-auto flex w-full max-w-page flex-col gap-2.5 px-4 py-3 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <BrandMark
              href={brandHref}
              withWordmark
              subLabel="Workspace"
              size={32}
              className="text-base font-semibold text-ink hover:text-ink-soft"
            />
            {user && role ? (
              <span
                className={clsx(
                  "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold uppercase tracking-wide ring-1 ring-inset",
                  ROLE_BADGE_CLASSES[role],
                )}
              >
                {ROLE_BADGE_COPY[role]}
              </span>
            ) : null}
          </div>

          <div className="flex items-center gap-3.5">
            {user ? (
              <>
                {role ? (
                  <NotificationsTray
                    viewAllHref={
                      role === "customer"
                        ? "/customer/notifications"
                        : "/supplier/notifications"
                    }
                  />
                ) : null}
                <UserDropdown
                  user={user}
                  role={role}
                  signOutAction={signOutAction}
                />
              </>
            ) : (
              <div className="flex items-center gap-3 text-sm font-semibold text-ink-soft">
                <Link
                  href="/login"
                  className="rounded-md border border-transparent px-3.5 py-1.5 transition-colors hover:border-white/10 hover:bg-white/[0.04] hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-200/50"
                >
                  Log in
                </Link>
                <Link href="/customer/search" className={primaryCtaClasses}>
                  Search suppliers
                </Link>
              </div>
            )}
          </div>
        </div>

        {user && navLinksWithBadges.length > 0 ? (
          <PortalNavTabs
            links={navLinksWithBadges}
            moreLinks={moreLinksWithBadges}
            maxVisibleLinks={3}
            currentPath={pathname}
          />
        ) : null}
      </div>
    </header>
  );
}

function deriveRoleFromPath(pathname: string): PortalRole | null {
  if (pathname.startsWith("/customer")) {
    return "customer";
  }
  if (pathname.startsWith("/supplier")) {
    return "supplier";
  }
  return null;
}

function formatBadgeCount(value?: number): string {
  if (typeof value !== "number") {
    return "0";
  }
  if (value > 99) {
    return "99+";
  }
  return String(value);
}

function truncateLabel(value: string, max = 28): string {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max - 3)}...`;
}

function UserDropdown({
  user,
  role,
  signOutAction,
}: {
  user: HeaderUser;
  role: PortalRole | null;
  signOutAction?: () => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const pathname = usePathname();

  useEffect(() => {
    function handleClick(event: MouseEvent) {
      if (!dropdownRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClick);
    }
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const settingsHref =
    role === "customer"
      ? "/customer/settings"
      : role === "supplier"
        ? "/supplier/settings"
        : "/account/settings";

  const buttonLabel =
    user.displayName ?? user.email ?? "Signed in user";

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="inline-flex items-center gap-2 rounded-md bg-white/[0.02] px-3.5 py-1.5 text-sm font-semibold text-slate-200 ring-1 ring-inset ring-white/[0.08] transition-colors hover:bg-white/[0.04] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-200/50 motion-reduce:transition-none"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span>{truncateLabel(buttonLabel)}</span>
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
      {open ? (
        <div className="absolute right-0 mt-2 w-64 rounded-2xl border border-white/[0.08] bg-slate-950/95 p-4 text-sm shadow-lg shadow-black/40">
          <p className="text-xs text-slate-500">Signed in as</p>
          <p className="mt-1 font-semibold text-white">
            {user.displayName ?? "Workspace user"}
          </p>
          {user.email ? (
            <p className="text-xs text-slate-500">{user.email}</p>
          ) : null}

          <div className="mt-4 flex flex-col gap-2">
            <Link
              href={settingsHref}
              className="rounded-xl bg-white/[0.02] px-3 py-2 text-left text-sm font-semibold text-slate-100 ring-1 ring-inset ring-white/[0.08] transition-colors hover:bg-white/[0.05] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-200/50 motion-reduce:transition-none"
              onClick={() => setOpen(false)}
            >
              Account settings
            </Link>
            <form action={signOutAction}>
              <button
                type="submit"
                className="w-full rounded-xl bg-red-500/10 px-3 py-2 text-sm font-semibold text-red-100 transition-colors hover:bg-red-500/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-200/50 motion-reduce:transition-none"
              >
                Log out
              </button>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
