import { supabaseServer } from "@/lib/supabaseServer";
import { schemaGate } from "@/server/db/schemaContract";
import {
  isMissingTableOrColumnError,
  isMissingSupabaseRelationError,
  isSupabaseRelationMarkedMissing,
  markSupabaseRelationMissing,
  serializeSupabaseError,
  warnOnce,
} from "@/server/admin/logging";

export type QuoteMessageRollup = {
  quoteId: string;
  lastCustomerAt: string | null;
  lastSupplierAt: string | null;
  lastAdminAt: string | null;
  lastSystemAt: string | null;
  lastMessageAt: string | null;
};

const RELATION = "quote_message_rollup";

function normalizeId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function safeIso(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return Number.isNaN(Date.parse(trimmed)) ? null : trimmed;
}

function ms(value: string | null): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export type QuoteThreadLastMessageAuthorRole = "customer" | "supplier" | "admin" | "system" | null;

export function inferLastMessageAuthorRole(
  rollup: QuoteMessageRollup,
): QuoteThreadLastMessageAuthorRole {
  const lastMessageMs = ms(rollup.lastMessageAt);
  if (lastMessageMs === null) return null;

  // Prefer deterministic ordering when timestamps tie.
  const candidates: Array<[QuoteThreadLastMessageAuthorRole, number | null]> = [
    ["customer", ms(rollup.lastCustomerAt)],
    ["supplier", ms(rollup.lastSupplierAt)],
    ["admin", ms(rollup.lastAdminAt)],
    ["system", ms(rollup.lastSystemAt)],
  ];

  for (const [role, ts] of candidates) {
    if (ts !== null && ts === lastMessageMs) return role;
  }

  return null;
}

export async function loadQuoteMessageRollups(
  quoteIds: string[],
): Promise<Record<string, QuoteMessageRollup>> {
  const ids = Array.from(
    new Set((Array.isArray(quoteIds) ? quoteIds : []).map(normalizeId).filter(Boolean)),
  );
  if (ids.length === 0) return {};

  const hasSchema = await schemaGate({
    enabled: true,
    relation: RELATION,
    requiredColumns: [
      "quote_id",
      "last_admin_at",
      "last_customer_at",
      "last_supplier_at",
      "last_system_at",
      "last_message_at",
    ],
    warnPrefix: "[message_state]",
  });
  if (!hasSchema) {
    return {};
  }

  if (isSupabaseRelationMarkedMissing(RELATION)) {
    return {};
  }

  type RollupRow = {
    quote_id: string;
    last_customer_at: string | null;
    last_supplier_at: string | null;
    last_admin_at: string | null;
    last_system_at: string | null;
    last_message_at: string | null;
  };

  try {
    const { data, error } = await supabaseServer()
      .from(RELATION)
      .select(
        "quote_id,last_customer_at,last_supplier_at,last_admin_at,last_system_at,last_message_at",
      )
      .in("quote_id", ids)
      .returns<RollupRow[]>();

    if (error) {
      if (isMissingSupabaseRelationError(error) || isMissingTableOrColumnError(error)) {
        markSupabaseRelationMissing(RELATION);
        const { code, message } = serializeSupabaseError(error);
        warnOnce(
          `missing_relation:${RELATION}`,
          "[message_state] missing rollup; skipping",
          { code, message },
        );
        return {};
      }
      console.error("[message_state] rollup query failed", {
        quoteIdsCount: ids.length,
        error: serializeSupabaseError(error) ?? error,
      });
      return {};
    }

    const out: Record<string, QuoteMessageRollup> = {};
    for (const row of Array.isArray(data) ? data : []) {
      const quoteId = normalizeId(row?.quote_id);
      if (!quoteId) continue;
      out[quoteId] = {
        quoteId,
        lastCustomerAt: safeIso(row.last_customer_at),
        lastSupplierAt: safeIso(row.last_supplier_at),
        lastAdminAt: safeIso(row.last_admin_at),
        lastSystemAt: safeIso(row.last_system_at),
        lastMessageAt: safeIso(row.last_message_at),
      };
    }
    return out;
  } catch (error) {
    if (isMissingSupabaseRelationError(error) || isMissingTableOrColumnError(error)) {
      markSupabaseRelationMissing(RELATION);
      const { code, message } = serializeSupabaseError(error);
      warnOnce(`missing_relation:${RELATION}`, "[message_state] missing rollup; skipping", {
        code,
        message,
      });
      return {};
    }
    console.error("[message_state] rollup query crashed", {
      quoteIdsCount: ids.length,
      error: serializeSupabaseError(error) ?? error,
    });
    return {};
  }
}

