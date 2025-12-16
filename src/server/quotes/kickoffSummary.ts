import { supabaseServer } from "@/lib/supabaseServer";
import {
  isMissingTableOrColumnError,
  serializeSupabaseError,
} from "@/server/admin/logging";

export type CustomerKickoffSummary = {
  totalTasks: number;
  completedTasks: number;
  isComplete: boolean;
};

const KICKOFF_TASKS_TABLE = "quote_kickoff_tasks";

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

    const { data: tasks, error: tasksError } = await supabaseServer
      .from(KICKOFF_TASKS_TABLE)
      .select("completed")
      .eq("quote_id", normalizedQuoteId)
      .eq("supplier_id", supplierId)
      .returns<{ completed: boolean | null }[]>();

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
      ? tasks.reduce((count, task) => count + (task?.completed ? 1 : 0), 0)
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
