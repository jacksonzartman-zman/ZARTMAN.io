import { NextResponse } from "next/server";

import { requireAdminUser, UnauthorizedError } from "@/server/auth";
import { schemaGate } from "@/server/db/schemaContract";
import { createQuoteMessage } from "@/server/quotes/messages";
import { emitQuoteEvent } from "@/server/quotes/events";

const QUOTE_MESSAGES_RELATION = "quote_messages";

export async function POST(
  req: Request,
  context: { params: Promise<{ id?: string }> },
) {
  const params = await context.params;
  const quoteId = typeof params?.id === "string" ? params.id.trim() : "";

  try {
    const admin = await requireAdminUser();

    if (!isUuidLike(quoteId)) {
      return NextResponse.json({ ok: false, error: "invalid_quote_id" }, { status: 400 });
    }

    const supported = await schemaGate({
      enabled: true,
      relation: QUOTE_MESSAGES_RELATION,
      requiredColumns: ["quote_id", "sender_id", "sender_role", "body", "created_at"],
      warnPrefix: "[take_action]",
      warnKey: "take_action:quote_messages",
    });

    if (!supported) {
      // Fail-soft: treat missing schema as an "unsupported" no-op.
      return NextResponse.json({ ok: false, error: "unsupported" }, { status: 200 });
    }

    const message = await createQuoteMessage({
      quoteId,
      senderId: admin.id,
      senderRole: "system",
      senderName: "Zartman.io",
      senderEmail: admin.email ?? "admin@zartman.io",
      body: "Ping: Supplier follow-up requested. Please respond or update your status.",
    });

    if (!message.ok) {
      // `createQuoteMessage` logs failures; keep API response stable and non-noisy.
      const code =
        message.reason === "schema_error"
          ? "unsupported"
          : message.reason === "unauthorized"
            ? "unauthorized"
            : message.reason === "validation"
              ? "invalid_input"
              : "write_failed";
      const status = code === "unauthorized" ? 401 : code === "invalid_input" ? 400 : 500;
      return NextResponse.json({ ok: false, error: code }, { status });
    }

    // Best-effort: emit event if the table exists; missing schema is a quiet no-op.
    void emitQuoteEvent({
      quoteId,
      eventType: "supplier_nudged",
      actorRole: "admin",
      actorUserId: admin.id,
      actorSupplierId: null,
      metadata: { quoteId },
    });

    return NextResponse.json({
      ok: true,
      quoteId,
      messageId: message.message?.id ?? null,
    });
  } catch (err: unknown) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }

    return NextResponse.json({ ok: false, error: "unknown" }, { status: 500 });
  }
}

function isUuidLike(value: string): boolean {
  const v = typeof value === "string" ? value.trim() : "";
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

