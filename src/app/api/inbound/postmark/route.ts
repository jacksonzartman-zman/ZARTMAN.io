/**
 * Manual verification
 * - Disabled case (missing POSTMARK_INBOUND_BASIC_USER/PASS) → 200 { ok:false, error:"disabled" }
 * - Bad auth → 403 { ok:false, error:"unauthorized" }
 * - Good auth but malformed payload → 400 { ok:false, error:"invalid_payload" }
 * - Good auth + valid payload but EMAIL_BRIDGE_SECRET missing → 200 { ok:false, error:"disabled" } (from handler)
 * - Token invalid → 401 { ok:false, error:"token_invalid" }
 * - Schema missing (quote_messages missing) → 200 { ok:false, error:"unsupported" } (warnOnce)
 * - Good auth + valid payload + valid token → inserts quote_messages supplier/customer message when supported
 * - Inbound with attachments → attachments uploaded + linked under message (best-effort)
 * - Replay same webhook twice → dedupe prevents duplicate message insert (best-effort)
 */
import crypto from "node:crypto";
import { NextResponse } from "next/server";

import type { InboundEmail } from "@/server/quotes/emailBridge";
import { handleInboundEmailBridge } from "@/server/quotes/emailBridge";
import { warnOnce } from "@/server/db/schemaErrors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WARN_PREFIX = "[postmark_inbound]";
const MAX_ATTACHMENTS = 5;
const MAX_TOTAL_BYTES = 15 * 1024 * 1024; // 15MB
const MAX_SINGLE_BYTES = 10 * 1024 * 1024; // 10MB

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function stringOrNull(value: unknown): string | null {
  const s = normalizeString(value);
  return s ? s : null;
}

function readEmailFromObject(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const obj = value as Record<string, unknown>;
  return normalizeString(obj.Email);
}

function readEmailListFromFull(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry === "string") {
      const s = normalizeString(entry);
      if (s) out.push(s);
      continue;
    }
    const email = readEmailFromObject(entry);
    if (email) out.push(email);
  }
  return out;
}

function splitCommaSeparatedEmails(value: unknown): string[] {
  const s = normalizeString(value);
  if (!s) return [];
  return s
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function coercePostmarkInboundEmail(payload: unknown): InboundEmail | null {
  if (!payload || typeof payload !== "object") return null;
  const obj = payload as Record<string, unknown>;

  const from = normalizeString(readEmailFromObject(obj.FromFull) || obj.From);
  const to =
    readEmailListFromFull(obj.ToFull).length > 0 ? readEmailListFromFull(obj.ToFull) : splitCommaSeparatedEmails(obj.To);
  const cc =
    readEmailListFromFull(obj.CcFull).length > 0 ? readEmailListFromFull(obj.CcFull) : splitCommaSeparatedEmails(obj.Cc);

  if (!from || to.length === 0) return null;

  const rawAttachments = Array.isArray(obj.Attachments) ? (obj.Attachments as unknown[]) : [];
  let attachmentsCapped = false;
  let totalDecoded = 0;
  const mappedAttachments: NonNullable<InboundEmail["attachments"]> = [];

  for (const entry of rawAttachments) {
    if (!entry || typeof entry !== "object") continue;
    const item = entry as Record<string, unknown>;
    const name = normalizeString(item.Name);
    const contentType = normalizeString(item.ContentType) || null;
    const contentLength =
      typeof item.ContentLength === "number" && Number.isFinite(item.ContentLength)
        ? item.ContentLength
        : null;
    const contentBase64 = normalizeString(item.Content);
    if (!name || !contentBase64) continue;

    // Enforce caps (best-effort). We decode to get an actual size without trusting ContentLength.
    const decoded = Buffer.from(contentBase64, "base64");
    const decodedBytes = decoded.byteLength;
    if (decodedBytes <= 0) continue;

    if (mappedAttachments.length >= MAX_ATTACHMENTS) {
      attachmentsCapped = true;
      continue;
    }
    if (decodedBytes > MAX_SINGLE_BYTES) {
      attachmentsCapped = true;
      continue;
    }
    if (totalDecoded + decodedBytes > MAX_TOTAL_BYTES) {
      attachmentsCapped = true;
      continue;
    }

    totalDecoded += decodedBytes;
    mappedAttachments.push({
      name,
      contentType,
      contentLength: contentLength ?? decodedBytes,
      contentBase64,
    });
  }

  if (attachmentsCapped) {
    warnOnce(
      "postmark_inbound:attachments_capped",
      `${WARN_PREFIX} attachments capped`,
    );
  }

  return {
    from,
    to,
    cc: cc.length > 0 ? cc : undefined,
    subject: stringOrNull(obj.Subject),
    text: stringOrNull(obj.TextBody),
    html: stringOrNull(obj.HtmlBody),
    date: stringOrNull(obj.Date),
    messageId: stringOrNull(obj.MessageID),
    attachments: mappedAttachments.length > 0 ? mappedAttachments : undefined,
  };
}

function safeEquals(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

function isAuthorized(req: Request, expectedUser: string, expectedPass: string): boolean {
  const header = normalizeString(req.headers.get("authorization"));
  if (!header) return false;
  if (!header.toLowerCase().startsWith("basic ")) return false;

  const token = header.slice("basic ".length).trim();
  if (!token) return false;

  let decoded = "";
  try {
    decoded = Buffer.from(token, "base64").toString("utf8");
  } catch {
    return false;
  }

  const sep = decoded.indexOf(":");
  if (sep <= 0) return false;

  const user = decoded.slice(0, sep);
  const pass = decoded.slice(sep + 1);

  return safeEquals(user, expectedUser) && safeEquals(pass, expectedPass);
}

export async function POST(req: Request) {
  const expectedUser = normalizeString(process.env.POSTMARK_INBOUND_BASIC_USER);
  const expectedPass = normalizeString(process.env.POSTMARK_INBOUND_BASIC_PASS);

  // Safe-by-default deploys: endpoint is inert unless explicitly configured.
  if (!expectedUser || !expectedPass) {
    return NextResponse.json({ ok: false, error: "disabled" }, { status: 200 });
  }

  if (!isAuthorized(req, expectedUser, expectedPass)) {
    // Postmark stops retrying on 403. Do not log auth headers/creds.
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 403 });
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_payload" }, { status: 400 });
  }

  const inbound = coercePostmarkInboundEmail(payload);
  if (!inbound) {
    return NextResponse.json({ ok: false, error: "invalid_payload" }, { status: 400 });
  }

  try {
    console.log(`${WARN_PREFIX} received`);

    const result = await handleInboundEmailBridge(inbound);
    if (result.ok) {
      return NextResponse.json({ ok: true }, { status: 200 });
    }

    if (result.error === "unsupported") {
      return NextResponse.json({ ok: false, error: "unsupported" }, { status: 200 });
    }
    if (result.error === "not_opted_in") {
      return NextResponse.json({ ok: false, error: "not_opted_in" }, { status: 200 });
    }
    if (result.error === "token_invalid") {
      return NextResponse.json({ ok: false, error: "token_invalid" }, { status: 401 });
    }
    // Fail-soft: everything else returns 200 to avoid retries spam.
    return NextResponse.json({ ok: false, error: result.error || "unknown" }, { status: 200 });
  } catch {
    warnOnce("postmark_inbound:unknown", `${WARN_PREFIX} unknown error`);
    return NextResponse.json({ ok: false, error: "unknown" }, { status: 200 });
  }
}

