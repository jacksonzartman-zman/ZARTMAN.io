import { supabaseServer } from "@/lib/supabaseServer";
import {
  serializeSupabaseError,
  isMissingTableOrColumnError,
  isRowLevelSecurityDeniedError,
} from "@/server/admin/logging";
import { schemaGate } from "@/server/db/schemaContract";
import { logOpsEvent } from "@/server/ops/events";
import {
  requireAdminUser,
  requireUser,
  UnauthorizedError,
} from "@/server/auth";
import { loadSupplierProfileByUserId } from "@/server/suppliers";
import { assertSupplierQuoteAccess } from "@/server/quotes/access";
import { emitQuoteEvent } from "@/server/quotes/events";
import type { QuoteEventActorRole } from "@/server/quotes/events";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DEFAULT_SUPPLIER_KICKOFF_TASKS,
  type SupplierKickoffTask,
  type KickoffTasksSummary,
  mergeKickoffTasksWithDefaults,
  summarizeKickoffTasks as summarizeKickoffTasksFromLib,
  formatKickoffSummaryLabel as formatKickoffSummaryLabelFromLib,
} from "@/lib/quote/kickoffChecklist";

// NOTE:
// This repo historically used `quote_kickoff_tasks` for a supplier-scoped checklist.
// Phase 18.2.1 introduces a quote-level kickoff task system using the same relation name.
// The migration renames the legacy table to `quote_supplier_kickoff_tasks`.
const QUOTE_KICKOFF_TASKS_TABLE = "quote_kickoff_tasks";
const SUPPLIER_KICKOFF_TASKS_TABLE_LEGACY = "quote_kickoff_tasks";
const SUPPLIER_KICKOFF_TASKS_TABLE_RENAMED = "quote_supplier_kickoff_tasks";

async function resolveSupplierKickoffTasksTableName(): Promise<string> {
  const requiredColumns = ["quote_id", "supplier_id", "task_key", "title", "completed"];
  const legacyOk = await schemaGate({
    enabled: true,
    relation: SUPPLIER_KICKOFF_TASKS_TABLE_LEGACY,
    requiredColumns,
    warnPrefix: "[kickoff supplier tasks]",
    warnKey: "kickoff_supplier_tasks:legacy_schema",
  });
  if (legacyOk) return SUPPLIER_KICKOFF_TASKS_TABLE_LEGACY;

  const renamedOk = await schemaGate({
    enabled: true,
    relation: SUPPLIER_KICKOFF_TASKS_TABLE_RENAMED,
    requiredColumns,
    warnPrefix: "[kickoff supplier tasks]",
    warnKey: "kickoff_supplier_tasks:renamed_schema",
  });
  if (renamedOk) return SUPPLIER_KICKOFF_TASKS_TABLE_RENAMED;

  // Fallback: let call-sites handle missing schema errors.
  return SUPPLIER_KICKOFF_TASKS_TABLE_LEGACY;
}

const SELECT_COLUMNS_V1 =
  "id,quote_id,supplier_id,task_key,title,description,completed,sort_order,updated_at";
const SELECT_COLUMNS_V2 =
  "id,quote_id,supplier_id,task_key,title,description,completed,completed_at,completed_by_user_id,completed_by_role,sort_order,updated_at";

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
  completedAt?: string | null;
  completedByUserId?: string | null;
  completedByRole?: "admin" | "supplier" | "system" | null;
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
  completed_at?: string | null;
  completed_by_user_id?: string | null;
  completed_by_role?: string | null;
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

export type EnsureKickoffTasksForQuoteResult =
  | {
      ok: true;
      /**
       * True when this call created the kickoff checklist rows for the first time.
       * (Used to drive a single timeline event.)
       */
      created: boolean;
      taskCount: number;
      supplierId: string | null;
      error: null;
    }
  | {
      ok: false;
      created: false;
      taskCount: 0;
      supplierId: string | null;
      error: string;
      reason: "missing-identifiers" | "not-awarded" | "schema-missing" | "seed-error";
    };

export type EnsureKickoffTasksForAwardedSupplierInput = {
  quoteId: string;
  actorRole?: QuoteEventActorRole | null;
  actorUserId?: string | null;
};

export type EnsureKickoffTasksForAwardedSupplierResult =
  | {
      ok: true;
      created: boolean;
      taskCount: number;
      supplierId: string;
      error: null;
    }
  | {
      ok: false;
      created: false;
      taskCount: 0;
      supplierId: string | null;
      error: string;
      reason: "missing-identifiers" | "not-awarded" | "schema-missing" | "seed-error";
    };

