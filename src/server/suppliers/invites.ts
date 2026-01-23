import crypto from "crypto";
import { supabaseServer } from "@/lib/supabaseServer";
import { sendNotificationEmail } from "@/server/notifications/email";
import { serializeSupabaseError } from "@/server/admin/logging";

export type SupplierInviteStatus = "pending" | "accepted" | "revoked";

export type SupplierInviteRow = {
  id: string;
  supplier_id: string;
  email: string;
  token: string;
  status: SupplierInviteStatus;
  created_at: string;
  accepted_at: string | null;
  invited_by_user_id: string | null;
};

export type SupplierInviteListItem = {
  id: string;
  email: string;
  token: string;
  status: SupplierInviteStatus;
  createdAt: string;
};

export type SupplierTeamMember = {
  userId: string;
  email: string | null;
  statusLabel: "Active";
  roleLabel: "Member";
};

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeEmail(value: unknown): string {
  const trimmed = normalizeText(value).toLowerCase();
  return trimmed;
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

export function buildSupplierInviteLink(token: string): string {
  const base = resolveSiteUrl();
  const safeToken = encodeURIComponent(token);
  return `${base}/supplier/invite/${safeToken}`;
}

function generateInviteToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function sendSupplierInviteEmail(args: {
  to: string;
  supplierCompanyName: string | null;
  inviteLink: string;
}): Promise<void> {
  const company = args.supplierCompanyName?.trim() ? args.supplierCompanyName.trim() : null;
  const greeting = company ? `<p>${escapeHtml(company)} team,</p>` : "<p>Hello,</p>";
  const subject = company
    ? `You're invited to join ${company} on Zartman`
    : "You're invited to join a supplier workspace on Zartman";
  const previewText = company
    ? `Accept your invite to join ${company} on Zartman.`
    : "Accept your invite to join a supplier workspace on Zartman.";

  await sendNotificationEmail({
    to: args.to,
    subject,
    previewText,
    html: `
      ${greeting}
      <p>You have been invited to join ${company ? `<strong>${escapeHtml(company)}</strong>` : "a supplier workspace"} on Zartman.</p>
      <p><a href="${args.inviteLink}">Accept invite</a></p>
      <p style="color:#94a3b8;font-size:12px;">If you weren't expecting this, you can ignore this email.</p>
    `,
  });
}

export async function listSupplierPendingInvites(args: {
  supplierId: string;
}): Promise<SupplierInviteListItem[]> {
  const supplierId = normalizeText(args?.supplierId);
  if (!supplierId) return [];

  try {
    const { data, error } = await supabaseServer()
      .from("supplier_invites")
      .select("id,email,token,status,created_at")
      .eq("supplier_id", supplierId)
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .returns<Array<Pick<SupplierInviteRow, "id" | "email" | "token" | "status" | "created_at">>>();

    if (error) {
      console.error("[supplier invites] list failed", {
        supplierId,
        error: serializeSupabaseError(error),
      });
      return [];
    }

    return (data ?? []).map((row) => ({
      id: row.id,
      email: row.email,
      token: row.token,
      status: row.status,
      createdAt: row.created_at,
    }));
  } catch (error) {
    console.error("[supplier invites] list crashed", {
      supplierId,
      error: serializeSupabaseError(error) ?? error,
    });
    return [];
  }
}

export async function createSupplierInvite(args: {
  supplierId: string;
  invitedEmail: string;
  invitedByUserId: string | null;
  supplierCompanyName: string | null;
}): Promise<{ ok: true; invite: SupplierInviteListItem } | { ok: false; error: string }> {
  const supplierId = normalizeText(args?.supplierId);
  const email = normalizeEmail(args?.invitedEmail);
  const invitedByUserId = normalizeText(args?.invitedByUserId) || null;

  if (!supplierId) {
    return { ok: false, error: "Missing supplier workspace." };
  }
  if (!email || !email.includes("@")) {
    return { ok: false, error: "Enter a valid email address." };
  }

  const token = generateInviteToken();

  try {
    const insertPayload = {
      supplier_id: supplierId,
      email,
      token,
      status: "pending" as const,
      invited_by_user_id: invitedByUserId,
    };

    const insert = await supabaseServer()
      .from("supplier_invites")
      .insert(insertPayload)
      .select("id,email,token,status,created_at")
      .single<Pick<SupplierInviteRow, "id" | "email" | "token" | "status" | "created_at">>();

    let inviteRow = insert.data ?? null;

    if (insert.error || !inviteRow) {
      const pgCode = (insert.error as { code?: string | null })?.code ?? null;

      // If a pending invite already exists for (supplier_id, email), reuse it.
      if (pgCode === "23505") {
        const existing = await supabaseServer()
          .from("supplier_invites")
          .select("id,email,token,status,created_at")
          .eq("supplier_id", supplierId)
          .eq("email", email)
          .eq("status", "pending")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle<Pick<SupplierInviteRow, "id" | "email" | "token" | "status" | "created_at">>();

        if (!existing.error && existing.data) {
          inviteRow = existing.data;
        } else {
          console.error("[supplier invites] create failed", {
            supplierId,
            email,
            error: serializeSupabaseError(insert.error) ?? insert.error,
            fallbackError: serializeSupabaseError(existing.error) ?? existing.error,
          });
          return { ok: false, error: "We couldn’t create that invite. Please try again." };
        }
      } else {
        console.error("[supplier invites] create failed", {
          supplierId,
          email,
          error: serializeSupabaseError(insert.error) ?? insert.error,
        });
        return { ok: false, error: "We couldn’t create that invite. Please try again." };
      }
    }

    const inviteLink = buildSupplierInviteLink(inviteRow.token);
    await sendSupplierInviteEmail({
      to: inviteRow.email,
      supplierCompanyName: args?.supplierCompanyName ?? null,
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
    console.error("[supplier invites] create failed", {
      supplierId,
      email,
      error: serializeSupabaseError(error) ?? error,
    });
    return { ok: false, error: "We couldn’t create that invite. Please try again." };
  }
}

export async function resendSupplierInvite(args: {
  supplierId: string;
  inviteId: string;
  supplierCompanyName: string | null;
}): Promise<{ ok: true; invite: SupplierInviteListItem } | { ok: false; error: string }> {
  const supplierId = normalizeText(args?.supplierId);
  const inviteId = normalizeText(args?.inviteId);
  if (!supplierId || !inviteId) {
    return { ok: false, error: "Missing invite." };
  }

  try {
    const { data, error } = await supabaseServer()
      .from("supplier_invites")
      .select("id,email,token,status,created_at")
      .eq("supplier_id", supplierId)
      .eq("id", inviteId)
      .maybeSingle<Pick<SupplierInviteRow, "id" | "email" | "token" | "status" | "created_at">>();

    if (error || !data) {
      console.error("[supplier invites] resend failed", {
        supplierId,
        inviteId,
        error: serializeSupabaseError(error) ?? error,
      });
      return { ok: false, error: "We couldn’t resend that invite. Please try again." };
    }

    if (data.status !== "pending") {
      return { ok: false, error: "That invite is no longer pending." };
    }

    const inviteLink = buildSupplierInviteLink(data.token);
    await sendSupplierInviteEmail({
      to: data.email,
      supplierCompanyName: args?.supplierCompanyName ?? null,
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
  } catch (error) {
    console.error("[supplier invites] resend failed", {
      supplierId,
      inviteId,
      error: serializeSupabaseError(error) ?? error,
    });
    return { ok: false, error: "We couldn’t resend that invite. Please try again." };
  }
}

export async function loadSupplierInviteByToken(args: {
  token: string;
}): Promise<SupplierInviteRow | null> {
  const token = normalizeToken(args?.token);
  if (!isValidToken(token)) return null;

  try {
    const { data, error } = await supabaseServer()
      .from("supplier_invites")
      .select("id,supplier_id,email,token,status,created_at,accepted_at,invited_by_user_id")
      .eq("token", token)
      .maybeSingle<SupplierInviteRow>();

    if (error) {
      console.error("[supplier invites] accept failed", {
        tokenPresent: Boolean(token),
        error: serializeSupabaseError(error),
      });
      return null;
    }

    return data ?? null;
  } catch (error) {
    console.error("[supplier invites] accept failed", {
      tokenPresent: Boolean(token),
      error: serializeSupabaseError(error) ?? error,
    });
    return null;
  }
}

export async function acceptSupplierInvite(args: {
  token: string;
  userId: string;
  userEmail: string | null;
}): Promise<
  | { ok: true; supplierId: string }
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

  const invite = await loadSupplierInviteByToken({ token });
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
    const supplierId = invite.supplier_id;

    const membership = await supabaseServer()
      .from("supplier_users")
      .upsert(
        { supplier_id: supplierId, user_id: userId },
        { onConflict: "supplier_id,user_id", ignoreDuplicates: true },
      );

    if (membership.error) {
      console.error("[supplier invites] accept failed", {
        supplierId,
        userId,
        tokenPresent: true,
        error: serializeSupabaseError(membership.error),
      });
      return { ok: false, error: "We couldn’t accept that invite. Please try again.", reason: "write_failed" };
    }

    const updated = await supabaseServer()
      .from("supplier_invites")
      .update({ status: "accepted", accepted_at: new Date().toISOString() })
      .eq("id", invite.id)
      .eq("status", "pending")
      .select("id")
      .maybeSingle<{ id: string }>();

    if (updated.error || !updated.data?.id) {
      console.error("[supplier invites] accept failed", {
        supplierId,
        userId,
        inviteId: invite.id,
        error: serializeSupabaseError(updated.error) ?? updated.error,
      });
      return { ok: false, error: "We couldn’t accept that invite. Please try again.", reason: "write_failed" };
    }

    return { ok: true, supplierId };
  } catch (error) {
    console.error("[supplier invites] accept failed", {
      tokenPresent: true,
      userId,
      error: serializeSupabaseError(error) ?? error,
    });
    return { ok: false, error: "We couldn’t accept that invite. Please try again.", reason: "write_failed" };
  }
}

export async function listSupplierTeamMembers(args: {
  supplierId: string;
  supplierOwnerUserId: string | null;
}): Promise<SupplierTeamMember[]> {
  const supplierId = normalizeText(args?.supplierId);
  const ownerUserId = normalizeText(args?.supplierOwnerUserId) || null;

  if (!supplierId) {
    return [];
  }

  type SupplierUserRow = { user_id: string; created_at: string };

  const userIds = new Set<string>();
  if (ownerUserId) userIds.add(ownerUserId);

  try {
    const { data, error } = await supabaseServer()
      .from("supplier_users")
      .select("user_id,created_at")
      .eq("supplier_id", supplierId)
      .order("created_at", { ascending: true })
      .returns<SupplierUserRow[]>();

    if (error) {
      console.error("[supplier invites] team members lookup failed", {
        supplierId,
        error: serializeSupabaseError(error),
      });
      // Still return owner (best-effort).
    } else {
      for (const row of data ?? []) {
        const id = normalizeText(row?.user_id);
        if (id) userIds.add(id);
      }
    }
  } catch (error) {
    console.error("[supplier invites] team members lookup crashed", {
      supplierId,
      error: serializeSupabaseError(error) ?? error,
    });
  }

  const resolved: SupplierTeamMember[] = [];

  for (const userId of Array.from(userIds)) {
    try {
      const { data, error } = await supabaseServer().auth.admin.getUserById(userId);
      if (error) {
        resolved.push({
          userId,
          email: null,
          statusLabel: "Active",
          roleLabel: "Member",
        });
        continue;
      }

      resolved.push({
        userId,
        email: data.user?.email ?? null,
        statusLabel: "Active",
        roleLabel: "Member",
      });
    } catch {
      resolved.push({
        userId,
        email: null,
        statusLabel: "Active",
        roleLabel: "Member",
      });
    }
  }

  resolved.sort((a, b) => (a.email ?? "").localeCompare(b.email ?? ""));
  return resolved;
}
