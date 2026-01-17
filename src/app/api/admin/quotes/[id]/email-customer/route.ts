import { NextResponse } from "next/server";

import { supabaseServer } from "@/lib/supabaseServer";
import { requireAdminUser, UnauthorizedError } from "@/server/auth";
import { schemaGate } from "@/server/db/schemaContract";
import {
  debugOnce,
  handleMissingSupabaseSchema,
  isMissingTableOrColumnError,
  serializeSupabaseError,
  warnOnce,
} from "@/server/db/schemaErrors";
import { buildCustomerThreadEmail, getEmailOutboundStatus, getEmailSender } from "@/server/quotes/emailOutbound";
import { resolveOutboundAttachments } from "@/server/quotes/emailAttachments";

/**
 * Phase 19.3.4 verification (outbound customer email bridge)
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
 * - Unsupported association (no customer_id): { ok:false, error:"unsupported" } with HTTP 200
 * - Success: { ok:true, sent:true, threadStored:<bool> } with HTTP 200
 * - If `quote_messages` is missing/unavailable: still sends email and returns threadStored:false
 */
const WARN_PREFIX = "[email_outbound_customer_api]";

const QUOTE_MESSAGES_RELATION = "quote_messages";
const QUOTES_RELATION = "quotes";
const CUSTOMERS_RELATION = "customers";

export const runtime = "nodejs";

type PostBody = {
  toEmail?: string;
  message?: string;
  attachmentFileIds?: string[];
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

    const hasAttachmentFileIdsField =
      Boolean(body) && typeof body === "object" && body !== null && "attachmentFileIds" in (body as any);
    const attachmentFileIds = Array.isArray(body?.attachmentFileIds)
      ? body!.attachmentFileIds.map((v) => (typeof v === "string" ? v.trim() : "")).filter(Boolean).slice(0, 25)
      : null;

    const status = getEmailOutboundStatus();
    if (!status.enabled) {
      return NextResponse.json({ ok: false, error: status.reason === "unsupported" ? "unsupported" : "disabled" }, { status: 200 });
    }

    const resolved = await resolveCustomerRecipient({
      quoteId,
      preferredToEmail: typeof body?.toEmail === "string" ? body.toEmail.trim() : "",
    });
    if (!resolved.ok) {
      return NextResponse.json({ ok: false, error: resolved.error }, { status: 200 });
    }

    const recentMessages = await loadRecentThreadMessages({ quoteId });
    const emailReq = buildCustomerThreadEmail({
      quoteId,
      customerId: resolved.customerId,
      toEmail: resolved.toEmail,
      adminMessageText: message,
      context: {
        shortQuoteLabel: quoteId.slice(0, 8),
        recentMessages,
      },
    });
    if (!emailReq) {
      return NextResponse.json({ ok: false, error: "disabled" }, { status: 200 });
    }

    // Threading: best-effort set In-Reply-To/References when we have prior inbound provider ids.
    const threadingHeaders = await loadLatestInboundThreadingHeaders({ quoteId, senderRole: "customer" });
    if (threadingHeaders) {
      emailReq.headers = threadingHeaders;
    }

    const attachmentsResult = hasAttachmentFileIdsField
      ? await resolveOutboundAttachments({
          quoteId,
          fileIds: attachmentFileIds,
        })
      : { attachments: [] };
    const attachments = attachmentsResult.attachments;
    if (attachments.length > 0) {
      emailReq.attachments = attachments.map((a) => ({
        filename: a.filename,
        contentType: a.contentType,
        contentBase64: a.contentBase64,
      }));
    }

    console.log(`${WARN_PREFIX} sending`, { quoteId, customerId: resolved.customerId });
    const sendResult = await getEmailSender().send(emailReq);
    if (!sendResult.ok) {
      return NextResponse.json({ ok: false, error: sendResult.error }, { status: 200 });
    }

    const threadStored = await tryStoreAdminThreadMessage({
      quoteId,
      customerId: resolved.customerId,
      adminUserId: admin.id,
      adminEmail: admin.email ?? null,
      body: message,
      attachmentsMeta:
        attachments.length > 0
          ? attachments.map((a) => ({
              fileId: typeof a.fileId === "string" ? a.fileId : null,
              filename: a.filename,
              sizeBytes: a.sizeBytes,
            }))
          : null,
    });

    const attachmentsMode: "none" | "latest_inbound" | "explicit" = hasAttachmentFileIdsField
      ? Array.isArray(attachmentFileIds) && attachmentFileIds.length > 0
        ? "explicit"
        : "latest_inbound"
      : "none";
    const requestedCount = hasAttachmentFileIdsField
      ? Math.max(Array.isArray(attachmentFileIds) ? attachmentFileIds.length : 0, attachments.length)
      : 0;
    return NextResponse.json(
      {
        ok: true,
        sent: true,
        threadStored,
        attachmentsSent: attachments.length,
        attachmentsRequested: requestedCount,
        attachmentsMode,
      },
      { status: 200 },
    );
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
  preferredToEmail: string;
}): Promise<
  | { ok: true; customerId: string; toEmail: string }
  | { ok: false; error: "missing_recipient" | "unsupported" }
