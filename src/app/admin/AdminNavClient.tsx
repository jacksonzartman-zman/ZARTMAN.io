"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { PortalContainer } from "@/app/(portals)/components/PortalContainer";
import {
  defaultIsPortalNavLinkActive,
  type PortalNavLink,
} from "@/app/(portals)/components/PortalNavTabs";
import { NotificationsTray } from "@/components/notifications/NotificationsTray";
import { BrandMark } from "@/components/BrandMark";

export type AdminHeaderUser = {
  email: string | null;
  displayName: string | null;
};

type AdminNavClientProps = {
  user: AdminHeaderUser | null;
  signOutAction?: () => Promise<void> | void;
};

const PRIMARY_LINK: PortalNavLink = { label: "Quotes", href: "/admin/quotes" };

const MORE_LINKS: PortalNavLink[] = [
  { label: "Overview", href: "/admin/overview" },
  { label: "Change requests", href: "/admin/change-requests" },
  { label: "Analytics", href: "/admin/analytics" },
  { label: "Uploads", href: "/admin/uploads" },
  { label: "Messages", href: "/admin/messages" },
  { label: "Activity", href: "/admin/activity" },
  { label: "Capacity", href: "/admin/capacity" },
  { label: "Ops inbox", href: "/admin/ops/inbox" },
  { label: "Suppliers", href: "/admin/suppliers" },
  { label: "Provider import", href: "/admin/providers/import" },
  { label: "Bench health", href: "/admin/bench-health" },
  { label: "System health", href: "/admin/system-health" },
  { label: "Email ops", href: "/admin/email-ops" },
];

const MOBILE_LINKS: PortalNavLink[] = [
  PRIMARY_LINK,
  { label: "Notifications", href: "/admin/notifications" },
  ...MORE_LINKS,
];

export default function AdminNavClient({ user, signOutAction }: AdminNavClientProps) {
  const pathname = usePathname() ?? "/admin/overview";
  const [moreOpen, setMoreOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement | null>(null);
  const mobileRef = useRef<HTMLDivElement | null>(null);

  const primaryActive = useMemo(
    () => defaultIsPortalNavLinkActive(pathname, PRIMARY_LINK.href),
    [pathname],
  );

  const moreActive = useMemo(() => {
    return MORE_LINKS.some((link) => defaultIsPortalNavLinkActive(pathname, link.href));
  }, [pathname]);

  useEffect(() => {
    setMoreOpen(false);
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    function handleClick(event: MouseEvent) {
      const target = event.target as Node;
      if (moreOpen && !moreRef.current?.contains(target)) {
        setMoreOpen(false);
      }
      if (mobileOpen && !mobileRef.current?.contains(target)) {
        setMobileOpen(false);
      }
    }

    if (moreOpen || mobileOpen) {
      document.addEventListener("mousedown", handleClick);
    }
    return () => document.removeEventListener("mousedown", handleClick);
  }, [moreOpen, mobileOpen]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMoreOpen(false);
        setMobileOpen(false);
      }
    }
    if (moreOpen || mobileOpen) {
      document.addEventListener("keydown", handleKeyDown);
    }
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [moreOpen, mobileOpen]);

  return (
    <div className="border-b border-slate-900 bg-slate-950/60">
      <PortalContainer className="flex items-center justify-between gap-3 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <BrandMark
            href="/admin/overview"
            withWordmark
            subLabel="Admin"
            size={28}
            className="text-base font-semibold text-white"
          />

          {/* Desktop nav */}
          <nav className="hidden items-center gap-2 text-sm font-medium text-slate-400 lg:flex">
            <Link
              href={PRIMARY_LINK.href}
              className={clsx(
                "inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300",
                primaryActive
                  ? "bg-slate-900 text-white"
                  : "text-slate-400 hover:text-white",
              )}
            >
              {PRIMARY_LINK.label}
            </Link>

            <div className="relative" ref={moreRef}>
              <button
                type="button"
                onClick={() => setMoreOpen((prev) => !prev)}
                className={clsx(
                  "inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300",
                  moreOpen || moreActive
                    ? "bg-slate-900/70 text-white"
                    : "text-slate-400 hover:text-white",
                )}
                aria-haspopup="menu"
                aria-expanded={moreOpen}
                aria-label="More admin links"
              >
                <span>More</span>
                <ChevronIcon className={clsx("h-4 w-4", moreOpen ? "rotate-180" : "")} />
              </button>

              {moreOpen ? (
                <div
                  role="menu"
                  aria-label="More admin links"
                  className="absolute left-0 z-50 mt-2 w-64 rounded-2xl border border-slate-900/80 bg-slate-950/95 p-2 text-sm text-slate-200 shadow-[0_18px_40px_rgba(2,6,23,0.65)]"
                >
                  {MORE_LINKS.map((link) => {
                    const active = defaultIsPortalNavLinkActive(pathname, link.href);
                    return (
                      <Link
                        key={link.href}
                        href={link.href}
                        role="menuitem"
                        className={clsx(
                          "flex items-center justify-between rounded-xl px-3 py-2 font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-300",
                          active
                            ? "bg-slate-900 text-white"
                            : "text-slate-300 hover:bg-slate-900/60 hover:text-white",
                        )}
                        onClick={() => setMoreOpen(false)}
                      >
                        <span>{link.label}</span>
                      </Link>
                    );
                  })}
                </div>
              ) : null}
            </div>
          </nav>
        </div>

        <div className="flex items-center gap-2">
          {/* Mobile menu toggle */}
          <div className="relative lg:hidden" ref={mobileRef}>
            <button
              type="button"
              onClick={() => setMobileOpen((prev) => !prev)}
              className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-900/70 bg-slate-950/70 text-slate-300 transition hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-300"
              aria-label={mobileOpen ? "Close admin menu" : "Open admin menu"}
              aria-haspopup="menu"
              aria-expanded={mobileOpen}
            >
              <HamburgerIcon className="h-5 w-5" />
            </button>

            {mobileOpen ? (
              <div
                role="menu"
                aria-label="Admin menu"
                className="absolute right-0 z-50 mt-2 w-[min(22rem,calc(100vw-2rem))] rounded-2xl border border-slate-900/80 bg-slate-950/95 p-2 text-sm text-slate-200 shadow-[0_18px_40px_rgba(2,6,23,0.65)]"
              >
                {MOBILE_LINKS.map((link) => {
                  const active = defaultIsPortalNavLinkActive(pathname, link.href);
                  return (
                    <Link
                      key={link.href}
                      href={link.href}
                      role="menuitem"
                      className={clsx(
                        "flex items-center justify-between rounded-xl px-3 py-2 font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-300",
                        active
                          ? "bg-slate-900 text-white"
                          : "text-slate-300 hover:bg-slate-900/60 hover:text-white",
                      )}
                      onClick={() => setMobileOpen(false)}
                    >
                      <span>{link.label}</span>
                    </Link>
                  );
                })}
              </div>
            ) : null}
          </div>

          <NotificationsTray viewAllHref="/admin/notifications" />

          {user ? <AdminUserDropdown user={user} signOutAction={signOutAction} /> : null}
        </div>
      </PortalContainer>
    </div>
  );
}