export async function loadQuoteKickoffTasksForSupplier(
  quoteId: string,
  supplierId: string,
  options?: { seedIfEmpty?: boolean },
): Promise<SupplierKickoffTasksResult> {
  const normalizedQuoteId = normalizeId(quoteId);
  const normalizedSupplierId = normalizeId(supplierId);
  const seedIfEmpty = options?.seedIfEmpty !== false;

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
    if (seedIfEmpty) {
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
  }

  const tasks = rows
    .map((row) => mapRowToTask(row))
    .filter(
      (task): task is SupplierKickoffTask => Boolean(task?.taskKey?.length),
    );

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

  const now = new Date().toISOString();
  const supabase = options?.supabase ?? supabaseServer;
  const supplierTasksTable = await resolveSupplierKickoffTasksTableName();

  try {
    const baseUpdatePayload: Record<string, unknown> = {
      title: payload.title,
      description: payload.description,
      completed: Boolean(payload.completed),
      sort_order: payload.sortOrder,
      updated_at: now,
    };

    const completedAt =
      typeof payload.completedAt === "string" && payload.completedAt.trim().length > 0
        ? payload.completedAt
        : null;
    const completedByUserId =
      typeof payload.completedByUserId === "string" && payload.completedByUserId.trim().length > 0
        ? payload.completedByUserId
        : null;
    const completedByRole =
      typeof payload.completedByRole === "string" && payload.completedByRole.trim().length > 0
        ? payload.completedByRole
        : null;

    const updatePayloadWithCompletion = {
      ...baseUpdatePayload,
      completed_at: Boolean(payload.completed) ? completedAt ?? now : null,
      completed_by_user_id: Boolean(payload.completed) ? completedByUserId : null,
      completed_by_role: Boolean(payload.completed) ? completedByRole : null,
    };

    // Prefer UPDATE to avoid INSERT RLS checks for existing rows.
    const updateAttempt = async (updatePayload: Record<string, unknown>) =>
      supabase
        .from(supplierTasksTable)
        .update(updatePayload)
        .eq("quote_id", quoteId)
        .eq("supplier_id", supplierId)
        .eq("task_key", taskKey)
        .select("id");

    const attemptV2 = await updateAttempt(updatePayloadWithCompletion);
    let updatedRows = attemptV2.data;
    let updateError = attemptV2.error;

    if (updateError && isMissingTableOrColumnError(updateError)) {
      const attemptV1 = await updateAttempt(baseUpdatePayload);
      updatedRows = attemptV1.data;
      updateError = attemptV1.error;
    }

    if (updateError) {
      const serialized = serializeSupabaseError(updateError);
      if (isMissingTableOrColumnError(updateError)) {
        return {
          ok: false,
          error: "schema-missing",
          reason: "schema-missing",
        };
      }
      if (isRowLevelSecurityDeniedError(updateError)) {
        return {
          ok: false,
          error: "denied",
          reason: "denied",
        };
      }
      return {
        ok: false,
        error: "upsert-error",
        reason: "upsert-error",
      };
    }

    const updatedCount = Array.isArray(updatedRows) ? updatedRows.length : 0;

    if (updatedCount > 0) {
      return {
        ok: true,
        error: null,
      };
    }

    // Fallback: row wasn't present (should be rare if tasks were seeded). Insert explicitly.
    const insertPayloadWithCompletion = {
      quote_id: quoteId,
      supplier_id: supplierId,
      task_key: taskKey,
      ...updatePayloadWithCompletion,
    };
    const insertPayloadWithoutCompletion = {
      quote_id: quoteId,
      supplier_id: supplierId,
      task_key: taskKey,
      ...baseUpdatePayload,
    };

    const insertAttempt = async (insertPayload: Record<string, unknown>) =>
      supabase.from(supplierTasksTable).insert(insertPayload);

    const attemptInsertV2 = await insertAttempt(insertPayloadWithCompletion);
    let insertError = attemptInsertV2.error;

    if (insertError && isMissingTableOrColumnError(insertError)) {
      const attemptInsertV1 = await insertAttempt(insertPayloadWithoutCompletion);
      insertError = attemptInsertV1.error;
    }

    if (insertError) {
      const serialized = serializeSupabaseError(insertError);
      if (isMissingTableOrColumnError(insertError)) {
        return {
          ok: false,
          error: "schema-missing",
          reason: "schema-missing",
        };
      }
      if (isRowLevelSecurityDeniedError(insertError)) {
        return {
          ok: false,
          error: "denied",
          reason: "denied",
        };
      }
      return {
        ok: false,
        error: "upsert-error",
        reason: "upsert-error",
      };
    }

    return {
      ok: true,
      error: null,
    };
  } catch (error) {
    const serialized = serializeSupabaseError(error);
    if (isMissingTableOrColumnError(error)) {
      return {
        ok: false,
        error: "schema-missing",
        reason: "schema-missing",
      };
    }
    if (isRowLevelSecurityDeniedError(error)) {
      return {
        ok: false,
        error: "denied",
        reason: "denied",
      };
    }
    return {
      ok: false,
      error: "upsert-error",
      reason: "upsert-error",
    };
  }
}

