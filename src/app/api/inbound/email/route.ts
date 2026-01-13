import { NextResponse } from "next/server";

import type { InboundEmail } from "@/server/quotes/emailBridge";
import { handleInboundEmailBridge } from "@/server/quotes/emailBridge";

export const dynamic = "force-dynamic";

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => normalizeString(v)).filter(Boolean);
}

function coerceInboundEmail(payload: unknown): InboundEmail | null {
  if (!payload || typeof payload !== "object") return null;
  const obj = payload as Record<string, unknown>;

  const from = normalizeString(obj.from);
  const to = normalizeStringArray(obj.to);

  if (!from || to.length === 0) return null;

  const cc = normalizeStringArray(obj.cc);

  const attachmentsRaw = Array.isArray(obj.attachments) ? obj.attachments : [];
  const attachments = attachmentsRaw
    .map((a) => (a && typeof a === "object" ? (a as Record<string, unknown>) : null))
    .filter(Boolean)
    .map((a) => ({
      name: normalizeString(a?.name ?? a?.filename),
      contentType: normalizeString(a?.contentType) || null,
      contentLength:
        typeof a?.contentLength === "number" && Number.isFinite(a.contentLength)
          ? a.contentLength
          : typeof a?.sizeBytes === "number" && Number.isFinite(a.sizeBytes)
            ? a.sizeBytes
            : null,
    }))
    .filter((a) => a.name);

  return {
    from,
    to,
    cc: cc.length > 0 ? cc : undefined,
    subject: normalizeString(obj.subject) || undefined,
    text: normalizeString(obj.text) || undefined,
    html: normalizeString(obj.html) || undefined,
    date: normalizeString(obj.date) || undefined,
    messageId: normalizeString(obj.messageId) || undefined,
    inReplyTo: normalizeString(obj.inReplyTo) || undefined,
    references: normalizeStringArray(obj.references),
    attachments: attachments.length > 0 ? attachments : undefined,
  };
}

export async function POST(req: Request) {
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const inbound = coerceInboundEmail(payload);
  if (!inbound) {
    return NextResponse.json({ ok: false, error: "invalid_payload" }, { status: 400 });
  }

  const result = await handleInboundEmailBridge(inbound);
  if (result.ok) {
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  return NextResponse.json({ ok: false, error: result.error }, { status: result.httpStatus });
}

