import { supabaseServer } from "@/lib/supabaseServer";
import {
  serializeSupabaseError,
  isMissingTableOrColumnError,
} from "@/server/admin/logging";
import {
  type SupplierKickoffTask,
  type KickoffTasksSummary,
  mergeKickoffTasksWithDefaults,
  summarizeKickoffTasks as summarizeKickoffTasksFromLib,
  formatKickoffSummaryLabel as formatKickoffSummaryLabelFromLib,
} from "@/lib/quote/kickoffChecklist";

const TABLE_NAME = "quote_kickoff_tasks";
const SELECT_COLUMNS =
  "id,quote_id,supplier_id,task_key,title,description,completed,sort_order,updated_at";

export type SupplierKickoffTasksResult = {
  ok: boolean;
  tasks: SupplierKickoffTask[];
  error: string | null;
  reason?: "schema-missing" | "load-error" | "missing-identifiers";
};

type QuoteKickoffTaskRow = {
  id: string | null;
  quote_id: string | null;
  supplier_id: string | null;
  task_key: string | null;
  title: string | null;
  description: string | null;
  completed: boolean | null;
  sort_order: number | null;
  updated_at: string | null;
};

export async function loadQuoteKickoffTasksForSupplier(
  quoteId: string,
  supplierId: string,
): Promise<SupplierKickoffTasksResult> {
  const normalizedQuoteId = normalizeId(quoteId);
  const normalizedSupplierId = normalizeId(supplierId);

  if (!normalizedQuoteId || !normalizedSupplierId) {
    return {
      ok: false,
      tasks: [],
      error: "missing-identifiers",
      reason: "missing-identifiers",
    };
  }

  try {
    const { data, error } = await supabaseServer
      .from(TABLE_NAME)
      .select(SELECT_COLUMNS)
      .eq("quote_id", normalizedQuoteId)
      .eq("supplier_id", normalizedSupplierId)
      .order("sort_order", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true, nullsFirst: true })
      .returns<QuoteKickoffTaskRow[]>();

    if (error) {
      const serialized = serializeSupabaseError(error);
      if (isMissingTableOrColumnError(error)) {
        console.warn("[quote kickoff tasks] load missing schema", {
          quoteId: normalizedQuoteId,
          supplierId: normalizedSupplierId,
          error: serialized,
        });
        return {
          ok: false,
          tasks: [],
          error: "schema-missing",
          reason: "schema-missing",
        };
      }
      console.error("[quote kickoff tasks] load failed", {
        quoteId: normalizedQuoteId,
        supplierId: normalizedSupplierId,
        error: serialized,
      });
      return {
        ok: false,
        tasks: [],
        error: "load-error",
        reason: "load-error",
      };
    }

    const rows = Array.isArray(data) ? data : [];
    const tasks = rows
      .map((row) => mapRowToTask(row))
      .filter(
        (task): task is SupplierKickoffTask => Boolean(task?.taskKey?.length),
      );

    console.info("[quote kickoff tasks] load success", {
      quoteId: normalizedQuoteId,
      supplierId: normalizedSupplierId,
      taskCount: tasks.length,
    });

    return {
      ok: true,
      tasks,
      error: null,
    };
  } catch (error) {
    const serialized = serializeSupabaseError(error);
    if (isMissingTableOrColumnError(error)) {
      console.warn("[quote kickoff tasks] load crashed (missing schema)", {
        quoteId: normalizedQuoteId,
        supplierId: normalizedSupplierId,
        error: serialized,
      });
      return {
        ok: false,
        tasks: [],
        error: "schema-missing",
        reason: "schema-missing",
      };
    }
    console.error("[quote kickoff tasks] load crashed", {
      quoteId: normalizedQuoteId,
      supplierId: normalizedSupplierId,
      error: serialized ?? error,
    });
    return {
      ok: false,
      tasks: [],
      error: "load-error",
      reason: "load-error",
    };
  }
}

function mapRowToTask(row: QuoteKickoffTaskRow): SupplierKickoffTask | null {
  if (!row) {
    return null;
  }
  const taskKey =
    typeof row.task_key === "string" ? row.task_key.trim() : undefined;
  if (!taskKey) {
    return null;
  }

  return {
    id: typeof row.id === "string" ? row.id : null,
    taskKey,
    title:
      typeof row.title === "string" && row.title.trim().length > 0
        ? row.title.trim()
        : taskKey,
    description:
      typeof row.description === "string" && row.description.trim().length > 0
        ? row.description.trim()
        : null,
    completed: Boolean(row.completed),
    sortOrder:
      typeof row.sort_order === "number" && Number.isFinite(row.sort_order)
        ? row.sort_order
        : null,
    updatedAt:
      typeof row.updated_at === "string" && row.updated_at.trim().length > 0
        ? row.updated_at
        : null,
  };
}

function normalizeId(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

export function getMergedKickoffTasks(
  tasks: SupplierKickoffTask[] | null | undefined,
): SupplierKickoffTask[] {
  return mergeKickoffTasksWithDefaults(tasks);
}

export {
  summarizeKickoffTasksFromLib as summarizeKickoffTasks,
  formatKickoffSummaryLabelFromLib as formatKickoffSummaryLabel,
};
export type { SupplierKickoffTask, KickoffTasksSummary };
