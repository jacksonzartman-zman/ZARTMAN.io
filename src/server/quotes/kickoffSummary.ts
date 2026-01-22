import { supabaseServer } from "@/lib/supabaseServer";
import {
  isMissingTableOrColumnError,
  serializeSupabaseError,
} from "@/server/admin/logging";
import { schemaGate } from "@/server/db/schemaContract";

export type CustomerKickoffSummary = {
  totalTasks: number;
  completedTasks: number;
  blockedTasks: number;
  /**
   * Customer-safe: title only (no internal notes / reasons).
   * Null when no pending tasks are known (complete, or tasks unavailable).
   */
  nextPendingTaskTitle: string | null;
  isComplete: boolean;
};

// Phase 18.2.1: quote-level kickoff tasks (pending/blocked/complete).
const QUOTE_KICKOFF_TASKS_TABLE = "quote_kickoff_tasks";
// Legacy supplier-scoped kickoff checklist table (renamed in some environments).
const SUPPLIER_KICKOFF_TASKS_TABLE_RENAMED = "quote_supplier_kickoff_tasks";
const SUPPLIER_KICKOFF_TASKS_TABLE_LEGACY = "quote_kickoff_tasks";

/**
 * Customer-safe kickoff summary for a quote.
 *
 * Guardrails:
 * - Aggregate counts only + safe next-step title (no descriptions / reasons)
 * - Failure-safe: returns zeros if schema is missing or a query fails
 */
