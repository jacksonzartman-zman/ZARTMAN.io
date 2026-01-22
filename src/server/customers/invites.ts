import crypto from "crypto";
import { supabaseServer } from "@/lib/supabaseServer";
import { sendNotificationEmail } from "@/server/notifications/email";
import { serializeSupabaseError } from "@/server/admin/logging";
import {
  ensureCustomerDefaultTeam,
  listCustomerTeamMembers as listCustomerTeamMemberRows,
} from "@/server/customerTeams";
import { isCustomerTeamsSchemaReady } from "@/server/customerTeams/schema";

export type CustomerInviteStatus = "pending" | "accepted" | "revoked";

export type CustomerInviteRow = {
  id: string;
  customer_id: string;
  email: string;
  token: string;
  status: CustomerInviteStatus;
  created_at: string;
  accepted_at: string | null;
  invited_by_user_id: string | null;
};

export type CustomerInviteListItem = {
  id: string;
  email: string;
  token: string;
  status: CustomerInviteStatus;
  createdAt: string;
};

export type CustomerTeamMember = {
  userId: string;
  email: string | null;
  statusLabel: "Active";
  roleLabel: "Owner" | "Member";
};

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeEmail(value: unknown): string {
  return normalizeText(value).toLowerCase();
}

function normalizeToken(value: unknown): string {
  return normalizeText(value);
}

function isValidToken(token: string): boolean {
  // Keep it permissive but require enough entropy.
  return token.length >= 32 && token.length <= 256;
}

function resolveSiteUrl(): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000")
  );
}

export function buildCustomerInviteLink(token: string): string {
  const base = resolveSiteUrl();
  const safeToken = encodeURIComponent(token);
  return `${base}/customer/invite/${safeToken}`;
}

function generateInviteToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function sendCustomerInviteEmail(args: {
  to: string;
  customerCompanyName: string | null;
  inviteLink: string;
}): Promise<void> {
  const company = args.customerCompanyName?.trim() ? args.customerCompanyName.trim() : null;
  const greeting = company ? `<p>${escapeHtml(company)} team,</p>` : "<p>Hello,</p>";
  const subject = company
    ? `You're invited to join ${company} on Zartman`
    : "You're invited to join a customer workspace on Zartman";
  const previewText = company
    ? `Accept your invite to join ${company} on Zartman.`
    : "Accept your invite to join a customer workspace on Zartman.";

  await sendNotificationEmail({
    to: args.to,
    subject,
    previewText,
    html: `
      ${greeting}
      <p>You have been invited to join ${company ? `<strong>${escapeHtml(company)}</strong>` : "a customer workspace"} on Zartman.</p>
      <p><a href="${args.inviteLink}">Accept invite</a></p>
      <p style="color:#94a3b8;font-size:12px;">If you weren't expecting this, you can ignore this email.</p>
    `,
  });
}

export async function listCustomerPendingInvites(args: {
  customerId: string;
}): Promise<CustomerInviteListItem[]> {
  const customerId = normalizeText(args?.customerId);
  if (!customerId) return [];

  const { data, error } = await supabaseServer
    .from("customer_invites")
    .select("id,email,token,status,created_at")
    .eq("customer_id", customerId)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .returns<Array<Pick<CustomerInviteRow, "id" | "email" | "token" | "status" | "created_at">>>();

  if (error) {
    return [];
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    email: row.email,
    token: row.token,
    status: row.status,
    createdAt: row.created_at,
  }));
}

