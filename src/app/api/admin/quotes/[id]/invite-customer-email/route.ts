import { NextResponse } from "next/server";

import { requireAdminUser, UnauthorizedError } from "@/server/auth";
import { isCustomerEmailBridgeEnabled } from "@/server/quotes/customerEmailPrefs";
import { getEmailOutboundStatus } from "@/server/quotes/emailOutbound";
import { sendCustomerInviteEmail } from "@/server/quotes/emailInvites";

/**
 * Phase 19.3.9 (admin onboarding invite)
 *
 * Fail-soft requirements:
 * - Disabled/unsupported config: HTTP 200 { ok:false, error:"disabled" | "unsupported" }
 * - Missing recipient: HTTP 200 { ok:false, error:"missing_recipient" }
 * - Unsupported association (no customer_id/email): HTTP 200 { ok:false, error:"unsupported" }
 * - Customer not opted in: HTTP 200 { ok:false, error:"not_opted_in" }
 * - Success: HTTP 200 { ok:true, sent:true }
 *
 * Never include PII (to/from/subject/body) in logs.
 */
const WARN_PREFIX = "[email_invite_customer_api]";

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

    // Respect customer opt-in feature gate. If disabled, do not probe schema.
    if (!isCustomerEmailBridgeEnabled()) {
      return NextResponse.json({ ok: false, error: "disabled" }, { status: 200 });
    }

    const result = await sendCustomerInviteEmail({ quoteId });
    if (!result.ok) {
      // Preserve the route's legacy contract shape.
      const error =
        result.error === "send_failed"
          ? "send_failed"
          : result.error === "missing_recipient"
            ? "missing_recipient"
            : result.error === "not_opted_in"
              ? "not_opted_in"
              : result.error === "unsupported"
                ? "unsupported"
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

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isUuidLike(value: string): boolean {
  const v = typeof value === "string" ? value.trim() : "";
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

