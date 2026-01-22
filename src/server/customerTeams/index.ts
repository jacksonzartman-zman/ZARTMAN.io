import { supabaseServer } from "@/lib/supabaseServer";
import { isMissingTableOrColumnError, serializeSupabaseError } from "@/server/admin/logging";
import { isCustomerTeamsSchemaReady } from "@/server/customerTeams/schema";

export type CustomerTeamRole = "owner" | "member";

type CustomerTeamRow = {
  id: string;
  customer_account_id: string;
  name: string;
  created_at: string;
};

type CustomerTeamMemberRow = {
  team_id: string;
  user_id: string;
  role: CustomerTeamRole;
  created_at: string;
};

function normalizeId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export async function getCustomerDefaultTeamId(args: {
  customerAccountId: string;
}): Promise<string | null> {
  const customerAccountId = normalizeId(args.customerAccountId);
  if (!customerAccountId) return null;
  if (!(await isCustomerTeamsSchemaReady())) return null;

  try {
    const { data, error } = await supabaseServer
      .from("customer_teams")
      .select("id,customer_account_id,name,created_at")
      .eq("customer_account_id", customerAccountId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle<CustomerTeamRow>();

    if (error) {
      if (isMissingTableOrColumnError(error)) return null;
      console.warn("[customer_teams] default team lookup failed", {
        customerAccountId,
        error: serializeSupabaseError(error) ?? error,
      });
      return null;
    }

    const id = normalizeId(data?.id);
    return id || null;
  } catch (error) {
    if (isMissingTableOrColumnError(error)) return null;
    console.warn("[customer_teams] default team lookup crashed", {
      customerAccountId,
      error: serializeSupabaseError(error) ?? error,
    });
    return null;
  }
}

export async function ensureCustomerDefaultTeam(args: {
  customerAccountId: string;
  teamName: string | null;
  ownerUserId: string | null;
}): Promise<{ ok: true; teamId: string } | { ok: false; reason: "schema_missing" | "write_failed" }> {
  const customerAccountId = normalizeId(args.customerAccountId);
  const ownerUserId = normalizeId(args.ownerUserId) || null;
  const teamName = typeof args.teamName === "string" && args.teamName.trim() ? args.teamName.trim() : "Team";
  if (!customerAccountId) return { ok: false, reason: "write_failed" };

  const schemaOk = await isCustomerTeamsSchemaReady();
  if (!schemaOk) return { ok: false, reason: "schema_missing" };

  const existing = await getCustomerDefaultTeamId({ customerAccountId });
  const teamId = existing ?? (await createCustomerTeam({ customerAccountId, name: teamName }));
  if (!teamId) return { ok: false, reason: "write_failed" };

  if (ownerUserId) {
    await upsertCustomerTeamMember({ teamId, userId: ownerUserId, role: "owner" });
  }

  return { ok: true, teamId };
}

async function createCustomerTeam(args: { customerAccountId: string; name: string }): Promise<string | null> {
  try {
    const { data, error } = await supabaseServer
      .from("customer_teams")
      .insert({
        customer_account_id: args.customerAccountId,
        name: args.name,
      })
      .select("id")
      .maybeSingle<{ id: string }>();

    if (error) {
      if (isMissingTableOrColumnError(error)) return null;
      console.warn("[customer_teams] create team failed", {
        customerAccountId: args.customerAccountId,
        error: serializeSupabaseError(error) ?? error,
      });
      return null;
    }

    const id = normalizeId(data?.id);
    return id || null;
  } catch (error) {
    if (isMissingTableOrColumnError(error)) return null;
    console.warn("[customer_teams] create team crashed", {
      customerAccountId: args.customerAccountId,
      error: serializeSupabaseError(error) ?? error,
    });
    return null;
  }
}

async function upsertCustomerTeamMember(args: {
  teamId: string;
  userId: string;
  role: CustomerTeamRole;
}): Promise<boolean> {
  const teamId = normalizeId(args.teamId);
  const userId = normalizeId(args.userId);
  if (!teamId || !userId) return false;

  try {
    const { error } = await supabaseServer
      .from("customer_team_members")
      .upsert(
        {
          team_id: teamId,
          user_id: userId,
          role: args.role,
        },
        { onConflict: "team_id,user_id" },
      );

    if (error) {
      if (isMissingTableOrColumnError(error)) return false;
      console.warn("[customer_teams] upsert member failed", {
        teamId,
        userId,
        error: serializeSupabaseError(error) ?? error,
      });
      return false;
    }

    return true;
  } catch (error) {
    if (isMissingTableOrColumnError(error)) return false;
    console.warn("[customer_teams] upsert member crashed", {
      teamId,
      userId,
      error: serializeSupabaseError(error) ?? error,
    });
    return false;
  }
}

export async function addUserToTeam(args: {
  teamId: string;
  userId: string;
  role: CustomerTeamRole;
}): Promise<boolean> {
  return await upsertCustomerTeamMember(args);
}

export async function listCustomerTeamMembers(args: {
  customerAccountId: string;
}): Promise<CustomerTeamMemberRow[]> {
  const customerAccountId = normalizeId(args.customerAccountId);
  if (!customerAccountId) return [];
  if (!(await isCustomerTeamsSchemaReady())) return [];

  const teamId = await getCustomerDefaultTeamId({ customerAccountId });
  if (!teamId) return [];

  try {
    const { data, error } = await supabaseServer
      .from("customer_team_members")
      .select("team_id,user_id,role,created_at")
      .eq("team_id", teamId)
      .order("created_at", { ascending: true })
      .returns<CustomerTeamMemberRow[]>();

    if (error) {
      if (isMissingTableOrColumnError(error)) return [];
      console.warn("[customer_teams] list members failed", {
        customerAccountId,
        error: serializeSupabaseError(error) ?? error,
      });
      return [];
    }

    return Array.isArray(data) ? data : [];
  } catch (error) {
    if (isMissingTableOrColumnError(error)) return [];
    console.warn("[customer_teams] list members crashed", {
      customerAccountId,
      error: serializeSupabaseError(error) ?? error,
    });
    return [];
  }
}

export async function addExistingUsersToCustomerDefaultTeamByEmail(args: {
  customerAccountId: string;
  ownerUserId: string | null;
  teamName: string | null;
  emails: string[];
}): Promise<{ ok: true; teamId: string; added: number } | { ok: false; reason: "schema_missing" | "unknown" }> {
  const emails = (Array.isArray(args.emails) ? args.emails : [])
    .map((e) => normalizeEmail(e))
    .filter((e) => e && e.includes("@"))
    .slice(0, 10);

  const ensured = await ensureCustomerDefaultTeam({
    customerAccountId: args.customerAccountId,
    teamName: args.teamName,
    ownerUserId: args.ownerUserId,
  });
  if (!ensured.ok) return { ok: false, reason: ensured.reason === "schema_missing" ? "schema_missing" : "unknown" };

  const teamId = ensured.teamId;
  const userIdsByEmail = await lookupAuthUserIdsByEmail(emails);

  let added = 0;
  for (const [email, userId] of userIdsByEmail.entries()) {
    if (!userId) continue;
    const ok = await upsertCustomerTeamMember({ teamId, userId, role: "member" });
    if (ok) added += 1;
    void email; // keep loop stable (email is useful for debugging)
  }

  return { ok: true, teamId, added };
}

async function lookupAuthUserIdsByEmail(emails: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const list = (Array.isArray(emails) ? emails : []).map((e) => normalizeEmail(e)).filter(Boolean);
  if (list.length === 0) return out;

  try {
    const { data, error } = await supabaseServer.rpc("lookup_auth_user_ids_by_email", { emails: list });
    if (error) {
      if (isMissingTableOrColumnError(error)) return out;
      console.warn("[customer_teams] lookup_auth_user_ids_by_email failed", {
        error: serializeSupabaseError(error) ?? error,
      });
      return out;
    }
    for (const row of (Array.isArray(data) ? data : []) as Array<{ email?: unknown; user_id?: unknown }>) {
      const email = normalizeEmail(row?.email);
      const userId = normalizeId(row?.user_id);
      if (!email || !userId) continue;
      out.set(email, userId);
    }
  } catch (error) {
    console.warn("[customer_teams] lookup_auth_user_ids_by_email crashed", {
      error: serializeSupabaseError(error) ?? error,
    });
  }

  return out;
}

export async function setQuoteTeamIdIfMissing(args: {
  quoteId: string;
  teamId: string;
}): Promise<boolean> {
  const quoteId = normalizeId(args.quoteId);
  const teamId = normalizeId(args.teamId);
  if (!quoteId || !teamId) return false;
  if (!(await isCustomerTeamsSchemaReady())) return false;

  try {
    const { error } = await supabaseServer
      .from("quotes")
      .update({ team_id: teamId })
      .eq("id", quoteId)
      .is("team_id", null);

    if (error) {
      if (isMissingTableOrColumnError(error)) return false;
      console.warn("[customer_teams] set quote team failed", {
        quoteId,
        teamId,
        error: serializeSupabaseError(error) ?? error,
      });
      return false;
    }

    return true;
  } catch (error) {
    if (isMissingTableOrColumnError(error)) return false;
    console.warn("[customer_teams] set quote team crashed", {
      quoteId,
      teamId,
      error: serializeSupabaseError(error) ?? error,
    });
    return false;
  }
}

export async function userHasTeamAccessToQuote(args: {
  quoteId: string;
  userId: string;
}): Promise<boolean> {
  const quoteId = normalizeId(args.quoteId);
  const userId = normalizeId(args.userId);
  if (!quoteId || !userId) return false;
  if (!(await isCustomerTeamsSchemaReady())) return false;

  try {
    const { data: quote, error: quoteError } = await supabaseServer
      .from("quotes")
      .select("team_id")
      .eq("id", quoteId)
      .maybeSingle<{ team_id: string | null }>();

    if (quoteError) {
      if (isMissingTableOrColumnError(quoteError)) return false;
      console.warn("[customer_teams] quote team lookup failed", {
        quoteId,
        error: serializeSupabaseError(quoteError) ?? quoteError,
      });
      return false;
    }

    const teamId = normalizeId(quote?.team_id);
    if (!teamId) return false;

    const { data, error } = await supabaseServer
      .from("customer_team_members")
      .select("user_id")
      .eq("team_id", teamId)
      .eq("user_id", userId)
      .limit(1)
      .returns<Array<{ user_id: string }>>();

    if (error) {
      if (isMissingTableOrColumnError(error)) return false;
      console.warn("[customer_teams] team membership check failed", {
        quoteId,
        teamId,
        userId,
        error: serializeSupabaseError(error) ?? error,
      });
      return false;
    }

    return Array.isArray(data) && data.length > 0;
  } catch (error) {
    if (isMissingTableOrColumnError(error)) return false;
    console.warn("[customer_teams] team membership check crashed", {
      quoteId,
      userId,
      error: serializeSupabaseError(error) ?? error,
    });
    return false;
  }
}

