import Link from "next/link";
import clsx from "clsx";
import { requireUser } from "@/server/auth";
import { resolveUserRoles } from "@/server/users/roles";
import {
  loadUserNotifications,
  markNotificationsRead,
  type UserNotification,
} from "@/server/notifications";
import { PortalShell } from "@/app/(portals)/components/PortalShell";
import { EmptyStateNotice } from "@/app/(portals)/EmptyStateNotice";

export const dynamic = "force-dynamic";

const DAY_FORMATTER = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
});

export default async function SupplierNotificationsPage() {
  const user = await requireUser({ redirectTo: "/login?next=/supplier/notifications" });
  const roles = await resolveUserRoles(user.id);
  if (!roles?.isSupplier) {
    return (
      <PortalShell
        workspace="supplier"
        title="Notifications"
        subtitle="You don’t have access to the supplier workspace."
      >
        <EmptyStateNotice
          title="Supplier access required"
          description="This page is only available to supplier accounts."
          action={
            <Link
              href="/customer"
              className="text-sm font-semibold text-blue-200 underline-offset-4 hover:underline"
            >
              Go to customer portal
            </Link>
          }
        />
      </PortalShell>
    );
  }

  const notifications = await loadUserNotifications(user.id, {
    onlyUnread: false,
    limit: 100,
  });

  async function markAllRead() {
    "use server";
    const unread = await loadUserNotifications(user.id, { onlyUnread: true, limit: 500 });
    await markNotificationsRead(user.id, unread.map((n) => n.id));
  }

  async function markOneRead(formData: FormData) {
    "use server";
    const id = String(formData.get("id") ?? "").trim();
    if (!id) return;
    await markNotificationsRead(user.id, [id]);
  }

  const grouped = groupByDay(notifications);
  const hasUnread = notifications.some((n) => !n.isRead);

  return (
    <PortalShell
      workspace="supplier"
      title="Notifications"
      subtitle="What needs your attention across search requests, messages, kickoff, and capacity."
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/supplier"
            className="rounded-full border border-slate-800 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-200 transition hover:border-slate-700 hover:text-white"
          >
            Back to dashboard
          </Link>
          <form action={markAllRead}>
            <button
              type="submit"
              disabled={!hasUnread}
              className={clsx(
                "rounded-full border px-4 py-2 text-xs font-semibold uppercase tracking-wide transition",
                hasUnread
                  ? "border-blue-400/40 text-blue-100 hover:border-blue-300 hover:text-white"
                  : "cursor-not-allowed border-slate-900 text-slate-600",
              )}
            >
              Mark all as read
            </button>
          </form>
        </div>
      }
    >
      {notifications.length === 0 ? (
        <EmptyStateNotice
          title="You’re all caught up"
          description="Nothing needs your attention right now."
        />
      ) : (
        <div className="space-y-6">
          {grouped.map(([dayKey, items]) => (
            <section key={dayKey} className="space-y-3">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                {formatDayLabel(dayKey)}
              </h2>
              <ul className="space-y-2">
                {items.map((n) => (
                  <li
                    key={n.id}
                    className={clsx(
                      "rounded-2xl border bg-slate-950/40 p-4",
                      n.isRead ? "border-slate-900/60" : "border-blue-500/20",
                    )}
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <TypeChip type={n.type} />
                          <ReadPill isRead={n.isRead} />
                        </div>
                        <p className="mt-2 text-sm font-semibold text-white">{n.title}</p>
                        <p className="mt-1 text-sm text-slate-300">{n.body}</p>
                        <Link
                          href={n.href}
                          className="mt-2 inline-flex text-xs font-semibold text-blue-200 underline-offset-4 hover:underline"
                        >
                          Open
                        </Link>
                      </div>
                      {!n.isRead ? (
                        <form action={markOneRead}>
                          <input type="hidden" name="id" value={n.id} />
                          <button
                            type="submit"
                            className="rounded-full border border-slate-800 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-200 transition hover:border-slate-700 hover:text-white"
                          >
                            Mark read
                          </button>
                        </form>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </PortalShell>
  );
}

function groupByDay(notifications: UserNotification[]): Array<[string, UserNotification[]]> {
  const map = new Map<string, UserNotification[]>();
  for (const n of notifications) {
    const day = toDayKey(n.createdAt);
    map.set(day, [...(map.get(day) ?? []), n]);
  }

  return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]));
}

function toDayKey(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "unknown";
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatDayLabel(dayKey: string): string {
  if (dayKey === "unknown") return "Unknown";
  const ms = Date.parse(`${dayKey}T00:00:00Z`);
  if (!Number.isFinite(ms)) return dayKey;
  return DAY_FORMATTER.format(new Date(ms));
}

function TypeChip({ type }: { type: UserNotification["type"] }) {
  return (
    <span className="inline-flex items-center rounded-full border border-slate-800 bg-slate-950/60 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-200">
      {type.replace(/_/g, " ")}
    </span>
  );
}

function ReadPill({ isRead }: { isRead: boolean }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
        isRead
          ? "border-slate-800 bg-slate-950/60 text-slate-400"
          : "border-blue-500/30 bg-blue-500/10 text-blue-100",
      )}
    >
      {isRead ? "read" : "unread"}
    </span>
  );
}
