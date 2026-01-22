import { supabaseServer } from "@/lib/supabaseServer";
import {
  isMissingTableOrColumnError,
  serializeSupabaseError,
} from "@/server/admin/logging";
import { emitQuoteEvent, type QuoteEventActorRole } from "@/server/quotes/events";
import { schemaGate } from "@/server/db/schemaContract";

export type FinalizeKickoffCompletionInput = {
  quoteId: string;
  supplierId: string;
  actorUserId: string | null;
  actorRole: QuoteEventActorRole;
};

let warnedMissingSchema = false;
const SUPPLIER_KICKOFF_TASKS_TABLE_LEGACY = "quote_kickoff_tasks";
const SUPPLIER_KICKOFF_TASKS_TABLE_RENAMED = "quote_supplier_kickoff_tasks";

async function resolveSupplierKickoffTasksTableName(): Promise<string> {
  const requiredColumns = ["quote_id", "supplier_id", "task_key", "completed"];
  const legacyOk = await schemaGate({
    enabled: true,
    relation: SUPPLIER_KICKOFF_TASKS_TABLE_LEGACY,
    requiredColumns,
    warnPrefix: "[kickoff completion]",
    warnKey: "kickoff_completion:supplier_tasks_legacy_schema",
  });
  if (legacyOk) return SUPPLIER_KICKOFF_TASKS_TABLE_LEGACY;

  const renamedOk = await schemaGate({
    enabled: true,
    relation: SUPPLIER_KICKOFF_TASKS_TABLE_RENAMED,
    requiredColumns,
    warnPrefix: "[kickoff completion]",
    warnKey: "kickoff_completion:supplier_tasks_renamed_schema",
  });
  if (renamedOk) return SUPPLIER_KICKOFF_TASKS_TABLE_RENAMED;

  return SUPPLIER_KICKOFF_TASKS_TABLE_LEGACY;
}

/**
 * Idempotently stamps quote-level kickoff completion + emits a timeline event.
 *
 * Behavior:
 * - If `quotes.kickoff_completed_at` is already set: return early (no event spam).
 * - Otherwise, load kickoff tasks for (quoteId, supplierId) and compute totals.
 * - If all tasks are complete, stamp the quote (only if still null) and emit
 *   `quote_events.kickoff_completed` with safe metadata.
 *
 * Failure-only logging. If schema is missing, warn once and no-op.
 */
export async function finalizeKickoffCompletionIfComplete(
  input: FinalizeKickoffCompletionInput,
): Promise<void> {
  const quoteId = normalizeId(input?.quoteId);
  const supplierId = normalizeId(input?.supplierId);
  const actorRole = normalizeActorRole(input?.actorRole) ?? "system";
  const actorUserId = actorRole === "system" ? null : normalizeId(input?.actorUserId) || null;

  if (!quoteId || !supplierId) {
    return;
  }

  try {
    // Idempotency guard: if already completed, return early.
    const { data: quoteRow, error: quoteError } = await supabaseServer
      .from("quotes")
      .select("id,kickoff_completed_at")
      .eq("id", quoteId)
      .maybeSingle<{ id: string; kickoff_completed_at: string | null }>();

    if (quoteError) {
      if (isMissingTableOrColumnError(quoteError)) {
        warnMissingSchemaOnce("[kickoff completion] missing schema (quote lookup)", {
          quoteId,
          supplierId,
          error: serializeSupabaseError(quoteError),
        });
        return;
      }
      console.error("[kickoff completion] quote lookup failed", {
        quoteId,
        supplierId,
        error: serializeSupabaseError(quoteError),
      });
      return;
    }

    if (quoteRow?.kickoff_completed_at) {
      return;
    }

    const supplierTasksTable = await resolveSupplierKickoffTasksTableName();
    const { data: taskRows, error: tasksError } = await supabaseServer
      .from(supplierTasksTable)
      .select("completed")
      .eq("quote_id", quoteId)
      .eq("supplier_id", supplierId)
      .returns<{ completed: boolean | null }[]>();

    if (tasksError) {
      if (isMissingTableOrColumnError(tasksError)) {
        warnMissingSchemaOnce("[kickoff completion] missing schema (tasks load)", {
          quoteId,
          supplierId,
          error: serializeSupabaseError(tasksError),
        });
        return;
      }
      console.error("[kickoff completion] task load failed", {
        quoteId,
        supplierId,
        error: serializeSupabaseError(tasksError),
      });
      return;
    }

    const totalTasks = Array.isArray(taskRows) ? taskRows.length : 0;
    const completedTasks = Array.isArray(taskRows)
      ? taskRows.reduce((count, task) => count + (task?.completed ? 1 : 0), 0)
      : 0;

    if (!(totalTasks > 0 && completedTasks >= totalTasks)) {
      return;
    }

    const now = new Date().toISOString();

    // Stamp quote only if kickoff_completed_at is still null (race-safe).
    const { data: updatedRows, error: updateError } = await supabaseServer
      .from("quotes")
      .update({
        kickoff_completed_at: now,
        kickoff_completed_by_user_id: actorUserId,
        kickoff_completed_by_role: actorRole,
      })
      .eq("id", quoteId)
      .is("kickoff_completed_at", null)
      .select("id")
      .returns<{ id: string }[]>();

    if (updateError) {
      if (isMissingTableOrColumnError(updateError)) {
        warnMissingSchemaOnce("[kickoff completion] missing schema (quote update)", {
          quoteId,
          supplierId,
          error: serializeSupabaseError(updateError),
        });
        return;
      }
      console.error("[kickoff completion] quote update failed", {
        quoteId,
        supplierId,
        error: serializeSupabaseError(updateError),
      });
      return;
    }

    const updated = Array.isArray(updatedRows) && updatedRows.length > 0;
    if (!updated) {
      // Another concurrent request already finalized.
      return;
    }

    // Emit kickoff_completed timeline event (best-effort, but do not throw).
    await emitQuoteEvent({
      quoteId,
      eventType: "kickoff_completed",
      actorRole,
      actorUserId,
      actorSupplierId: actorRole === "supplier" ? supplierId : null,
      metadata: {
        supplierId,
        completedTasks,
        totalTasks,
      },
    });
  } catch (error) {
    if (isMissingTableOrColumnError(error)) {
      warnMissingSchemaOnce("[kickoff completion] missing schema (crash)", {
        quoteId,
        supplierId,
        error: serializeSupabaseError(error),
      });
      return;
    }

    console.error("[kickoff completion] crashed", {
      quoteId,
      supplierId,
      error: serializeSupabaseError(error) ?? error,
    });
  }
}

function warnMissingSchemaOnce(message: string, context: Record<string, unknown>) {
  if (warnedMissingSchema) return;
  warnedMissingSchema = true;
  console.warn(message, context);
}

function normalizeId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeActorRole(value: unknown): QuoteEventActorRole | null {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (
    normalized === "admin" ||
    normalized === "customer" ||
    normalized === "supplier" ||
    normalized === "system"
  ) {
    return normalized;
  }
  return null;
}
