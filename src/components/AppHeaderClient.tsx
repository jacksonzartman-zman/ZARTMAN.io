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
    "border-emerald-400/40 text-emerald-200 bg-emerald-500/5",
  supplier:
    "border-blue-400/40 text-blue-200 bg-blue-500/5",
};

const NAV_LINKS: Record<PortalRole, PortalNavLink[]> = {
  customer: [
    { label: "RFQs", href: "/customer/quotes" },
    { label: "Projects", href: "/customer/projects" },
    { label: "Messages", href: "/customer/messages" },
    { label: "Settings", href: "/customer/settings" },
  ],
  supplier: [
    { label: "Dashboard", href: "/supplier" },
    { label: "Decisions", href: "/supplier/decisions" },
    { label: "Quotes", href: "/supplier/quotes" },
    { label: "Projects", href: "/supplier/projects" },
    { label: "Messages", href: "/supplier/messages" },
    { label: "Notifications", href: "/supplier/notifications" },
    { label: "Settings", href: "/supplier/settings" },
  ],
};

const CUSTOMER_MORE_LINKS: PortalNavLink[] = [
  { label: "Search", href: "/customer/search" },
  { label: "Saved searches", href: "/customer/saved" },
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
  const moreLinks: PortalNavLink[] =
    role === "customer" ? CUSTOMER_MORE_LINKS : [];
  const navLinksWithBadges = navLinks.map((link) => {
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
        <span className="inline-flex min-w-[1.5rem] items-center justify-center rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[11px] font-semibold text-amber-100">
          {formatBadgeCount(supplierDecisionCount)}
        </span>
      ),
    };
  });

  const brandHref =
    role === "customer"
      ? "/customer/quotes"
      : role === "supplier"
        ? "/supplier"
        : "/";

  return (
    <header className="sticky top-0 z-40 border-b border-slate-900/70 bg-neutral-950/95 backdrop-blur">
      <div className="mx-auto flex w-full max-w-page flex-col gap-3 px-4 py-4 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <BrandMark
              href={brandHref}
              withWordmark
              subLabel="Workspace"
              size={32}
              className="text-base font-semibold text-ink transition-colors hover:text-ink-soft"
            />
            {user && role ? (
              <span
                className={clsx(
                  "inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wide",
                  ROLE_BADGE_CLASSES[role],
                )}
              >
                {ROLE_BADGE_COPY[role]}
              </span>
            ) : null}
          </div>

          <div className="flex items-center gap-3">
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
                  className="rounded-full border border-transparent px-4 py-1.5 transition-colors hover:border-slate-800 hover:text-ink"
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
            moreLinks={moreLinks}
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
        className="inline-flex items-center gap-2 rounded-full border border-slate-800 bg-slate-950/50 px-4 py-1.5 text-sm font-semibold text-slate-200 transition hover:border-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-300"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span>{truncateLabel(buttonLabel)}</span>
        <svg
          className={clsx(
            "h-4 w-4 transition-transform",
            open ? "rotate-180" : "rotate-0",
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
      {open ? (
        <div className="absolute right-0 mt-2 w-64 rounded-2xl border border-slate-900 bg-slate-950/95 p-4 text-sm shadow-lg shadow-black/40">
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
              className="rounded-full border border-slate-800 px-3 py-1.5 text-left text-sm font-semibold text-slate-100 transition hover:border-slate-700 hover:text-white"
              onClick={() => setOpen(false)}
            >
              Account settings
            </Link>
            <form action={signOutAction}>
              <button
                type="submit"
                className="w-full rounded-full bg-red-500/10 px-3 py-1.5 text-sm font-semibold text-red-200 transition hover:bg-red-500/20"
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
