import { supabaseServer } from "@/lib/supabaseServer";
import {
  serializeSupabaseError,
  isMissingTableOrColumnError,
  isRowLevelSecurityDeniedError,
} from "@/server/admin/logging";
import { normalizeQuoteStatus } from "@/server/quotes/status";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DEFAULT_SUPPLIER_KICKOFF_TASKS,
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
  reason?:
    | "schema-missing"
    | "load-error"
    | "missing-identifiers"
    | "seed-error";
};

export type ToggleSupplierKickoffTaskPayload = {
  quoteId: string;
  supplierId: string;
  taskKey: string;
  title: string;
  description: string | null;
  completed: boolean;
  sortOrder: number | null;
};

export type ToggleSupplierKickoffTaskResult = {
  ok: boolean;
  error: string | null;
  reason?: "schema-missing" | "missing-identifiers" | "denied" | "upsert-error";
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

type KickoffTaskRowsResult =
  | {
      ok: true;
      rows: QuoteKickoffTaskRow[];
      error: null;
    }
  | {
      ok: false;
      rows: QuoteKickoffTaskRow[];
      error: string;
      reason: "schema-missing" | "load-error" | "seed-error";
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

  const initialRows = await fetchKickoffTaskRows(
    normalizedQuoteId,
    normalizedSupplierId,
  );
  if (!initialRows.ok) {
    return {
      ok: false,
      tasks: [],
      error: initialRows.error,
      reason: initialRows.reason,
    };
  }

  let rows = initialRows.rows;

  if (rows.length === 0) {
    const seedResult = await seedKickoffTasks(
      normalizedQuoteId,
      normalizedSupplierId,
    );
    if (!seedResult.ok) {
      return {
        ok: false,
        tasks: [],
        error: seedResult.error,
        reason: seedResult.reason,
      };
    }
    rows = seedResult.rows;
  }

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
}

export async function toggleSupplierKickoffTask(
  payload: ToggleSupplierKickoffTaskPayload,
  options?: { supabase?: SupabaseClient },
): Promise<ToggleSupplierKickoffTaskResult> {
  const quoteId = normalizeId(payload.quoteId);
  const supplierId = normalizeId(payload.supplierId);
  const taskKey = normalizeId(payload.taskKey);

  if (!quoteId || !supplierId || !taskKey) {
    return {
      ok: false,
      error: "missing-identifiers",
      reason: "missing-identifiers",
    };
  }

  const awardCheck = await loadQuoteAwardInfoForKickoff(quoteId);
  if (!awardCheck.ok) {
    if (awardCheck.reason === "schema-missing") {
      return {
        ok: false,
        error: "schema-missing",
        reason: "schema-missing",
      };
    }
    return {
      ok: false,
      error: "upsert-error",
      reason: "upsert-error",
    };
  }

  const awardedSupplierId = awardCheck.awardedSupplierId;
  const quoteStatus = awardCheck.status;
  if (normalizeQuoteStatus(quoteStatus) === "won" && !awardedSupplierId) {
    console.warn("[quote integrity] won quote missing awarded_supplier_id", {
      quoteId,
      status: quoteStatus ?? null,
    });
  }

  if (!awardedSupplierId || awardedSupplierId !== supplierId) {
    console.warn("[kickoff access] denied: not awarded supplier", {
      quoteId,
      quote: { awarded_supplier_id: awardedSupplierId },
      resolved: { supplierId },
    });
    return {
      ok: false,
      error: "denied",
      reason: "denied",
    };
  }

  const now = new Date().toISOString();
  const supabase = options?.supabase ?? supabaseServer;

  try {
    const updatePayload = {
      title: payload.title,
      description: payload.description,
      completed: Boolean(payload.completed),
      sort_order: payload.sortOrder,
      updated_at: now,
    };

    // Prefer UPDATE to avoid INSERT RLS checks for existing rows.
    const {
      data: updatedRows,
      error: updateError,
    } = await supabase
      .from(TABLE_NAME)
      .update(updatePayload)
      .eq("quote_id", quoteId)
      .eq("supplier_id", supplierId)
      .eq("task_key", taskKey)
      .select("id");

    if (updateError) {
      const serialized = serializeSupabaseError(updateError);
      if (isMissingTableOrColumnError(updateError)) {
        console.warn("[quote kickoff tasks] update missing schema", {
          quoteId,
          supplierId,
          taskKey,
          error: serialized,
        });
        return {
          ok: false,
          error: "schema-missing",
          reason: "schema-missing",
        };
      }
      if (isRowLevelSecurityDeniedError(updateError)) {
        console.warn("[quote kickoff tasks] update denied by RLS", {
          quoteId,
          supplierId,
          taskKey,
          error: serialized ?? updateError,
        });
        return {
          ok: false,
          error: "denied",
          reason: "denied",
        };
      }
      console.error("[quote kickoff tasks] update failed", {
        quoteId,
        supplierId,
        taskKey,
        error: serialized,
      });
      return {
        ok: false,
        error: "upsert-error",
        reason: "upsert-error",
      };
    }

    const updatedCount = Array.isArray(updatedRows) ? updatedRows.length : 0;

    if (updatedCount > 0) {
      console.log("[quote kickoff tasks] update success", {
        quoteId,
        supplierId,
        taskKey,
        completed: payload.completed,
      });

      return {
        ok: true,
        error: null,
      };
    }

    // Fallback: row wasn't present (should be rare if tasks were seeded). Insert explicitly.
    const { error: insertError } = await supabase.from(TABLE_NAME).insert({
      quote_id: quoteId,
      supplier_id: supplierId,
      task_key: taskKey,
      ...updatePayload,
    });

    if (insertError) {
      const serialized = serializeSupabaseError(insertError);
      if (isMissingTableOrColumnError(insertError)) {
        console.warn("[quote kickoff tasks] insert missing schema", {
          quoteId,
          supplierId,
          taskKey,
          error: serialized,
        });
        return {
          ok: false,
          error: "schema-missing",
          reason: "schema-missing",
        };
      }
      if (isRowLevelSecurityDeniedError(insertError)) {
        console.warn("[quote kickoff tasks] insert denied by RLS", {
          quoteId,
          supplierId,
          taskKey,
          error: serialized ?? insertError,
        });
        return {
          ok: false,
          error: "denied",
          reason: "denied",
        };
      }
      console.error("[quote kickoff tasks] insert failed", {
        quoteId,
        supplierId,
        taskKey,
        error: serialized,
      });
      return {
        ok: false,
        error: "upsert-error",
        reason: "upsert-error",
      };
    }

    console.log("[quote kickoff tasks] insert success", {
      quoteId,
      supplierId,
      taskKey,
      completed: payload.completed,
    });

    return {
      ok: true,
      error: null,
    };
  } catch (error) {
    const serialized = serializeSupabaseError(error);
    if (isMissingTableOrColumnError(error)) {
      console.warn("[quote kickoff tasks] write crashed (missing schema)", {
        quoteId,
        supplierId,
        taskKey,
        error: serialized,
      });
      return {
        ok: false,
        error: "schema-missing",
        reason: "schema-missing",
      };
    }
    if (isRowLevelSecurityDeniedError(error)) {
      console.warn("[quote kickoff tasks] write denied by RLS", {
        quoteId,
        supplierId,
        taskKey,
        error: serialized ?? error,
      });
      return {
        ok: false,
        error: "denied",
        reason: "denied",
      };
    }
    console.error("[quote kickoff tasks] write crashed", {
      quoteId,
      supplierId,
      taskKey,
      error: serialized ?? error,
    });
    return {
      ok: false,
      error: "upsert-error",
      reason: "upsert-error",
    };
  }
}

type QuoteAwardInfoLookupResult =
  | { ok: true; status: string | null; awardedSupplierId: string | null }
  | {
      ok: false;
      error: string;
      reason: "schema-missing" | "load-error" | "not-found";
    };

async function loadQuoteAwardInfoForKickoff(
  quoteId: string,
): Promise<QuoteAwardInfoLookupResult> {
  try {
    const { data, error } = await supabaseServer
      .from("quotes")
      .select("id,status,awarded_supplier_id")
      .eq("id", quoteId)
      .maybeSingle<{
        id: string;
        status: string | null;
        awarded_supplier_id: string | null;
      }>();

    if (error) {
      const serialized = serializeSupabaseError(error);
      if (isMissingTableOrColumnError(error)) {
        console.warn("[quote kickoff tasks] award info lookup missing schema", {
          quoteId,
          error: serialized,
        });
        return { ok: false, error: "schema-missing", reason: "schema-missing" };
      }
      console.error("[quote kickoff tasks] award info lookup failed", {
        quoteId,
        error: serialized ?? error,
      });
      return { ok: false, error: "load-error", reason: "load-error" };
    }

    if (!data?.id) {
      return { ok: false, error: "not-found", reason: "not-found" };
    }

    const awardedSupplierId = normalizeId(data.awarded_supplier_id) || null;
    const status = typeof data.status === "string" ? data.status : null;
    return { ok: true, status, awardedSupplierId };
  } catch (error) {
    const serialized = serializeSupabaseError(error);
    if (isMissingTableOrColumnError(error)) {
      return { ok: false, error: "schema-missing", reason: "schema-missing" };
    }
    console.error("[quote kickoff tasks] award info lookup crashed", {
      quoteId,
      error: serialized ?? error,
    });
    return { ok: false, error: "load-error", reason: "load-error" };
  }
}

async function fetchKickoffTaskRows(
  quoteId: string,
  supplierId: string,
): Promise<KickoffTaskRowsResult> {
  try {
    const { data, error } = await supabaseServer
      .from(TABLE_NAME)
      .select(SELECT_COLUMNS)
      .eq("quote_id", quoteId)
      .eq("supplier_id", supplierId)
      .order("sort_order", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true, nullsFirst: true })
      .returns<QuoteKickoffTaskRow[]>();

    if (error) {
      const serialized = serializeSupabaseError(error);
      if (isMissingTableOrColumnError(error)) {
        console.warn("[quote kickoff tasks] load missing schema", {
          quoteId,
          supplierId,
          error: serialized,
        });
        return {
          ok: false,
          rows: [],
          error: "schema-missing",
          reason: "schema-missing",
        };
      }
      console.error("[quote kickoff tasks] load failed", {
        quoteId,
        supplierId,
        error: serialized,
      });
      return {
        ok: false,
        rows: [],
        error: "load-error",
        reason: "load-error",
      };
    }

    return {
      ok: true,
      rows: Array.isArray(data) ? data : [],
      error: null,
    };
  } catch (error) {
    const serialized = serializeSupabaseError(error);
    if (isMissingTableOrColumnError(error)) {
      console.warn("[quote kickoff tasks] load crashed (missing schema)", {
        quoteId,
        supplierId,
        error: serialized,
      });
      return {
        ok: false,
        rows: [],
        error: "schema-missing",
        reason: "schema-missing",
      };
    }
    console.error("[quote kickoff tasks] load crashed", {
      quoteId,
      supplierId,
      error: serialized ?? error,
    });
    return {
      ok: false,
      rows: [],
      error: "load-error",
      reason: "load-error",
    };
  }
}

