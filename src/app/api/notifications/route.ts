import { NextResponse } from "next/server";
import { getServerAuthUser } from "@/server/auth";
import { loadUserNotifications, markNotificationsRead } from "@/server/notifications";

export async function GET(req: Request) {
  try {
    const { user } = await getServerAuthUser();
    if (!user) {
      return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const onlyUnread = searchParams.get("onlyUnread") === "1";
    const limit = Number(searchParams.get("limit") ?? "20");

    const notifications = await loadUserNotifications(user.id, {
      onlyUnread,
      limit: Number.isFinite(limit) ? limit : 20,
    });

    const unreadCount = notifications.filter((n) => !n.isRead).length;

    return NextResponse.json({ notifications, unreadCount });
  } catch (error) {
    console.error("[notifications] GET /api/notifications failed", { error });
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const { user } = await getServerAuthUser();
    if (!user) {
      return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
    }

    const body = (await req.json().catch(() => null)) as
      | { notificationIds?: string[]; markAll?: boolean }
      | null;

    const markAll = Boolean(body?.markAll);

    if (markAll) {
      const unread = await loadUserNotifications(user.id, {
        onlyUnread: true,
        limit: 500,
      });
      const ids = unread.map((n) => n.id);
      await markNotificationsRead(user.id, ids);
      return NextResponse.json({ ok: true, marked: ids.length });
    }

    const ids = Array.isArray(body?.notificationIds) ? body?.notificationIds : [];
    await markNotificationsRead(user.id, ids);
    return NextResponse.json({ ok: true, marked: ids.length });
  } catch (error) {
    console.error("[notifications] POST /api/notifications failed", { error });
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
