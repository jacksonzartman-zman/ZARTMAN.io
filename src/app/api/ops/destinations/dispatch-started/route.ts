import { NextResponse } from "next/server";

import { supabaseServer } from "@/lib/supabaseServer";
import { requireAdminUser, UnauthorizedError } from "@/server/auth";
import { isMissingTableOrColumnError, serializeSupabaseError } from "@/server/admin/logging";
import { schemaGate } from "@/server/db/schemaContract";
import { logOpsEvent } from "@/server/ops/events";

export async function POST(req: Request) {
  try {
    await requireAdminUser();

    const body = (await req.json().catch(() => null)) as {
      destinationId?: unknown;
      quoteId?: unknown;
    } | null;
    const destinationId =
      typeof body?.destinationId === "string" ? body.destinationId.trim() : "";
    const quoteId = typeof body?.quoteId === "string" ? body.quoteId.trim() : "";

    if (!destinationId || !quoteId) {
      return NextResponse.json({ ok: false, error: "missing_params" });
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
    const { data, error } = await supabaseServer
      .from("rfq_destinations")
      .update({ dispatch_started_at: now })
      .eq("id", destinationId)
      .is("dispatch_started_at", null)
      .select("id")
      .returns<Array<{ id: string | null }>>();

    if (error) {
      if (isMissingTableOrColumnError(error)) {
        return NextResponse.json({ ok: true, skipped: true });
      }
      console.error("[dispatch started] update failed", {
        destinationId,
        quoteId,
        error: serializeSupabaseError(error) ?? error,
      });
      return NextResponse.json({ ok: true });
    }

    if (Array.isArray(data) && data.length > 0) {
      void logOpsEvent({
        quoteId,
        destinationId,
        eventType: "destination_dispatch_started",
      });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ ok: true });
    }
    console.error("[dispatch started] unexpected error", {
      error: serializeSupabaseError(error) ?? error,
    });
    return NextResponse.json({ ok: true });
  }
}
