import { NextResponse } from "next/server";

import { supabaseServer } from "@/lib/supabaseServer";
import { requireAdminUser, UnauthorizedError } from "@/server/auth";
import { schemaGate } from "@/server/db/schemaContract";
import { isMissingTableOrColumnError, serializeSupabaseError, warnOnce } from "@/server/db/schemaErrors";
import { buildSupplierThreadEmail, getEmailOutboundStatus, getEmailSender } from "@/server/quotes/emailOutbound";

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

const QUOTE_MESSAGES_RELATION = "quote_messages";
const QUOTES_RELATION = "quotes";
const SUPPLIERS_RELATION = "suppliers";

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

    const supplierId = await resolveSupplierId({ quoteId });
    if (!supplierId) {
      return NextResponse.json({ ok: false, error: "unsupported" }, { status: 200 });
    }

    const toEmail = await resolveSupplierEmail({ supplierId });
    if (!toEmail) {
      return NextResponse.json({ ok: false, error: "missing_recipient" }, { status: 200 });
    }

    const recentMessages = await loadRecentThreadMessages({ quoteId });

    const inviteText = [
      "You can reply to this email to respond.",
      "Messages and attachments will appear in the portal thread.",
      "",
      "Tip: keep the “To” address unchanged so your reply stays attached to this RFQ.",
    ].join("\n");

    const emailReq = buildSupplierThreadEmail({
      quoteId,
      supplierId,
      toEmail,
      adminMessageText: inviteText,
      context: {
        shortQuoteLabel: quoteId.slice(0, 8),
        recentMessages,
      },
    });
    if (!emailReq) {
      return NextResponse.json({ ok: false, error: "disabled" }, { status: 200 });
    }

    console.log(`${WARN_PREFIX} sending`, { quoteId, supplierId });
    const sendResult = await getEmailSender().send(emailReq);
    if (!sendResult.ok) {
      return NextResponse.json({ ok: false, error: sendResult.error }, { status: 200 });
    }

    return NextResponse.json({ ok: true, sent: true }, { status: 200 });
  } catch (err: unknown) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
    console.error(`${WARN_PREFIX} crashed`, { quoteId, error: err });
    return NextResponse.json({ ok: false, error: "unknown" }, { status: 500 });
  }
}

async function resolveSupplierId(args: { quoteId: string }): Promise<string | null> {
  const supported = await schemaGate({
    enabled: true,
    relation: QUOTES_RELATION,
    requiredColumns: ["id", "awarded_supplier_id"],
    warnPrefix: WARN_PREFIX,
    warnKey: "email_invite_supplier:quotes_awarded_supplier_id",
  });
  if (!supported) return null;

  try {
    const { data, error } = await supabaseServer
      .from(QUOTES_RELATION)
      .select("awarded_supplier_id")
      .eq("id", args.quoteId)
      .maybeSingle<{ awarded_supplier_id: string | null }>();
    if (error) {
      if (isMissingTableOrColumnError(error)) {
        warnOnce("email_invite_supplier:quotes_select_missing_schema", `${WARN_PREFIX} quotes schema drift; skipping`, {
          code: serializeSupabaseError(error).code,
        });
        return null;
      }
      console.warn(`${WARN_PREFIX} quote lookup failed`, { code: serializeSupabaseError(error).code });
      return null;
    }
    const awarded = typeof data?.awarded_supplier_id === "string" ? data.awarded_supplier_id.trim() : "";
    return awarded || null;
  } catch (error) {
    console.warn(`${WARN_PREFIX} quote lookup crashed`, { error });
    return null;
  }
}

async function resolveSupplierEmail(args: { supplierId: string }): Promise<string | null> {
  const emailSupported = await schemaGate({
    enabled: true,
    relation: SUPPLIERS_RELATION,
    requiredColumns: ["id", "email"],
    warnPrefix: WARN_PREFIX,
    warnKey: "email_invite_supplier:suppliers_email",
  });
  const primarySupported = !emailSupported
    ? await schemaGate({
        enabled: true,
        relation: SUPPLIERS_RELATION,
        requiredColumns: ["id", "primary_email"],
        warnPrefix: WARN_PREFIX,
        warnKey: "email_invite_supplier:suppliers_primary_email",
      })
    : false;

  if (!emailSupported && !primarySupported) return null;

  try {
    const select = emailSupported ? "email" : "primary_email";
    const { data, error } = await supabaseServer
      .from(SUPPLIERS_RELATION)
      .select(select)
      .eq("id", args.supplierId)
      .maybeSingle<Record<string, string | null>>();

    if (error) {
      if (isMissingTableOrColumnError(error)) {
        warnOnce("email_invite_supplier:suppliers_select_missing_schema", `${WARN_PREFIX} suppliers schema drift; skipping`, {
          code: serializeSupabaseError(error).code,
        });
        return null;
      }
      console.warn(`${WARN_PREFIX} supplier lookup failed`, { code: serializeSupabaseError(error).code });
      return null;
    }

    const raw = typeof data?.[select] === "string" ? (data?.[select] as string) : "";
    const trimmed = raw.trim();
    return trimmed && trimmed.includes("@") ? trimmed : null;
  } catch (error) {
    console.warn(`${WARN_PREFIX} supplier lookup crashed`, { error });
    return null;
  }
}

async function loadRecentThreadMessages(args: { quoteId: string }) {
  const supported = await schemaGate({
    enabled: true,
    relation: QUOTE_MESSAGES_RELATION,
    requiredColumns: ["quote_id", "sender_role", "body", "created_at"],
    warnPrefix: WARN_PREFIX,
    warnKey: "email_invite_supplier:quote_messages_context",
  });
  if (!supported) return null;

  try {
    const { data, error } = await supabaseServer
      .from(QUOTE_MESSAGES_RELATION)
      .select("sender_role,body,created_at")
      .eq("quote_id", args.quoteId)
      .order("created_at", { ascending: false })
      .limit(3);
    if (error) return null;
    const rows = Array.isArray(data) ? data : [];
    return rows.map((row) => ({
      senderRole: typeof (row as any)?.sender_role === "string" ? (row as any).sender_role : null,
      body: typeof (row as any)?.body === "string" ? (row as any).body : null,
      createdAt: typeof (row as any)?.created_at === "string" ? (row as any).created_at : null,
    }));
  } catch {
    return null;
  }
}

function isUuidLike(value: string): boolean {
  const v = typeof value === "string" ? value.trim() : "";
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

