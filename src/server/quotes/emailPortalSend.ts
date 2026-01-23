import { supabaseServer } from "@/lib/supabaseServer";
import { schemaGate } from "@/server/db/schemaContract";
import {
  debugOnce,
  handleMissingSupabaseSchema,
  isMissingTableOrColumnError,
  serializeSupabaseError,
  warnOnce,
} from "@/server/db/schemaErrors";
import { canSupplierEmailCustomer, isCustomerEmailBridgeEnabled } from "@/server/quotes/customerEmailPrefs";
import { createCustomerReplyToken, createReplyToken } from "@/server/quotes/emailBridge";
import { resolveOutboundAttachments } from "@/server/quotes/emailAttachments";
import { getEmailOutboundStatus, getEmailSender, type EmailSendRequest } from "@/server/quotes/emailOutbound";
import { isPortalEmailSendEnabledFlag } from "@/server/quotes/emailOpsFlags";

type PortalSendResult =
  | { ok: true; sent: true; attachmentsSent: number }
  | { ok: false; error: "disabled" | "unsupported" | "not_opted_in" | "missing_recipient" | "send_failed" };

const WARN_PREFIX = "[email_portal_send]";

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeId(value: unknown): string {
  return normalizeString(value);
}

function looksLikeEmail(value: string): boolean {
  const v = normalizeString(value).toLowerCase();
  return v.includes("@") && !v.includes(" ") && v.length <= 320;
}