> {
  const preferred = normalizeEmail(args.preferredToEmail);
  if (preferred) {
    // If admin explicitly supplies an email, we still need a customerId for token attribution.
    const idFromQuote = await resolveCustomerIdFromQuote(args.quoteId);
    if (!idFromQuote) return { ok: false, error: "unsupported" };
    return { ok: true, customerId: idFromQuote, toEmail: preferred };
  }

  const supported = await schemaGate({
    enabled: true,
    relation: QUOTES_RELATION,
    requiredColumns: ["id", "customer_id", "customer_email"],
    warnPrefix: WARN_PREFIX,
    warnKey: "email_outbound_customer:quotes_customer",
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
          warnKey: "email_outbound_customer:quotes_select_missing_schema",
        })
      ) {
        return { ok: false, error: "unsupported" };
      }
      warnOnce("email_outbound_customer:quote_lookup_failed", `${WARN_PREFIX} quote lookup failed`, {
        code: serializeSupabaseError(error).code,
      });
      return { ok: false, error: "unsupported" };
    }

    const customerId = normalizeString(data?.customer_id);
    const quoteEmail = normalizeEmail(data?.customer_email ?? null);
    if (!quoteEmail) {
      return { ok: false, error: "missing_recipient" };
    }

    // Prefer quotes.customer_id; otherwise best-effort derive from customers table by email.
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
        warnKey: "email_outbound_customer:quotes_select_missing_schema_crash",
      })
    ) {
      return { ok: false, error: "unsupported" };
    }
    console.warn(`${WARN_PREFIX} quote lookup crashed`, { error });
    return { ok: false, error: "unsupported" };
  }
}

async function resolveCustomerIdFromQuote(quoteId: string): Promise<string | null> {
  const supported = await schemaGate({
    enabled: true,
    relation: QUOTES_RELATION,
    requiredColumns: ["id", "customer_id"],
    warnPrefix: WARN_PREFIX,
    warnKey: "email_outbound_customer:quotes_customer_id",
  });
  if (!supported) return null;

  try {
    const { data, error } = await supabaseServer
      .from(QUOTES_RELATION)
      .select("customer_id")
      .eq("id", quoteId)
      .maybeSingle<{ customer_id: string | null }>();

    if (error) {
      return null;
    }
    const id = normalizeString(data?.customer_id);
    return id || null;
  } catch {
    return null;
  }
}

