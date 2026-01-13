import { supabaseServer } from "@/lib/supabaseServer";
import {
  handleMissingSupabaseRelation,
  isMissingTableOrColumnError,
  isRowLevelSecurityDeniedError,
  isSupabaseRelationMarkedMissing,
  markSupabaseRelationMissing,
  serializeSupabaseError,
  warnOnce,
} from "@/server/admin/logging";
import type { SupabaseClient } from "@supabase/supabase-js";

export function isMessageReadsEnabled(): boolean {
  const raw = process.env.MESSAGE_READS_ENABLED;
  if (!raw) return false;
  const normalized = raw.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

export type QuoteMessageLastPreview = {
  body: string;
  created_at: string;
  sender_role: string;
  sender_id: string | null;
};

export type QuoteUnreadMessageSummary = {
  quoteId: string;
  unreadCount: number;
  lastMessage: QuoteMessageLastPreview | null;
};

export async function markQuoteMessagesRead(input: {
  quoteId: string;
  userId: string;
  supabase?: SupabaseClient;
}): Promise<{ ok: true } | { ok: false; reason: string; error?: unknown }> {
  if (!isMessageReadsEnabled()) {
    return { ok: true };
  }

  const quoteId = normalizeId(input.quoteId);
  const userId = normalizeId(input.userId);
  if (!quoteId || !userId) {
    return { ok: false, reason: "invalid_input" };
  }

  if (isSupabaseRelationMarkedMissing("quote_message_reads")) {
    return { ok: true };
  }

  const client = input.supabase ?? supabaseServer;

  try {
    const { error } = await client
      .from("quote_message_reads")
      .upsert(
        { quote_id: quoteId, user_id: userId, last_read_at: new Date().toISOString() },
        { onConflict: "quote_id,user_id" },
      );

    if (error) {
      if (
        handleMissingSupabaseRelation({
          relation: "quote_message_reads",
          error,
          warnPrefix: "[message_reads]",
        })
      ) {
        return { ok: true };
      }
      if (isMissingTableOrColumnError(error)) {
        // Failure-safe: missing table/columns in older environments.
        markSupabaseRelationMissing("quote_message_reads");
        const serialized = serializeSupabaseError(error);
        warnOnce("missing_relation:quote_message_reads", "[message_reads] missing relation; skipping", {
          code: serialized.code,
          message: serialized.message,
        });
        return { ok: true };
      }
      if (isRowLevelSecurityDeniedError(error)) {
        return { ok: false, reason: "unauthorized", error: serializeSupabaseError(error) ?? error };
      }
      console.error("[quote message reads] upsert failed", {
        quoteId,
        userId,
        error: serializeSupabaseError(error) ?? error,
      });
      return { ok: false, reason: "write_failed", error: serializeSupabaseError(error) ?? error };
    }

    return { ok: true };
  } catch (error) {
    if (
      handleMissingSupabaseRelation({
        relation: "quote_message_reads",
        error,
        warnPrefix: "[message_reads]",
      })
    ) {
      return { ok: true };
    }
    if (isMissingTableOrColumnError(error)) {
      markSupabaseRelationMissing("quote_message_reads");
      const serialized = serializeSupabaseError(error);
      warnOnce("missing_relation:quote_message_reads", "[message_reads] missing relation; skipping", {
        code: serialized.code,
        message: serialized.message,
      });
      return { ok: true };
    }
    console.error("[quote message reads] upsert crashed", {
      quoteId,
      userId,
      error: serializeSupabaseError(error) ?? error,
    });
    return { ok: false, reason: "unknown", error };
  }
}

export async function loadUnreadMessageSummary(input: {
  quoteIds: string[];
  userId: string;
}): Promise<Record<string, QuoteUnreadMessageSummary>> {
  const userId = normalizeId(input.userId);
  const quoteIds = (Array.isArray(input.quoteIds) ? input.quoteIds : [])
    .map((id) => normalizeId(id))
    .filter(Boolean);

  const result: Record<string, QuoteUnreadMessageSummary> = {};
  for (const quoteId of quoteIds) {
    result[quoteId] = { quoteId, unreadCount: 0, lastMessage: null };
  }

  if (!userId || quoteIds.length === 0) {
    return result;
  }

  // Failure-safe: if the new reads table isn't present yet, keep unread counts
  // at 0 but still surface last-message previews from `quote_messages`.
  type ReadRow = { quote_id: string; user_id: string; last_read_at: string };
  let reads: ReadRow[] = [];
  let readsAvailable =
    isMessageReadsEnabled() && !isSupabaseRelationMarkedMissing("quote_message_reads");
  try {
    if (readsAvailable) {
      const { data, error } = await supabaseServer
        .from("quote_message_reads")
        .select("quote_id,user_id,last_read_at")
        .eq("user_id", userId)
        .in("quote_id", quoteIds)
        .returns<ReadRow[]>();
      if (error) {
        if (
          handleMissingSupabaseRelation({
            relation: "quote_message_reads",
            error,
            warnPrefix: "[message_reads]",
          })
        ) {
          readsAvailable = false;
        } else if (isMissingTableOrColumnError(error)) {
          readsAvailable = false;
          markSupabaseRelationMissing("quote_message_reads");
          const serialized = serializeSupabaseError(error);
          warnOnce("missing_relation:quote_message_reads", "[message_reads] missing relation; skipping", {
            code: serialized.code,
            message: serialized.message,
          });
        } else {
          readsAvailable = false;
          console.error("[quote message reads] load reads failed", {
            userId,
            quoteCount: quoteIds.length,
            error: serializeSupabaseError(error) ?? error,
          });
        }
      } else {
        reads = (data ?? []) as ReadRow[];
      }
    }
  } catch (error) {
    if (
      handleMissingSupabaseRelation({
        relation: "quote_message_reads",
        error,
        warnPrefix: "[message_reads]",
      })
    ) {
      readsAvailable = false;
    } else if (isMissingTableOrColumnError(error)) {
      readsAvailable = false;
      markSupabaseRelationMissing("quote_message_reads");
      const serialized = serializeSupabaseError(error);
      warnOnce("missing_relation:quote_message_reads", "[message_reads] missing relation; skipping", {
        code: serialized.code,
        message: serialized.message,
      });
    } else {
      readsAvailable = false;
      console.error("[quote message reads] load reads crashed", {
        userId,
        quoteCount: quoteIds.length,
        error: serializeSupabaseError(error) ?? error,
      });
    }
  }

  const lastReadByQuoteId = new Map<string, string>();
  for (const row of reads) {
    if (row?.quote_id && typeof row.last_read_at === "string") {
      lastReadByQuoteId.set(row.quote_id, row.last_read_at);
    }
  }

  const hasMissingReadMarker = readsAvailable
    ? quoteIds.some((quoteId) => !lastReadByQuoteId.has(quoteId))
    : false;
  const earliestLastRead = readsAvailable
    ? hasMissingReadMarker
      ? "1970-01-01T00:00:00.000Z"
      : resolveEarliestLastRead(Array.from(lastReadByQuoteId.values()))
    : null;

  type MessageRow = {
    quote_id: string;
    sender_id: string;
    sender_role: string;
    body: string;
    created_at: string;
  };

  // Query 1: last message per quote (best-effort).
  try {
    const limit = Math.max(50, Math.min(1000, quoteIds.length * 8));
    const { data, error } = await supabaseServer
      .from("quote_messages")
      .select("quote_id,sender_id,sender_role,body,created_at")
      .in("quote_id", quoteIds)
      .order("created_at", { ascending: false })
      .limit(limit)
      .returns<MessageRow[]>();

    if (!error) {
      const rows = (data ?? []) as MessageRow[];
      const seen = new Set<string>();
      for (const row of rows) {
        if (!row?.quote_id || seen.has(row.quote_id)) continue;
        seen.add(row.quote_id);
        const summary = result[row.quote_id];
        if (!summary) continue;
        summary.lastMessage = {
          body: truncatePreview(row.body, 80),
          created_at: row.created_at,
          sender_role: row.sender_role ?? "admin",
          sender_id: normalizeId(row.sender_id) || null,
        };
      }
    } else if (!isMissingTableOrColumnError(error)) {
      console.error("[quote message reads] last message query failed", {
        userId,
        quoteCount: quoteIds.length,
        error: serializeSupabaseError(error) ?? error,
      });
    }
  } catch (error) {
    if (!isMissingTableOrColumnError(error)) {
      console.error("[quote message reads] last message query crashed", {
        userId,
        quoteCount: quoteIds.length,
        error: serializeSupabaseError(error) ?? error,
      });
    }
  }

  // Query 2: unread messages (best-effort, avoids N+1).
  try {
    if (!readsAvailable) {
      return result;
    }

    let query = supabaseServer
      .from("quote_messages")
      .select("quote_id,sender_id,sender_role,body,created_at")
      .in("quote_id", quoteIds)
      .neq("sender_id", userId)
      .order("created_at", { ascending: false })
      .limit(Math.max(250, Math.min(2500, quoteIds.length * 25)));

    // Only apply created_at gating if we have any read markers. If we don't, we
    // fall back to scanning recent messages (limit above) for a signal.
    if (earliestLastRead) {
      query = query.gt("created_at", earliestLastRead);
    }

    const { data, error } = await query.returns<MessageRow[]>();
    if (!error) {
      const rows = (data ?? []) as MessageRow[];
      for (const row of rows) {
        const quoteId = normalizeId(row.quote_id);
        const summary = result[quoteId];
        if (!summary) continue;

        const lastReadAt = lastReadByQuoteId.get(quoteId) ?? "1970-01-01T00:00:00.000Z";
        if (typeof row.created_at === "string" && row.created_at > lastReadAt) {
          summary.unreadCount += 1;
        }
      }
    } else if (!isMissingTableOrColumnError(error)) {
      console.error("[quote message reads] unread query failed", {
        userId,
        quoteCount: quoteIds.length,
        error: serializeSupabaseError(error) ?? error,
      });
    }
  } catch (error) {
    if (!isMissingTableOrColumnError(error)) {
      console.error("[quote message reads] unread query crashed", {
        userId,
        quoteCount: quoteIds.length,
        error: serializeSupabaseError(error) ?? error,
      });
    }
  }

  return result;
}

function normalizeId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function truncatePreview(value: unknown, maxLen: number): string {
  const raw = typeof value === "string" ? value : "";
  const squashed = raw.replace(/\s+/g, " ").trim();
  if (!squashed) return "";
  if (squashed.length <= maxLen) return squashed;
  return `${squashed.slice(0, Math.max(0, maxLen - 1))}…`;
}

function resolveEarliestLastRead(values: string[]): string | null {
  let earliest: string | null = null;
  let earliestMs = Number.POSITIVE_INFINITY;
  for (const value of values) {
    const ms = Date.parse(value);
    if (!Number.isFinite(ms)) continue;
    if (ms < earliestMs) {
      earliestMs = ms;
      earliest = value;
    }
  }
  return earliest;
}