export type AdminMessageReplyState = {
  needsReply: boolean;
  lastCustomerMessageAt: string | null;
  lastAdminMessageAt: string | null;
};

export function computeAdminReplyState(rollup: QuoteMessageRollup): AdminMessageReplyState {
  const lastCustomerMessageAt = rollup.lastCustomerAt;
  const lastAdminMessageAt = rollup.lastAdminAt;
  const lastMessageAt = rollup.lastMessageAt;

  const lastCustomerMs = ms(lastCustomerMessageAt);
  const lastSupplierMs = ms(rollup.lastSupplierAt);
  const lastAdminMs = ms(lastAdminMessageAt);
  const lastMessageMs = ms(lastMessageAt);

  const lastInboundMs = maxNullable(lastCustomerMs, lastSupplierMs);

  const needsReply =
    lastInboundMs !== null &&
    lastMessageMs !== null &&
    lastInboundMs === lastMessageMs &&
    (lastAdminMs === null || lastAdminMs < lastInboundMs);

  return { needsReply, lastCustomerMessageAt, lastAdminMessageAt };
}

export function computeAdminNeedsReply(rollup: QuoteMessageRollup): boolean {
  return computeAdminReplyState(rollup).needsReply;
}

export type AdminThreadSlaStatus = "clear" | "needs_reply" | "overdue";

export type AdminThreadSla = {
  status: AdminThreadSlaStatus;
  lastInboundAt: Date | null;
  lastAdminAt: Date | null;
};

const ADMIN_REPLY_SLA_MS = 24 * 60 * 60 * 1000; // 24 hours

function maxNullable(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.max(a, b);
}

/**
 * Admin reply SLA classification (Phase 18.3.3 MVP):
 * - status="clear": no reply needed
 * - status="needs_reply": needs reply and inbound age <= 24h
 * - status="overdue": needs reply and inbound age > 24h
 *
 * Notes:
 * - "Inbound" means customer or supplier (system does not clear needs-reply).
 * - Fail-soft: invalid/missing timestamps yield a conservative "clear" result.
 */
export function computeAdminThreadSla(
  rollup: QuoteMessageRollup,
  now: Date = new Date(),
): AdminThreadSla {
  const needsReply = computeAdminNeedsReply(rollup);

  const inboundMs = maxNullable(ms(rollup.lastCustomerAt), ms(rollup.lastSupplierAt));
  const adminMs = ms(rollup.lastAdminAt);

  const lastInboundAt = inboundMs === null ? null : new Date(inboundMs);
  const lastAdminAt = adminMs === null ? null : new Date(adminMs);

  if (!needsReply) {
    return { status: "clear", lastInboundAt, lastAdminAt };
  }

  if (!lastInboundAt || !Number.isFinite(now.getTime())) {
    // Defensive: needsReply should imply inbound exists, but keep behavior safe under schema drift.
    return { status: "needs_reply", lastInboundAt, lastAdminAt };
  }

  const ageMs = now.getTime() - lastInboundAt.getTime();
  const overdue = Number.isFinite(ageMs) && ageMs > ADMIN_REPLY_SLA_MS;

  return { status: overdue ? "overdue" : "needs_reply", lastInboundAt, lastAdminAt };
}

/**
 * Quick verification (manual):
 * - Customer sends a message → admin sees "Needs reply" (quotes list + quote detail) and a "message_needs_reply" notification.
 * - Admin replies (sender_role='admin') → "Needs reply" disappears on refresh and notification stops generating.
 * - Supplier/system messages do NOT create "Needs reply".
 * - If the latest customer message is older than 24h → admin sees "Overdue" (quotes list + quote detail), and notification body indicates overdue.
 *
 * Unit-ish sanity checks:
 * - lastAdminAt is null, last message is customer → needsReply = true
 * - lastAdminAt is null, last message is not customer → needsReply = false
 * - lastCustomerAt <= lastAdminAt → needsReply = false
 * - lastCustomerAt > lastAdminAt and lastMessageAt == lastCustomerAt → needsReply = true
 */