async function resolveCustomerIdByEmail(email: string): Promise<string | null> {
  const supported = await schemaGate({
    enabled: true,
    relation: CUSTOMERS_RELATION,
    requiredColumns: ["id", "email"],
    warnPrefix: WARN_PREFIX,
    warnKey: "email_outbound_customer:customers_email",
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
          warnKey: "email_outbound_customer:customers_select_missing_schema",
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
    warnKey: "email_outbound_customer:quote_messages_context",
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
      if (isMissingTableOrColumnError(error)) {
        return null;
      }
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
  customerId: string;
  adminUserId: string;
  adminEmail: string | null;
  body: string;
  attachmentsMeta: Array<{ fileId: string | null; filename: string; sizeBytes: number }> | null;
}): Promise<boolean> {
  const supported = await schemaGate({
    enabled: true,
    relation: QUOTE_MESSAGES_RELATION,
    requiredColumns: ["quote_id", "sender_role", "sender_id", "body"],
    warnPrefix: WARN_PREFIX,
    warnKey: "email_outbound_customer:quote_messages_store",
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
    customer_id: args.customerId,
    metadata: {
      via: "email",
      outbound: true,
      ...(args.attachmentsMeta && args.attachmentsMeta.length > 0 ? { attachments: args.attachmentsMeta } : {}),
    },
  };

  try {
    const { error: extendedError } = await supabaseServer.from(QUOTE_MESSAGES_RELATION).insert(extendedPayload);
    if (!extendedError) return true;

    if (isMissingTableOrColumnError(extendedError)) {
      debugOnce(
        "email_outbound_customer:quote_messages_insert_degraded",
        `${WARN_PREFIX} message insert degraded; retrying minimal`,
        {
          code: serializeSupabaseError(extendedError).code,
        },
      );
    }

    const { error: baseError } = await supabaseServer.from(QUOTE_MESSAGES_RELATION).insert(basePayload);
    if (baseError) {
      if (isMissingTableOrColumnError(baseError)) {
        debugOnce("email_outbound_customer:quote_messages_insert_missing_schema", `${WARN_PREFIX} message insert skipped`, {
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

async function loadLatestInboundThreadingHeaders(args: {
  quoteId: string;
  senderRole: "supplier" | "customer";
}): Promise<Record<string, string> | null> {
  const supported = await schemaGate({
    enabled: true,
    relation: QUOTE_MESSAGES_RELATION,
    requiredColumns: ["quote_id", "sender_role", "metadata"],
    warnPrefix: WARN_PREFIX,
    warnKey: "email_outbound_customer:quote_messages_threading_meta",
  });
  if (!supported) return null;

  const pickString = (meta: unknown, key: string): string | null => {
    if (!meta || typeof meta !== "object") return null;
    const v = (meta as any)?.[key];
    const s = typeof v === "string" ? v.trim() : "";
    return s ? s : null;
  };

  const readProviderMessageId = (meta: unknown): string | null => {
    return pickString(meta, "providerMessageId") ?? pickString(meta, "messageId");
  };

  const readReferences = (meta: unknown): string[] => {
    if (!meta || typeof meta !== "object") return [];
    const raw = (meta as any)?.references;
    if (!Array.isArray(raw)) return [];
    return raw
      .map((v: unknown) => (typeof v === "string" ? v.trim() : ""))
      .filter(Boolean)
      .slice(0, 25);
  };

  const buildReferencesHeader = (messageId: string, refs: string[]): string => {
    const uniq: string[] = [];
    const seen = new Set<string>();
    for (const r of [...refs, messageId]) {
      const s = typeof r === "string" ? r.trim() : "";
      if (!s) continue;
      if (seen.has(s)) continue;
      seen.add(s);
      uniq.push(s);
      if (uniq.length >= 25) break;
    }
    let joined = uniq.join(" ");
    if (joined.length > 1800) {
      joined = joined.slice(0, 1800);
    }
    return joined;
  };

  try {
    let query = supabaseServer
      .from(QUOTE_MESSAGES_RELATION)
      .select("id,metadata,created_at")
      .eq("quote_id", args.quoteId)
      .eq("sender_role", args.senderRole)
      .order("created_at", { ascending: false })
      .limit(25) as any;

    let result = (await query) as { data?: any[]; error?: unknown };
    if (result.error && isMissingTableOrColumnError(result.error)) {
      const fallbackQuery = supabaseServer
        .from(QUOTE_MESSAGES_RELATION)
        .select("id,metadata")
        .eq("quote_id", args.quoteId)
        .eq("sender_role", args.senderRole)
        .order("id", { ascending: false })
        .limit(25) as any;
      result = (await fallbackQuery) as { data?: any[]; error?: unknown };
    }

    if (result.error) {
      return null;
    }

    const rows = Array.isArray(result.data) ? result.data : [];
    for (const row of rows) {
      const meta = row?.metadata && typeof row.metadata === "object" ? row.metadata : null;
      const messageId = readProviderMessageId(meta);
      if (!messageId) continue;

      const refs = readReferences(meta);
      return {
        "In-Reply-To": messageId,
        References: refs.length > 0 ? buildReferencesHeader(messageId, refs) : messageId,
      };
    }

    return null;
  } catch {
    return null;
  }
}

