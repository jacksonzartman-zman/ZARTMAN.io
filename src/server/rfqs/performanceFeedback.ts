import "server-only";

import { supabaseServer } from "@/lib/supabaseServer";
import {
  isMissingTableOrColumnError,
  serializeSupabaseError,
} from "@/server/admin/logging";

export type RfqPerformanceFeedback = {
  firstOfferMinutes: number | null;
  suppliersMatched: number | null;
};

type RfqEventTimestampRow = {
  event_type: string | null;
  created_at: string | null;
};

function normalizeId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function parseIsoMs(value: string | null): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

export async function getRfqPerformanceFeedback(
  rfqId: string,
  options?: { client?: ReturnType<typeof supabaseServer>; skipEvents?: boolean },
): Promise<RfqPerformanceFeedback> {
  const normalizedId = normalizeId(rfqId);
  if (!normalizedId) {
    return { firstOfferMinutes: null, suppliersMatched: null };
  }

  const client = options?.client ?? supabaseServer();
  const skipEvents = options?.skipEvents === true;

  const result: RfqPerformanceFeedback = {
    firstOfferMinutes: null,
    suppliersMatched: null,
  };

  // Suppliers matched: rfq_destinations count
  try {
    const { count, error } = await client
      .from("rfq_destinations")
      .select("id", { count: "exact", head: true })
      .eq("rfq_id", normalizedId);

    if (error) {
      if (!isMissingTableOrColumnError(error)) {
        console.error("[rfq perf] destinations count failed", {
          rfqId: normalizedId,
          supabaseError: serializeSupabaseError(error),
        });
      }
    } else {
      result.suppliersMatched =
        typeof count === "number" && Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
    }
  } catch (error) {
    if (!isMissingTableOrColumnError(error)) {
      console.error("[rfq perf] destinations count crashed", {
        rfqId: normalizedId,
        error: serializeSupabaseError(error) ?? error,
      });
    }
  }

  if (skipEvents) {
    return result;
  }

  // First offer in minutes: supplier_notified -> first offer_created
  try {
    const { data, error } = await client
      .from("rfq_events")
      .select("event_type,created_at")
      .eq("rfq_id", normalizedId)
      .in("event_type", ["supplier_notified", "offer_created"])
      .order("created_at", { ascending: true })
      .limit(250)
      .returns<RfqEventTimestampRow[]>();

    if (error) {
      if (!isMissingTableOrColumnError(error)) {
        console.error("[rfq perf] events query failed", {
          rfqId: normalizedId,
          supabaseError: serializeSupabaseError(error),
        });
      }
      return result;
    }

    const rows = Array.isArray(data) ? data : [];
    let supplierNotifiedAt: string | null = null;
    let firstOfferCreatedAt: string | null = null;

    for (const row of rows) {
      const type = typeof row?.event_type === "string" ? row.event_type.trim().toLowerCase() : "";
      const ts = typeof row?.created_at === "string" ? row.created_at : null;
      if (!ts) continue;
      if (!supplierNotifiedAt && type === "supplier_notified") {
        supplierNotifiedAt = ts;
        continue;
      }
      if (!firstOfferCreatedAt && type === "offer_created") {
        firstOfferCreatedAt = ts;
      }
      if (supplierNotifiedAt && firstOfferCreatedAt) break;
    }

    const notifiedMs = parseIsoMs(supplierNotifiedAt);
    const offerMs = parseIsoMs(firstOfferCreatedAt);
    if (notifiedMs === null || offerMs === null) {
      return result;
    }

    const diffMs = Math.max(0, offerMs - notifiedMs);
    result.firstOfferMinutes = Math.floor(diffMs / 60_000);
    return result;
  } catch (error) {
    if (!isMissingTableOrColumnError(error)) {
      console.error("[rfq perf] events query crashed", {
        rfqId: normalizedId,
        error: serializeSupabaseError(error) ?? error,
      });
    }
    return result;
  }
}

