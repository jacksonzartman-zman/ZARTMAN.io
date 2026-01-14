import { NextResponse } from "next/server";

import { requireAdminUser, UnauthorizedError } from "@/server/auth";
import { getEmailOutboundStatus } from "@/server/quotes/emailOutbound";
import { sendSupplierInviteEmail } from "@/server/quotes/emailInvites";

/**
 * Phase 19.3.9 (admin onboarding invite)
 *
 * Fail-soft requirements:
 * - Disabled/unsupported config: HTTP 200 { ok:false, error:"disabled" | "unsupported" }
 * - Missing recipient: HTTP 200 { ok:false, error:"missing_recipient" }
 * - Unsupported association (no awarded supplier): HTTP 200 { ok:false, error:"unsupported" }
 * - Success: HTTP 200 { ok:true, sent:true }
 *
 * Never include PII (to/from/subject/body) in logs.
 */
const WARN_PREFIX = "[email_invite_supplier_api]";

export const runtime = "nodejs";

export async function POST(_req: Request, context: { params: Promise<{ id?: string }> }) {
  const params = await context.params;
  const quoteId = typeof params?.id === "string" ? params.id.trim() : "";

  try {
    await requireAdminUser();

    if (!isUuidLike(quoteId)) {
      return NextResponse.json({ ok: false, error: "invalid_quote_id" }, { status: 400 });
    }

    const status = getEmailOutboundStatus();
    if (!status.enabled) {
      return NextResponse.json(
        { ok: false, error: status.reason === "unsupported" ? "unsupported" : "disabled" },
        { status: 200 },
      );
    }

    const result = await sendSupplierInviteEmail({ quoteId });
    if (!result.ok) {
      const error =
        result.error === "missing_recipient"
          ? "missing_recipient"
          : result.error === "unsupported"
            ? "unsupported"
            : result.error === "send_failed"
              ? "send_failed"
              : "disabled";
      return NextResponse.json({ ok: false, error }, { status: 200 });
    }

    console.log(`${WARN_PREFIX} sent`, { quoteId });
    return NextResponse.json({ ok: true, sent: true }, { status: 200 });
  } catch (err: unknown) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
    console.error(`${WARN_PREFIX} crashed`, { quoteId, error: err });
    return NextResponse.json({ ok: false, error: "unknown" }, { status: 500 });
  }
}

function isUuidLike(value: string): boolean {
  const v = typeof value === "string" ? value.trim() : "";
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