type QuoteAwardFields = {
  id: string;
  awarded_bid_id: string | null;
  awarded_supplier_id: string | null;
  awarded_at: string | null;
};

export function isKickoffReadyForSupplier(args: {
  quote: Pick<QuoteAwardFields, "awarded_supplier_id" | "awarded_at" | "awarded_bid_id">;
  supplierId: string;
}): boolean {
  const quoteSupplierId = normalizeId(args.quote?.awarded_supplier_id);
  const supplierId = normalizeId(args.supplierId);

  if (!quoteSupplierId || !supplierId || quoteSupplierId !== supplierId) {
    return false;
  }

  return Boolean(normalizeId(args.quote?.awarded_at)) && Boolean(normalizeId(args.quote?.awarded_bid_id));
}

type QuoteAwardInfoLookupResult =
  | { ok: true; quote: QuoteAwardFields }
  | {
      ok: false;
      error: string;
      reason: "schema-missing" | "load-error" | "not-found";
    };

async function loadQuoteAwardFieldsForKickoff(
  quoteId: string,
): Promise<QuoteAwardInfoLookupResult> {
  try {
    const { data, error } = await supabaseServer
      .from("quotes")
      .select("id,awarded_bid_id,awarded_supplier_id,awarded_at")
      .eq("id", quoteId)
      .maybeSingle<QuoteAwardFields>();

    if (error) {
      const serialized = serializeSupabaseError(error);
      if (isMissingTableOrColumnError(error)) {
        console.warn("[kickoff] award info lookup missing schema", {
          quoteId,
          pgCode: (error as { code?: string | null })?.code ?? null,
          message: (error as { message?: string | null })?.message ?? null,
        });
        return { ok: false, error: "schema-missing", reason: "schema-missing" };
      }
      console.error("[kickoff] award info lookup failed", {
        quoteId,
        pgCode: (error as { code?: string | null })?.code ?? null,
        message: (error as { message?: string | null })?.message ?? null,
      });
      return { ok: false, error: "load-error", reason: "load-error" };
    }

    if (!data?.id) {
      return { ok: false, error: "not-found", reason: "not-found" };
    }

    return { ok: true, quote: data };
  } catch (error) {
    const serialized = serializeSupabaseError(error);
    if (isMissingTableOrColumnError(error)) {
      return { ok: false, error: "schema-missing", reason: "schema-missing" };
    }
    console.error("[kickoff] award info lookup crashed", {
      quoteId,
      pgCode: (error as { code?: string | null })?.code ?? null,
      message: (error as { message?: string | null })?.message ?? null,
    });
    return { ok: false, error: "load-error", reason: "load-error" };
  }
}

async function fetchKickoffTaskRows(
  quoteId: string,
  supplierId: string,
): Promise<KickoffTaskRowsResult> {
  const supplierTasksTable = await resolveSupplierKickoffTasksTableName();
  try {
    const selectAttempt = async (columns: string) =>
      supabaseServer
        .from(supplierTasksTable)
        .select(columns)
        .eq("quote_id", quoteId)
        .eq("supplier_id", supplierId)
        .order("sort_order", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: true, nullsFirst: true })
        .returns<QuoteKickoffTaskRow[]>();

    const attemptV2 = await selectAttempt(SELECT_COLUMNS_V2);
    let data = attemptV2.data;
    let error = attemptV2.error;

    if (error && isMissingTableOrColumnError(error)) {
      const attemptV1 = await selectAttempt(SELECT_COLUMNS_V1);
      data = attemptV1.data;
      error = attemptV1.error;
    }

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
  const supplierTasksTable = await resolveSupplierKickoffTasksTableName();
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
      .from(supplierTasksTable)
      .upsert(seedRows, {
        onConflict: "quote_id,supplier_id,task_key",
        // Critical: do not overwrite any existing task completion state.
        ignoreDuplicates: true,
      });

    if (error) {
      const serialized = serializeSupabaseError(error);
      if (isMissingTableOrColumnError(error)) {
        return {
          ok: false,
          rows: [],
          error: "schema-missing",
          reason: "schema-missing",
        };
      }
      return {
        ok: false,
        rows: [],
        error: "seed-error",
        reason: "seed-error",
      };
    }

    return fetchKickoffTaskRows(quoteId, supplierId);
  } catch (error) {
    const serialized = serializeSupabaseError(error);
    if (isMissingTableOrColumnError(error)) {
      return {
        ok: false,
        rows: [],
        error: "schema-missing",
        reason: "schema-missing",
      };
    }
    return {
      ok: false,
      rows: [],
      error: "seed-error",
      reason: "seed-error",
    };
  }
}

