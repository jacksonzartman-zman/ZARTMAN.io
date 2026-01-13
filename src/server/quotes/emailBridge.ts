import crypto from "node:crypto";

import { supabaseServer } from "@/lib/supabaseServer";
import { schemaGate } from "@/server/db/schemaContract";
import { serializeSupabaseError, warnOnce } from "@/server/db/schemaErrors";

export type InboundEmail = {
  from: string;
  to: string[];
  cc?: string[];
  subject?: string | null;
  text?: string | null;
  html?: string | null;
  date?: string | null;
  messageId?: string | null;
  inReplyTo?: string | null;
  references?: string[];
  attachments?: { filename: string; contentType: string; sizeBytes?: number }[];
};

type ReplyTokenParts = {
  quoteId: string;
  supplierId: string;
  sig: string;
};

const WARN_PREFIX = "[email_bridge]";
const QUOTE_MESSAGES_RELATION = "quote_messages";

// Keep the local-part token reasonably short for common provider limits.
const SIG_HEX_LEN = 16; // 8 bytes -> 16 hex chars

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isSafeTokenComponent(value: string): boolean {
  // UUIDs + common ids; keep conservative to avoid weird parsing/abuse.
  return /^[a-zA-Z0-9-]{6,}$/.test(value);
}

function safeEquals(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

function computeSigHex(args: { secret: string; quoteId: string; supplierId: string }): string {
  const hmac = crypto
    .createHmac("sha256", args.secret)
    .update(`${args.quoteId}:${args.supplierId}`, "utf8")
    .digest("hex");
  return hmac.slice(0, SIG_HEX_LEN);
}

export function createReplyToken(args: { quoteId: string; supplierId: string; secret?: string }): string | null {
  const quoteId = normalizeString(args.quoteId);
  const supplierId = normalizeString(args.supplierId);
  const secret = normalizeString(args.secret ?? process.env.EMAIL_BRIDGE_SECRET);

  if (!secret) return null;
  if (!quoteId || !supplierId) return null;
  if (!isSafeTokenComponent(quoteId) || !isSafeTokenComponent(supplierId)) return null;

  const sig = computeSigHex({ secret, quoteId, supplierId });
  return `${quoteId}.${supplierId}.${sig}`;
}

export function verifyReplyToken(args: { quoteId: string; supplierId: string; sig: string; secret?: string }): boolean {
  const quoteId = normalizeString(args.quoteId);
  const supplierId = normalizeString(args.supplierId);
  const sig = normalizeString(args.sig).toLowerCase();
  const secret = normalizeString(args.secret ?? process.env.EMAIL_BRIDGE_SECRET);

  if (!secret) return false;
  if (!quoteId || !supplierId || !sig) return false;
  if (!isSafeTokenComponent(quoteId) || !isSafeTokenComponent(supplierId)) return false;
  if (!/^[a-f0-9]{8,64}$/.test(sig)) return false;

  const expected = computeSigHex({ secret, quoteId, supplierId }).toLowerCase();
  return safeEquals(expected, sig);
}

function getEmailBridgeDomain(): string | null {
  const explicit = normalizeString(process.env.EMAIL_BRIDGE_DOMAIN);
  if (explicit) return explicit;

  const siteUrl =
    normalizeString(process.env.NEXT_PUBLIC_SITE_URL) ||
    (normalizeString(process.env.VERCEL_URL) ? `https://${normalizeString(process.env.VERCEL_URL)}` : "");

  if (!siteUrl) return null;

  try {
    const url = new URL(siteUrl);
    const host = url.hostname.trim();
    return host.length > 0 ? host : null;
  } catch {
    return null;
  }
}

export function getSupplierReplyToAddress(args: {
  quoteId: string;
  supplierId: string;
}): { ok: true; address: string } | { ok: false; reason: "disabled" | "missing_domain" } {
  const secret = normalizeString(process.env.EMAIL_BRIDGE_SECRET);
  if (!secret) {
    return { ok: false, reason: "disabled" };
  }

  const domain = getEmailBridgeDomain();
  if (!domain) {
    return { ok: false, reason: "missing_domain" };
  }

  const token = createReplyToken({ quoteId: args.quoteId, supplierId: args.supplierId, secret });
  if (!token) {
    return { ok: false, reason: "disabled" };
  }

  return { ok: true, address: `reply+${token}@${domain}` };
}

function tryExtractEmail(raw: string): string | null {
  const trimmed = normalizeString(raw);
  if (!trimmed) return null;

  // Common formats: "Name <email@domain>", "email@domain"
  const angleMatch = trimmed.match(/<([^>]+@[^>]+)>/);
  const candidate = angleMatch ? angleMatch[1] : trimmed;
  const cleaned = candidate.replace(/[,\s]+$/g, "").trim();
  return cleaned.includes("@") ? cleaned : null;
}

export function parseReplyToTokenFromRecipients(
  recipients: string[],
): { ok: true; parts: ReplyTokenParts } | { ok: false; reason: "missing" | "malformed" } {
  const list = Array.isArray(recipients) ? recipients : [];
  for (const raw of list) {
    const email = raw ? tryExtractEmail(raw) : null;
    if (!email) continue;

    const at = email.lastIndexOf("@");
    if (at <= 0) continue;

    const local = email.slice(0, at);
    if (!local.toLowerCase().startsWith("reply+")) continue;

    const token = local.slice("reply+".length);
    const [quoteId, supplierId, sig, ...rest] = token.split(".");
    if (rest.length > 0) return { ok: false, reason: "malformed" };

    const q = normalizeString(quoteId);
    const s = normalizeString(supplierId);
    const g = normalizeString(sig);
    if (!q || !s || !g) return { ok: false, reason: "malformed" };
    if (!isSafeTokenComponent(q) || !isSafeTokenComponent(s)) return { ok: false, reason: "malformed" };

    return { ok: true, parts: { quoteId: q, supplierId: s, sig: g } };
  }
  return { ok: false, reason: "missing" };
}

function stripHtmlToText(html: string): string {
  const input = typeof html === "string" ? html : "";
  if (!input.trim()) return "";

  // Minimal/fast: remove scripts/styles, convert <br>/<p> to newlines, strip tags.
  const withoutScripts = input
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, " ");
  const withNewlines = withoutScripts
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/\s*p\s*>/gi, "\n")
    .replace(/<\/\s*div\s*>/gi, "\n");
  const stripped = withNewlines.replace(/<[^>]+>/g, " ");
  return stripped
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function sanitizeBody(inbound: InboundEmail): string | null {
  const text = normalizeString(inbound.text);
  if (text) return text.length > 2000 ? text.slice(0, 2000) : text;

  const html = normalizeString(inbound.html);
  if (!html) return null;

  const stripped = stripHtmlToText(html);
  if (!stripped) return null;
  return stripped.length > 2000 ? stripped.slice(0, 2000) : stripped;
}