export async function createCustomerInvite(args: {
  customerId: string;
  invitedEmail: string;
  invitedByUserId: string | null;
  customerCompanyName: string | null;
}): Promise<{ ok: true; invite: CustomerInviteListItem } | { ok: false; error: string }> {
  const customerId = normalizeText(args?.customerId);
  const email = normalizeEmail(args?.invitedEmail);
  const invitedByUserId = normalizeText(args?.invitedByUserId) || null;

  if (!customerId) {
    return { ok: false, error: "Missing customer workspace." };
  }
  if (!email || !email.includes("@")) {
    return { ok: false, error: "Enter a valid email address." };
  }

  const token = generateInviteToken();

  try {
    const insertPayload = {
      customer_id: customerId,
      email,
      token,
      status: "pending" as const,
      invited_by_user_id: invitedByUserId,
    };

    const insert = await supabaseServer
      .from("customer_invites")
      .insert(insertPayload)
      .select("id,email,token,status,created_at")
      .single<Pick<CustomerInviteRow, "id" | "email" | "token" | "status" | "created_at">>();

    let inviteRow = insert.data ?? null;

    if (insert.error || !inviteRow) {
      const pgCode = (insert.error as { code?: string | null })?.code ?? null;

      // If a pending invite already exists for (customer_id, email), reuse it.
      if (pgCode === "23505") {
        const existing = await supabaseServer
          .from("customer_invites")
          .select("id,email,token,status,created_at")
          .eq("customer_id", customerId)
          .eq("email", email)
          .eq("status", "pending")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle<Pick<CustomerInviteRow, "id" | "email" | "token" | "status" | "created_at">>();

        if (!existing.error && existing.data) {
          inviteRow = existing.data;
        } else {
          console.error("[customer invites] create failed", {
            customerId,
            email,
            error: serializeSupabaseError(insert.error) ?? insert.error,
            fallbackError: serializeSupabaseError(existing.error) ?? existing.error,
          });
          return { ok: false, error: "We couldn’t create that invite. Please try again." };
        }
      } else {
        console.error("[customer invites] create failed", {
          customerId,
          email,
          error: serializeSupabaseError(insert.error) ?? insert.error,
        });
        return { ok: false, error: "We couldn’t create that invite. Please try again." };
      }
    }

    const inviteLink = buildCustomerInviteLink(inviteRow.token);
    await sendCustomerInviteEmail({
      to: inviteRow.email,
      customerCompanyName: args?.customerCompanyName ?? null,
      inviteLink,
    });

    return {
      ok: true,
      invite: {
        id: inviteRow.id,
        email: inviteRow.email,
        token: inviteRow.token,
        status: inviteRow.status,
        createdAt: inviteRow.created_at,
      },
    };
  } catch (error) {
    console.error("[customer invites] create failed", {
      customerId,
      email,
      error: serializeSupabaseError(error) ?? error,
    });
    return { ok: false, error: "We couldn’t create that invite. Please try again." };
  }
}

export async function resendCustomerInvite(args: {
  customerId: string;
  inviteId: string;
  customerCompanyName: string | null;
}): Promise<{ ok: true; invite: CustomerInviteListItem } | { ok: false; error: string }> {
  const customerId = normalizeText(args?.customerId);
  const inviteId = normalizeText(args?.inviteId);
  if (!customerId || !inviteId) {
    return { ok: false, error: "Missing invite." };
  }

  const { data, error } = await supabaseServer
    .from("customer_invites")
    .select("id,email,token,status,created_at")
    .eq("customer_id", customerId)
    .eq("id", inviteId)
    .maybeSingle<Pick<CustomerInviteRow, "id" | "email" | "token" | "status" | "created_at">>();

  if (error || !data) {
    return { ok: false, error: "We couldn’t resend that invite. Please try again." };
  }

  if (data.status !== "pending") {
    return { ok: false, error: "That invite is no longer pending." };
  }

  const inviteLink = buildCustomerInviteLink(data.token);
  await sendCustomerInviteEmail({
    to: data.email,
    customerCompanyName: args?.customerCompanyName ?? null,
    inviteLink,
  });

  return {
    ok: true,
    invite: {
      id: data.id,
      email: data.email,
      token: data.token,
      status: data.status,
      createdAt: data.created_at,
    },
  };
}

export async function loadCustomerInviteByToken(args: {
  token: string;
}): Promise<CustomerInviteRow | null> {
  const token = normalizeToken(args?.token);
  if (!isValidToken(token)) return null;

  try {
    const { data, error } = await supabaseServer
      .from("customer_invites")
      .select("id,customer_id,email,token,status,created_at,accepted_at,invited_by_user_id")
      .eq("token", token)
      .maybeSingle<CustomerInviteRow>();

    if (error) {
      console.error("[customer invites] accept failed", {
        tokenPresent: Boolean(token),
        error: serializeSupabaseError(error),
      });
      return null;
    }

    return data ?? null;
  } catch (error) {
    console.error("[customer invites] accept failed", {
      tokenPresent: Boolean(token),
      error: serializeSupabaseError(error) ?? error,
    });
    return null;
  }
}

export async function acceptCustomerInvite(args: {
  token: string;
  userId: string;
  userEmail: string | null;
}): Promise<
  | { ok: true; customerId: string }
  | { ok: false; error: string; reason?: "invalid" | "email_mismatch" | "write_failed" }
