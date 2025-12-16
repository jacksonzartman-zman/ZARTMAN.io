import { supabaseServer } from "@/lib/supabaseServer";
import {
  AWARD_FEEDBACK_MAX_NOTES_LENGTH,
  isAwardFeedbackConfidence,
  isAwardFeedbackReason,
  type AwardFeedbackConfidence,
  type AwardFeedbackReason,
} from "@/lib/awardFeedback";
import {
  isMissingTableOrColumnError,
  serializeSupabaseError,
} from "@/server/admin/logging";
import type { QuoteEventActorRole } from "@/server/quotes/events";

export type AwardFeedbackRecordInput = {
  quoteId: string;
  supplierId: string;
  reason: AwardFeedbackReason;
  confidence?: AwardFeedbackConfidence | null;
  notes?: string | null;
  actorUserId: string;
  actorRole: Extract<QuoteEventActorRole, "admin" | "customer">;
};

export type AwardFeedbackRecordResult =
  | { ok: true; skipped: boolean }
  | { ok: false; error: string };

export type AwardFeedbackSnapshot = {
  supplierId: string;
  reason: AwardFeedbackReason;
  confidence: AwardFeedbackConfidence | null;
  notes: string | null;
  createdAt: string;
  actorRole: QuoteEventActorRole;
  actorUserId: string | null;
};

const EVENT_TYPE = "award_feedback_recorded";
const IDEMPOTENCY_WINDOW_MS = 10 * 60 * 1000;

export async function recordAwardFeedback(
  input: AwardFeedbackRecordInput,
): Promise<AwardFeedbackRecordResult> {
  const quoteId = normalizeId(input?.quoteId);
  const supplierId = normalizeId(input?.supplierId);
  const actorUserId = normalizeId(input?.actorUserId);
  const actorRole = normalizeActorRole(input?.actorRole);
  const reasonRaw = typeof input?.reason === "string" ? input.reason : "";
  const confidenceRaw =
    typeof input?.confidence === "string" ? input.confidence : null;
  const notesRaw = typeof input?.notes === "string" ? input.notes : null;

  const reason = isAwardFeedbackReason(reasonRaw) ? reasonRaw : null;
  const confidence = confidenceRaw && isAwardFeedbackConfidence(confidenceRaw) ? confidenceRaw : null;

  const notes = normalizeNotes(notesRaw);

  if (!quoteId || !supplierId || !actorUserId || !actorRole) {
    return { ok: false, error: "invalid_input" };
  }

  if (!reason) {
    return { ok: false, error: "invalid_reason" };
  }

  if (notes && notes.length > AWARD_FEEDBACK_MAX_NOTES_LENGTH) {
    return { ok: false, error: "notes_too_long" };
  }

  // Idempotency: if an identical feedback exists for same quote+supplier in the last 10 minutes, skip.
  const duplicate = await findRecentDuplicate({
    quoteId,
    supplierId,
    reason,
    confidence,
    notes,
  });
  if (duplicate) {
    return { ok: true, skipped: true };
  }

  const metadata = {
    supplierId,
    supplier_id: supplierId,
    reason,
    ...(confidence ? { confidence } : null),
    ...(notes ? { notes } : null),
  } as Record<string, unknown>;

  try {
    // Prefer canonical schema (metadata jsonb).
    const insertAttempt = await supabaseServer.from("quote_events").insert({
      quote_id: quoteId,
      event_type: EVENT_TYPE,
      actor_role: actorRole,
      actor_user_id: actorUserId,
      actor_supplier_id: null,
      metadata,
    });

    if (!insertAttempt.error) {
      return { ok: true, skipped: false };
    }

    // Back-compat: some environments historically used `payload` instead of `metadata`.
    if (isMissingTableOrColumnError(insertAttempt.error)) {
      const fallback = await supabaseServer.from("quote_events").insert({
        quote_id: quoteId,
        event_type: EVENT_TYPE,
        actor_role: actorRole,
        actor_user_id: actorUserId,
        actor_supplier_id: null,
        payload: metadata,
      } as unknown as Record<string, unknown>);

      if (!fallback.error) {
        return { ok: true, skipped: false };
      }

      console.error("[award feedback] write failed", {
        quoteId,
        supplierId,
        error: serializeSupabaseError(fallback.error),
      });
      return { ok: false, error: "write_failed" };
    }

    console.error("[award feedback] write failed", {
      quoteId,
      supplierId,
      error: serializeSupabaseError(insertAttempt.error),
    });
    return { ok: false, error: "write_failed" };
  } catch (error) {
    console.error("[award feedback] write crashed", {
      quoteId,
      supplierId,
      error: serializeSupabaseError(error) ?? error,
    });
    return { ok: false, error: "write_failed" };
  }
}