async function seedKickoffTasks(
  quoteId: string,
  supplierId: string,
): Promise<KickoffTaskRowsResult> {
  const seedRows = DEFAULT_SUPPLIER_KICKOFF_TASKS.map((definition) => ({
    quote_id: quoteId,
    supplier_id: supplierId,
    task_key: definition.taskKey,
    title: definition.title,
    description: definition.description ?? null,
    completed: false,
    sort_order: definition.sortOrder ?? null,
  }));

  if (seedRows.length === 0) {
    return {
      ok: true,
      rows: [],
      error: null,
    };
  }

  try {
    const { error } = await supabaseServer
      .from(TABLE_NAME)
      .upsert(seedRows, { onConflict: "quote_id,supplier_id,task_key" });

    if (error) {
      const serialized = serializeSupabaseError(error);
      if (isMissingTableOrColumnError(error)) {
        console.warn("[quote kickoff tasks] seed missing schema", {
          quoteId,
          supplierId,
          error: serialized,
        });
        return {
          ok: false,
          rows: [],
          error: "schema-missing",
          reason: "schema-missing",
        };
      }
      console.error("[quote kickoff tasks] seed failed", {
        quoteId,
        supplierId,
        error: serialized,
      });
      return {
        ok: false,
        rows: [],
        error: "seed-error",
        reason: "seed-error",
      };
    }

    console.info("[quote kickoff tasks] seeded defaults", {
      quoteId,
      supplierId,
      count: seedRows.length,
    });

    return fetchKickoffTaskRows(quoteId, supplierId);
  } catch (error) {
    const serialized = serializeSupabaseError(error);
    if (isMissingTableOrColumnError(error)) {
      console.warn("[quote kickoff tasks] seed crashed (missing schema)", {
        quoteId,
        supplierId,
        error: serialized,
      });
      return {
        ok: false,
        rows: [],
        error: "schema-missing",
        reason: "schema-missing",
      };
    }
    console.error("[quote kickoff tasks] seed crashed", {
      quoteId,
      supplierId,
      error: serialized ?? error,
    });
    return {
      ok: false,
      rows: [],
      error: "seed-error",
      reason: "seed-error",
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