> {
  const token = normalizeToken(args?.token);
  const userId = normalizeText(args?.userId);
  const userEmail = args?.userEmail ? normalizeEmail(args.userEmail) : null;

  if (!userId) {
    return { ok: false, error: "You must be logged in to accept an invite.", reason: "invalid" };
  }

  if (!isValidToken(token)) {
    return { ok: false, error: "That invite link is invalid.", reason: "invalid" };
  }

  const invite = await loadCustomerInviteByToken({ token });
  if (!invite || invite.status !== "pending") {
    return { ok: false, error: "That invite is no longer valid.", reason: "invalid" };
  }

  const invitedEmail = normalizeEmail(invite.email);
  if (!userEmail || invitedEmail !== userEmail) {
    return {
      ok: false,
      error: `Please log in as ${invite.email} to accept this invite.`,
      reason: "email_mismatch",
    };
  }

  try {
    const customerId = invite.customer_id;

    const membership = await supabaseServer
      .from("customer_users")
      .upsert({ customer_id: customerId, user_id: userId }, { onConflict: "customer_id,user_id", ignoreDuplicates: true });

    if (membership.error) {
      console.error("[customer invites] accept failed", {
        customerId,
        userId,
        tokenPresent: true,
        error: serializeSupabaseError(membership.error),
      });
      return { ok: false, error: "We couldn’t accept that invite. Please try again.", reason: "write_failed" };
    }

    const updated = await supabaseServer
      .from("customer_invites")
      .update({ status: "accepted", accepted_at: new Date().toISOString() })
      .eq("id", invite.id)
      .eq("status", "pending")
      .select("id")
      .maybeSingle<{ id: string }>();

    if (updated.error || !updated.data?.id) {
      console.error("[customer invites] accept failed", {
        customerId,
        userId,
        inviteId: invite.id,
        error: serializeSupabaseError(updated.error) ?? updated.error,
      });
      return { ok: false, error: "We couldn’t accept that invite. Please try again.", reason: "write_failed" };
    }

    // Best-effort: also add to customer team membership when teams schema exists.
    try {
      if (await isCustomerTeamsSchemaReady()) {
        const { data: customerRow } = await supabaseServer
          .from("customers")
          .select("id,company_name,user_id")
          .eq("id", customerId)
          .maybeSingle<{ id: string; company_name: string | null; user_id: string | null }>();

        const teamName =
          customerRow?.company_name?.trim()
            ? `${customerRow.company_name.trim()} team`
            : "Team";

        const ensured = await ensureCustomerDefaultTeam({
          customerAccountId: customerId,
          teamName,
          ownerUserId: customerRow?.user_id ?? null,
        });

        if (ensured.ok) {
          await supabaseServer
            .from("customer_team_members")
            .upsert(
              { team_id: ensured.teamId, user_id: userId, role: "member" },
              { onConflict: "team_id,user_id" },
            );
        }
      }
    } catch {
      // Fail-soft.
    }

    return { ok: true, customerId };
  } catch (error) {
    console.error("[customer invites] accept failed", {
      tokenPresent: true,
      userId,
      error: serializeSupabaseError(error) ?? error,
    });
    return { ok: false, error: "We couldn’t accept that invite. Please try again.", reason: "write_failed" };
  }
}

export async function listCustomerTeamMembers(args: {
  customerId: string;
  customerOwnerUserId: string | null;
}): Promise<CustomerTeamMember[]> {
  const customerId = normalizeText(args?.customerId);
  const ownerUserId = normalizeText(args?.customerOwnerUserId) || null;
  if (!customerId) return [];

  type CustomerUserRow = { user_id: string; created_at: string };

  const resolved: CustomerTeamMember[] = [];

  // Prefer the new team schema when present; fall back to legacy customer_users.
  const userRoles = new Map<string, CustomerTeamMember["roleLabel"]>();

  if (await isCustomerTeamsSchemaReady()) {
    const memberRows = await listCustomerTeamMemberRows({ customerAccountId: customerId });
    for (const row of memberRows) {
      const id = normalizeText(row?.user_id);
      if (!id) continue;
      const roleLabel: CustomerTeamMember["roleLabel"] = row.role === "owner" ? "Owner" : "Member";
      userRoles.set(id, roleLabel);
    }
  }

  if (userRoles.size === 0) {
    const userIds = new Set<string>();
    if (ownerUserId) userIds.add(ownerUserId);

    const { data } = await supabaseServer
      .from("customer_users")
      .select("user_id,created_at")
      .eq("customer_id", customerId)
      .order("created_at", { ascending: true })
      .returns<CustomerUserRow[]>();

    for (const row of data ?? []) {
      const id = normalizeText(row?.user_id);
      if (id) userIds.add(id);
    }

    for (const userId of Array.from(userIds)) {
      userRoles.set(userId, "Member");
    }
  }

  for (const [userId, roleLabel] of userRoles.entries()) {
    try {
      const { data, error } = await supabaseServer.auth.admin.getUserById(userId);
      if (error) {
        resolved.push({ userId, email: null, statusLabel: "Active", roleLabel });
        continue;
      }
      resolved.push({
        userId,
        email: data.user?.email ?? null,
        statusLabel: "Active",
        roleLabel,
      });
    } catch {
      resolved.push({ userId, email: null, statusLabel: "Active", roleLabel });
    }
  }

  resolved.sort((a, b) => (a.email ?? "").localeCompare(b.email ?? ""));
  return resolved;
}