/**
 * Idempotently ensures the default supplier kickoff tasks exist for the awarded quote.
 *
 * - Uses the existing unique constraint (quote_id, supplier_id, task_key).
 * - Inserts missing default tasks without overwriting existing rows.
 * - Emits a single timeline event ("kickoff_started") only when tasks are first created.
 *
 * This is intended to run from server/service-role pathways (e.g. award flow).
 */
export async function ensureKickoffTasksForQuote(
  quoteId: string,
  actor?: {
    actorRole?: QuoteEventActorRole | null;
    actorUserId?: string | null;
  },
): Promise<EnsureKickoffTasksForQuoteResult> {
  const normalizedQuoteId = normalizeId(quoteId);

  if (!normalizedQuoteId) {
    return {
      ok: false,
      created: false,
      taskCount: 0,
      supplierId: null,
      error: "missing-identifiers",
      reason: "missing-identifiers",
    };
  }

  const actorRole = normalizeKickoffActorRole(actor?.actorRole);
  const actorUserId =
    actorRole === "system" ? null : normalizeId(actor?.actorUserId) || null;

  const awardInfo = await loadQuoteAwardFieldsForKickoff(normalizedQuoteId);
  if (!awardInfo.ok) {
    return {
      ok: false,
      created: false,
      taskCount: 0,
      supplierId: null,
      error: awardInfo.error,
      reason: awardInfo.reason === "schema-missing" ? "schema-missing" : "seed-error",
    };
  }

  const supplierId = normalizeId(awardInfo.quote.awarded_supplier_id) || null;
  const awardedAt = normalizeId(awardInfo.quote.awarded_at) || null;
  const awardedBidId = normalizeId(awardInfo.quote.awarded_bid_id) || null;

  if (!supplierId || !awardedAt || !awardedBidId) {
    return {
      ok: false,
      created: false,
      taskCount: 0,
      supplierId: null,
      error: "not-awarded",
      reason: "not-awarded",
    };
  }

  const supplierTasksTable = await resolveSupplierKickoffTasksTableName();
  const seedRows = DEFAULT_SUPPLIER_KICKOFF_TASKS.map((definition) => ({
    quote_id: normalizedQuoteId,
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
      created: false,
      taskCount: 0,
      supplierId: supplierId ?? null,
      error: null,
    };
  }

  // Determine if tasks existed before this run (best-effort). We only emit the
  // kickoff_started event when we are confident this is the first creation.
  let hadExistingTasks: boolean | null = null;
  try {
    const { data: existingRows, error } = await supabaseServer
      .from(supplierTasksTable)
      .select("id")
      .eq("quote_id", normalizedQuoteId)
      .eq("supplier_id", supplierId)
      .limit(1);
    if (!error) {
      hadExistingTasks = (existingRows ?? []).length > 0;
    }
  } catch (error) {
    // Best-effort only; avoid noisy logs here.
  }

  try {
    const { data: insertedRows, error } = await supabaseServer
      .from(supplierTasksTable)
      .upsert(seedRows, {
        onConflict: "quote_id,supplier_id,task_key",
        // Critical: don't overwrite existing task state.
        ignoreDuplicates: true,
      })
      .select("id")
      .returns<{ id: string }[]>();

    if (error) {
      if (isMissingTableOrColumnError(error)) {
        console.warn("[kickoff] ensure failed (missing schema)", {
          quoteId: normalizedQuoteId,
          supplierId,
          pgCode: (error as { code?: string | null })?.code ?? null,
          message: (error as { message?: string | null })?.message ?? null,
        });
        return {
          ok: false,
          created: false,
          taskCount: 0,
          supplierId,
          error: "schema-missing",
          reason: "schema-missing",
        };
      }
      console.error("[kickoff] ensure failed", {
        quoteId: normalizedQuoteId,
        supplierId,
        pgCode: (error as { code?: string | null })?.code ?? null,
        message: (error as { message?: string | null })?.message ?? null,
      });
      return {
        ok: false,
        created: false,
        taskCount: 0,
        supplierId,
        error: "seed-error",
        reason: "seed-error",
      };
    }

    const createdCount = Array.isArray(insertedRows) ? insertedRows.length : 0;

    const createdForFirstTime = hadExistingTasks === false && createdCount > 0;
    if (createdForFirstTime) {
      // Prevent accidental duplicate timeline events in case of retries/races.
      let kickoffEventAlreadyExists = false;
      try {
        const { data: existingEventRows, error: existingEventError } =
          await supabaseServer
            .from("quote_events")
            .select("id")
            .eq("quote_id", normalizedQuoteId)
            .eq("event_type", "kickoff_started")
            .limit(1);
        if (!existingEventError) {
          kickoffEventAlreadyExists = (existingEventRows ?? []).length > 0;
        }
      } catch {
        // If this check fails, skip the guard and attempt the emit (best-effort).
      }

      // Emit kickoff_started event only when tasks were first created.
      if (!kickoffEventAlreadyExists) {
        // Use the post-write task count so the event reflects the full checklist.
        const seededRows = await fetchKickoffTaskRows(normalizedQuoteId, supplierId);
        const taskCountForEvent = seededRows.ok ? seededRows.rows.length : DEFAULT_SUPPLIER_KICKOFF_TASKS.length;

        void emitQuoteEvent({
          quoteId: normalizedQuoteId,
          eventType: "kickoff_started",
          actorRole,
          actorUserId,
          actorSupplierId: null,
          metadata: { taskCount: taskCountForEvent, source: "award" },
        });
      }
    }

    const refreshed = await fetchKickoffTaskRows(normalizedQuoteId, supplierId);
    const taskCount = refreshed.ok ? refreshed.rows.length : 0;

    return {
      ok: true,
      created: createdForFirstTime,
      taskCount,
      supplierId,
      error: null,
    };
  } catch (error) {
    if (isMissingTableOrColumnError(error)) {
      console.warn("[kickoff] ensure failed (missing schema)", {
        quoteId: normalizedQuoteId,
        supplierId,
        pgCode: (error as { code?: string | null })?.code ?? null,
        message: (error as { message?: string | null })?.message ?? null,
      });
      return {
        ok: false,
        created: false,
        taskCount: 0,
        supplierId,
        error: "schema-missing",
        reason: "schema-missing",
      };
    }
    console.error("[kickoff] ensure crashed", {
      quoteId: normalizedQuoteId,
      supplierId,
      pgCode: (error as { code?: string | null })?.code ?? null,
      message: (error as { message?: string | null })?.message ?? null,
    });
    return {
      ok: false,
      created: false,
      taskCount: 0,
      supplierId,
      error: "seed-error",
      reason: "seed-error",
    };
  }
}

export async function ensureKickoffTasksForAwardedSupplier(
  input: EnsureKickoffTasksForAwardedSupplierInput,
): Promise<EnsureKickoffTasksForAwardedSupplierResult> {
  const quoteId = normalizeId(input.quoteId);
  if (!quoteId) {
    return {
      ok: false,
      created: false,
      taskCount: 0,
      supplierId: null,
      error: "missing-identifiers",
      reason: "missing-identifiers",
    };
  }

  const awardInfo = await loadQuoteAwardFieldsForKickoff(quoteId);
  if (!awardInfo.ok) {
    return {
      ok: false,
      created: false,
      taskCount: 0,
      supplierId: null,
      error: awardInfo.error,
      reason: awardInfo.reason === "schema-missing" ? "schema-missing" : "seed-error",
    };
  }

  const supplierId = normalizeId(awardInfo.quote.awarded_supplier_id) || null;
  const awardedAt = normalizeId(awardInfo.quote.awarded_at) || null;
  const awardedBidId = normalizeId(awardInfo.quote.awarded_bid_id) || null;

  if (!supplierId || !awardedAt || !awardedBidId) {
    return {
      ok: false,
      created: false,
      taskCount: 0,
      supplierId,
      error: "not-awarded",
      reason: "not-awarded",
    };
  }

  const ensured = await ensureKickoffTasksForQuote(quoteId, {
    actorRole: input.actorRole ?? null,
    actorUserId: input.actorUserId ?? null,
  });

  if (!ensured.ok) {
    return {
      ok: false,
      created: false,
      taskCount: 0,
      supplierId: ensured.supplierId ?? supplierId,
      error: ensured.error,
      reason: ensured.reason,
    };
  }

  const ensuredSupplierId = normalizeId(ensured.supplierId) || null;
  if (!ensuredSupplierId || ensuredSupplierId !== supplierId) {
    console.warn("[kickoff] ensure returned mismatched supplier id", {
      quoteId,
      supplierId,
      ensuredSupplierId,
      pgCode: null,
      message: "supplier-id-mismatch",
    });
  }

  return {
    ok: true,
    created: ensured.created,
    taskCount: ensured.taskCount,
    supplierId,
    error: null,
  };
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
    completedAt:
      typeof row.completed_at === "string" && row.completed_at.trim().length > 0
        ? row.completed_at
        : null,
    completedByUserId:
      typeof row.completed_by_user_id === "string" && row.completed_by_user_id.trim().length > 0
        ? row.completed_by_user_id
        : null,
    completedByRole:
      typeof row.completed_by_role === "string" && row.completed_by_role.trim().length > 0
        ? (row.completed_by_role.trim().toLowerCase() as SupplierKickoffTask["completedByRole"])
        : null,
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

function normalizeKickoffActorRole(value: unknown): QuoteEventActorRole {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (
    normalized === "admin" ||
    normalized === "customer" ||
    normalized === "supplier" ||
    normalized === "system"
  ) {
    return normalized;
  }
  return "system";
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

export type QuoteKickoffTaskStatus = "pending" | "complete" | "blocked";

export type QuoteKickoffTask = {
  id: string;
  quoteId: string;
  taskKey: string;
  title: string;
  description: string | null;
  sortOrder: number;
  status: QuoteKickoffTaskStatus;
  completedAt: string | null;
  completedByUserId: string | null;
  blockedReason: string | null;
  createdAt: string;
  updatedAt: string;
};

const DEFAULT_QUOTE_KICKOFF_TASKS: Array<{
  taskKey: string;
  title: string;
  description: string | null;
  sortOrder: number;
}> = [
  {
    taskKey: "review-requirements",
    title: "Review requirements & drawings",
    description: null,
    sortOrder: 1,
  },
  {
    taskKey: "confirm-material",
    title: "Confirm material + finishing",
    description: null,
    sortOrder: 2,
  },
  {
    taskKey: "confirm-leadtime",
    title: "Confirm lead time",
    description: null,
    sortOrder: 3,
  },
  {
    taskKey: "confirm-shipping",
    title: "Confirm shipping / ship-to",
    description: null,
    sortOrder: 4,
  },
  {
    taskKey: "ask-questions",
    title: "Ask questions / clarifications",
    description: null,
    sortOrder: 5,
  },
];

function normalizeQuoteKickoffTaskStatus(value: unknown): QuoteKickoffTaskStatus | null {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (normalized === "pending" || normalized === "complete" || normalized === "blocked") {
    return normalized;
  }
  return null;
}

function normalizeOptionalText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function ensureDefaultKickoffTasksForQuote(
  quoteId: string,
): Promise<{ ok: true; createdCount: number } | { ok: false; error: string }> {
  const normalizedQuoteId = normalizeId(quoteId);
  if (!normalizedQuoteId) {
    return { ok: false, error: "missing-identifiers" };
  }

  const schemaReady = await schemaGate({
    enabled: true,
    relation: QUOTE_KICKOFF_TASKS_TABLE,
    requiredColumns: [
      "quote_id",
      "task_key",
      "title",
      "description",
      "sort_order",
      "status",
      "created_at",
      "updated_at",
    ],
    warnPrefix: "[kickoff quote tasks]",
    warnKey: "kickoff_quote_tasks:missing_schema",
  });
  if (!schemaReady) {
    return { ok: false, error: "schema-missing" };
  }

  const seedRows = DEFAULT_QUOTE_KICKOFF_TASKS.map((task) => ({
    quote_id: normalizedQuoteId,
    task_key: task.taskKey,
    title: task.title,
    description: task.description,
    sort_order: task.sortOrder,
    status: "pending",
  }));

  try {
    const { data, error } = await supabaseServer
      .from(QUOTE_KICKOFF_TASKS_TABLE)
      .upsert(seedRows, {
        onConflict: "quote_id,task_key",
        ignoreDuplicates: true,
      })
      .select("id")
      .returns<Array<{ id: string }>>();

    if (error) {
      if (isMissingTableOrColumnError(error)) {
        return { ok: false, error: "schema-missing" };
      }
      console.error("[kickoff quote tasks] seed failed", {
        quoteId: normalizedQuoteId,
        error: serializeSupabaseError(error),
      });
      return { ok: false, error: "seed-error" };
    }

    const createdCount = Array.isArray(data) ? data.length : 0;
    return { ok: true, createdCount };
  } catch (error) {
    if (isMissingTableOrColumnError(error)) {
      return { ok: false, error: "schema-missing" };
    }
    console.error("[kickoff quote tasks] seed crashed", {
      quoteId: normalizedQuoteId,
      error: serializeSupabaseError(error) ?? error,
    });
    return { ok: false, error: "seed-error" };
  }
}

export async function getKickoffTasksForQuote(
  quoteId: string,
): Promise<QuoteKickoffTask[]> {
  const normalizedQuoteId = normalizeId(quoteId);
  if (!normalizedQuoteId) return [];

  const schemaReady = await schemaGate({
    enabled: true,
    relation: QUOTE_KICKOFF_TASKS_TABLE,
    requiredColumns: [
      "id",
      "quote_id",
      "task_key",
      "title",
      "description",
      "sort_order",
      "status",
      "completed_at",
      "completed_by_user_id",
      "blocked_reason",
      "created_at",
      "updated_at",
    ],
    warnPrefix: "[kickoff quote tasks]",
    warnKey: "kickoff_quote_tasks:get_missing_schema",
  });
  if (!schemaReady) return [];

  try {
    type Row = {
      id: string | null;
      quote_id: string | null;
      task_key: string | null;
      title: string | null;
      description: string | null;
      sort_order: number | null;
      status: string | null;
      completed_at: string | null;
      completed_by_user_id: string | null;
      blocked_reason: string | null;
      created_at: string | null;
      updated_at: string | null;
    };

    const { data, error } = await supabaseServer
      .from(QUOTE_KICKOFF_TASKS_TABLE)
      .select(
        "id,quote_id,task_key,title,description,sort_order,status,completed_at,completed_by_user_id,blocked_reason,created_at,updated_at",
      )
      .eq("quote_id", normalizedQuoteId)
      .order("sort_order", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true, nullsFirst: true })
      .returns<Row[]>();

    if (error) {
      if (isMissingTableOrColumnError(error)) return [];
      console.error("[kickoff quote tasks] load failed", {
        quoteId: normalizedQuoteId,
        error: serializeSupabaseError(error),
      });
      return [];
    }

    return (Array.isArray(data) ? data : [])
      .map((row): QuoteKickoffTask | null => {
        const id = normalizeId(row?.id);
        const taskKey = normalizeId(row?.task_key);
        const quoteId = normalizeId(row?.quote_id);
        if (!id || !taskKey || !quoteId) return null;

        const sortOrder = typeof row?.sort_order === "number" && Number.isFinite(row.sort_order)
          ? row.sort_order
          : 1;
        const status = normalizeQuoteKickoffTaskStatus(row?.status) ?? "pending";

        return {
          id,
          quoteId,
          taskKey,
          title: normalizeOptionalText(row?.title) ?? taskKey,
          description: normalizeOptionalText(row?.description),
          sortOrder,
          status,
          completedAt: normalizeOptionalText(row?.completed_at),
          completedByUserId: normalizeOptionalText(row?.completed_by_user_id),
          blockedReason: normalizeOptionalText(row?.blocked_reason),
          createdAt: normalizeOptionalText(row?.created_at) ?? new Date().toISOString(),
          updatedAt: normalizeOptionalText(row?.updated_at) ?? new Date().toISOString(),
        };
      })
      .filter((task): task is QuoteKickoffTask => Boolean(task));
  } catch (error) {
    if (isMissingTableOrColumnError(error)) return [];
    console.error("[kickoff quote tasks] load crashed", {
      quoteId: normalizedQuoteId,
      error: serializeSupabaseError(error) ?? error,
    });
    return [];
  }
}

export type UpdateKickoffTaskStatusActionResult =
  | { ok: true }
  | { ok: false; error: string };

export async function updateKickoffTaskStatusAction(args: {
  quoteId: string;
  taskKey: string;
  status: QuoteKickoffTaskStatus;
  blockedReason?: string | null;
}): Promise<UpdateKickoffTaskStatusActionResult> {
  "use server";

  const quoteId = normalizeId(args.quoteId);
  const taskKey = normalizeId(args.taskKey);
  const nextStatus = normalizeQuoteKickoffTaskStatus(args.status);
  const blockedReason = normalizeOptionalText(args.blockedReason);
  if (!quoteId || !taskKey || !nextStatus) {
    return { ok: false, error: "invalid_input" };
  }

  const schemaReady = await schemaGate({
    enabled: true,
    relation: QUOTE_KICKOFF_TASKS_TABLE,
    requiredColumns: [
      "quote_id",
      "task_key",
      "status",
      "completed_at",
      "completed_by_user_id",
      "blocked_reason",
      "updated_at",
    ],
    warnPrefix: "[kickoff quote tasks]",
    warnKey: "kickoff_quote_tasks:update_missing_schema",
  });
  if (!schemaReady) {
    return { ok: false, error: "schema-missing" };
  }

  let actorRole: "admin" | "supplier" = "supplier";
  let actorUserId: string | null = null;
  let isAdmin = false;
  let supplierId: string | null = null;

  try {
    const adminUser = await requireAdminUser();
    isAdmin = true;
    actorRole = "admin";
    actorUserId = normalizeId(adminUser.id) || null;
  } catch (error) {
    if (!(error instanceof UnauthorizedError)) {
      throw error;
    }
    const user = await requireUser();
    actorUserId = normalizeId(user.id) || null;
    actorRole = "supplier";

    const profile = await loadSupplierProfileByUserId(user.id);
    supplierId = normalizeId(profile?.supplier?.id ?? null) || null;
    if (!supplierId) {
      return { ok: false, error: "missing_supplier_profile" };
    }

    const access = await assertSupplierQuoteAccess({
      quoteId,
      supplierId,
      supplierUserEmail: user.email ?? null,
    });
    if (!access.ok) {
      return { ok: false, error: "forbidden" };
    }

    // Restrict edits to the awarded supplier (defense-in-depth).
    const { data: quoteRow } = await supabaseServer
      .from("quotes")
      .select("awarded_supplier_id")
      .eq("id", quoteId)
      .maybeSingle<{ awarded_supplier_id: string | null }>();
    const awardedSupplierId = normalizeId(quoteRow?.awarded_supplier_id ?? null) || null;
    if (!awardedSupplierId || awardedSupplierId !== supplierId) {
      return { ok: false, error: "not_awarded_supplier" };
    }
  }

  // Ensure default tasks exist (idempotent) so updates don't race award.
  await ensureDefaultKickoffTasksForQuote(quoteId);

  type StatusRow = { status: string | null };
  const { data: currentRow, error: loadError } = await supabaseServer
    .from(QUOTE_KICKOFF_TASKS_TABLE)
    .select("status")
    .eq("quote_id", quoteId)
    .eq("task_key", taskKey)
    .maybeSingle<StatusRow>();

  if (loadError) {
    if (isMissingTableOrColumnError(loadError)) {
      return { ok: false, error: "schema-missing" };
    }
    console.error("[kickoff quote tasks] load status failed", {
      quoteId,
      taskKey,
      error: serializeSupabaseError(loadError),
    });
    return { ok: false, error: "load-error" };
  }

  const currentStatus = normalizeQuoteKickoffTaskStatus(currentRow?.status) ?? "pending";
  const now = new Date().toISOString();

  const isAllowed = (() => {
    if (currentStatus === nextStatus) return true;
    if (currentStatus === "pending" && (nextStatus === "complete" || nextStatus === "blocked")) {
      return true;
    }
    if (currentStatus === "blocked" && nextStatus === "pending") {
      return true;
    }
    if (currentStatus === "complete" && nextStatus === "pending") {
      return isAdmin;
    }
    return false;
  })();

  if (!isAllowed) {
    return { ok: false, error: "invalid_transition" };
  }

  if (nextStatus === "blocked" && !blockedReason) {
    return { ok: false, error: "blocked_reason_required" };
  }

  const updatePayload: Record<string, unknown> = {
    status: nextStatus,
    updated_at: now,
  };

  if (nextStatus === "complete") {
    updatePayload.completed_at = now;
    updatePayload.completed_by_user_id = actorUserId;
    updatePayload.blocked_reason = null;
  } else if (nextStatus === "blocked") {
    updatePayload.blocked_reason = blockedReason;
    updatePayload.completed_at = null;
    updatePayload.completed_by_user_id = null;
  } else {
    // pending
    updatePayload.blocked_reason = null;
    updatePayload.completed_at = null;
    updatePayload.completed_by_user_id = null;
  }

  const { error: updateError } = await supabaseServer
    .from(QUOTE_KICKOFF_TASKS_TABLE)
    .update(updatePayload)
    .eq("quote_id", quoteId)
    .eq("task_key", taskKey);

  if (updateError) {
    if (isMissingTableOrColumnError(updateError)) {
      return { ok: false, error: "schema-missing" };
    }
    console.error("[kickoff quote tasks] update failed", {
      quoteId,
      taskKey,
      nextStatus,
      error: serializeSupabaseError(updateError),
    });
    return { ok: false, error: "update-error" };
  }

  await logOpsEvent({
    quoteId,
    eventType: "kickoff_task_status_changed",
    payload: {
      quote_id: quoteId,
      task_key: taskKey,
      new_status: nextStatus,
    },
  });

  return { ok: true };
}
