import { requireAdminUser } from "@/server/auth";
import { emitQuoteEvent } from "@/server/quotes/events";

export type CapacityUpdateRequestReason = "stale" | "missing" | "manual";

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

