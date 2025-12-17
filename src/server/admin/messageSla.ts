/**
 * Phase 1 Polish checklist
 * - Done: Missing SLA RPC falls back quietly (no warn in prod)
 * - Done: UI can surface fallback via `usingFallback`
 */

import { supabaseServer } from "@/lib/supabaseServer";
import { requireAdminUser } from "@/server/auth";
import {
  isMissingTableOrColumnError,
  logAdminQuotesInfo,
  logAdminQuotesWarn,
  serializeSupabaseError,
} from "@/server/admin/logging";

export type AdminThreadMessageAuthorRole = "customer" | "supplier" | "admin";
export type AdminThreadNeedsReplyFrom = "supplier" | "customer";
export type AdminThreadStalenessBucket = "fresh" | "stale" | "very_stale" | "none";

export type AdminThreadSla = {
  lastMessageAt: string | null;
  lastMessageAuthorRole: AdminThreadMessageAuthorRole | null;
  /**
   * Admin perspective only: which external party needs to respond next, if any.
   */
  needsReplyFrom: AdminThreadNeedsReplyFrom | null;
  stalenessBucket: AdminThreadStalenessBucket;
  unreadForAdmin: boolean;
  /**
   * True when the SLA RPC was unavailable and we fell back to a basic staleness signal.
   * (Non-blocking, expected in older/dev environments.)
   */
  usingFallback: boolean;
};

const STALE_AFTER_MS = 48 * 60 * 60 * 1000;
const VERY_STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

let didWarnMissingAdminThreadSlaRpc = false;

export async function loadAdminThreadSlaForQuotes(input: {
  quoteIds: string[];
}): Promise<Record<string, AdminThreadSla>> {
  // Defense-in-depth: this helper is intended for admin-only surfaces.
  const adminUser = await requireAdminUser();
  const adminUserId = typeof adminUser?.id === "string" ? adminUser.id.trim() : "";

  const normalizedQuoteIds = Array.from(
    new Set(
      (Array.isArray(input.quoteIds) ? input.quoteIds : [])
        .map((id) => (typeof id === "string" ? id.trim() : ""))
        .filter(Boolean),
    ),
  );

  const result: Record<string, AdminThreadSla> = {};
  for (const quoteId of normalizedQuoteIds) {
    result[quoteId] = {
      lastMessageAt: null,
      lastMessageAuthorRole: null,
      needsReplyFrom: null,
      stalenessBucket: "none",
      unreadForAdmin: false,
      usingFallback: false,
    };
  }

  if (normalizedQuoteIds.length === 0) {
    return result;
  }

  const nowMs = Date.now();
  const appliedFromRpc = await applyAdminThreadSlaFromRpc({
    quoteIds: normalizedQuoteIds,
    result,
    nowMs,
  });

  if (!appliedFromRpc) {
    await applyAdminThreadSlaFromLatestMessagesFallback({
      quoteIds: normalizedQuoteIds,
      result,
      nowMs,
    });
    for (const quoteId of normalizedQuoteIds) {
      if (result[quoteId]) {
        result[quoteId].usingFallback = true;
      }
    }
  }

  // Query 2 (best-effort): reads for the admin user to flag unread threads.
  if (adminUserId) {
    try {
      type ReadRow = { quote_id: string; last_read_at: string | null };
      const { data, error } = await supabaseServer
        .from("quote_message_reads")
        .select("quote_id,last_read_at")
        .eq("user_id", adminUserId)
        .in("quote_id", normalizedQuoteIds)
        .returns<ReadRow[]>();

      if (error) {
        if (!isMissingTableOrColumnError(error)) {
          logAdminQuotesWarn("thread SLA query failed (reads)", {
            quoteIdsCount: normalizedQuoteIds.length,
            supabaseError: serializeSupabaseError(error),
          });
        }
        return result;
      }

      const lastReadByQuoteId = new Map<string, string>();
      for (const row of Array.isArray(data) ? data : []) {
        const quoteId = typeof row?.quote_id === "string" ? row.quote_id.trim() : "";
        const lastReadAt =
          typeof row?.last_read_at === "string" ? row.last_read_at : null;
        if (quoteId && lastReadAt) {
          lastReadByQuoteId.set(quoteId, lastReadAt);
        }
      }

      for (const quoteId of normalizedQuoteIds) {
        const sla = result[quoteId];
        if (!sla?.lastMessageAt) {
          sla.unreadForAdmin = false;
          continue;
        }

        // If the reads table exists but there is no marker, treat as unread.
        const lastReadAt = lastReadByQuoteId.get(quoteId) ?? null;
        sla.unreadForAdmin = !lastReadAt ? true : sla.lastMessageAt > lastReadAt;
      }
    } catch (error) {
      if (!isMissingTableOrColumnError(error)) {
        logAdminQuotesWarn("thread SLA query crashed (reads)", {
          quoteIdsCount: normalizedQuoteIds.length,
          error: serializeSupabaseError(error) ?? error,
        });
      }
      return result;
    }
  }

  return result;
}

