import { requireAdminUser } from "@/server/auth";
import { emitQuoteEvent } from "@/server/quotes/events";
import { supabaseServer } from "@/lib/supabaseServer";
import {
  isMissingTableOrColumnError,
  serializeSupabaseError,
} from "@/server/admin/logging";

export type CapacityUpdateRequestReason = "stale" | "missing" | "manual";

let didWarnMissingQuoteEventsSchemaForAdminCapacityRequests = false;

function normalizeId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeWeekStartDate(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return "";
  return trimmed;
}

/**
 * Load the most recent capacity_update_requested event for a supplier + week,
 * limited to a lookback window (default: 7 days).
 *
 * Failure-only logging:
 * - warn once on missing schema
 * - error on real failures
 */
export async function loadRecentCapacityUpdateRequest(args: {
  supplierId: string;
  weekStartDate: string;
  lookbackDays?: number;
}): Promise<{ createdAt: string | null }> {
  // Defense-in-depth: uses service role; keep admin-only.
  await requireAdminUser();

  const supplierId = normalizeId(args?.supplierId);
  const weekStartDate = normalizeWeekStartDate(args?.weekStartDate);
  const lookbackDaysRaw = args?.lookbackDays;
  const lookbackDays =
    typeof lookbackDaysRaw === "number" && Number.isFinite(lookbackDaysRaw)
      ? Math.max(1, Math.min(90, Math.floor(lookbackDaysRaw)))
      : 7;

  if (!supplierId || !weekStartDate) {
    return { createdAt: null };
  }

  const cutoff = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString();

  type Row = { created_at: string };

  const selectLatest = async (supplierKey: "supplierId" | "supplier_id") => {
    return await supabaseServer
      .from("quote_events")
      .select("created_at")
      .eq("event_type", "capacity_update_requested")
      .eq(`metadata->>${supplierKey}`, supplierId)
      .eq("metadata->>weekStartDate", weekStartDate)
      .gte("created_at", cutoff)
      .order("created_at", { ascending: false })
      .limit(1)
      .returns<Row[]>();
  };

  try {
    const preferred = await selectLatest("supplierId");
    if (preferred.error) {
      if (isMissingTableOrColumnError(preferred.error)) {
        if (!didWarnMissingQuoteEventsSchemaForAdminCapacityRequests) {
          didWarnMissingQuoteEventsSchemaForAdminCapacityRequests = true;
          console.warn("[admin capacity request] lookup skipped (missing schema)", {
            supplierId,
            weekStartDate,
            lookbackDays,
            pgCode: (preferred.error as { code?: string | null })?.code ?? null,
            message: (preferred.error as { message?: string | null })?.message ?? null,
          });
        }
        return { createdAt: null };
      }

      console.error("[admin capacity request] lookup failed", {
        supplierId,
        weekStartDate,
        lookbackDays,
        error: serializeSupabaseError(preferred.error),
      });
      return { createdAt: null };
    }

    const preferredCreatedAt =
      Array.isArray(preferred.data) && typeof preferred.data[0]?.created_at === "string"
        ? preferred.data[0].created_at
        : null;
    if (preferredCreatedAt) {
      return { createdAt: preferredCreatedAt };
    }

    const legacy = await selectLatest("supplier_id");
    if (legacy.error) {
      if (isMissingTableOrColumnError(legacy.error)) {
        if (!didWarnMissingQuoteEventsSchemaForAdminCapacityRequests) {
          didWarnMissingQuoteEventsSchemaForAdminCapacityRequests = true;
          console.warn("[admin capacity request] lookup skipped (missing schema)", {
            supplierId,
            weekStartDate,
            lookbackDays,
            pgCode: (legacy.error as { code?: string | null })?.code ?? null,
            message: (legacy.error as { message?: string | null })?.message ?? null,
          });
        }
        return { createdAt: null };
      }

      console.error("[admin capacity request] lookup failed", {
        supplierId,
        weekStartDate,
        lookbackDays,
        error: serializeSupabaseError(legacy.error),
      });
      return { createdAt: null };
    }

    const legacyCreatedAt =
      Array.isArray(legacy.data) && typeof legacy.data[0]?.created_at === "string"
        ? legacy.data[0].created_at
        : null;
    return { createdAt: legacyCreatedAt };
  } catch (error) {
    if (isMissingTableOrColumnError(error)) {
      if (!didWarnMissingQuoteEventsSchemaForAdminCapacityRequests) {
        didWarnMissingQuoteEventsSchemaForAdminCapacityRequests = true;
        console.warn("[admin capacity request] lookup crashed (missing schema)", {
          supplierId,
          weekStartDate,
          lookbackDays,
          error: serializeSupabaseError(error),
        });
      }
      return { createdAt: null };
    }

    console.error("[admin capacity request] lookup crashed", {
      supplierId,
      weekStartDate,
      lookbackDays,
      error: serializeSupabaseError(error) ?? error,
    });
    return { createdAt: null };
  }
}

