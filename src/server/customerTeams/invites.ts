import crypto from "crypto";

import { supabaseServer } from "@/lib/supabaseServer";
import { serializeSupabaseError } from "@/server/admin/logging";
import { isCustomerTeamInvitesSchemaReady } from "@/server/customerTeams/schema";

export type CustomerTeamInviteStatus = "pending" | "accepted" | "expired";

export type CustomerTeamInviteRow = {
  id: string;
  team_id: string;
  email: string;
  token: string;
  invited_by_user_id: string | null;
  status: CustomerTeamInviteStatus;
  created_at: string;
  expires_at: string;
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

export function buildCustomerTeamInviteLink(args: { token: string; nextPath?: string | null }): string {
  const base = resolveSiteUrl();
  const safeToken = encodeURIComponent(args.token);
  const nextPath = normalizeText(args.nextPath);
  const nextQuery = nextPath ? `?next=${encodeURIComponent(nextPath)}` : "";
  return `${base}/customer/team/invite/${safeToken}${nextQuery}`;
}

function generateInviteToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

function isExpired(expiresAtIso: string): boolean {
  const expiresAt = Date.parse(expiresAtIso);
  if (!Number.isFinite(expiresAt)) return true;
  return expiresAt <= Date.now();
}

async function markExpiredIfNeeded(args: { teamId: string; email: string }) {
  try {
    const nowIso = new Date().toISOString();
    await supabaseServer
      .from("customer_team_invites")
      .update({ status: "expired" })
      .eq("team_id", args.teamId)
      .ilike("email", args.email)
      .eq("status", "pending")
      .lte("expires_at", nowIso);
  } catch {
    // Fail-soft.
  }
}

export async function createCustomerTeamInvite(args: {
  teamId: string;
  invitedEmail: string;
  invitedByUserId: string | null;
}): Promise<{ ok: true; invite: CustomerTeamInviteRow } | { ok: false; error: string; reason?: string }> {
  const teamId = normalizeText(args?.teamId);
  const email = normalizeEmail(args?.invitedEmail);
  const invitedByUserId = normalizeText(args?.invitedByUserId) || null;

  if (!teamId) return { ok: false, error: "Missing team.", reason: "invalid_team" };
  if (!email || !email.includes("@")) return { ok: false, error: "Enter a valid email address.", reason: "invalid_email" };

  if (!(await isCustomerTeamInvitesSchemaReady())) {
    return { ok: false, error: "Invites aren’t available yet.", reason: "schema_missing" };
  }

  await markExpiredIfNeeded({ teamId, email });

  const token = generateInviteToken();

  try {
    const insert = await supabaseServer
      .from("customer_team_invites")
      .insert({
        team_id: teamId,
        email,
        token,
        invited_by_user_id: invitedByUserId,
        status: "pending" as const,
      })
      .select("id,team_id,email,token,invited_by_user_id,status,created_at,expires_at")
      .single<CustomerTeamInviteRow>();

    if (!insert.error && insert.data) {
      return { ok: true, invite: insert.data };
    }

    const pgCode = (insert.error as { code?: string | null })?.code ?? null;
    // If a pending invite already exists for (team_id, email), reuse it.
    if (pgCode === "23505") {
      const existing = await supabaseServer
        .from("customer_team_invites")
        .select("id,team_id,email,token,invited_by_user_id,status,created_at,expires_at")
        .eq("team_id", teamId)
        .ilike("email", email)
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle<CustomerTeamInviteRow>();

      if (!existing.error && existing.data && existing.data.status === "pending") {
        // If it somehow already expired, mark expired and ask caller to retry.
        if (isExpired(existing.data.expires_at)) {
          await markExpiredIfNeeded({ teamId, email });
          return { ok: false, error: "That invite has expired. Please try again.", reason: "expired_existing" };
        }
        return { ok: true, invite: existing.data };
      }
    }

    console.error("[customer_team_invites] create failed", {
      teamId,
      email,
      error: serializeSupabaseError(insert.error) ?? insert.error,
    });
    return { ok: false, error: "We couldn’t create that invite. Please try again.", reason: "write_failed" };
  } catch (error) {
    console.error("[customer_team_invites] create crashed", {
      teamId,
      email,
      error: serializeSupabaseError(error) ?? error,
    });
    return { ok: false, error: "We couldn’t create that invite. Please try again.", reason: "write_failed" };
  }
}

export async function loadCustomerTeamInviteByToken(args: {
  token: string;
}): Promise<CustomerTeamInviteRow | null> {
  const token = normalizeToken(args?.token);
  if (!isValidToken(token)) return null;
  if (!(await isCustomerTeamInvitesSchemaReady())) return null;

  try {
    const { data, error } = await supabaseServer
      .from("customer_team_invites")
      .select("id,team_id,email,token,invited_by_user_id,status,created_at,expires_at")
      .eq("token", token)
      .maybeSingle<CustomerTeamInviteRow>();

    if (error) {
      console.error("[customer_team_invites] load failed", {
        tokenPresent: true,
        error: serializeSupabaseError(error),
      });
      return null;
    }

    const invite = data ?? null;
    if (!invite) return null;

    if (invite.status === "pending" && isExpired(invite.expires_at)) {
      // Best-effort: mark expired for single-use + safe UX.
      try {
        await supabaseServer
          .from("customer_team_invites")
          .update({ status: "expired" })
          .eq("id", invite.id)
          .eq("status", "pending");
      } catch {
        // Fail-soft.
      }
      return { ...invite, status: "expired" };
    }

    return invite;
  } catch (error) {
    console.error("[customer_team_invites] load crashed", {
      tokenPresent: true,
      error: serializeSupabaseError(error) ?? error,
    });
    return null;
  }
}

export async function acceptCustomerTeamInvite(args: {
  token: string;
  userId: string;
  userEmail: string | null;
}): Promise<
  | { ok: true; teamId: string }
  | { ok: false; error: string; reason?: "invalid" | "email_mismatch" | "write_failed" | "schema_missing" }
> {
  const token = normalizeToken(args?.token);
  const userId = normalizeText(args?.userId);
  const userEmail = args?.userEmail ? normalizeEmail(args.userEmail) : null;

  if (!userId) return { ok: false, error: "You must be logged in to accept an invite.", reason: "invalid" };
  if (!isValidToken(token)) return { ok: false, error: "That invite link is invalid.", reason: "invalid" };

  if (!(await isCustomerTeamInvitesSchemaReady())) {
    return { ok: false, error: "Invites aren’t available yet.", reason: "schema_missing" };
  }

  const invite = await loadCustomerTeamInviteByToken({ token });
  if (!invite || invite.status !== "pending") {
    return { ok: false, error: "That invite is no longer valid.", reason: "invalid" };
  }

  if (isExpired(invite.expires_at)) {
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
    const teamId = invite.team_id;

    const membership = await supabaseServer
      .from("customer_team_members")
      .upsert({ team_id: teamId, user_id: userId, role: "member" }, { onConflict: "team_id,user_id" });

    if (membership.error) {
      console.error("[customer_team_invites] accept failed (membership)", {
        teamId,
        userId,
        tokenPresent: true,
        error: serializeSupabaseError(membership.error),
      });
      return { ok: false, error: "We couldn’t accept that invite. Please try again.", reason: "write_failed" };
    }

    const nowIso = new Date().toISOString();
    const updated = await supabaseServer
      .from("customer_team_invites")
      .update({ status: "accepted" })
      .eq("id", invite.id)
      .eq("status", "pending")
      .gt("expires_at", nowIso)
      .select("id,status")
      .maybeSingle<{ id: string; status: CustomerTeamInviteStatus }>();

    if (!updated.error && updated.data?.id) {
      return { ok: true, teamId };
    }

    // If the invite was accepted concurrently, treat as ok (membership is already in place).
    const reread = await loadCustomerTeamInviteByToken({ token });
    if (reread?.id === invite.id && reread.status === "accepted") {
      return { ok: true, teamId };
    }

    console.error("[customer_team_invites] accept failed (invite update)", {
      teamId,
      userId,
      inviteId: invite.id,
      error: serializeSupabaseError(updated.error) ?? updated.error,
    });
    return { ok: false, error: "We couldn’t accept that invite. Please try again.", reason: "write_failed" };
  } catch (error) {
    console.error("[customer_team_invites] accept crashed", {
      tokenPresent: true,
      userId,
      error: serializeSupabaseError(error) ?? error,
    });
    return { ok: false, error: "We couldn’t accept that invite. Please try again.", reason: "write_failed" };
  }
}

