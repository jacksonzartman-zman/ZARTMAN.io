import { NextResponse } from "next/server";

import { supabaseServer } from "@/lib/supabaseServer";
import { requireAdminUser, UnauthorizedError } from "@/server/auth";
import { schemaGate } from "@/server/db/schemaContract";
import { isMissingTableOrColumnError, serializeSupabaseError, warnOnce } from "@/server/db/schemaErrors";
import { buildSupplierThreadEmail, getEmailOutboundStatus, getEmailSender } from "@/server/quotes/emailOutbound";

/**
 * Phase 19.3.2 verification (outbound supplier email bridge)
 *
 * Required env vars:
 * - EMAIL_PROVIDER
 * - EMAIL_FROM
 * - EMAIL_REPLY_DOMAIN
 * - EMAIL_BRIDGE_SECRET
 * - POSTMARK_SERVER_TOKEN (when EMAIL_PROVIDER=postmark)
 *
 * Expected behaviors (fail-soft; do not hard-fail when disabled/unsupported):
 * - Disabled/unsupported config: { ok:false, error:"disabled" | "unsupported" } with HTTP 200
 * - Missing recipient: { ok:false, error:"missing_recipient" } with HTTP 200
 * - Unsupported association (no awarded supplier): { ok:false, error:"unsupported" } with HTTP 200
 * - Success: { ok:true, sent:true, threadStored:<bool> } with HTTP 200
 * - If `quote_messages` is missing/unavailable: still sends email and returns threadStored:false
 */
const WARN_PREFIX = "[email_outbound_api]";

const QUOTE_MESSAGES_RELATION = "quote_messages";
const QUOTES_RELATION = "quotes";
const SUPPLIERS_RELATION = "suppliers";

export const runtime = "nodejs";

type PostBody = {
  supplierId?: string;
  toEmail?: string;
  message?: string;
};