export function isCapacityRequestSuppressed(args: {
  requestCreatedAt: string | null;
  supplierLastUpdatedAt: string | null;
}): boolean {
  const requestCreatedAt =
    typeof args?.requestCreatedAt === "string" && args.requestCreatedAt.trim()
      ? args.requestCreatedAt.trim()
      : null;
  if (!requestCreatedAt) return false;

  const supplierLastUpdatedAt =
    typeof args?.supplierLastUpdatedAt === "string" && args.supplierLastUpdatedAt.trim()
      ? args.supplierLastUpdatedAt.trim()
      : null;
  if (!supplierLastUpdatedAt) return true;

  const requestTs = Date.parse(requestCreatedAt);
  const updatedTs = Date.parse(supplierLastUpdatedAt);
  if (!Number.isFinite(requestTs) || !Number.isFinite(updatedTs)) {
    // Be conservative: treat unknown timestamps as suppressed if a request exists.
    return true;
  }

  // Suppressed if supplier has NOT updated capacity after the request.
  return updatedTs <= requestTs;
}

export async function requestSupplierCapacityUpdate(args: {
  quoteId: string;
  supplierId: string;
  weekStartDate: string; // YYYY-MM-DD
  reason: CapacityUpdateRequestReason;
  actorUserId: string;
}): Promise<void> {
  const quoteId = typeof args?.quoteId === "string" ? args.quoteId.trim() : "";
  const supplierId =
    typeof args?.supplierId === "string" ? args.supplierId.trim() : "";
  const weekStartDate =
    typeof args?.weekStartDate === "string" ? args.weekStartDate.trim() : "";
  const reason =
    args?.reason === "stale" || args?.reason === "missing" || args?.reason === "manual"
      ? args.reason
      : "manual";

  if (!quoteId || !supplierId || !weekStartDate) {
    // Failure-only logging, per spec.
    console.warn("[admin capacity request] skipped (invalid input)", {
      quoteId: quoteId || null,
      supplierId: supplierId || null,
      weekStartDate: weekStartDate || null,
      reason,
    });
    return;
  }

  // Guard with requireAdminUser (do not trust caller-provided actor id).
  const adminUser = await requireAdminUser();

  try {
    const result = await emitQuoteEvent({
      quoteId,
      eventType: "capacity_update_requested",
      actorRole: "admin",
      actorUserId: adminUser.id,
      metadata: {
        supplierId,
        weekStartDate,
        reason,
      },
    });

    if (!result.ok) {
      // Failure-only logging (schema missing / insert failure), per spec.
      console.warn("[admin capacity request] emit failed", {
        quoteId,
        supplierId,
        weekStartDate,
        reason,
        error: result.error,
      });
    }
  } catch (error) {
    console.warn("[admin capacity request] emit crashed", {
      quoteId,
      supplierId,
      weekStartDate,
      reason,
      message: (error as { message?: string | null })?.message ?? null,
      code: (error as { code?: string | null })?.code ?? null,
    });
  }
}

