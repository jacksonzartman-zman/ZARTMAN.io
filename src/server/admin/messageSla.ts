import { supabaseServer } from "@/lib/supabaseServer";
import { requireAdminUser } from "@/server/auth";
import {
  isMissingTableOrColumnError,
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
};

const ROLE_PRIORITY: AdminThreadMessageAuthorRole[] = ["admin", "supplier", "customer"];
const STALE_AFTER_MS = 48 * 60 * 60 * 1000;
const VERY_STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

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
    };
  }

  if (normalizedQuoteIds.length === 0) {
    return result;
  }

  type RoleMaxRow = {
    quote_id: string;
    sender_role: string | null;
    last_at: string | null;
  };

  const roleMaxByQuoteId = new Map<
    string,
    Partial<Record<AdminThreadMessageAuthorRole, string | null>>
  >();

  // Query 1: grouped max(created_at) by quote + role.
  try {
    const { data, error } = await supabaseServer
      .from("quote_messages")
      .select("quote_id,sender_role,last_at:created_at.max()")
      .in("quote_id", normalizedQuoteIds)
      .in("sender_role", ROLE_PRIORITY)
      .returns<RoleMaxRow[]>();

    if (error) {
      if (isMissingTableOrColumnError(error)) {
        // Failure-safe: missing `quote_messages` in older environments.
        return result;
      }
      logAdminQuotesWarn("thread SLA query failed (role max)", {
        quoteIdsCount: normalizedQuoteIds.length,
        supabaseError: serializeSupabaseError(error),
      });
      return result;
    }

    const rows = Array.isArray(data) ? data : [];
    for (const row of rows) {
      const quoteId = typeof row?.quote_id === "string" ? row.quote_id.trim() : "";
      const role = normalizeRole(row?.sender_role);
      if (!quoteId || !role) continue;
      const existing = roleMaxByQuoteId.get(quoteId) ?? {};
      existing[role] = typeof row?.last_at === "string" ? row.last_at : null;
      roleMaxByQuoteId.set(quoteId, existing);
    }
  } catch (error) {
    if (isMissingTableOrColumnError(error)) {
      return result;
    }
    logAdminQuotesWarn("thread SLA query crashed (role max)", {
      quoteIdsCount: normalizedQuoteIds.length,
      error: serializeSupabaseError(error) ?? error,
    });
    return result;
  }

  // Derive last message role + timestamp, needs-reply role, and staleness.
  const nowMs = Date.now();
  for (const quoteId of normalizedQuoteIds) {
    const roleMax = roleMaxByQuoteId.get(quoteId) ?? {};
    const lastAt = resolveLatestTimestamp(roleMax);
    const lastRole = lastAt ? resolveRoleForTimestamp(roleMax, lastAt) : null;

    const stalenessBucket = resolveStalenessBucket(lastAt, nowMs);
    const needsReplyFrom = resolveNeedsReplyFrom({
      lastRole,
      lastAt,
      customerLastAt: roleMax.customer ?? null,
      supplierLastAt: roleMax.supplier ?? null,
    });

    const row = result[quoteId];
    if (!row) continue;
    row.lastMessageAt = lastAt;
    row.lastMessageAuthorRole = lastRole;
    row.needsReplyFrom = needsReplyFrom;
    row.stalenessBucket = stalenessBucket;
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

function resolveLatestTimestamp(
  roleMax: Partial<Record<AdminThreadMessageAuthorRole, string | null>>,
): string | null {
  const candidates = ROLE_PRIORITY.map((role) => roleMax[role]).filter(
    (value): value is string => typeof value === "string" && value.trim().length > 0,
  );
  if (candidates.length === 0) return null;

  let latest = candidates[0]!;
  for (const value of candidates.slice(1)) {
    if (value > latest) {
      latest = value;
    }
  }
  return latest;
}

function resolveRoleForTimestamp(
  roleMax: Partial<Record<AdminThreadMessageAuthorRole, string | null>>,
  lastAt: string,
): AdminThreadMessageAuthorRole | null {
  for (const role of ROLE_PRIORITY) {
    if (roleMax[role] === lastAt) {
      return role;
    }
  }
  return null;
}

function resolveNeedsReplyFrom(args: {
  lastRole: AdminThreadMessageAuthorRole | null;
  lastAt: string | null;
  customerLastAt: string | null;
  supplierLastAt: string | null;
}): AdminThreadNeedsReplyFrom | null {
  if (!args.lastRole || !args.lastAt) return null;
  if (args.lastRole === "admin") return null;

  if (args.lastRole === "customer") {
    // Needs supplier reply if supplier has NOT posted since that customer message.
    return args.supplierLastAt && args.supplierLastAt >= args.lastAt ? null : "supplier";
  }
  if (args.lastRole === "supplier") {
    // Needs customer reply if customer has NOT posted since that supplier message.
    return args.customerLastAt && args.customerLastAt >= args.lastAt ? null : "customer";
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