function clampAttachmentIds(input: unknown): string[] | null {
  if (typeof input === "undefined") return null;
  if (!Array.isArray(input)) return [];
  return input
    .map((v) => normalizeId(v))
    .filter(Boolean)
    .slice(0, 5);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function sanitizeExcerpt(value: unknown, maxLen: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value
    .replace(/\r\n/g, "\n")
    .replace(/\t/g, " ")
    .trim();
  if (!trimmed) return null;
  if (trimmed.length <= maxLen) return trimmed;
  return `${trimmed.slice(0, maxLen - 1)}…`;
}

function isUuidLike(value: string): boolean {
  const v = typeof value === "string" ? value.trim() : "";
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

async function loadRecentThreadMessages(args: { quoteId: string }) {
  const supported = await schemaGate({
    enabled: true,
    relation: "quote_messages",
    requiredColumns: ["quote_id", "sender_role", "body", "created_at"],
    warnPrefix: WARN_PREFIX,
    warnKey: "email_portal_send:quote_messages_context",
  });
  if (!supported) return null;

  try {
    const { data, error } = await supabaseServer()
      .from("quote_messages")
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

async function resolveCustomerRecipient(args: {
  quoteId: string;
}): Promise<{ ok: true; customerId: string; toEmail: string } | { ok: false; error: "unsupported" | "missing_recipient" }> {
  const quoteId = normalizeId(args.quoteId);
  if (!isUuidLike(quoteId)) return { ok: false, error: "unsupported" };

  const quotesSupported = await schemaGate({
    enabled: true,
    relation: "quotes",
    requiredColumns: ["id", "customer_id"],
    warnPrefix: WARN_PREFIX,
    warnKey: "email_portal_send:quotes_customer_id",
  });
  if (!quotesSupported) return { ok: false, error: "unsupported" };

  let customerId: string | null = null;
  try {
    const { data, error } = await supabaseServer()
      .from("quotes")
      .select("customer_id")
      .eq("id", quoteId)
      .maybeSingle<{ customer_id: string | null }>();
    if (error) {
      if (
        handleMissingSupabaseSchema({
          relation: "quotes",
          error,
          warnPrefix: WARN_PREFIX,
          warnKey: "email_portal_send:quotes_customer_id_missing_schema",
        })
      ) {
        return { ok: false, error: "unsupported" };
      }
      return { ok: false, error: "unsupported" };
    }
    customerId = normalizeId(data?.customer_id) || null;
  } catch (error) {
    if (
      handleMissingSupabaseSchema({
        relation: "quotes",
        error,
        warnPrefix: WARN_PREFIX,
        warnKey: "email_portal_send:quotes_customer_id_missing_schema_crash",
      })
    ) {
      return { ok: false, error: "unsupported" };
    }
    return { ok: false, error: "unsupported" };
  }

  if (!customerId) return { ok: false, error: "unsupported" };

  const customersEmailSupported = await schemaGate({
    enabled: true,
    relation: "customers",
    requiredColumns: ["id", "email"],
    warnPrefix: WARN_PREFIX,
    warnKey: "email_portal_send:customers_email",
  });
  const customersPrimarySupported = !customersEmailSupported
    ? await schemaGate({
        enabled: true,
        relation: "customers",
        requiredColumns: ["id", "primary_email"],
        warnPrefix: WARN_PREFIX,
        warnKey: "email_portal_send:customers_primary_email",
      })
    : false;

  if (!customersEmailSupported && !customersPrimarySupported) {
    return { ok: false, error: "unsupported" };
  }

  const select = customersEmailSupported ? "email" : "primary_email";
  try {
    const { data, error } = await supabaseServer()
      .from("customers")
      .select(select)
      .eq("id", customerId)
      .maybeSingle<Record<string, string | null>>();
    if (error) {
      if (isMissingTableOrColumnError(error)) {
        warnOnce("email_portal_send:customers_select_missing_schema", `${WARN_PREFIX} customers schema drift; skipping`, {
          code: serializeSupabaseError(error).code,
        });
        return { ok: false, error: "unsupported" };
      }
      return { ok: false, error: "unsupported" };
    }
    const raw = typeof data?.[select] === "string" ? (data?.[select] as string) : "";
    const toEmail = raw.trim().toLowerCase();
    if (!looksLikeEmail(toEmail)) return { ok: false, error: "missing_recipient" };
    return { ok: true, customerId, toEmail };
  } catch {
    return { ok: false, error: "unsupported" };
  }
}

async function resolveSupplierRecipient(args: {
  quoteId: string;
}): Promise<{ ok: true; supplierId: string; toEmail: string } | { ok: false; error: "unsupported" | "missing_recipient" }> {
  const quoteId = normalizeId(args.quoteId);
  if (!isUuidLike(quoteId)) return { ok: false, error: "unsupported" };

  const quotesSupported = await schemaGate({
    enabled: true,
    relation: "quotes",
    requiredColumns: ["id", "awarded_supplier_id"],
    warnPrefix: WARN_PREFIX,
    warnKey: "email_portal_send:quotes_awarded_supplier_id",
  });
  if (!quotesSupported) return { ok: false, error: "unsupported" };

  let supplierId: string | null = null;
  try {
    const { data, error } = await supabaseServer()
      .from("quotes")
      .select("awarded_supplier_id")
      .eq("id", quoteId)
      .maybeSingle<{ awarded_supplier_id: string | null }>();
    if (error) {
      if (
        handleMissingSupabaseSchema({
          relation: "quotes",
          error,
          warnPrefix: WARN_PREFIX,
          warnKey: "email_portal_send:quotes_awarded_supplier_id_missing_schema",
        })
      ) {
        return { ok: false, error: "unsupported" };
      }
      return { ok: false, error: "unsupported" };
    }
    supplierId = normalizeId(data?.awarded_supplier_id) || null;
  } catch (error) {
    if (
      handleMissingSupabaseSchema({
        relation: "quotes",
        error,
        warnPrefix: WARN_PREFIX,
        warnKey: "email_portal_send:quotes_awarded_supplier_id_missing_schema_crash",
      })
    ) {
      return { ok: false, error: "unsupported" };
    }
    return { ok: false, error: "unsupported" };
  }

  if (!supplierId) return { ok: false, error: "unsupported" };

  const suppliersEmailSupported = await schemaGate({
    enabled: true,
    relation: "suppliers",
    requiredColumns: ["id", "email"],
    warnPrefix: WARN_PREFIX,
    warnKey: "email_portal_send:suppliers_email",
  });
  const suppliersPrimarySupported = !suppliersEmailSupported
    ? await schemaGate({
        enabled: true,
        relation: "suppliers",
        requiredColumns: ["id", "primary_email"],
        warnPrefix: WARN_PREFIX,
        warnKey: "email_portal_send:suppliers_primary_email",
      })
    : false;

  if (!suppliersEmailSupported && !suppliersPrimarySupported) {
    return { ok: false, error: "unsupported" };
  }

  const select = suppliersEmailSupported ? "email" : "primary_email";
  try {
    const { data, error } = await supabaseServer()
      .from("suppliers")
      .select(select)
      .eq("id", supplierId)
      .maybeSingle<Record<string, string | null>>();
    if (error) {
      if (isMissingTableOrColumnError(error)) {
        warnOnce("email_portal_send:suppliers_select_missing_schema", `${WARN_PREFIX} suppliers schema drift; skipping`, {
          code: serializeSupabaseError(error).code,
        });
        return { ok: false, error: "unsupported" };
      }
      return { ok: false, error: "unsupported" };
    }
    const raw = typeof data?.[select] === "string" ? (data?.[select] as string) : "";
    const toEmail = raw.trim().toLowerCase();
    if (!looksLikeEmail(toEmail)) return { ok: false, error: "missing_recipient" };
    return { ok: true, supplierId, toEmail };
  } catch {
    return { ok: false, error: "unsupported" };
  }
}

function buildPortalEmail(args: {
  quoteId: string;
  toEmail: string;
  replyTo: string;
  portalRoleLabel: "Customer" | "Supplier";
  message: string;
  recentMessages: Array<{ senderRole: string | null; body: string | null }> | null;
}): EmailSendRequest {
  const shortQuoteLabel = args.quoteId.slice(0, 8);
  const subject = `Message via portal: ${shortQuoteLabel}`;

  const excerptLines: string[] = [];
  const recent = Array.isArray(args.recentMessages) ? args.recentMessages : [];
  for (const msg of recent.slice(0, 3)) {
    const roleRaw = normalizeString(msg?.senderRole).toLowerCase() || "unknown";
    const label =
      roleRaw === "supplier"
        ? "Supplier"
        : roleRaw === "customer"
          ? "Customer"
          : roleRaw === "admin"
            ? "Zartman Team"
            : roleRaw === "system"
              ? "System"
              : "Unknown";
    const body = sanitizeExcerpt(msg?.body ?? "", 420);
    if (!body) continue;
    excerptLines.push(`[${label}] ${body}`);
  }

  const contextBlock =
    excerptLines.length > 0
      ? `\n\n---\nRecent thread:\n${excerptLines.join("\n\n")}\n`
      : "";

  const text = `Message via portal (${args.portalRoleLabel}):\n\n${args.message}${contextBlock}\n\nReply to this email to respond.\n`;
  const html = `<div style="font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; line-height: 1.4;">
  <p style="margin: 0 0 10px 0; font-size: 12px; color: rgba(148, 163, 184, 1); font-weight: 600;">Message via portal (${escapeHtml(
    args.portalRoleLabel,
  )})</p>
  <p style="white-space: pre-wrap; margin: 0 0 12px 0;">${escapeHtml(args.message)}</p>
  ${
    excerptLines.length > 0
      ? `<hr style="border: 0; border-top: 1px solid rgba(148, 163, 184, 0.35); margin: 16px 0;" />
  <p style="margin: 0 0 8px 0; font-size: 12px; color: rgba(148, 163, 184, 1);">Recent thread:</p>
  <div style="white-space: pre-wrap; font-size: 13px; color: rgba(226, 232, 240, 1);">${escapeHtml(
    excerptLines.join("\n\n"),
  )}</div>`
      : ""
  }
  <p style="margin: 16px 0 0 0; font-size: 13px;"><strong>Reply to this email to respond.</strong></p>
</div>`;

  return {
    to: args.toEmail,
    subject,
    text: text.length > 15000 ? text.slice(0, 15000) : text,
    html,
    replyTo: args.replyTo,
    metadata: {
      quoteId: args.quoteId,
      via: "portal",
    },
  };
}

async function tryStorePortalOutboundThreadMessage(args: {
  quoteId: string;
  senderRole: "supplier" | "customer";
  senderPartyId: string;
  recipientRole: "supplier" | "customer";
  attachmentsMeta: Array<{ fileId: string | null; filename: string; sizeBytes: number }> | null;
}): Promise<boolean> {
  const supported = await schemaGate({
    enabled: true,
    relation: "quote_messages",
    requiredColumns: ["quote_id", "sender_role", "sender_id", "body"],
    warnPrefix: WARN_PREFIX,
    warnKey: "email_portal_send:quote_messages_store",
  });
  if (!supported) return false;

  const basePayload: Record<string, unknown> = {
    quote_id: args.quoteId,
    sender_role: "system",
    sender_id: "00000000-0000-0000-0000-000000000000",
    body: `Sent email to ${args.recipientRole} via portal.`,
  };

  const extendedPayload: Record<string, unknown> = {
    ...basePayload,
    metadata: {
      via: "email",
      outbound: true,
      portal: true,
      senderRole: args.senderRole,
      ...(args.attachmentsMeta && args.attachmentsMeta.length > 0
        ? { attachments: args.attachmentsMeta }
        : {}),
    },
    ...(args.senderRole === "supplier" ? { supplier_id: args.senderPartyId } : {}),
    ...(args.senderRole === "customer" ? { customer_id: args.senderPartyId } : {}),
  };

  try {
    const { error: extendedError } = await supabaseServer().from("quote_messages").insert(extendedPayload);
    if (!extendedError) return true;

    if (isMissingTableOrColumnError(extendedError)) {
      debugOnce(
        "email_portal_send:quote_messages_insert_degraded",
        `${WARN_PREFIX} message insert degraded; retrying minimal`,
        { code: serializeSupabaseError(extendedError).code },
      );
    }

    const { error: baseError } = await supabaseServer().from("quote_messages").insert(basePayload);
    if (baseError) {
      if (isMissingTableOrColumnError(baseError)) {
        debugOnce("email_portal_send:quote_messages_insert_missing_schema", `${WARN_PREFIX} message insert skipped`, {
          code: serializeSupabaseError(baseError).code,
        });
        return false;
      }
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export async function sendEmailToCustomerFromSupplier(args: {
  quoteId: string;
  supplierId: string;
  message: string;
  attachmentFileIds?: string[];
}): Promise<PortalSendResult> {
  if (!isPortalEmailSendEnabledFlag()) {
    return { ok: false, error: "disabled" };
  }

  const status = getEmailOutboundStatus();
  if (!status.enabled) {
    return { ok: false, error: "disabled" };
  }

  const quoteId = normalizeId(args.quoteId);
  const supplierId = normalizeId(args.supplierId);
  const message = normalizeString(args.message);
  if (!isUuidLike(quoteId) || !supplierId || !message) return { ok: false, error: "unsupported" };

  // Safe-by-default: if customer email bridge is off, do not attempt supplier -> customer email.
  if (!isCustomerEmailBridgeEnabled()) {
    return { ok: false, error: "disabled" };
  }

  const recipient = await resolveCustomerRecipient({ quoteId });
  if (!recipient.ok) return { ok: false, error: recipient.error };

  const policy = await canSupplierEmailCustomer({ quoteId, customerId: recipient.customerId });
  if (!policy.ok) return { ok: false, error: policy.reason };
  if (!policy.allowed) return { ok: false, error: "not_opted_in" };

  const replyDomain = normalizeString(process.env.EMAIL_REPLY_DOMAIN);
  const secret = normalizeString(process.env.EMAIL_BRIDGE_SECRET);
  if (!replyDomain || !secret) return { ok: false, error: "disabled" };

  // IMPORTANT: Reply-To token represents the expected replier (recipient),
  // so replies are attributed correctly by the inbound bridge.
  const replyToken = createCustomerReplyToken({ quoteId, customerId: recipient.customerId, secret });
  if (!replyToken) return { ok: false, error: "disabled" };
  const replyTo = `reply+${replyToken}@${replyDomain}`;

  const attachmentFileIds = clampAttachmentIds(args.attachmentFileIds);
  const attachmentsResult =
    attachmentFileIds === null
      ? { attachments: [] }
      : await resolveOutboundAttachments({ quoteId, fileIds: attachmentFileIds });
  const attachments = attachmentsResult.attachments;

  const recentMessages = await loadRecentThreadMessages({ quoteId });
  const emailReq = buildPortalEmail({
    quoteId,
    toEmail: recipient.toEmail,
    replyTo,
    portalRoleLabel: "Supplier",
    message,
    recentMessages,
  });

  if (attachments.length > 0) {
    emailReq.attachments = attachments.map((a) => ({
      filename: a.filename,
      contentType: a.contentType,
      contentBase64: a.contentBase64,
    }));
  }

  console.log(`${WARN_PREFIX} sending`, { quoteId, supplierId, recipientRole: "customer" });
  const sendResult = await getEmailSender().send(emailReq);
  if (!sendResult.ok) {
    return { ok: false, error: "send_failed" };
  }

  void tryStorePortalOutboundThreadMessage({
    quoteId,
    senderRole: "supplier",
    senderPartyId: supplierId,
    recipientRole: "customer",
    attachmentsMeta:
      attachments.length > 0
        ? attachments.map((a) => ({
            fileId: typeof a.fileId === "string" ? a.fileId : null,
            filename: a.filename,
            sizeBytes: a.sizeBytes,
          }))
        : null,
  });

  return { ok: true, sent: true, attachmentsSent: attachments.length };
}

export async function sendEmailToSupplierFromCustomer(args: {
  quoteId: string;
  customerId: string;
  message: string;
  attachmentFileIds?: string[];
}): Promise<PortalSendResult> {
  if (!isPortalEmailSendEnabledFlag()) {
    return { ok: false, error: "disabled" };
  }

  const status = getEmailOutboundStatus();
  if (!status.enabled) {
    return { ok: false, error: "disabled" };
  }

  const quoteId = normalizeId(args.quoteId);
  const customerId = normalizeId(args.customerId);
  const message = normalizeString(args.message);
  if (!isUuidLike(quoteId) || !customerId || !message) return { ok: false, error: "unsupported" };

  const recipient = await resolveSupplierRecipient({ quoteId });
  if (!recipient.ok) return { ok: false, error: recipient.error };

  const replyDomain = normalizeString(process.env.EMAIL_REPLY_DOMAIN);
  const secret = normalizeString(process.env.EMAIL_BRIDGE_SECRET);
  if (!replyDomain || !secret) return { ok: false, error: "disabled" };

  // IMPORTANT: Reply-To token represents the expected replier (recipient),
  // so replies are attributed correctly by the inbound bridge.
  const replyToken = createReplyToken({ quoteId, supplierId: recipient.supplierId, secret });
  if (!replyToken) return { ok: false, error: "disabled" };
  const replyTo = `reply+${replyToken}@${replyDomain}`;

  const attachmentFileIds = clampAttachmentIds(args.attachmentFileIds);
  const attachmentsResult =
    attachmentFileIds === null
      ? { attachments: [] }
      : await resolveOutboundAttachments({ quoteId, fileIds: attachmentFileIds });
  const attachments = attachmentsResult.attachments;

  const recentMessages = await loadRecentThreadMessages({ quoteId });
  const emailReq = buildPortalEmail({
    quoteId,
    toEmail: recipient.toEmail,
    replyTo,
    portalRoleLabel: "Customer",
    message,
    recentMessages,
  });

  if (attachments.length > 0) {
    emailReq.attachments = attachments.map((a) => ({
      filename: a.filename,
      contentType: a.contentType,
      contentBase64: a.contentBase64,
    }));
  }

  console.log(`${WARN_PREFIX} sending`, { quoteId, customerId, recipientRole: "supplier" });
  const sendResult = await getEmailSender().send(emailReq);
  if (!sendResult.ok) {
    return { ok: false, error: "send_failed" };
  }

  void tryStorePortalOutboundThreadMessage({
    quoteId,
    senderRole: "customer",
    senderPartyId: customerId,
    recipientRole: "supplier",
    attachmentsMeta:
      attachments.length > 0
        ? attachments.map((a) => ({
            fileId: typeof a.fileId === "string" ? a.fileId : null,
            filename: a.filename,
            sizeBytes: a.sizeBytes,
          }))
        : null,
  });

  return { ok: true, sent: true, attachmentsSent: attachments.length };
}

