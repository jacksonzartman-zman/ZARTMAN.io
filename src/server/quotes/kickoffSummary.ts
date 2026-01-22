import { supabaseServer } from "@/lib/supabaseServer";
import {
  isMissingTableOrColumnError,
  serializeSupabaseError,
} from "@/server/admin/logging";
import { schemaGate } from "@/server/db/schemaContract";

export type CustomerKickoffSummary = {
  totalTasks: number;
  completedTasks: number;
  isComplete: boolean;
};

const QUOTE_KICKOFF_TASKS_TABLE = "quote_kickoff_tasks";
const SUPPLIER_KICKOFF_TASKS_TABLE_RENAMED = "quote_supplier_kickoff_tasks";

/**
 * Customer-safe kickoff summary for a quote.
 *
 * Guardrails:
 * - Aggregate counts only (no task titles/notes)
 * - Failure-safe: returns zeros if schema is missing or a query fails
 */
export async function getCustomerKickoffSummary(
  quoteId: string,
): Promise<CustomerKickoffSummary> {
  const normalizedQuoteId = normalizeId(quoteId);
  if (!normalizedQuoteId) {
    return { totalTasks: 0, completedTasks: 0, isComplete: false };
  }

  try {
    // Determine the awarded supplier so we only aggregate the winner’s checklist.
    const { data: quoteRow, error: quoteError } = await supabaseServer
      .from("quotes")
      .select("awarded_supplier_id,kickoff_completed_at")
      .eq("id", normalizedQuoteId)
      .maybeSingle<{ awarded_supplier_id: string | null; kickoff_completed_at: string | null }>();

    if (quoteError) {
      if (isMissingTableOrColumnError(quoteError)) {
        return { totalTasks: 0, completedTasks: 0, isComplete: false };
      }
      console.error("[customer kickoff summary] quote lookup failed", {
        quoteId: normalizedQuoteId,
        error: serializeSupabaseError(quoteError),
      });
      return { totalTasks: 0, completedTasks: 0, isComplete: false };
    }

    // Authoritative completion bit for back-compat and schema drift.
    const kickoffCompletedAt =
      typeof quoteRow?.kickoff_completed_at === "string" &&
      quoteRow.kickoff_completed_at.trim().length > 0
        ? quoteRow.kickoff_completed_at
        : null;

    const supplierId = normalizeId(quoteRow?.awarded_supplier_id) || null;
    if (!supplierId) {
      return {
        totalTasks: 0,
        completedTasks: 0,
        isComplete: Boolean(kickoffCompletedAt),
      };
    }

    // Prefer legacy supplier-scoped kickoff checklist rows when present (including after rename),
    // since that's what customer kickoff summary historically reflects.
    const supplierChecklistReady = await schemaGate({
      enabled: true,
      relation: SUPPLIER_KICKOFF_TASKS_TABLE_RENAMED,
      requiredColumns: ["quote_id", "supplier_id", "completed"],
      warnPrefix: "[customer kickoff summary]",
      warnKey: "customer_kickoff_summary:supplier_table_schema",
    });

    const table = supplierChecklistReady ? SUPPLIER_KICKOFF_TASKS_TABLE_RENAMED : QUOTE_KICKOFF_TASKS_TABLE;
    const select = supplierChecklistReady ? "completed" : "status";

    const query = supabaseServer
      .from(table)
      .select(select)
      .eq("quote_id", normalizedQuoteId);

    const { data: tasks, error: tasksError } = supplierChecklistReady
      ? await query.eq("supplier_id", supplierId).returns<{ completed: boolean | null }[]>()
      : await query.returns<{ status: string | null }[]>();

    if (tasksError) {
      if (isMissingTableOrColumnError(tasksError)) {
        return {
          totalTasks: 0,
          completedTasks: 0,
          isComplete: Boolean(kickoffCompletedAt),
        };
      }
      console.error("[customer kickoff summary] kickoff tasks load failed", {
        quoteId: normalizedQuoteId,
        supplierId,
        error: serializeSupabaseError(tasksError),
      });
      return {
        totalTasks: 0,
        completedTasks: 0,
        isComplete: Boolean(kickoffCompletedAt),
      };
    }

    const totalTasks = Array.isArray(tasks) ? tasks.length : 0;
    const completedTasks = Array.isArray(tasks)
      ? supplierChecklistReady
        ? (tasks as Array<{ completed: boolean | null }>).reduce(
            (count, task) => count + (task?.completed ? 1 : 0),
            0,
          )
        : (tasks as Array<{ status: string | null }>).reduce(
            (count, task) => count + (normalizeStatus(task?.status) === "complete" ? 1 : 0),
            0,
          )
      : 0;
    const isComplete =
      Boolean(kickoffCompletedAt) || (totalTasks > 0 && completedTasks >= totalTasks);

    return { totalTasks, completedTasks, isComplete };
  } catch (error) {
    if (isMissingTableOrColumnError(error)) {
      return { totalTasks: 0, completedTasks: 0, isComplete: false };
    }
    console.error("[customer kickoff summary] load crashed", {
      quoteId: normalizedQuoteId,
      error: serializeSupabaseError(error) ?? error,
    });
    return { totalTasks: 0, completedTasks: 0, isComplete: false };
  }
}

function normalizeId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeStatus(value: unknown): "pending" | "complete" | "blocked" | null {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (normalized === "pending" || normalized === "complete" || normalized === "blocked") {
    return normalized;
  }
  return null;
}