type InboundHandleResult =
  | { ok: true }
  | { ok: false; error: string; httpStatus: 200 | 400 | 401 };

export async function handleInboundSupplierEmail(inbound: InboundEmail): Promise<InboundHandleResult> {
  console.log(`${WARN_PREFIX} inbound received`);

  const secret = normalizeString(process.env.EMAIL_BRIDGE_SECRET);
  if (!secret) {
    return { ok: false, error: "disabled", httpStatus: 200 };
  }

  const to = Array.isArray(inbound?.to) ? inbound.to : [];
  const tokenResult = parseReplyToTokenFromRecipients(to);
  if (!tokenResult.ok) {
    console.warn(`${WARN_PREFIX} token invalid`, { reason: tokenResult.reason });
    return { ok: false, error: "token_missing_or_malformed", httpStatus: 400 };
  }

  const { quoteId, supplierId, sig } = tokenResult.parts;
  const valid = verifyReplyToken({ quoteId, supplierId, sig, secret });
  if (!valid) {
    console.warn(`${WARN_PREFIX} token invalid`, { reason: "bad_sig" });
    return { ok: false, error: "token_invalid", httpStatus: 401 };
  }

  const body = sanitizeBody(inbound);
  if (!body) {
    return { ok: false, error: "empty_body", httpStatus: 400 };
  }

  const supported = await schemaGate({
    enabled: true,
    relation: QUOTE_MESSAGES_RELATION,
    requiredColumns: ["quote_id", "sender_role", "sender_id", "body"],
    warnPrefix: WARN_PREFIX,
    warnKey: "email_bridge:quote_messages",
  });
  if (!supported) {
    warnOnce("email_bridge:unsupported", `${WARN_PREFIX} unsupported; quote_messages missing`);
    return { ok: false, error: "unsupported", httpStatus: 200 };
  }

  // Try the extended payload first (newer schemas). If it fails due to missing columns,
  // retry with the minimal schema-compatible payload to avoid noisy drift errors.
  const basePayload: Record<string, unknown> = {
    quote_id: quoteId,
    sender_role: "supplier",
    sender_id: supplierId,
    sender_name: null,
    sender_email: normalizeString(inbound.from).toLowerCase().slice(0, 240) || null,
    body,
  };

  const extendedPayload: Record<string, unknown> = {
    ...basePayload,
    supplier_id: supplierId,
    metadata: {
      from: normalizeString(inbound.from),
      subject: normalizeString(inbound.subject) || null,
      messageId: normalizeString(inbound.messageId) || null,
      inReplyTo: normalizeString(inbound.inReplyTo) || null,
      references: Array.isArray(inbound.references) ? inbound.references.slice(0, 50) : null,
      attachments: Array.isArray(inbound.attachments) ? inbound.attachments.slice(0, 25) : null,
    },
  };

  try {
    const { error: extendedError } = await supabaseServer.from(QUOTE_MESSAGES_RELATION).insert(extendedPayload);
    if (!extendedError) {
      console.log(`${WARN_PREFIX} wrote supplier msg`, { quoteId, supplierId, via: "email" });
      return { ok: true };
    }

    const serialized = serializeSupabaseError(extendedError);
    warnOnce("email_bridge:insert_extended_failed", `${WARN_PREFIX} insert degraded; retrying minimal`, {
      code: serialized.code,
      message: serialized.message,
    });

    const { error: baseError } = await supabaseServer.from(QUOTE_MESSAGES_RELATION).insert(basePayload);
    if (baseError) {
      console.error(`${WARN_PREFIX} insert failed`, { error: serializeSupabaseError(baseError) ?? baseError });
      return { ok: false, error: "write_failed", httpStatus: 200 };
    }

    console.log(`${WARN_PREFIX} wrote supplier msg`, { quoteId, supplierId, via: "email", degraded: true });
    return { ok: true };
  } catch (error) {
    console.error(`${WARN_PREFIX} insert crashed`, { error });
    return { ok: false, error: "write_failed", httpStatus: 200 };
  }
}

