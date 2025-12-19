"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import {
  formatRelativeTimeFromTimestamp,
  toTimestamp,
} from "@/lib/relativeTime";
import type { UserNotification } from "@/server/notifications";

type NotificationsTrayProps = {
  viewAllHref: string;
};

export function NotificationsTray({ viewAllHref }: NotificationsTrayProps) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const [items, setItems] = useState<UserNotification[]>([]);
  const [loading, setLoading] = useState(false);

  const unreadCount = useMemo(() => items.filter((n) => !n.isRead).length, [items]);

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
    if (!open) return;

    setLoading(true);
    void fetch("/api/notifications?onlyUnread=1&limit=20", {
      method: "GET",
      headers: { "content-type": "application/json" },
    })
      .then(async (res) => {
        if (!res.ok) return { notifications: [] as UserNotification[] };
        return (await res.json()) as { notifications: UserNotification[] };
      })
      .then((data) => {
        setItems(Array.isArray(data.notifications) ? data.notifications : []);
      })
      .catch((error) => {
        console.error("[notifications] tray load failed", { error });
        setItems([]);
      })
      .finally(() => setLoading(false));
  }, [open]);

  const badgeLabel = unreadCount > 9 ? "9+" : unreadCount > 0 ? String(unreadCount) : null;

  async function markAllAsRead() {
    try {
      await fetch("/api/notifications", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ markAll: true }),
      });
      setItems([]);
    } catch (error) {
      console.error("[notifications] markAll failed", { error });
    }
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="relative inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-900/70 bg-slate-950/70 text-slate-300 transition hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-300"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={badgeLabel ? `View notifications (${badgeLabel} unread)` : "View notifications"}
      >
        <BellIcon className="h-5 w-5" />
        {badgeLabel ? (
          <span className="absolute -right-1 -top-1 inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-sky-400 px-1.5 py-0.5 text-[10px] font-semibold text-slate-950 ring-2 ring-slate-950">
            {badgeLabel}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 mt-2 w-96 rounded-2xl border border-slate-900/80 bg-slate-950/95 p-4 text-sm text-slate-200 shadow-[0_18px_40px_rgba(2,6,23,0.65)]">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-white">Notifications</p>
              <p className="mt-1 text-xs text-slate-500">
                {unreadCount > 0 ? `${unreadCount} unread` : "All caught up"}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Link
                href={viewAllHref}
                className="rounded-full border border-slate-800 px-3 py-1 text-xs font-semibold text-slate-200 transition hover:border-slate-700 hover:text-white"
                onClick={(event) => event.stopPropagation()}
              >
                View all
              </Link>
              <button
                type="button"
                onClick={markAllAsRead}
                disabled={unreadCount === 0}
                className={clsx(
                  "rounded-full border px-3 py-1 text-xs font-semibold transition",
                  unreadCount === 0
                    ? "cursor-not-allowed border-slate-900 text-slate-600"
                    : "border-slate-800 text-slate-200 hover:border-slate-700 hover:text-white",
                )}
              >
                Mark all read
              </button>
            </div>
          </div>

          <div className="mt-3 space-y-2">
            {loading ? (
              <p className="text-xs text-slate-500">Loading…</p>
            ) : items.length > 0 ? (
              items.map((notification) => (
                <NotificationPreview key={notification.id} notification={notification} />
              ))
            ) : (
              <p className="text-xs text-slate-500">Nothing needs your attention right now.</p>
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
  notification: UserNotification;
}) {
  const timestampLabel =
    formatRelativeTimeFromTimestamp(toTimestamp(notification.createdAt)) ?? "Just now";

  return (
    <Link
      href={notification.href}
      className="block focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-300"
      onClick={(event) => event.stopPropagation()}
    >
      <div
        className={clsx(
          "flex flex-col rounded-2xl border px-3 py-2 transition hover:border-blue-400/30 hover:bg-slate-900/40",
          notification.isRead ? "border-slate-900/70 opacity-80" : "border-blue-500/30",
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <p className="min-w-0 text-sm font-semibold text-white">
            {notification.title}
          </p>
          <span className="shrink-0 text-[11px] uppercase tracking-wide text-slate-500">
            {timestampLabel}
          </span>
        </div>
        <p className="mt-1 line-clamp-1 text-xs text-slate-400">{notification.body}</p>
      </div>
    </Link>
  );
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
