"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import type { PortalRole } from "@/types/portal";
import { primaryCtaClasses } from "@/lib/ctas";
import type { HeaderUser } from "./AppHeader";
import type { NotificationPayload } from "@/types/notifications";
import { formatRelativeTimeFromTimestamp, toTimestamp } from "@/lib/relativeTime";

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
  notifications?: NotificationPayload[];
  signOutAction?: () => Promise<void> | void;
};

export default function AppHeaderClient({
  user,
  notifications = [],
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
            <>
              <NotificationsBell notifications={notifications} />
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

function NotificationsBell({
  notifications,
}: {
  notifications: NotificationPayload[];
}) {
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const pathname = usePathname();
  const hasNotifications = notifications.length > 0;
  const unreadCount = notifications.filter((item) => item.read === false).length;

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

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="relative inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-900/70 bg-slate-950/70 text-slate-300 transition hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-300"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={hasNotifications ? "View notifications" : "No notifications"}
      >
        <BellIcon className="h-5 w-5" />
        {unreadCount > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 inline-flex h-2.5 w-2.5 rounded-full bg-sky-400/90 ring-2 ring-slate-950">
            <span className="sr-only">
              {`${unreadCount} unread notification${unreadCount === 1 ? "" : "s"}`}
            </span>
          </span>
        ) : null}
      </button>
      {open ? (
        <div className="absolute right-0 mt-2 w-80 rounded-2xl border border-slate-900/80 bg-slate-950/95 p-4 text-sm text-slate-200 shadow-[0_18px_40px_rgba(2,6,23,0.65)]">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-white">Notifications</p>
            <span className="text-xs text-slate-500">
              {hasNotifications
                ? `${unreadCount || notifications.length} new`
                : "All caught up"}
            </span>
          </div>
          <div className="mt-3 space-y-2">
            {hasNotifications ? (
              notifications.map((notification) => (
                <NotificationPreview
                  key={notification.id}
                  notification={notification}
                />
              ))
            ) : (
              <p className="text-xs text-slate-500">
                We’ll surface quote and bid updates here soon.
              </p>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function NotificationPreview({
  notification,
}: {
  notification: NotificationPayload;
}) {
  const timestampLabel =
    formatRelativeTimeFromTimestamp(toTimestamp(notification.timestamp)) ??
    "Just now";
  const typeLabel =
    notification.type === "bid"
      ? "Bid"
      : notification.type === "status"
        ? "Status"
        : "Quote";
  const badgeClasses: Record<string, string> = {
    Quote: "bg-emerald-500/10 text-emerald-200 border-emerald-500/30",
    Bid: "bg-blue-500/10 text-blue-200 border-blue-500/30",
    Status: "bg-slate-500/10 text-slate-200 border-slate-500/30",
  };

  const content = (
    <div
      className={clsx(
        "flex flex-col rounded-2xl border px-3 py-2 transition hover:border-blue-400/30 hover:bg-slate-900/40",
        notification.read ? "border-slate-900/70 opacity-80" : "border-blue-500/30",
      )}
    >
      <span
        className={clsx(
          "mb-2 inline-flex w-fit items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
          badgeClasses[typeLabel] ?? "",
        )}
      >
        {typeLabel}
      </span>
      <p className="text-sm font-semibold text-white">{notification.title}</p>
      <p className="text-xs text-slate-400">{notification.description}</p>
      <p className="mt-2 text-[11px] uppercase tracking-wide text-slate-500">
        {timestampLabel}
      </p>
    </div>
  );

  if (notification.href) {
    return (
      <Link
        href={notification.href}
        className="block focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-300"
        onClick={(event) => event.stopPropagation()}
      >
        {content}
      </Link>
    );
  }

  return content;
}

function BellIcon({ className }: { className?: string }) {
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
      <path d="M12 4a4 4 0 0 0-4 4v2.26c0 .46-.18.9-.5 1.22L6.2 12.78A1 1 0 0 0 6.9 14h10.2a1 1 0 0 0 .7-1.72l-1.3-1.3a1.73 1.73 0 0 1-.5-1.22V8a4 4 0 0 0-4-4Z" />
      <path d="M10 17a2 2 0 0 0 4 0" />
    </svg>
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