function normalizeRole(value: unknown): AdminThreadMessageAuthorRole | null {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (normalized === "admin" || normalized === "customer" || normalized === "supplier") {
    return normalized;
  }
  return null;
}

function resolveNeedsReplyFrom(args: {
  lastRole: AdminThreadMessageAuthorRole | null;
  lastCustomerMessageAt: string | null;
  lastSupplierMessageAt: string | null;
}): AdminThreadNeedsReplyFrom | null {
  if (!args.lastRole) return null;
  if (args.lastRole === "admin") return null;

  if (args.lastRole === "customer") {
    // Needs supplier reply if supplier has NOT posted since the last customer message.
    if (!args.lastSupplierMessageAt) return "supplier";
    if (!args.lastCustomerMessageAt) return "supplier";
    return args.lastSupplierMessageAt < args.lastCustomerMessageAt ? "supplier" : null;
  }

  if (args.lastRole === "supplier") {
    // Needs customer reply if customer has NOT posted since the last supplier message.
    if (!args.lastCustomerMessageAt) return "customer";
    if (!args.lastSupplierMessageAt) return "customer";
    return args.lastCustomerMessageAt < args.lastSupplierMessageAt ? "customer" : null;
  }

  return null;
}

function resolveStalenessBucket(
  lastMessageAt: string | null,
  nowMs: number,
): AdminThreadStalenessBucket {
  if (!lastMessageAt) return "none";
  const parsed = Date.parse(lastMessageAt);
  if (!Number.isFinite(parsed)) return "none";
  const ageMs = nowMs - parsed;
  if (ageMs >= VERY_STALE_AFTER_MS) return "very_stale";
  if (ageMs >= STALE_AFTER_MS) return "stale";
  return "fresh";
}

function getSupabaseErrorCode(error: unknown): string | null {
  const serialized = serializeSupabaseError(error);
  if (!serialized || typeof serialized !== "object") return null;
  const code = "code" in serialized ? (serialized as { code?: unknown }).code : null;
  return typeof code === "string" ? code : null;
}

function isMissingRpcOrSchemaError(error: unknown): boolean {
  const code = getSupabaseErrorCode(error);
  if (code === "PGRST202") return true; // missing function / RPC
  return isMissingTableOrColumnError(error);
}

