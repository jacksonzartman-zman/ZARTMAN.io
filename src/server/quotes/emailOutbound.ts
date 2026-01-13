import { createCustomerReplyToken, createReplyToken } from "@/server/quotes/emailBridge";
import { warnOnce } from "@/server/db/schemaErrors";

export type EmailSendRequest = {
  to: string;
  subject: string;
  text: string;
  html?: string;
  replyTo: string;
  metadata?: Record<string, string>;
  attachments?: Array<{
    filename: string;
    contentType: string;
    contentBase64: string;
  }>;
};

export type EmailSender = {
  send(req: EmailSendRequest): Promise<{ ok: true } | { ok: false; error: string }>;
};

const WARN_PREFIX = "[email_outbound]";

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeLower(value: unknown): string {
  return normalizeString(value).toLowerCase();
}

function looksLikeEmail(value: string): boolean {
  const v = normalizeString(value);
  // Conservative: avoid false negatives without implementing full RFC.
  return v.includes("@") && !v.includes(" ") && v.length <= 320;
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

export function getEmailOutboundStatus(): { enabled: true } | { enabled: false; reason: string } {
  const provider = normalizeLower(process.env.EMAIL_PROVIDER || "");
  if (!provider || provider === "none") {
    return { enabled: false, reason: "disabled" };
  }

  // Reply-To bridge prerequisites.
  const secret = normalizeString(process.env.EMAIL_BRIDGE_SECRET);
  if (!secret) {
    return { enabled: false, reason: "disabled" };
  }

  const replyDomain = normalizeString(process.env.EMAIL_REPLY_DOMAIN);
  if (!replyDomain) {
    return { enabled: false, reason: "disabled" };
  }

  const from = normalizeString(process.env.EMAIL_FROM);
  if (!from) {
    return { enabled: false, reason: "disabled" };
  }

  if (provider === "postmark") {
    const token = normalizeString(process.env.POSTMARK_SERVER_TOKEN);
    if (!token) return { enabled: false, reason: "disabled" };
    return { enabled: true };
  }

  return { enabled: false, reason: "unsupported" };
}

const disabledSender: EmailSender = {
  async send() {
    warnOnce("email_outbound:disabled_sender", `${WARN_PREFIX} disabled; skipping send`);
    return { ok: false, error: "disabled" };
  },
};

export function getEmailSender(): EmailSender {
  const provider = normalizeLower(process.env.EMAIL_PROVIDER || "");
  if (!provider || provider === "none") {
    return disabledSender;
  }

  if (provider !== "postmark") {
    warnOnce("email_outbound:unsupported_provider", `${WARN_PREFIX} unsupported provider; skipping send`, {
      provider,
    });
    return disabledSender;
  }

  const from = normalizeString(process.env.EMAIL_FROM);
  const token = normalizeString(process.env.POSTMARK_SERVER_TOKEN);
  if (!from || !token) {
    warnOnce(
      "email_outbound:postmark_missing_config",
      `${WARN_PREFIX} missing provider config; skipping send`,
      {
        hasFrom: Boolean(from),
        hasToken: Boolean(token),
      },
    );
    return disabledSender;
  }

  return {
    async send(req: EmailSendRequest) {
      const to = normalizeString(req.to);
      const subject = normalizeString(req.subject);
      const text = normalizeString(req.text);
      const replyTo = normalizeString(req.replyTo);

      if (!looksLikeEmail(to) || !subject || !text || !looksLikeEmail(replyTo)) {
        console.warn(`${WARN_PREFIX} invalid send request`);
        return { ok: false, error: "invalid_request" };
      }

      try {
        const attachments = Array.isArray(req.attachments) ? req.attachments : [];
        const postmarkAttachments =
          attachments.length > 0
            ? attachments
                .map((a) => {
                  const filename = normalizeString(a?.filename) || "attachment";
                  const contentType = normalizeString(a?.contentType) || "application/octet-stream";
                  const contentBase64 = normalizeString(a?.contentBase64);
                  if (!contentBase64) return null;
                  return {
                    Name: filename,
                    Content: contentBase64,
                    ContentType: contentType,
                  };
                })
                .filter(Boolean)
            : undefined;

        const res = await fetch("https://api.postmarkapp.com/email", {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            "X-Postmark-Server-Token": token,
          },
          body: JSON.stringify({
            From: from,
            To: to,
            Subject: subject,
            TextBody: text,
            HtmlBody: req.html ? String(req.html) : undefined,
            ReplyTo: replyTo,
            Metadata: req.metadata ?? undefined,
            Attachments: postmarkAttachments,
            // Avoid tracking/PII; callers can pass explicit Metadata.
          }),
        });

        if (!res.ok) {
          warnOnce(
            `email_outbound:postmark_non_2xx:${res.status}`,
            `${WARN_PREFIX} provider returned non-2xx`,
            { status: res.status },
          );
          return { ok: false, error: "send_failed" };
        }

        console.log(`${WARN_PREFIX} sent`, {
          provider: "postmark",
        });
        return { ok: true };
      } catch (error) {
        warnOnce("email_outbound:postmark_crash", `${WARN_PREFIX} provider crashed`, {
          error: String(error),
        });
        return { ok: false, error: "send_failed" };
      }
    },
  };
}

