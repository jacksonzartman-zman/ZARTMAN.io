import { supabaseServer } from "@/lib/supabaseServer";
import { schemaGate } from "@/server/db/schemaContract";
import {
  handleMissingSupabaseSchema,
  isMissingTableOrColumnError,
  serializeSupabaseError,
  warnOnce,
} from "@/server/db/schemaErrors";

const WARN_PREFIX = "[email_invite_markers]";
const QUOTE_MESSAGES_RELATION = "quote_messages";

export type InviteRole = "customer" | "supplier";

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeRole(value: unknown): InviteRole | null {
  return value === "customer" || value === "supplier" ? value : null;
}

function isInviteMetaMatch(meta: unknown, role: InviteRole): boolean {
  if (!meta || typeof meta !== "object") return false;
  const record = meta as Record<string, unknown>;
  const invite = record.invite === true;
  const inviteRole = normalizeRole(record.inviteRole);
  if (!invite || inviteRole !== role) return false;
  // Extra safety: match the intended marker shape.
  if (record.via !== "email") return false;
  if (record.outbound !== true) return false;
  return true;
}

/**
 * Best-effort "sent marker" using quote_messages + metadata.
 *
 * Strategy:
 * - Preferred: insert a system message with metadata marker (requires metadata column).
 * - If metadata is missing/unsupported, becomes a no-op.
 *
 * Never throws.
 */
export async function markInviteSent(args: {
  quoteId: string;
  role: InviteRole;
}): Promise<void> {
  const quoteId = normalizeString(args.quoteId);
  const role = normalizeRole(args.role);
  if (!quoteId || !role) return;

  const supported = await schemaGate({
    enabled: true,
    relation: QUOTE_MESSAGES_RELATION,
    requiredColumns: ["quote_id", "sender_role", "sender_id", "body", "metadata"],
    warnPrefix: WARN_PREFIX,
    warnKey: "email_invite_markers:quote_messages_metadata",
  });
  if (!supported) return;

  try {
    const payload = {
      quote_id: quoteId,
      sender_role: "system",
      sender_id: "system",
      body: "Email invite sent.",
      metadata: {
        via: "email",
        outbound: true,
        invite: true,
        inviteRole: role,
      },
    };

    const { error } = await supabaseServer().from(QUOTE_MESSAGES_RELATION).insert(payload as any);
    if (error) {
      if (
        handleMissingSupabaseSchema({
          relation: QUOTE_MESSAGES_RELATION,
          error,
          warnPrefix: WARN_PREFIX,
          warnKey: "email_invite_markers:insert_missing_schema",
        }) ||
        isMissingTableOrColumnError(error)
      ) {
        return;
      }

      warnOnce("email_invite_markers:insert_failed", `${WARN_PREFIX} insert failed; skipping`, {
        code: serializeSupabaseError(error).code,
      });
    }
  } catch (error) {
    if (
      handleMissingSupabaseSchema({
        relation: QUOTE_MESSAGES_RELATION,
        error,
        warnPrefix: WARN_PREFIX,
        warnKey: "email_invite_markers:insert_missing_schema_crash",
      }) ||
      isMissingTableOrColumnError(error)
    ) {
      return;
    }
    warnOnce("email_invite_markers:insert_crashed", `${WARN_PREFIX} insert crashed; skipping`, {
      code: serializeSupabaseError(error).code,
    });
  }
}

/**
 * Best-effort check for "invite already sent" using quote_messages + metadata.
 *
 * If quote_messages or metadata isn't supported, returns false (no dedupe).
 * Never throws.
 */
export async function wasInviteSent(args: {
  quoteId: string;
  role: InviteRole;
}): Promise<boolean> {
  const quoteId = normalizeString(args.quoteId);
  const role = normalizeRole(args.role);
  if (!quoteId || !role) return false;

  const supported = await schemaGate({
    enabled: true,
    relation: QUOTE_MESSAGES_RELATION,
    requiredColumns: ["quote_id", "created_at", "metadata"],
    warnPrefix: WARN_PREFIX,
    warnKey: "email_invite_markers:quote_messages_metadata_read",
  });
  if (!supported) return false;

  try {
    const MAX_SCAN = 50;
    const { data, error } = await supabaseServer()
      .from(QUOTE_MESSAGES_RELATION)
      .select("metadata,created_at")
      .eq("quote_id", quoteId)
      .order("created_at", { ascending: false })
      .limit(MAX_SCAN);

    if (error) {
      if (
        handleMissingSupabaseSchema({
          relation: QUOTE_MESSAGES_RELATION,
          error,
          warnPrefix: WARN_PREFIX,
          warnKey: "email_invite_markers:select_missing_schema",
        }) ||
        isMissingTableOrColumnError(error)
      ) {
        return false;
      }
      warnOnce("email_invite_markers:select_failed", `${WARN_PREFIX} select failed; skipping`, {
        code: serializeSupabaseError(error).code,
      });
      return false;
    }

    const rows = Array.isArray(data) ? data : [];
    for (const row of rows) {
      const meta = (row as any)?.metadata;
      if (isInviteMetaMatch(meta, role)) {
        return true;
      }
    }

    return false;
  } catch (error) {
    if (
      handleMissingSupabaseSchema({
        relation: QUOTE_MESSAGES_RELATION,
        error,
        warnPrefix: WARN_PREFIX,
        warnKey: "email_invite_markers:select_missing_schema_crash",
      }) ||
      isMissingTableOrColumnError(error)
    ) {
      return false;
    }
    warnOnce("email_invite_markers:select_crashed", `${WARN_PREFIX} select crashed; skipping`, {
      code: serializeSupabaseError(error).code,
    });
    return false;
  }
}

