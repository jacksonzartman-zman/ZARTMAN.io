"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import type { PortalRole } from "@/types/portal";
import { primaryCtaClasses } from "@/lib/ctas";
import type { HeaderUser } from "./AppHeader";

type NavLink = {
  label: string;
  href: string;
};

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

const NAV_LINKS: Record<PortalRole, NavLink[]> = {
  customer: [
    { label: "Dashboard", href: "/customer" },
    { label: "Quotes", href: "/customer/quotes" },
    { label: "Settings", href: "/customer/settings" },
  ],
  supplier: [
    { label: "Dashboard", href: "/supplier" },
    { label: "RFQs", href: "/supplier/rfqs" },
    { label: "Settings", href: "/supplier/settings" },
  ],
};

export type AppHeaderClientProps = {
  user: HeaderUser | null;
  signOutAction?: () => Promise<void> | void;
};

export default function AppHeaderClient({
  user,
  signOutAction,
}: AppHeaderClientProps) {
  const pathname = usePathname() ?? "/";
  const role = useMemo(() => deriveRoleFromPath(pathname), [pathname]);
  const navLinks = role ? NAV_LINKS[role] : [];

  return (
    <header className="sticky top-0 z-40 border-b border-slate-900/70 bg-neutral-950/95 backdrop-blur">
      <div className="mx-auto flex w-full max-w-page flex-col gap-3 px-4 py-4 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <Link
              href="/"
              className="flex items-center gap-3 text-base font-semibold text-ink transition-colors hover:text-ink-soft"
              aria-label="Zartman workspace home"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-2xl border border-emerald-400/50 bg-emerald-400/10 text-sm font-bold uppercase tracking-wide text-emerald-200">
                Z
              </span>
              <div className="flex flex-col leading-tight">
                <span>Zartman</span>
                <span className="text-xs font-normal uppercase tracking-[0.35em] text-ink-muted">
                  workspace
                </span>
              </div>
            </Link>
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
              <UserDropdown
                user={user}
                role={role}
                signOutAction={signOutAction}
              />
            ) : (
              <div className="flex items-center gap-3 text-sm font-semibold text-ink-soft">
                <Link
                  href="/login"
                  className="rounded-full border border-transparent px-4 py-1.5 transition-colors hover:border-slate-800 hover:text-ink"
                >
                  Log in
                </Link>
                <Link href="/quote" className={primaryCtaClasses}>
                  Get quote
                </Link>
              </div>
            )}
          </div>
        </div>

        {user && navLinks.length > 0 ? (
          <nav className="flex flex-wrap items-center gap-2 text-sm font-medium text-slate-400">
            {navLinks.map((link) => {
              const active = isPathActive(pathname, link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={clsx(
                    "rounded-full px-3 py-1.5 transition-colors",
                    active
                      ? "bg-slate-900 text-white"
                      : "text-slate-400 hover:text-white",
                  )}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>
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

function isPathActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
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
