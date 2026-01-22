import { NextResponse } from "next/server";

import { buildPublicUrl } from "@/lib/publicUrl";
import { UnauthorizedError, requireUser } from "@/server/auth";
import { getCustomerByUserId } from "@/server/customers";
import { sendNotificationEmail } from "@/server/notifications/email";
import { logOpsEvent, logOpsEventNoQuote } from "@/server/ops/events";
import { getEmailOutboundStatus, getEmailSender } from "@/server/quotes/emailOutbound";
import { supabaseServer } from "@/lib/supabaseServer";
import { serializeSupabaseError } from "@/server/admin/logging";
import {
  addExistingUsersToCustomerDefaultTeamByEmail,
  ensureCustomerDefaultTeam,
  setQuoteTeamIdIfMissing,
} from "@/server/customerTeams";
import { buildCustomerTeamInviteLink, createCustomerTeamInvite } from "@/server/customerTeams/invites";
import { isCustomerTeamInvitesSchemaReady } from "@/server/customerTeams/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WARN_PREFIX = "[portal_customer_invite_teammate_api]";

type PostBody = {
  quoteId?: string;
  emails?: string[] | string;
  message?: string;
};

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isUuidLike(value: string): boolean {
  const v = typeof value === "string" ? value.trim() : "";
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  if (!normalized.includes("@")) return null;
  if (/\s/.test(normalized)) return null;
  if (normalized.length > 320) return null;
  return normalized;
}