export async function loadLatestAwardFeedbackForQuote(args: {
  quoteId: string;
  supplierId: string;
}): Promise<AwardFeedbackSnapshot | null> {
  const quoteId = normalizeId(args?.quoteId);
  const supplierId = normalizeId(args?.supplierId);
  if (!quoteId || !supplierId) return null;

  try {
    type Row = {
      actor_role: QuoteEventActorRole;
      actor_user_id: string | null;
      created_at: string;
      metadata?: unknown;
      payload?: unknown;
    };

    const runSelect = (columns: string) =>
      supabaseServer
        .from("quote_events")
        .select(columns)
        .eq("quote_id", quoteId)
        .eq("event_type", EVENT_TYPE)
        .order("created_at", { ascending: false })
        .limit(25)
        .returns<Row[]>();

    let data: Row[] | null = null;
    let error: unknown = null;

    const attemptWithPayload = await runSelect(
      "actor_role,actor_user_id,created_at,metadata,payload",
    );
    if (!attemptWithPayload.error) {
      data = attemptWithPayload.data ?? [];
    } else if (isMissingTableOrColumnError(attemptWithPayload.error)) {
      const attemptMetadataOnly = await runSelect(
        "actor_role,actor_user_id,created_at,metadata",
      );
      if (!attemptMetadataOnly.error) {
        data = attemptMetadataOnly.data ?? [];
      } else if (isMissingTableOrColumnError(attemptMetadataOnly.error)) {
        const attemptPayloadOnly = await runSelect(
          "actor_role,actor_user_id,created_at,payload",
        );
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
      console.error("[award feedback] load failed", {
        quoteId,
        supplierId,
        error: serializeSupabaseError(error),
      });
      return null;
    }

    const rows = Array.isArray(data) ? data : [];
    for (const row of rows) {
      const meta = resolveMetadata(row);
      const metaSupplierId =
        normalizeId(meta["supplierId"]) || normalizeId(meta["supplier_id"]);
      if (metaSupplierId !== supplierId) continue;

      const reason = meta["reason"];
      if (!isAwardFeedbackReason(reason)) continue;
      const confidence = isAwardFeedbackConfidence(meta["confidence"])
        ? (meta["confidence"] as AwardFeedbackConfidence)
        : null;
      const notes = normalizeNotes(
        typeof meta["notes"] === "string" ? (meta["notes"] as string) : null,
      );

      return {
        supplierId,
        reason,
        confidence,
        notes,
        createdAt: row.created_at,
        actorRole: row.actor_role,
        actorUserId: row.actor_user_id,
      };
    }

    return null;
  } catch (error) {
    console.error("[award feedback] load crashed", {
      quoteId,
      supplierId,
      error: serializeSupabaseError(error) ?? error,
    });
    return null;
  }
}

async function findRecentDuplicate(args: {
  quoteId: string;
  supplierId: string;
  reason: AwardFeedbackReason;
  confidence: AwardFeedbackConfidence | null;
  notes: string | null;
}): Promise<boolean> {
  const since = new Date(Date.now() - IDEMPOTENCY_WINDOW_MS).toISOString();
  try {
    type Row = { created_at: string; metadata?: unknown; payload?: unknown };

    const runSelect = (columns: string) =>
      supabaseServer
        .from("quote_events")
        .select(columns)
        .eq("quote_id", args.quoteId)
        .eq("event_type", EVENT_TYPE)
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(25)
        .returns<Row[]>();

    let data: Row[] | null = null;
    let error: unknown = null;

    const attemptWithPayload = await runSelect("created_at,metadata,payload");
    if (!attemptWithPayload.error) {
      data = attemptWithPayload.data ?? [];
    } else if (isMissingTableOrColumnError(attemptWithPayload.error)) {
      const attemptMetadataOnly = await runSelect("created_at,metadata");
      if (!attemptMetadataOnly.error) {
        data = attemptMetadataOnly.data ?? [];
      } else if (isMissingTableOrColumnError(attemptMetadataOnly.error)) {
        const attemptPayloadOnly = await runSelect("created_at,payload");
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
      // Failure-only logging.
      console.error("[award feedback] duplicate check failed", {
        quoteId: args.quoteId,
        supplierId: args.supplierId,
        error: serializeSupabaseError(error),
      });
      return false;
    }

    const rows = Array.isArray(data) ? data : [];
    for (const row of rows) {
      const meta = resolveMetadata(row);
      const supplierId =
        normalizeId(meta["supplierId"]) || normalizeId(meta["supplier_id"]);
      const reason = meta["reason"];
      const confidence = meta["confidence"];
      const notes = typeof meta["notes"] === "string" ? (meta["notes"] as string) : null;

      if (supplierId !== args.supplierId) continue;
      if (reason !== args.reason) continue;
      if ((typeof confidence === "string" ? confidence : null) !== args.confidence) continue;
      if (normalizeNotes(notes) !== args.notes) continue;

      return true;
    }

    return false;
  } catch (error) {
    console.error("[award feedback] duplicate check crashed", {
      quoteId: args.quoteId,
      supplierId: args.supplierId,
      error: serializeSupabaseError(error) ?? error,
    });
    return false;
  }
}

function resolveMetadata(row: { metadata?: unknown; payload?: unknown }): Record<string, unknown> {
  if (isRecord(row.metadata)) return row.metadata as Record<string, unknown>;
  if (isRecord(row.payload)) return row.payload as Record<string, unknown>;
  return {};
}

function normalizeId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeActorRole(value: unknown): "admin" | "customer" | null {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (normalized === "admin" || normalized === "customer") return normalized;
  return null;
}

function normalizeNotes(value: string | null): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

