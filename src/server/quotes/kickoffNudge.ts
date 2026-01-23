import { supabaseServer } from "@/lib/supabaseServer";
import {
  isMissingTableOrColumnError,
  serializeSupabaseError,
} from "@/server/admin/logging";
import { emitQuoteEvent } from "@/server/quotes/events";

export type KickoffNudgeResult =
  | { ok: true }
  | { ok: false; reason: "recent_nudge" | "invalid_input" | "write_failed" | "unavailable" };

type QuoteEventRow = {
  event_type: string;
  created_at: string;
  metadata?: unknown;
  payload?: unknown;
};

function normalizeId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeEventType(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function resolveMetadata(row: QuoteEventRow): Record<string, unknown> {
  if (isRecord(row.metadata)) return row.metadata;
  if (isRecord(row.payload)) return row.payload;
  return {};
}

function extractSupplierId(metadata: Record<string, unknown>): string {
  return (
    normalizeId(metadata["supplierId"]) ||
    normalizeId(metadata["supplier_id"]) ||
    ""
  );
}

export async function getLatestKickoffNudgedAt(args: {
  quoteId: string;
  supplierId: string;
}): Promise<string | null> {
  const quoteId = normalizeId(args.quoteId);
  const supplierId = normalizeId(args.supplierId);
  if (!quoteId || !supplierId) return null;

  try {
    const runSelect = (columns: string) =>
      supabaseServer()
        .from("quote_events")
        .select(columns)
        .eq("quote_id", quoteId)
        .eq("event_type", "kickoff_nudged")
        .order("created_at", { ascending: false })
        .limit(25)
        .returns<QuoteEventRow[]>();

    let data: QuoteEventRow[] | null = null;
    let error: unknown = null;

    const attemptWithPayload = await runSelect("event_type,created_at,metadata,payload");
    if (!attemptWithPayload.error) {
      data = attemptWithPayload.data ?? [];
    } else if (isMissingTableOrColumnError(attemptWithPayload.error)) {
      const attemptMetadataOnly = await runSelect("event_type,created_at,metadata");
      if (!attemptMetadataOnly.error) {
        data = attemptMetadataOnly.data ?? [];
      } else if (isMissingTableOrColumnError(attemptMetadataOnly.error)) {
        const attemptPayloadOnly = await runSelect("event_type,created_at,payload");
        if (!attemptPayloadOnly.error) {
          data = attemptPayloadOnly.data ?? [];
        } else {
          error = attemptPayloadOnly.error;
        }
      } else {
        error = attemptMetadataOnly.error;
      }
    } else {
      error = attemptWithPayload.error;
    }

    if (error) {
      if (isMissingTableOrColumnError(error)) {
        return null;
      }
      console.error("[kickoff nudge] lookup failed", {
        quoteId,
        supplierId,
        error: serializeSupabaseError(error),
      });
      return null;
    }

    for (const row of data ?? []) {
      if (normalizeEventType(row.event_type) !== "kickoff_nudged") continue;
      const metadata = resolveMetadata(row);
      if (extractSupplierId(metadata) !== supplierId) continue;
      const createdAt = typeof row.created_at === "string" ? row.created_at : "";
      return createdAt.trim().length > 0 ? createdAt : null;
    }

    return null;
  } catch (error) {
    if (isMissingTableOrColumnError(error)) {
      return null;
    }
    console.error("[kickoff nudge] lookup crashed", {
      quoteId,
      supplierId,
      error: serializeSupabaseError(error) ?? error,
    });
    return null;
  }
}

export async function nudgeSupplierKickoffAsCustomer(args: {
  quoteId: string;
  supplierId: string;
  actorUserId: string;
}): Promise<KickoffNudgeResult> {
  const quoteId = normalizeId(args.quoteId);
  const supplierId = normalizeId(args.supplierId);
  const actorUserId = normalizeId(args.actorUserId);
  if (!quoteId || !supplierId || !actorUserId) {
    return { ok: false, reason: "invalid_input" };
  }

  const lastNudgeAt = await getLatestKickoffNudgedAt({ quoteId, supplierId });
  if (lastNudgeAt) {
    const ms = Date.parse(lastNudgeAt);
    if (Number.isFinite(ms)) {
      const within24h = Date.now() - ms < 24 * 60 * 60 * 1000;
      if (within24h) {
        return { ok: false, reason: "recent_nudge" };
      }
    }
  }

  const emitted = await emitQuoteEvent({
    quoteId,
    eventType: "kickoff_nudged",
    actorRole: "customer",
    actorUserId,
    actorSupplierId: null,
    metadata: { supplierId, quoteId },
  });

  if (emitted.ok) {
    return { ok: true };
  }

  // Schema-missing should be a quiet no-op in some envs.
  // `emitQuoteEvent` already suppresses missing-schema logging; we just map to "unavailable".
  return { ok: false, reason: "unavailable" };
}