export async function getCustomerKickoffSummary(
  quoteId: string,
  preload?: {
    awardedSupplierId?: string | null;
    kickoffCompletedAt?: string | null;
  },
): Promise<CustomerKickoffSummary> {
  const normalizedQuoteId = normalizeId(quoteId);
  if (!normalizedQuoteId) {
    return {
      totalTasks: 0,
      completedTasks: 0,
      blockedTasks: 0,
      nextPendingTaskTitle: null,
      isComplete: false,
    };
  }

  try {
    const kickoffCompletedAt =
      typeof preload?.kickoffCompletedAt === "string" && preload.kickoffCompletedAt.trim()
        ? preload.kickoffCompletedAt.trim()
        : null;

    // Prefer quote-level kickoff tasks when available (Phase 18.2.1+).
    const quoteKickoffReady = await schemaGate({
      enabled: true,
      relation: QUOTE_KICKOFF_TASKS_TABLE,
      requiredColumns: ["quote_id", "task_key", "title", "sort_order", "status"],
      warnPrefix: "[customer kickoff summary]",
      warnKey: "customer_kickoff_summary:quote_tasks_schema",
    });

    if (quoteKickoffReady) {
      type Row = {
        status: string | null;
        title: string | null;
        sort_order: number | null;
        task_key: string | null;
      };

      const { data, error } = await supabaseServer
        .from(QUOTE_KICKOFF_TASKS_TABLE)
        .select("status,title,sort_order,task_key")
        .eq("quote_id", normalizedQuoteId)
        .order("sort_order", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: true, nullsFirst: true } as any)
        .returns<Row[]>();

      if (error) {
        if (isMissingTableOrColumnError(error)) {
          return {
            totalTasks: 0,
            completedTasks: 0,
            blockedTasks: 0,
            nextPendingTaskTitle: null,
            isComplete: Boolean(kickoffCompletedAt),
          };
        }
        console.error("[customer kickoff summary] quote kickoff tasks load failed", {
          quoteId: normalizedQuoteId,
          error: serializeSupabaseError(error),
        });
        return {
          totalTasks: 0,
          completedTasks: 0,
          blockedTasks: 0,
          nextPendingTaskTitle: null,
          isComplete: Boolean(kickoffCompletedAt),
        };
      }

      const tasks = Array.isArray(data) ? data : [];
      const totalTasks = tasks.length;
      let completedTasks = 0;
      let blockedTasks = 0;
      let nextPendingTaskTitle: string | null = null;

      for (const row of tasks) {
        const status = normalizeStatus(row?.status);
        if (status === "complete") completedTasks += 1;
        if (status === "blocked") blockedTasks += 1;
        if (nextPendingTaskTitle === null && status === "pending") {
          const title = typeof row?.title === "string" ? row.title.trim() : "";
          const fallback = typeof row?.task_key === "string" ? row.task_key.trim() : "";
          nextPendingTaskTitle = title || fallback || null;
        }
      }

      const isComplete =
        Boolean(kickoffCompletedAt) || (totalTasks > 0 && completedTasks >= totalTasks);

      return {
        totalTasks,
        completedTasks,
        blockedTasks,
        nextPendingTaskTitle,
        isComplete,
      };
    }

    // Back-compat fallback: supplier-scoped kickoff tasks (completed boolean only).
    const supplierSchemaReadyLegacy = await schemaGate({
      enabled: true,
      relation: SUPPLIER_KICKOFF_TASKS_TABLE_LEGACY,
      requiredColumns: ["quote_id", "supplier_id", "task_key", "title", "completed", "sort_order"],
      warnPrefix: "[customer kickoff summary]",
      warnKey: "customer_kickoff_summary:supplier_tasks_legacy_schema",
    });

    const supplierSchemaReadyRenamed = supplierSchemaReadyLegacy
      ? false
      : await schemaGate({
          enabled: true,
          relation: SUPPLIER_KICKOFF_TASKS_TABLE_RENAMED,
          requiredColumns: ["quote_id", "supplier_id", "task_key", "title", "completed", "sort_order"],
          warnPrefix: "[customer kickoff summary]",
          warnKey: "customer_kickoff_summary:supplier_tasks_renamed_schema",
        });

    const supplierTable = supplierSchemaReadyLegacy
      ? SUPPLIER_KICKOFF_TASKS_TABLE_LEGACY
      : supplierSchemaReadyRenamed
        ? SUPPLIER_KICKOFF_TASKS_TABLE_RENAMED
        : null;

    // Determine awarded supplier id (best-effort) so we only aggregate the winner’s checklist.
    const preloadSupplierId = normalizeId(preload?.awardedSupplierId) || null;
    let supplierId = preloadSupplierId;
    if (!supplierId) {
      // Avoid referencing missing columns: only select kickoff_completed_at if present.
      const hasKickoffCompletedAt = await schemaGate({
        enabled: true,
        relation: "quotes",
        requiredColumns: ["kickoff_completed_at"],
        warnPrefix: "[customer kickoff summary]",
        warnKey: "customer_kickoff_summary:quotes_kickoff_completed_at",
      });
      const select = hasKickoffCompletedAt
        ? "awarded_supplier_id,kickoff_completed_at"
        : "awarded_supplier_id";
      const { data: quoteRow, error: quoteError } = await supabaseServer
        .from("quotes")
        .select(select)
        .eq("id", normalizedQuoteId)
        .maybeSingle<{ awarded_supplier_id: string | null; kickoff_completed_at?: string | null }>();

      if (quoteError) {
        if (isMissingTableOrColumnError(quoteError)) {
          return {
            totalTasks: 0,
            completedTasks: 0,
            blockedTasks: 0,
            nextPendingTaskTitle: null,
            isComplete: Boolean(kickoffCompletedAt),
          };
        }
        console.error("[customer kickoff summary] quote lookup failed", {
          quoteId: normalizedQuoteId,
          error: serializeSupabaseError(quoteError),
        });
        return {
          totalTasks: 0,
          completedTasks: 0,
          blockedTasks: 0,
          nextPendingTaskTitle: null,
          isComplete: Boolean(kickoffCompletedAt),
        };
      }

      supplierId = normalizeId(quoteRow?.awarded_supplier_id) || null;
    }

    if (!supplierId || !supplierTable) {
      return {
        totalTasks: 0,
        completedTasks: 0,
        blockedTasks: 0,
        nextPendingTaskTitle: null,
        isComplete: Boolean(kickoffCompletedAt),
      };
    }

    type SupplierRow = {
      completed: boolean | null;
      title: string | null;
      task_key: string | null;
      sort_order: number | null;
    };
    const { data: supplierTasks, error: tasksError } = await supabaseServer
      .from(supplierTable)
      .select("completed,title,task_key,sort_order")
      .eq("quote_id", normalizedQuoteId)
      .eq("supplier_id", supplierId)
      .order("sort_order", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true, nullsFirst: true } as any)
      .returns<SupplierRow[]>();

    if (tasksError) {
      if (isMissingTableOrColumnError(tasksError)) {
        return {
          totalTasks: 0,
          completedTasks: 0,
          blockedTasks: 0,
          nextPendingTaskTitle: null,
          isComplete: Boolean(kickoffCompletedAt),
        };
      }
      console.error("[customer kickoff summary] supplier kickoff tasks load failed", {
        quoteId: normalizedQuoteId,
        supplierId,
        error: serializeSupabaseError(tasksError),
      });
      return {
        totalTasks: 0,
        completedTasks: 0,
        blockedTasks: 0,
        nextPendingTaskTitle: null,
        isComplete: Boolean(kickoffCompletedAt),
      };
    }

    const rows = Array.isArray(supplierTasks) ? supplierTasks : [];
    const totalTasks = rows.length;
    const completedTasks = rows.reduce((count, task) => count + (task?.completed ? 1 : 0), 0);
    const nextPendingTaskTitle =
      rows.find((row) => !row?.completed)?.title?.trim() ||
      rows.find((row) => !row?.completed)?.task_key?.trim() ||
      null;
    const isComplete =
      Boolean(kickoffCompletedAt) || (totalTasks > 0 && completedTasks >= totalTasks);

    return {
      totalTasks,
      completedTasks,
      blockedTasks: 0,
      nextPendingTaskTitle,
      isComplete,
    };
  } catch (error) {
    if (isMissingTableOrColumnError(error)) {
      return {
        totalTasks: 0,
        completedTasks: 0,
        blockedTasks: 0,
        nextPendingTaskTitle: null,
        isComplete: false,
      };
    }
    console.error("[customer kickoff summary] load crashed", {
      quoteId: normalizedQuoteId,
      error: serializeSupabaseError(error) ?? error,
    });
    return {
      totalTasks: 0,
      completedTasks: 0,
      blockedTasks: 0,
      nextPendingTaskTitle: null,
      isComplete: false,
    };
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
