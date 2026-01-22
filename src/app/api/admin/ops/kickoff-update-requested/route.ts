import { NextResponse } from "next/server";

import { requireAdminUser, UnauthorizedError } from "@/server/auth";
import { serializeSupabaseError } from "@/server/admin/logging";
import { logOpsEvent } from "@/server/ops/events";

type PostBody = {
  quoteId?: unknown;
  context?: unknown;
};

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isUuidLike(value: string): boolean {
  const v = typeof value === "string" ? value.trim() : "";
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

export async function POST(req: Request) {
  try {
    await requireAdminUser();

    const body = (await req.json().catch(() => null)) as PostBody | null;
    const quoteId = normalizeString(body?.quoteId);

    if (!isUuidLike(quoteId)) {
      return NextResponse.json({ ok: false, error: "invalid_quote_id" }, { status: 400 });
    }

    // Fail-soft: logOpsEvent swallows missing schema / unsupported event type constraint violations.
    void logOpsEvent({
      quoteId,
      eventType: "kickoff_update_requested",
      payload: {
        context: body?.context ?? undefined,
      },
    });

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
    console.error("[kickoff update requested] unexpected error", {
      error: serializeSupabaseError(error) ?? error,
    });
    return NextResponse.json({ ok: true }, { status: 200 });
  }
}

