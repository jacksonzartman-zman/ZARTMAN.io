import { NextResponse } from "next/server";

import { supabaseServer } from "@/lib/supabaseServer";
import { requireAdminUser, UnauthorizedError } from "@/server/auth";
import { emitQuoteEvent } from "@/server/quotes/events";

export async function POST(req: Request) {
  try {
    const admin = await requireAdminUser();

    const body = (await req.json().catch(() => null)) as
      | { changeRequestId?: unknown }
      | null;
    const changeRequestId =
      typeof body?.changeRequestId === "string" ? body.changeRequestId.trim() : "";

    if (!isUuidLike(changeRequestId)) {
      return NextResponse.json(
        { ok: false, error: "invalid_changeRequestId" },
        { status: 400 },
      );
    }

    const { data: updated, error: updateError } = await supabaseServer
      .from("quote_change_requests")
      .update({
        status: "resolved",
        resolved_at: new Date().toISOString(),
        resolved_by_user_id: admin.id,
      })
      .eq("id", changeRequestId)
      .select("id,quote_id,status")
      .maybeSingle<{ id: string; quote_id: string; status: string }>();

    if (updateError) {
      console.error("[admin change-requests] resolve update failed", {
        changeRequestId,
        adminUserId: admin.id,
        error: updateError,
      });
      return NextResponse.json(
        { ok: false, error: "update_failed" },
        { status: 500 },
      );
    }

    if (!updated?.id || !updated?.quote_id) {
      return NextResponse.json(
        { ok: false, error: "not_found" },
        { status: 404 },
      );
    }

    try {
      const { error: notificationError, count } = await supabaseServer
        .from("user_notifications")
        .update(
          { is_read: true, updated_at: new Date().toISOString() },
          { count: "exact" },
        )
        .eq("type", "change_request_submitted")
        .eq("entity_type", "change_request")
        .eq("entity_id", changeRequestId);

      if (notificationError) {
        console.warn("[change-requests] resolve notification update failed", {
          changeRequestId,
          code: (notificationError as { code?: string } | null)?.code,
          message: (notificationError as { message?: string } | null)?.message,
        });
      } else {
        console.log("[change-requests] resolve notification updated", {
          changeRequestId,
          updatedCount: typeof count === "number" ? count : 0,
        });
      }
    } catch (error: unknown) {
      console.warn("[change-requests] resolve notification update failed", {
        changeRequestId,
        code: (error as { code?: string } | null)?.code,
        message: (error as { message?: string } | null)?.message,
      });
    }

    const event = await emitQuoteEvent({
      quoteId: updated.quote_id,
      eventType: "change_request_resolved",
      actorRole: "admin",
      actorUserId: admin.id,
      metadata: {
        changeRequestId,
        // Back-compat keys
        change_request_id: changeRequestId,
      },
    });

    if (!event.ok) {
      console.error("[admin change-requests] resolve event insert failed", {
        changeRequestId,
        quoteId: updated.quote_id,
        adminUserId: admin.id,
        error: event.error,
      });
      return NextResponse.json(
        { ok: false, error: "event_insert_failed" },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
    console.error("[admin change-requests] resolve crashed", err);
    return NextResponse.json({ ok: false, error: "unknown" }, { status: 500 });
  }
}

function isUuidLike(value: string): boolean {
  const v = typeof value === "string" ? value.trim() : "";
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

