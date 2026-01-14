import { NextResponse } from "next/server";

import { supabaseServer } from "@/lib/supabaseServer";
import { requireAdminUser, UnauthorizedError } from "@/server/auth";
import { schemaGate } from "@/server/db/schemaContract";
import {
  handleMissingSupabaseSchema,
  isMissingTableOrColumnError,
  serializeSupabaseError,
  warnOnce,
} from "@/server/db/schemaErrors";
import { getCustomerEmailOptInStatus, isCustomerEmailBridgeEnabled } from "@/server/quotes/customerEmailPrefs";
import { buildCustomerThreadEmail, getEmailOutboundStatus, getEmailSender } from "@/server/quotes/emailOutbound";

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

const QUOTE_MESSAGES_RELATION = "quote_messages";
const QUOTES_RELATION = "quotes";
const CUSTOMERS_RELATION = "customers";

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

    const resolved = await resolveCustomerRecipient({ quoteId });
    if (!resolved.ok) {
      return NextResponse.json({ ok: false, error: resolved.error }, { status: 200 });
    }

    const optIn = await getCustomerEmailOptInStatus({ quoteId, customerId: resolved.customerId });
    if (!optIn.ok) {
      return NextResponse.json({ ok: false, error: optIn.error }, { status: 200 });
    }
    if (!optIn.optedIn) {
      return NextResponse.json({ ok: false, error: "not_opted_in" }, { status: 200 });
    }

    const recentMessages = await loadRecentThreadMessages({ quoteId });

    const inviteText = [
      "You can reply to this email to respond.",
      "Messages and attachments will appear in the portal thread.",
      "",
      "Tip: keep the “To” address unchanged so your reply stays attached to this RFQ.",
    ].join("\n");

    const emailReq = buildCustomerThreadEmail({
      quoteId,
      customerId: resolved.customerId,
      toEmail: resolved.toEmail,
      adminMessageText: inviteText,
      context: {
        shortQuoteLabel: quoteId.slice(0, 8),
        recentMessages,
      },
    });
    if (!emailReq) {
      return NextResponse.json({ ok: false, error: "disabled" }, { status: 200 });
    }

    console.log(`${WARN_PREFIX} sending`, { quoteId, customerId: resolved.customerId });
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

async function resolveCustomerRecipient(args: {
  quoteId: string;
}): Promise<
  | { ok: true; customerId: string; toEmail: string }
  | { ok: false; error: "missing_recipient" | "unsupported" }
> {
  const supported = await schemaGate({
    enabled: true,
    relation: QUOTES_RELATION,
    requiredColumns: ["id", "customer_id", "customer_email"],
    warnPrefix: WARN_PREFIX,
    warnKey: "email_invite_customer:quotes_customer",
  });
  if (!supported) {
    return { ok: false, error: "unsupported" };
  }

  type QuoteRow = { customer_id: string | null; customer_email: string | null };

  try {
    const { data, error } = await supabaseServer
      .from(QUOTES_RELATION)
      .select("customer_id,customer_email")
      .eq("id", args.quoteId)
      .maybeSingle<QuoteRow>();

    if (error) {
      if (
        handleMissingSupabaseSchema({
          relation: QUOTES_RELATION,
          error,
          warnPrefix: WARN_PREFIX,
          warnKey: "email_invite_customer:quotes_select_missing_schema",
        })
      ) {
        return { ok: false, error: "unsupported" };
      }
      warnOnce("email_invite_customer:quote_lookup_failed", `${WARN_PREFIX} quote lookup failed`, {
        code: serializeSupabaseError(error).code,
      });
      return { ok: false, error: "unsupported" };
    }

    const customerId = normalizeString(data?.customer_id);
    const quoteEmail = normalizeEmail(data?.customer_email ?? null);
    if (!quoteEmail) {
      return { ok: false, error: "missing_recipient" };
    }

    const finalCustomerId = customerId || (await resolveCustomerIdByEmail(quoteEmail));
    if (!finalCustomerId) {
      return { ok: false, error: "unsupported" };
    }

    return { ok: true, customerId: finalCustomerId, toEmail: quoteEmail };
  } catch (error) {
    if (
      handleMissingSupabaseSchema({
        relation: QUOTES_RELATION,
        error,
        warnPrefix: WARN_PREFIX,
        warnKey: "email_invite_customer:quotes_select_missing_schema_crash",
      })
    ) {
      return { ok: false, error: "unsupported" };
    }
    console.warn(`${WARN_PREFIX} quote lookup crashed`, { error });
    return { ok: false, error: "unsupported" };
  }
}

async function resolveCustomerIdByEmail(email: string): Promise<string | null> {
  const supported = await schemaGate({
    enabled: true,
    relation: CUSTOMERS_RELATION,
    requiredColumns: ["id", "email"],
    warnPrefix: WARN_PREFIX,
    warnKey: "email_invite_customer:customers_email",
  });
  if (!supported) return null;

  try {
    const { data, error } = await supabaseServer
      .from(CUSTOMERS_RELATION)
      .select("id")
      .eq("email", email)
      .maybeSingle<{ id: string | null }>();
    if (error) {
      if (
        handleMissingSupabaseSchema({
          relation: CUSTOMERS_RELATION,
          error,
          warnPrefix: WARN_PREFIX,
          warnKey: "email_invite_customer:customers_select_missing_schema",
        })
      ) {
        return null;
      }
      return null;
    }
    const id = normalizeString(data?.id);
    return id || null;
  } catch {
    return null;
  }
}

async function loadRecentThreadMessages(args: { quoteId: string }) {
  const supported = await schemaGate({
    enabled: true,
    relation: QUOTE_MESSAGES_RELATION,
    requiredColumns: ["quote_id", "sender_role", "body", "created_at"],
    warnPrefix: WARN_PREFIX,
    warnKey: "email_invite_customer:quote_messages_context",
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
      if (isMissingTableOrColumnError(error)) return null;
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

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;
  if (!trimmed.includes("@") || trimmed.includes(" ")) return null;
  if (trimmed.length > 320) return null;
  return trimmed;
}

function isUuidLike(value: string): boolean {
  const v = typeof value === "string" ? value.trim() : "";
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