function parseEmails(input: unknown): string[] {
  if (Array.isArray(input)) {
    return input
      .flatMap((item) => String(item ?? "").split(/[,\n;]+/g))
      .map((v) => v.trim())
      .filter(Boolean);
  }
  if (typeof input === "string") {
    return input
      .split(/[,\n;]+/g)
      .map((v) => v.trim())
      .filter(Boolean);
  }
  return [];
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const v = value.trim();
    if (!v) continue;
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

function buildInviteEmail(args: {
  customerEmail: string | null;
  shareUrl: string;
  message: string | null;
}): { subject: string; html: string; text: string; replyTo?: string } {
  const customerEmail = normalizeEmail(args.customerEmail);
  const safeLink = args.shareUrl;
  const note = args.message?.trim() ? args.message.trim() : null;

  const subject = "Review this Zartman search request";
  const previewText = "A teammate shared a search request with you.";

  const html = `
    <div style="font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; line-height: 1.4;">
      <p><strong>A teammate invited you to review a Zartman search request.</strong></p>
      ${note ? `<p style="white-space: pre-wrap;">${escapeHtml(note)}</p>` : ""}
      <p><a href="${escapeHtml(safeLink)}">Open the search request</a></p>
      <p style="color:#94a3b8;font-size:12px;">If you weren’t expecting this, you can ignore this email.</p>
      <div style="display:none;font-size:1px;color:#fefefe;line-height:1px;max-height:0px;max-width:0px;opacity:0;overflow:hidden;">${escapeHtml(
        previewText,
      )}</div>
    </div>
  `;

  const lines: string[] = [
    "A teammate invited you to review a Zartman search request.",
    note ? "" : "",
    note ? note : "",
    "",
    `Open: ${safeLink}`,
    "",
    "If you weren’t expecting this, you can ignore this email.",
  ].filter((line) => typeof line === "string");

  return {
    subject,
    html,
    text: lines.join("\n").trim(),
    ...(customerEmail ? { replyTo: customerEmail } : {}),
  };
}

function buildTeamInviteEmail(args: {
  customerEmail: string | null;
  inviteUrl: string;
  message: string | null;
}): { subject: string; html: string; text: string; replyTo?: string } {
  const customerEmail = normalizeEmail(args.customerEmail);
  const safeLink = args.inviteUrl;
  const note = args.message?.trim() ? args.message.trim() : null;

  const subject = "You’ve been invited to join a Zartman team";
  const previewText = "A teammate invited you to join their team.";

  const html = `
    <div style="font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; line-height: 1.4;">
      <p><strong>A teammate invited you to join their Zartman team.</strong></p>
      ${note ? `<p style="white-space: pre-wrap;">${escapeHtml(note)}</p>` : ""}
      <p><a href="${escapeHtml(safeLink)}">Accept invite</a></p>
      <p style="color:#94a3b8;font-size:12px;">If you weren’t expecting this, you can ignore this email.</p>
      <div style="display:none;font-size:1px;color:#fefefe;line-height:1px;max-height:0px;max-width:0px;opacity:0;overflow:hidden;">${escapeHtml(
        previewText,
      )}</div>
    </div>
  `;

  const lines: string[] = [
    "A teammate invited you to join their Zartman team.",
    note ? "" : "",
    note ? note : "",
    "",
    `Accept invite: ${safeLink}`,
    "",
    "If you weren’t expecting this, you can ignore this email.",
  ].filter((line) => typeof line === "string");

  return {
    subject,
    html,
    text: lines.join("\n").trim(),
    ...(customerEmail ? { replyTo: customerEmail } : {}),
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function recipientDomains(emails: string[]): string[] {
  const domains = emails
    .map((email) => {
      const parts = email.split("@");
      return parts.length === 2 ? parts[1]?.trim().toLowerCase() : "";
    })
    .filter(Boolean);
  return uniqueStrings(domains).slice(0, 10);
}

async function canSendViaResend(): Promise<boolean> {
  return Boolean(process.env.RESEND_API_KEY);
}

async function sendInviteEmails(args: {
  toEmails: string[];
  customerEmail: string | null;
  shareUrl: string;
  message: string | null;
}): Promise<
  | { ok: true; provider: "resend" | "postmark"; sent: number }
  | { ok: false; error: "not_configured" | "send_failed" }
> {
  const email = buildInviteEmail({
    customerEmail: args.customerEmail,
    shareUrl: args.shareUrl,
    message: args.message,
  });

  if (await canSendViaResend()) {
    await Promise.allSettled(
      args.toEmails.map((to) =>
        sendNotificationEmail({
          to,
          subject: email.subject,
          previewText: "A teammate shared a search request with you.",
          html: email.html,
          ...(email.replyTo ? { replyTo: email.replyTo } : {}),
        }),
      ),
    );
    // `sendNotificationEmail` is fail-soft; assume delivered best-effort.
    return { ok: true, provider: "resend", sent: args.toEmails.length };
  }

  const outboundStatus = getEmailOutboundStatus();
  if (!outboundStatus.enabled) {
    return { ok: false, error: "not_configured" };
  }

  const sender = getEmailSender();
  const sends = await Promise.allSettled(
    args.toEmails.map((to) =>
      sender.send({
        to,
        subject: email.subject,
        text: email.text,
        html: email.html,
        replyTo: email.replyTo ?? "no-reply@zartman.io",
        metadata: {
          kind: "customer_teammate_invite",
        },
      }),
    ),
  );
  const okCount = sends.filter((r) => r.status === "fulfilled" && r.value.ok).length;
  if (okCount === 0) {
    return { ok: false, error: "send_failed" };
  }
  return { ok: true, provider: "postmark", sent: okCount };
}

async function sendTeamInviteEmails(args: {
  to: Array<{ email: string; inviteUrl: string }>;
  customerEmail: string | null;
  message: string | null;
}): Promise<
  | { ok: true; provider: "resend" | "postmark"; sent: number }
  | { ok: false; error: "not_configured" | "send_failed" }
> {
  if (args.to.length === 0) {
    return { ok: true, provider: "resend", sent: 0 };
  }

  if (await canSendViaResend()) {
    await Promise.allSettled(
      args.to.map((item) => {
        const email = buildTeamInviteEmail({
          customerEmail: args.customerEmail,
          inviteUrl: item.inviteUrl,
          message: args.message,
        });
        return sendNotificationEmail({
          to: item.email,
          subject: email.subject,
          previewText: "A teammate invited you to join their team.",
          html: email.html,
          ...(email.replyTo ? { replyTo: email.replyTo } : {}),
        });
      }),
    );
    // `sendNotificationEmail` is fail-soft; assume delivered best-effort.
    return { ok: true, provider: "resend", sent: args.to.length };
  }

  const outboundStatus = getEmailOutboundStatus();
  if (!outboundStatus.enabled) {
    return { ok: false, error: "not_configured" };
  }

  const sender = getEmailSender();
  const sends = await Promise.allSettled(
    args.to.map((item) => {
      const email = buildTeamInviteEmail({
        customerEmail: args.customerEmail,
        inviteUrl: item.inviteUrl,
        message: args.message,
      });
      return sender.send({
        to: item.email,
        subject: email.subject,
        text: email.text,
        html: email.html,
        replyTo: email.replyTo ?? "no-reply@zartman.io",
        metadata: {
          kind: "customer_team_invite",
        },
      });
    }),
  );
  const okCount = sends.filter((r) => r.status === "fulfilled" && r.value.ok).length;
  if (okCount === 0) {
    return { ok: false, error: "send_failed" };
  }
  return { ok: true, provider: "postmark", sent: okCount };
}

export async function POST(req: Request) {
  try {
    const user = await requireUser({ redirectTo: "/customer/quotes" });
    const customer = await getCustomerByUserId(user.id);
    if (!customer) {
      return NextResponse.json({ ok: false, error: "missing_profile" }, { status: 403 });
    }

    const body = (await req.json().catch(() => null)) as PostBody | null;
    const quoteId = normalizeString(body?.quoteId);
    const rawEmails = parseEmails(body?.emails);
    const normalizedEmails = uniqueStrings(rawEmails)
      .map((e) => normalizeEmail(e))
      .filter((e): e is string => Boolean(e))
      .slice(0, 10);
    const message = normalizeString(body?.message);
    const messageNormalized = message.length > 0 ? message : null;

    if (!isUuidLike(quoteId)) {
      return NextResponse.json({ ok: false, error: "invalid_quote" }, { status: 400 });
    }
    if (normalizedEmails.length === 0) {
      return NextResponse.json({ ok: false, error: "invalid_emails" }, { status: 400 });
    }
    if (messageNormalized && messageNormalized.length > 5000) {
      return NextResponse.json({ ok: false, error: "message_too_long" }, { status: 400 });
    }

    type QuoteRow = { id: string; customer_id: string | null; customer_email: string | null };
    const { data: quoteRow, error: quoteError } = await supabaseServer
      .from("quotes")
      .select("id,customer_id,customer_email")
      .eq("id", quoteId)
      .maybeSingle<QuoteRow>();

    if (quoteError) {
      console.error(`${WARN_PREFIX} quote lookup failed`, { quoteId, error: serializeSupabaseError(quoteError) ?? quoteError });
      return NextResponse.json({ ok: false, error: "quote_lookup_failed" }, { status: 500 });
    }
    if (!quoteRow?.id) {
      return NextResponse.json({ ok: false, error: "quote_not_found" }, { status: 404 });
    }

    const quoteCustomerId = normalizeString(quoteRow.customer_id);
    const customerIdMatches = Boolean(quoteCustomerId) && quoteCustomerId === customer.id;
    const quoteEmail = normalizeEmail(quoteRow.customer_email);
    const customerEmail = normalizeEmail(customer.email);
    const emailMatches = Boolean(quoteEmail && customerEmail && quoteEmail === customerEmail);
    if (!customerIdMatches && !emailMatches) {
      return NextResponse.json({ ok: false, error: "access_denied" }, { status: 403 });
    }

    const shareUrl = buildPublicUrl(`/customer/search?quote=${encodeURIComponent(quoteId)}`);
    const nextPath = `/customer/search?quote=${encodeURIComponent(quoteId)}`;

    // Best-effort: if customer teams schema exists, attach this quote to the customer's team
    // and add any *existing* users (by email) to that team.
    let teamGrantSummary: { enabled: boolean; teamId?: string; added?: number } = { enabled: false };
    let ensuredTeamId: string | null = null;
    try {
      const teamName =
        typeof customer.company_name === "string" && customer.company_name.trim().length > 0
          ? `${customer.company_name.trim()} team`
          : "Team";

      const ensured = await ensureCustomerDefaultTeam({
        customerAccountId: customer.id,
        ownerUserId: customer.user_id ?? user.id,
        teamName,
      });
      if (ensured.ok) {
        ensuredTeamId = ensured.teamId;
        await setQuoteTeamIdIfMissing({ quoteId, teamId: ensured.teamId });
      }

      const teamGrant = await addExistingUsersToCustomerDefaultTeamByEmail({
        customerAccountId: customer.id,
        ownerUserId: customer.user_id ?? user.id,
        teamName,
        emails: normalizedEmails,
      });

      if (teamGrant.ok) {
        teamGrantSummary = { enabled: true, teamId: teamGrant.teamId, added: teamGrant.added };
        await setQuoteTeamIdIfMissing({ quoteId, teamId: teamGrant.teamId });
        ensuredTeamId = ensuredTeamId ?? teamGrant.teamId;
      }
    } catch (error) {
      // Fail-soft: do not block invite emails or copy-link fallback.
      console.warn(`${WARN_PREFIX} team membership best-effort failed`, { quoteId, error });
    }

    // Phase 20.1.4: product-native team invites (schema-gated).
    if (ensuredTeamId && (await isCustomerTeamInvitesSchemaReady())) {
      const created: Array<{ email: string; inviteUrl: string }> = [];
      const inviteLinks: string[] = [];
      for (const email of normalizedEmails) {
        const createdInvite = await createCustomerTeamInvite({
          teamId: ensuredTeamId,
          invitedEmail: email,
          invitedByUserId: user.id,
        });
        if (!createdInvite.ok) {
          continue;
        }
        const inviteUrl = buildCustomerTeamInviteLink({
          token: createdInvite.invite.token,
          nextPath,
        });
        created.push({ email, inviteUrl });
        inviteLinks.push(inviteUrl);
      }

      const sendResult = await sendTeamInviteEmails({
        to: created,
        customerEmail: customer.email ?? user.email ?? quoteRow.customer_email ?? null,
        message: messageNormalized,
      });

      void logOpsEventNoQuote({
        eventType: "customer_team_invite_created",
        payload: {
          team_id: ensuredTeamId,
          quote_id: quoteId,
          recipient_count: normalizedEmails.length,
          created_count: created.length,
          emailed_count: sendResult.ok ? sendResult.sent : 0,
          recipient_domains: recipientDomains(normalizedEmails),
          provider: sendResult.ok ? sendResult.provider : "none",
          status: sendResult.ok ? "sent" : sendResult.error,
          source: "customer_quote_page",
          team_grant: teamGrantSummary,
        },
      });

      return NextResponse.json(
        {
          ok: true,
          invited: created.length,
          emailed: sendResult.ok ? sendResult.sent : 0,
          provider: sendResult.ok ? sendResult.provider : "none",
          shareUrl,
          inviteLinks: sendResult.ok && sendResult.sent > 0 ? undefined : inviteLinks,
        },
        { status: 200 },
      );
    }

    // Fallback: legacy "share search request" email (schema not ready).
    const sendResult = await sendInviteEmails({
      toEmails: normalizedEmails,
      customerEmail: customer.email ?? user.email ?? quoteRow.customer_email ?? null,
      shareUrl,
      message: messageNormalized,
    });

    void logOpsEvent({
      quoteId,
      eventType: "customer_teammate_invited",
      payload: {
        recipient_count: normalizedEmails.length,
        recipient_domains: recipientDomains(normalizedEmails),
        provider: sendResult.ok ? sendResult.provider : "none",
        sent_count: sendResult.ok ? sendResult.sent : 0,
        status: sendResult.ok ? "sent" : sendResult.error,
        source: "customer_quote_page",
        team_grant: teamGrantSummary,
      },
    });

    if (!sendResult.ok) {
      return NextResponse.json(
        { ok: false, error: sendResult.error, shareUrl },
        { status: 200 },
      );
    }

    return NextResponse.json(
      { ok: true, sent: sendResult.sent, provider: sendResult.provider, shareUrl },
      { status: 200 },
    );
  } catch (err: unknown) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
    console.error(`${WARN_PREFIX} crashed`, { error: err });
    return NextResponse.json({ ok: false, error: "unknown" }, { status: 500 });
  }
}