export type SupplierThreadContextMessage = {
  senderRole?: string | null;
  body?: string | null;
  createdAt?: string | null;
};

export type CustomerThreadContextMessage = {
  senderRole?: string | null;
  body?: string | null;
  createdAt?: string | null;
};

export function buildSupplierThreadEmail(args: {
  quoteId: string;
  supplierId: string;
  toEmail: string;
  adminMessageText: string;
  context?: {
    shortQuoteLabel?: string | null;
    recentMessages?: SupplierThreadContextMessage[] | null;
  };
}): EmailSendRequest | null {
  const quoteId = normalizeString(args.quoteId);
  const supplierId = normalizeString(args.supplierId);
  const toEmail = normalizeString(args.toEmail);
  const adminMessageText = normalizeString(args.adminMessageText);

  if (!quoteId || !supplierId || !looksLikeEmail(toEmail) || !adminMessageText) {
    return null;
  }

  const replyDomain = normalizeString(process.env.EMAIL_REPLY_DOMAIN);
  const secret = normalizeString(process.env.EMAIL_BRIDGE_SECRET);
  if (!replyDomain || !secret) {
    warnOnce("email_outbound:reply_to_disabled", `${WARN_PREFIX} reply-to disabled; missing config`);
    return null;
  }

  const sigToken = createReplyToken({ quoteId, supplierId, secret });
  if (!sigToken) {
    warnOnce("email_outbound:reply_to_token_failed", `${WARN_PREFIX} reply-to token generation failed`);
    return null;
  }

  const replyTo = `reply+${sigToken}@${replyDomain}`;

  const shortQuoteLabel = normalizeString(args.context?.shortQuoteLabel) || quoteId;
  const subject = `Quote update: ${shortQuoteLabel}`;

  const excerptLines: string[] = [];
  const recent = Array.isArray(args.context?.recentMessages) ? args.context?.recentMessages : [];
  for (const msg of recent.slice(0, 3)) {
    const role = normalizeLower(msg?.senderRole) || "unknown";
    const body = sanitizeExcerpt(msg?.body ?? "", 420);
    if (!body) continue;
    excerptLines.push(`[${role}] ${body}`);
  }

  const contextBlock =
    excerptLines.length > 0
      ? `\n\n---\nRecent thread:\n${excerptLines.join("\n\n")}\n`
      : "";

  const text = `${adminMessageText}${contextBlock}\n\nReply to this email to respond.\n`;
  const html = `<div style="font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; line-height: 1.4;">
  <p style="white-space: pre-wrap; margin: 0 0 12px 0;">${escapeHtml(adminMessageText)}</p>
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
    to: toEmail,
    subject,
    text: text.length > 15000 ? text.slice(0, 15000) : text,
    html,
    replyTo,
    metadata: {
      quoteId,
      supplierId,
    },
  };
}

export function buildCustomerThreadEmail(args: {
  quoteId: string;
  customerId: string;
  toEmail: string;
  adminMessageText: string;
  context?: {
    shortQuoteLabel?: string | null;
    recentMessages?: CustomerThreadContextMessage[] | null;
  };
}): EmailSendRequest | null {
  const quoteId = normalizeString(args.quoteId);
  const customerId = normalizeString(args.customerId);
  const toEmail = normalizeString(args.toEmail);
  const adminMessageText = normalizeString(args.adminMessageText);

  if (!quoteId || !customerId || !looksLikeEmail(toEmail) || !adminMessageText) {
    return null;
  }

  const replyDomain = normalizeString(process.env.EMAIL_REPLY_DOMAIN);
  const secret = normalizeString(process.env.EMAIL_BRIDGE_SECRET);
  if (!replyDomain || !secret) {
    warnOnce("email_outbound:customer_reply_to_disabled", `${WARN_PREFIX} reply-to disabled; missing config`);
    return null;
  }

  const sigToken = createCustomerReplyToken({ quoteId, customerId, secret });
  if (!sigToken) {
    warnOnce("email_outbound:customer_reply_to_token_failed", `${WARN_PREFIX} customer reply-to token generation failed`);
    return null;
  }

  const replyTo = `reply+${sigToken}@${replyDomain}`;

  const shortQuoteLabel = normalizeString(args.context?.shortQuoteLabel) || quoteId;
  const subject = `Quote ${shortQuoteLabel}: Update from Zartman Team`;

  const excerptLines: string[] = [];
  const recent = Array.isArray(args.context?.recentMessages) ? args.context?.recentMessages : [];
  for (const msg of recent.slice(0, 3)) {
    const role = normalizeLower(msg?.senderRole) || "unknown";
    const label =
      role === "supplier"
        ? "Supplier"
        : role === "customer"
          ? "Customer"
          : role === "admin"
            ? "Zartman Team"
            : role === "system"
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

  const text = `${adminMessageText}${contextBlock}\n\nReply to this email to respond.\n`;
  const html = `<div style="font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; line-height: 1.4;">
  <p style="white-space: pre-wrap; margin: 0 0 12px 0;">${escapeHtml(adminMessageText)}</p>
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
    to: toEmail,
    subject,
    text: text.length > 15000 ? text.slice(0, 15000) : text,
    html,
    replyTo,
    metadata: {
      quoteId,
      customerId,
    },
  };
}

