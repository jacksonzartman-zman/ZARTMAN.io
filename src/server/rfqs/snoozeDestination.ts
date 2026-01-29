import "server-only";

import { supabaseServer } from "@/lib/supabaseServer";
import {
  isMissingTableOrColumnError,
  serializeSupabaseError,
} from "@/server/admin/logging";
import { hasColumns } from "@/server/db/schemaContract";

export type SnoozeRfqDestinationAsSupplierResult =
  | { ok: true; snoozeUntil: string | null }
  | { ok: false; error: "invalid_input" | "forbidden" | "write_failed" };

/**
 * Supplier-side "Snooze":
 * - Only allowed when the supplier's `providerId` has a matching `rfq_destinations` row for the RFQ.
 * - Updates `rfq_destinations.status` to `viewed`.
 * - Best-effort stores `rfq_destinations.snooze_until` when the column exists.
 */
export async function snoozeRfqDestinationAsSupplier(
  input: {
    rfqId: string;
    providerId: string;
    actorUserId: string | null;
    snoozeUntilIso: string;
  },
  deps?: {
    client?: ReturnType<typeof supabaseServer>;
    nowIso?: string;
    supportsSnoozeUntil?: boolean;
  },
): Promise<SnoozeRfqDestinationAsSupplierResult> {
  const rfqId = normalizeId(input?.rfqId);
  const providerId = normalizeId(input?.providerId);
  const actorUserId = normalizeId(input?.actorUserId ?? null) || null;
  const snoozeUntilIso = typeof input?.snoozeUntilIso === "string" ? input.snoozeUntilIso.trim() : "";
  const now = typeof deps?.nowIso === "string" && deps.nowIso.trim() ? deps.nowIso.trim() : new Date().toISOString();

  // actorUserId currently unused (kept for parity with decline, and future event logging).
  void actorUserId;

  if (!rfqId || !providerId || !snoozeUntilIso) {
    return { ok: false, error: "invalid_input" };
  }
  const snoozeUntilMs = Date.parse(snoozeUntilIso);
  if (Number.isNaN(snoozeUntilMs) || snoozeUntilMs <= Date.parse(now)) {
    return { ok: false, error: "invalid_input" };
  }

  const client = deps?.client ?? supabaseServer();

  // Access control: only the supplier assigned via rfq_destinations can snooze.
  const { data: destinationRow, error: destinationLookupError } = await client
    .from("rfq_destinations")
    .select("id,status")
    .eq("rfq_id", rfqId)
    .eq("provider_id", providerId)
    .maybeSingle<{ id: string | null; status: string | null }>();

  if (destinationLookupError) {
    console.error("[supplier snooze destination] destination lookup failed", {
      rfqId,
      providerId,
      error: serializeSupabaseError(destinationLookupError) ?? destinationLookupError,
    });
    return { ok: false, error: "write_failed" };
  }

  const destinationId = normalizeId(destinationRow?.id ?? null);
  if (!destinationId) {
    return { ok: false, error: "forbidden" };
  }

  const supportsSnoozeUntil =
    typeof deps?.supportsSnoozeUntil === "boolean"
      ? deps.supportsSnoozeUntil
      : await hasColumns("rfq_destinations", ["snooze_until"]);

  const updatePayload: Record<string, unknown> = { status: "viewed" };
  if (supportsSnoozeUntil) {
    updatePayload.snooze_until = snoozeUntilIso;
  }

  const { error: updateError } = await client
    .from("rfq_destinations")
    .update(updatePayload)
    .eq("rfq_id", rfqId)
    .eq("provider_id", providerId);

  if (updateError) {
    // If the column doesn't exist in the current env, retry without it.
    if (supportsSnoozeUntil && isMissingTableOrColumnError(updateError)) {
      const { error: fallbackError } = await client
        .from("rfq_destinations")
        .update({ status: "viewed" })
        .eq("rfq_id", rfqId)
        .eq("provider_id", providerId);

      if (fallbackError) {
        console.error("[supplier snooze destination] destination update failed (fallback)", {
          rfqId,
          providerId,
          error: serializeSupabaseError(fallbackError) ?? fallbackError,
        });
        return { ok: false, error: "write_failed" };
      }

      return { ok: true, snoozeUntil: null };
    }

    console.error("[supplier snooze destination] destination update failed", {
      rfqId,
      providerId,
      error: serializeSupabaseError(updateError) ?? updateError,
    });
    return { ok: false, error: "write_failed" };
  }

  return { ok: true, snoozeUntil: supportsSnoozeUntil ? snoozeUntilIso : null };
}

function normalizeId(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : "";
}