function AdminUserDropdown({
  user,
  signOutAction,
}: {
  user: AdminHeaderUser;
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

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("keydown", handleKeyDown);
    }
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  const buttonLabel = user.displayName ?? user.email ?? "Account";

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="inline-flex items-center gap-2 rounded-full border border-slate-800 bg-slate-950/50 px-4 py-1.5 text-sm font-semibold text-slate-200 transition hover:border-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-300"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
      >
        <span className="max-w-[12rem] truncate">{buttonLabel}</span>
        <ChevronIcon className={clsx("h-4 w-4", open ? "rotate-180" : "")} />
      </button>

      {open ? (
        <div
          role="menu"
          aria-label="Account menu"
          className="absolute right-0 z-50 mt-2 w-64 rounded-2xl border border-slate-900 bg-slate-950/95 p-4 text-sm shadow-lg shadow-black/40"
        >
          <p className="text-xs text-slate-500">Signed in as</p>
          <p className="mt-1 font-semibold text-white">{user.displayName ?? "Admin user"}</p>
          {user.email ? <p className="text-xs text-slate-500">{user.email}</p> : null}

          <div className="mt-4 flex flex-col gap-2">
            <Link
              href="/account/settings"
              role="menuitem"
              className="rounded-full border border-slate-800 px-3 py-1.5 text-left text-sm font-semibold text-slate-100 transition hover:border-slate-700 hover:text-white"
              onClick={() => setOpen(false)}
            >
              Account settings
            </Link>
            {signOutAction ? (
              <form action={signOutAction}>
                <button
                  type="submit"
                  className="w-full rounded-full bg-red-500/10 px-3 py-1.5 text-sm font-semibold text-red-200 transition hover:bg-red-500/20"
                >
                  Log out
                </button>
              </form>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg
      className={clsx("transition-transform", className)}
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
  );
}

function HamburgerIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 7h16" />
      <path d="M4 12h16" />
      <path d="M4 17h16" />
    </svg>
  );
}

