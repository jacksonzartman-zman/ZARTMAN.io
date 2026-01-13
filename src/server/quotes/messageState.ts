import { supabaseServer } from "@/lib/supabaseServer";
import {
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

export async function loadQuoteMessageRollups(
  quoteIds: string[],
): Promise<Record<string, QuoteMessageRollup>> {
  const ids = Array.from(
    new Set((Array.isArray(quoteIds) ? quoteIds : []).map(normalizeId).filter(Boolean)),
  );
  if (ids.length === 0) return {};

  if (isSupabaseRelationMarkedMissing(RELATION)) {
    return {};
  }

  type RollupRow = {
    quote_id: string;
    last_customer_message_at: string | null;
    last_supplier_message_at: string | null;
    last_admin_message_at: string | null;
    last_message_at: string | null;
  };

  try {
    const { data, error } = await supabaseServer
      .from(RELATION)
      .select(
        "quote_id,last_customer_message_at,last_supplier_message_at,last_admin_message_at,last_message_at",
      )
      .in("quote_id", ids)
      .returns<RollupRow[]>();

    if (error) {
      if (isMissingSupabaseRelationError(error)) {
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
        lastCustomerAt: safeIso(row.last_customer_message_at),
        lastSupplierAt: safeIso(row.last_supplier_message_at),
        lastAdminAt: safeIso(row.last_admin_message_at),
        lastMessageAt: safeIso(row.last_message_at),
      };
    }
    return out;
  } catch (error) {
    if (isMissingSupabaseRelationError(error)) {
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

export function computeAdminNeedsReply(rollup: QuoteMessageRollup): boolean {
  const customerMs = ms(rollup.lastCustomerAt);
  const supplierMs = ms(rollup.lastSupplierAt);
  const adminMs = ms(rollup.lastAdminAt);

  const externalMs =
    customerMs === null
      ? supplierMs
      : supplierMs === null
        ? customerMs
        : Math.max(customerMs, supplierMs);

  if (externalMs === null) return false;
  if (adminMs === null) return true;
  return externalMs > adminMs;
}

/**
 * Quick verification (manual):
 * - Customer or supplier sends a message → admin sees "Needs reply" (quotes list + quote detail) and a "message_needs_reply" notification.
 * - Admin replies (admin/system sender_role) → "Needs reply" disappears on refresh and notification stops generating.
 */

