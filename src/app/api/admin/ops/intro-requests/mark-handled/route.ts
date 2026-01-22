import { NextResponse } from "next/server";

import { supabaseServer } from "@/lib/supabaseServer";
import { requireAdminUser, UnauthorizedError } from "@/server/auth";
import { isMissingTableOrColumnError, serializeSupabaseError } from "@/server/admin/logging";
import { schemaGate } from "@/server/db/schemaContract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PostBody = {
  quoteId?: unknown;
  providerId?: unknown;
  notes?: unknown;
};

export async function POST(req: Request) {
  try {
    const admin = await requireAdminUser();

    const body = (await req.json().catch(() => null)) as PostBody | null;
    const quoteId = typeof body?.quoteId === "string" ? body.quoteId.trim() : "";
    const providerId = typeof body?.providerId === "string" ? body.providerId.trim() : "";
    const notesRaw = typeof body?.notes === "string" ? body.notes.trim() : "";

    if (!isUuidLike(quoteId)) {
      return NextResponse.json({ ok: false, error: "invalid_quoteId" }, { status: 400 });
    }
    if (!providerId) {
      return NextResponse.json({ ok: false, error: "invalid_providerId" }, { status: 400 });
    }
    if (notesRaw.length > 2000) {
      return NextResponse.json({ ok: false, error: "invalid_notes" }, { status: 400 });
    }

    const supported = await schemaGate({
      enabled: true,
      relation: "ops_events",
      requiredColumns: ["quote_id", "event_type", "payload", "created_at"],
      warnPrefix: "[admin intro requests]",
      warnKey: "admin_intro_requests:ops_events",
    });

    if (!supported) {
      // Fail-soft: treat missing schema as a no-op (and avoid noisy logs).
      return NextResponse.json({ ok: true, skipped: true });
    }

    const payload: Record<string, unknown> = {
      provider_id: providerId,
      notes: notesRaw || undefined,
      source: "admin_ops_inbox",
      handled_by_user_id: admin.id,
    };

    const { error } = await supabaseServer.from("ops_events").insert({
      quote_id: quoteId,
      destination_id: null,
      event_type: "customer_intro_handled",
      payload,
    });

    if (error) {
      // Missing table/column or stale check-constraint: treat as quiet "skipped" to avoid spam.
      if (isMissingTableOrColumnError(error) || isOpsEventsEventTypeConstraintViolation(error)) {
        return NextResponse.json({ ok: true, skipped: true });
      }

      console.error("[admin intro requests] insert failed", {
        quoteId,
        providerId,
        adminUserId: admin.id,
        error: serializeSupabaseError(error) ?? error,
      });
      return NextResponse.json({ ok: false, error: "insert_failed" }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
    console.error("[admin intro requests] mark-handled crashed", {
      error: serializeSupabaseError(err) ?? err,
    });
    return NextResponse.json({ ok: false, error: "unknown" }, { status: 500 });
  }
}

function isUuidLike(value: string): boolean {
  const v = typeof value === "string" ? value.trim() : "";
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

function isOpsEventsEventTypeConstraintViolation(error: unknown): boolean {
  const serialized = serializeSupabaseError(error);
  const code = typeof serialized?.code === "string" ? serialized.code : "";
  if (code !== "23514") {
    return false;
  }
  const blob = `${serialized?.message ?? ""} ${serialized?.details ?? ""} ${serialized?.hint ?? ""}`
    .toLowerCase()
    .trim();
  if (!blob) return true;
  return blob.includes("ops_events_event_type_check") || blob.includes("check constraint");
}