async function applyAdminThreadSlaFromRpc(args: {
  quoteIds: string[];
  result: Record<string, AdminThreadSla>;
  nowMs: number;
}): Promise<boolean> {
  type RpcRow = {
    quote_id: string;
    last_message_at: string | null;
    last_message_author_role: string | null;
    last_customer_message_at: string | null;
    last_supplier_message_at: string | null;
    last_admin_message_at: string | null;
  };

  try {
    const { data, error } = await supabaseServer
      .rpc("admin_message_sla_for_quotes", {
        p_quote_ids: args.quoteIds,
      })
      .returns<RpcRow[]>();

    if (error) {
      if (isMissingRpcOrSchemaError(error)) {
        if (!didWarnMissingAdminThreadSlaRpc) {
          didWarnMissingAdminThreadSlaRpc = true;
          const isProd = process.env.NODE_ENV === "production";
          (isProd ? logAdminQuotesInfo : logAdminQuotesWarn)(
            "thread SLA signal unavailable; using fallback",
            {
            quoteIdsCount: args.quoteIds.length,
            supabaseError: serializeSupabaseError(error),
            },
          );
        }
        return false;
      }

      logAdminQuotesWarn("thread SLA RPC failed", {
        quoteIdsCount: args.quoteIds.length,
        supabaseError: serializeSupabaseError(error),
      });
      return false;
    }

    const rows = Array.isArray(data) ? data : [];
    const byQuoteId = new Map<string, RpcRow>();
    for (const row of rows) {
      const quoteId = typeof row?.quote_id === "string" ? row.quote_id.trim() : "";
      if (!quoteId) continue;
      byQuoteId.set(quoteId, row);
    }

    for (const quoteId of args.quoteIds) {
      const row = args.result[quoteId];
      if (!row) continue;
      const rpc = byQuoteId.get(quoteId);
      const lastMessageAt =
        rpc && typeof rpc.last_message_at === "string" ? rpc.last_message_at : null;
      const lastRole = normalizeRole(rpc?.last_message_author_role ?? null);

      const lastCustomerMessageAt =
        rpc && typeof rpc.last_customer_message_at === "string"
          ? rpc.last_customer_message_at
          : null;
      const lastSupplierMessageAt =
        rpc && typeof rpc.last_supplier_message_at === "string"
          ? rpc.last_supplier_message_at
          : null;

      row.lastMessageAt = lastMessageAt;
      row.lastMessageAuthorRole = lastRole;
      row.needsReplyFrom = resolveNeedsReplyFrom({
        lastRole,
        lastCustomerMessageAt,
        lastSupplierMessageAt,
      });
      row.stalenessBucket = resolveStalenessBucket(lastMessageAt, args.nowMs);
      row.usingFallback = false;
    }

    return true;
  } catch (error) {
    if (isMissingRpcOrSchemaError(error)) {
      if (!didWarnMissingAdminThreadSlaRpc) {
        didWarnMissingAdminThreadSlaRpc = true;
        const isProd = process.env.NODE_ENV === "production";
        (isProd ? logAdminQuotesInfo : logAdminQuotesWarn)(
          "thread SLA signal unavailable; using fallback",
          {
          quoteIdsCount: args.quoteIds.length,
          supabaseError: serializeSupabaseError(error) ?? error,
          },
        );
      }
      return false;
    }

    logAdminQuotesWarn("thread SLA RPC crashed", {
      quoteIdsCount: args.quoteIds.length,
      error: serializeSupabaseError(error) ?? error,
    });
    return false;
  }
}

async function applyAdminThreadSlaFromLatestMessagesFallback(args: {
  quoteIds: string[];
  result: Record<string, AdminThreadSla>;
  nowMs: number;
}): Promise<void> {
  // Failure-safe fallback that avoids aggregates entirely: fetch newest messages globally,
  // then take the first-per-quote in memory.
  const limit = Math.min(10000, Math.max(100, args.quoteIds.length * 10));

  try {
    type MsgRow = {
      id: string;
      quote_id: string;
      created_at: string;
      sender_role: string | null;
    };

    const { data, error } = await supabaseServer
      .from("quote_messages")
      .select("id,quote_id,created_at,sender_role")
      .in("quote_id", args.quoteIds)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(limit)
      .returns<MsgRow[]>();

    if (error) {
      if (isMissingTableOrColumnError(error)) {
        // Older environments: `quote_messages` might not exist.
        return;
      }
      logAdminQuotesWarn("thread SLA fallback query failed (latest messages)", {
        quoteIdsCount: args.quoteIds.length,
        supabaseError: serializeSupabaseError(error),
      });
      return;
    }

    const rows = Array.isArray(data) ? data : [];
    const latestByQuoteId = new Map<string, MsgRow>();
    for (const msg of rows) {
      const quoteId = typeof msg?.quote_id === "string" ? msg.quote_id.trim() : "";
      if (!quoteId || latestByQuoteId.has(quoteId)) continue;
      latestByQuoteId.set(quoteId, msg);
      if (latestByQuoteId.size >= args.quoteIds.length) break;
    }

    for (const quoteId of args.quoteIds) {
      const sla = args.result[quoteId];
      if (!sla) continue;
      const latest = latestByQuoteId.get(quoteId);
      const lastMessageAt =
        latest && typeof latest.created_at === "string" ? latest.created_at : null;
      const lastRole = normalizeRole(latest?.sender_role ?? null);

      sla.lastMessageAt = lastMessageAt;
      sla.lastMessageAuthorRole = lastRole;
      // Safe defaults: we do not attempt per-role aggregates in fallback mode.
      sla.needsReplyFrom = null;
      sla.stalenessBucket = resolveStalenessBucket(lastMessageAt, args.nowMs);
    }
  } catch (error) {
    if (!isMissingTableOrColumnError(error)) {
      logAdminQuotesWarn("thread SLA fallback query crashed (latest messages)", {
        quoteIdsCount: args.quoteIds.length,
        error: serializeSupabaseError(error) ?? error,
      });
    }
  }
}

