import "server-only";

import { supabaseServer } from "@/lib/supabaseServer";
import { emitRfqEvent } from "@/server/rfqs/events";

export type DeclineRfqDestinationAsSupplierResult =
  | { ok: true }
  | { ok: false; error: "invalid_input" | "forbidden" | "write_failed" };

/**
 * Supplier-side "Not a fit":
 * - Only allowed when the supplier's `providerId` has a matching `rfq_destinations` row for the RFQ.
 * - Updates `rfq_destinations.status` to `declined`.
 * - Emits an `rfq_events` row via `emitRfqEvent` with type `destination_declined`.
 */
export async function declineRfqDestinationAsSupplier(
  input: {
    rfqId: string;
    providerId: string;
    actorUserId: string | null;
  },
  deps?: {
    client?: ReturnType<typeof supabaseServer>;
    emitEvent?: typeof emitRfqEvent;
    nowIso?: string;
  },
): Promise<DeclineRfqDestinationAsSupplierResult> {
  const rfqId = normalizeId(input?.rfqId);
  const providerId = normalizeId(input?.providerId);
  const actorUserId = normalizeId(input?.actorUserId ?? null) || null;
  const now = typeof deps?.nowIso === "string" && deps.nowIso.trim() ? deps.nowIso.trim() : new Date().toISOString();

  if (!rfqId || !providerId) {
    return { ok: false, error: "invalid_input" };
  }

  const client = deps?.client ?? supabaseServer();
  const emitEvent = deps?.emitEvent ?? emitRfqEvent;

  // Access control: only the supplier assigned via rfq_destinations can decline.
  const { data: destinationRow, error: destinationLookupError } = await client
    .from("rfq_destinations")
    .select("id,status")
    .eq("rfq_id", rfqId)
    .eq("provider_id", providerId)
    .maybeSingle<{ id: string | null; status: string | null }>();

  if (destinationLookupError) {
    console.error("[supplier decline destination] destination lookup failed", {
      rfqId,
      providerId,
      error: destinationLookupError,
    });
    return { ok: false, error: "write_failed" };
  }

  const destinationId = normalizeId(destinationRow?.id ?? null);
  if (!destinationId) {
    return { ok: false, error: "forbidden" };
  }

  const { error: updateError } = await client
    .from("rfq_destinations")
    .update({ status: "declined" })
    .eq("rfq_id", rfqId)
    .eq("provider_id", providerId);

  if (updateError) {
    console.error("[supplier decline destination] destination update failed", {
      rfqId,
      providerId,
      error: updateError,
    });
    return { ok: false, error: "write_failed" };
  }

  // Best-effort: event log. If it fails, we still return ok since the decline succeeded.
  try {
    await emitEvent(
      {
        rfqId,
        eventType: "destination_declined",
        actorRole: "supplier",
        actorUserId,
        createdAt: now,
      },
      { client },
    );
  } catch {
    // ignore
  }

  return { ok: true };
}

function normalizeId(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : "";
}