export async function POST(req: Request, context: { params: Promise<{ id?: string }> }) {
  const params = await context.params;
  const quoteId = typeof params?.id === "string" ? params.id.trim() : "";

  try {
    const admin = await requireAdminUser();

    if (!isUuidLike(quoteId)) {
      return NextResponse.json({ ok: false, error: "invalid_quote_id" }, { status: 400 });
    }

    const body = (await req.json().catch(() => null)) as PostBody | null;
    const message = typeof body?.message === "string" ? body.message.trim() : "";
    if (!message || message.length > 5000) {
      return NextResponse.json({ ok: false, error: "invalid_message" }, { status: 400 });
    }

    const status = getEmailOutboundStatus();
    if (!status.enabled) {
      // Fail-soft: configuration disabled by default.
      return NextResponse.json({ ok: false, error: status.reason === "unsupported" ? "unsupported" : "disabled" }, { status: 200 });
    }

    const supplierId = await resolveSupplierId({
      quoteId,
      preferredSupplierId: typeof body?.supplierId === "string" ? body.supplierId.trim() : "",
    });
    if (!supplierId) {
      return NextResponse.json({ ok: false, error: "unsupported" }, { status: 200 });
    }

    const toEmail = await resolveSupplierEmail({
      supplierId,
      preferredToEmail: typeof body?.toEmail === "string" ? body.toEmail.trim() : "",
    });
    if (!toEmail) {
      return NextResponse.json({ ok: false, error: "missing_recipient" }, { status: 200 });
    }

    const recentMessages = await loadRecentThreadMessages({ quoteId });

    const emailReq = buildSupplierThreadEmail({
      quoteId,
      supplierId,
      toEmail,
      adminMessageText: message,
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

    const threadStored = await tryStoreAdminThreadMessage({
      quoteId,
      supplierId,
      adminUserId: admin.id,
      adminEmail: admin.email ?? null,
      body: message,
    });

    return NextResponse.json({ ok: true, sent: true, threadStored }, { status: 200 });
  } catch (err: unknown) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
    console.error(`${WARN_PREFIX} crashed`, { quoteId, error: err });
    return NextResponse.json({ ok: false, error: "unknown" }, { status: 500 });
  }
}

async function resolveSupplierId(args: {
  quoteId: string;
  preferredSupplierId: string;
}): Promise<string | null> {
  const preferred = typeof args.preferredSupplierId === "string" ? args.preferredSupplierId.trim() : "";
  if (preferred) return preferred;

  const supported = await schemaGate({
    enabled: true,
    relation: QUOTES_RELATION,
    requiredColumns: ["id", "awarded_supplier_id"],
    warnPrefix: WARN_PREFIX,
    warnKey: "email_outbound:quotes_awarded_supplier_id",
  });
  if (!supported) {
    return null;
  }

  try {
    const { data, error } = await supabaseServer
      .from(QUOTES_RELATION)
      .select("awarded_supplier_id")
      .eq("id", args.quoteId)
      .maybeSingle<{ awarded_supplier_id: string | null }>();
    if (error) {
      if (isMissingTableOrColumnError(error)) {
        warnOnce("email_outbound:quotes_select_missing_schema", `${WARN_PREFIX} quotes schema drift; skipping`, {
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

async function resolveSupplierEmail(args: {
  supplierId: string;
  preferredToEmail: string;
}): Promise<string | null> {
  const preferred = typeof args.preferredToEmail === "string" ? args.preferredToEmail.trim() : "";
  if (preferred) return preferred;

  const emailSupported = await schemaGate({
    enabled: true,
    relation: SUPPLIERS_RELATION,
    requiredColumns: ["id", "email"],
    warnPrefix: WARN_PREFIX,
    warnKey: "email_outbound:suppliers_email",
  });
  const primarySupported = !emailSupported
    ? await schemaGate({
        enabled: true,
        relation: SUPPLIERS_RELATION,
        requiredColumns: ["id", "primary_email"],
        warnPrefix: WARN_PREFIX,
        warnKey: "email_outbound:suppliers_primary_email",
      })
    : false;

  if (!emailSupported && !primarySupported) {
    return null;
  }

  try {
    const select = emailSupported ? "email" : "primary_email";
    const { data, error } = await supabaseServer
      .from(SUPPLIERS_RELATION)
      .select(select)
      .eq("id", args.supplierId)
      .maybeSingle<Record<string, string | null>>();

    if (error) {
      if (isMissingTableOrColumnError(error)) {
        warnOnce("email_outbound:suppliers_select_missing_schema", `${WARN_PREFIX} suppliers schema drift; skipping`, {
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
    warnKey: "email_outbound:quote_messages_context",
  });
  if (!supported) return null;

  try {
    const { data, error } = await supabaseServer
      .from(QUOTE_MESSAGES_RELATION)
      .select("sender_role,body,created_at")
      .eq("quote_id", args.quoteId)
      .order("created_at", { ascending: false })
      .limit(3);
    if (error) {
      return null;
    }
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

async function tryStoreAdminThreadMessage(args: {
  quoteId: string;
  supplierId: string;
  adminUserId: string;
  adminEmail: string | null;
  body: string;
}): Promise<boolean> {
  const supported = await schemaGate({
    enabled: true,
    relation: QUOTE_MESSAGES_RELATION,
    requiredColumns: ["quote_id", "sender_role", "sender_id", "body"],
    warnPrefix: WARN_PREFIX,
    warnKey: "email_outbound:quote_messages_store",
  });
  if (!supported) {
    return false;
  }

  const basePayload: Record<string, unknown> = {
    quote_id: args.quoteId,
    sender_role: "admin",
    sender_id: args.adminUserId,
    body: args.body,
  };

  const extendedPayload: Record<string, unknown> = {
    ...basePayload,
    sender_name: null,
    sender_email: args.adminEmail ? String(args.adminEmail).toLowerCase().slice(0, 240) : null,
    supplier_id: args.supplierId,
    metadata: { via: "email_outbound" },
  };

  try {
    const { error: extendedError } = await supabaseServer.from(QUOTE_MESSAGES_RELATION).insert(extendedPayload);
    if (!extendedError) return true;

    if (isMissingTableOrColumnError(extendedError)) {
      warnOnce(
        "email_outbound:quote_messages_insert_degraded",
        `${WARN_PREFIX} message insert degraded; retrying minimal`,
        {
          code: serializeSupabaseError(extendedError).code,
        },
      );
    }

    const { error: baseError } = await supabaseServer.from(QUOTE_MESSAGES_RELATION).insert(basePayload);
    if (baseError) {
      if (isMissingTableOrColumnError(baseError)) {
        warnOnce("email_outbound:quote_messages_insert_missing_schema", `${WARN_PREFIX} message insert skipped`, {
          code: serializeSupabaseError(baseError).code,
        });
        return false;
      }
      console.warn(`${WARN_PREFIX} message insert failed`, { code: serializeSupabaseError(baseError).code });
      return false;
    }

    return true;
  } catch (error) {
    console.warn(`${WARN_PREFIX} message insert crashed`, { error });
    return false;
  }
}

function isUuidLike(value: string): boolean {
  const v = typeof value === "string" ? value.trim() : "";
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

