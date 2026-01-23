import { supabaseServer } from "@/lib/supabaseServer";
import { requireAdminUser } from "@/server/auth";
import {
  isMissingTableOrColumnError,
  serializeSupabaseError,
} from "@/server/admin/logging";

export type AwardFeedbackSummaryForSupplier = {
  total: number;
  byReason: Record<string, number>;
  lastReason?: string;
  lastConfidence?: string | null;
  lastNotes?: string | null;
  lastCreatedAt?: string | null;
};

const EVENT_TYPE = "award_feedback_recorded";
let didWarnMissingAwardFeedbackSchema = false;

function normalizeId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function clampLookbackDays(value: unknown, fallback: number): number {
  const raw = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.max(1, Math.min(365, Math.floor(raw)));
}

function sanitizePostgrestOrNeedle(value: string): string {
  // Keep PostgREST `.or()` strings stable and prevent delimiter injection.
  // Also strip `*` since it's the wildcard token in `.or()` filters.
  return (value ?? "")
    .trim()
    .replace(/[*(),]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readString(meta: Record<string, unknown>, key: string): string | null {
  const value = meta[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function resolveMetadata(row: { metadata?: unknown; payload?: unknown }): Record<string, unknown> {
  if (isRecord(row.metadata)) return row.metadata;
  if (isRecord(row.payload)) return row.payload;
  return {};
}

function buildEmpty(): AwardFeedbackSummaryForSupplier {
  return { total: 0, byReason: {} };
}

export async function getAwardFeedbackSummaryForSupplier(args: {
  supplierId: string;
  lookbackDays?: number;
}): Promise<AwardFeedbackSummaryForSupplier> {
  // Defense-in-depth: this uses the service role key.
  await requireAdminUser();

  const supplierId = normalizeId(args?.supplierId);
  const lookbackDays = clampLookbackDays(args?.lookbackDays, 90);
  if (!supplierId) return buildEmpty();

  const cutoff = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString();
  const safeSupplierId = sanitizePostgrestOrNeedle(supplierId);
  if (!safeSupplierId) return buildEmpty();

  type Row = {
    created_at: string;
    metadata?: unknown;
    payload?: unknown;
  };

  const runQuery = async (jsonColumn: "metadata" | "payload") => {
    // PostgREST supports filtering jsonb with `column->>key`.
    const supplierFilter = [
      `${jsonColumn}->>supplierId.eq.${safeSupplierId}`,
      `${jsonColumn}->>supplier_id.eq.${safeSupplierId}`,
    ].join(",");

    return await supabaseServer()
      .from("quote_events")
      .select("created_at,metadata,payload")
      .eq("event_type", EVENT_TYPE)
      .gte("created_at", cutoff)
      .or(supplierFilter)
      .order("created_at", { ascending: false })
      .limit(500)
      .returns<Row[]>();
  };

  try {
    // Prefer canonical schema (`metadata` jsonb), but tolerate legacy (`payload`).
    let data: Row[] | null = null;
    let error: unknown = null;

    const preferred = await runQuery("metadata");
    if (!preferred.error) {
      data = preferred.data ?? [];
    } else if (isMissingTableOrColumnError(preferred.error)) {
      const legacy = await runQuery("payload");
      if (!legacy.error) {
        data = legacy.data ?? [];
      } else {
        error = legacy.error;
      }
    } else {
      error = preferred.error;
    }

    if (error) {
      if (isMissingTableOrColumnError(error)) {
        if (!didWarnMissingAwardFeedbackSchema) {
          didWarnMissingAwardFeedbackSchema = true;
          console.warn("[admin award feedback] missing schema; returning empty", {
            supplierId,
            lookbackDays,
            error: serializeSupabaseError(error),
          });
        }
        return buildEmpty();
      }

      console.error("[admin award feedback] query failed", {
        supplierId,
        lookbackDays,
        error: serializeSupabaseError(error),
      });
      return buildEmpty();
    }

    const rows = Array.isArray(data) ? data : [];
    const byReason: Record<string, number> = {};
    let total = 0;

    let lastReason: string | undefined;
    let lastConfidence: string | null | undefined;
    let lastNotes: string | null | undefined;
    let lastCreatedAt: string | null | undefined;

    for (const row of rows) {
      const meta = resolveMetadata(row);
      const metaSupplierId = readString(meta, "supplierId") ?? readString(meta, "supplier_id");
      if (metaSupplierId !== supplierId) continue;

      const reason = readString(meta, "reason");
      if (!reason) continue;

      total += 1;
      byReason[reason] = (byReason[reason] ?? 0) + 1;

      if (!lastCreatedAt) {
        // Rows are ordered newest-first.
        lastCreatedAt = row.created_at ?? null;
        lastReason = reason;
        lastConfidence = readString(meta, "confidence");
        lastNotes = readString(meta, "notes");
      }
    }

    return {
      total,
      byReason,
      lastReason,
      lastConfidence: lastConfidence ?? null,
      lastNotes: lastNotes ?? null,
      lastCreatedAt: lastCreatedAt ?? null,
    };
  } catch (error) {
    if (isMissingTableOrColumnError(error)) {
      if (!didWarnMissingAwardFeedbackSchema) {
        didWarnMissingAwardFeedbackSchema = true;
        console.warn("[admin award feedback] crashed (missing schema); returning empty", {
          supplierId,
          lookbackDays,
          error: serializeSupabaseError(error),
        });
      }
      return buildEmpty();
    }

    console.error("[admin award feedback] crashed", {
      supplierId,
      lookbackDays,
      error: serializeSupabaseError(error) ?? error,
    });
    return buildEmpty();
  }
}

