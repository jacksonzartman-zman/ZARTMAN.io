import { NextResponse } from "next/server";

import { supabaseServer } from "@/lib/supabaseServer";
import { requireAdminUser, UnauthorizedError } from "@/server/auth";
import {
  isMissingTableOrColumnError,
  serializeSupabaseError,
} from "@/server/admin/logging";
import { schemaGate } from "@/server/db/schemaContract";

export async function POST(req: Request) {
  try {
    await requireAdminUser();

    const body = (await req.json().catch(() => null)) as { destinationId?: unknown } | null;
    const destinationId =
      typeof body?.destinationId === "string" ? body.destinationId.trim() : "";

    if (!destinationId) {
      return NextResponse.json(
        { ok: false, error: "missing_destination_id" },
        { status: 400 },
      );
    }

    const supported = await schemaGate({
      enabled: true,
      relation: "rfq_destinations",
      requiredColumns: ["id", "dispatch_started_at"],
      warnPrefix: "[dispatch started]",
      warnKey: "dispatch_started:rfq_destinations",
    });

    if (!supported) {
      return NextResponse.json({ ok: true, skipped: true });
    }

    const now = new Date().toISOString();
    const { error } = await supabaseServer()
      .from("rfq_destinations")
      .update({ dispatch_started_at: now })
      .eq("id", destinationId)
      .is("dispatch_started_at", null);

    if (error) {
      if (isMissingTableOrColumnError(error)) {
        return NextResponse.json({ ok: true, skipped: true });
      }
      console.error("[dispatch started] update failed", {
        destinationId,
        error: serializeSupabaseError(error) ?? error,
      });
      return NextResponse.json(
        { ok: false, error: "update_failed" },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json(
        { ok: false, error: "unauthorized" },
        { status: 401 },
      );
    }
    console.error("[dispatch started] unexpected error", {
      error: serializeSupabaseError(error) ?? error,
    });
    return NextResponse.json({ ok: false, error: "unknown" }, { status: 500 });
  }
}
