import { supabaseServer } from "@/lib/supabaseServer";
import {
  isMissingTableOrColumnError,
  serializeSupabaseError,
} from "@/server/admin/logging";
import { notifyOnProjectKickoffChange } from "@/server/quotes/notifications";
import type { MutationResult } from "@/server/types/results";

const TABLE_NAME = "quote_projects";
const SELECT_COLUMNS =
  "id,quote_id,supplier_id,status,po_number,target_ship_date,notes,created_at,updated_at";

/**
 * public.quote_projects currently stores:
 * - id: primary key for the project row.
 * - quote_id: reference to public.quotes(id).
 * - supplier_id: optional reference to public.suppliers(id) for the winner.
 * - status: text status for the project lifecycle (defaults to "planning").
 * - po_number: customer-supplied purchase order identifier.
 * - target_ship_date: target shipment date (stored as YYYY-MM-DD).
 * - notes: kickoff notes visible to admins, customers, and the winning supplier.
 * - created_at / updated_at: timestamps maintained server-side.
 */
export type QuoteProjectRecord = {
  id: string;
  quote_id: string;
  supplier_id: string | null;
  status: string | null;
  po_number: string | null;
  target_ship_date: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type QuoteProjectFailureReason =
  | "not_found"
  | "schema_error"
  | "unknown";

export type QuoteProjectResult =
  | { ok: true; project: QuoteProjectRecord }
  | {
      ok: false;
      project: null;
      reason: QuoteProjectFailureReason;
      error?: unknown;
    };

export type ProjectMutationResult = MutationResult<QuoteProjectRecord>;

type EnsureWinnerParams = {
  quoteId: string;
  winningSupplierId: string;
};

type UpsertProjectParams = {
  quoteId: string;
  poNumber?: string | null;
  targetShipDate?: string | null;
  notes?: string | null;
};

export async function loadQuoteProjectForQuote(
  quoteId: string,
): Promise<QuoteProjectResult> {
  const normalizedQuoteId = normalizeId(quoteId);
  if (!normalizedQuoteId) {
    return {
      ok: false,
      project: null,
      reason: "not_found",
      error: "quoteId is required",
    };
  }

  try {
    const { data, error } = await supabaseServer()
      .from(TABLE_NAME)
      .select(SELECT_COLUMNS)
      .eq("quote_id", normalizedQuoteId)
      .maybeSingle<QuoteProjectRecord>();

    if (error) {
      const serialized = serializeSupabaseError(error);
      const reason: QuoteProjectFailureReason = isMissingTableOrColumnError(error)
        ? "schema_error"
        : "unknown";

      logProjectLoadOutcome(normalizedQuoteId, null, reason);

      const logPayload = {
        quoteId: normalizedQuoteId,
        error: serialized,
      };
      if (reason === "schema_error") {
        console.warn("[quote projects] load missing schema", logPayload);
      } else {
        console.error("[quote projects] load failed", logPayload);
      }

      return {
        ok: false,
        project: null,
        reason,
        error: serialized,
      };
    }

    if (!data) {
      logProjectLoadOutcome(normalizedQuoteId, null, "not_found");
      return { ok: false, project: null, reason: "not_found" };
    }

    logProjectLoadOutcome(normalizedQuoteId, data, null);
    return { ok: true, project: data };
  } catch (error) {
    const serialized = serializeSupabaseError(error);
    const reason: QuoteProjectFailureReason = isMissingTableOrColumnError(error)
      ? "schema_error"
      : "unknown";

    logProjectLoadOutcome(normalizedQuoteId, null, reason);

    if (reason === "schema_error") {
      console.warn("[quote projects] load crashed (missing schema)", {
        quoteId: normalizedQuoteId,
        error: serialized,
      });
    } else {
      console.error("[quote projects] load crashed", {
        quoteId: normalizedQuoteId,
        error: serialized ?? error,
      });
    }

    return {
      ok: false,
      project: null,
      reason,
      error: serialized ?? error,
    };
  }
}

export async function ensureQuoteProjectForWinner(
  params: EnsureWinnerParams,
): Promise<QuoteProjectResult> {
  const quoteId = normalizeId(params?.quoteId);
  const winningSupplierId = normalizeId(params?.winningSupplierId);

  if (!quoteId || !winningSupplierId) {
    console.warn("[quote projects] ensure skipped (missing identifiers)", {
      quoteId: quoteId || params?.quoteId || null,
      winningSupplierId: winningSupplierId || params?.winningSupplierId || null,
    });
    return {
      ok: false,
      project: null,
      reason: "unknown",
      error: "missing-identifiers",
    };
  }

  try {
    let shouldSetDefaultStatus = false;
    try {
      const { data: existingRow, error: existingError } = await supabaseServer()
        .from(TABLE_NAME)
        .select("id")
        .eq("quote_id", quoteId)
        .maybeSingle<{ id: string }>();

      if (existingError && !isMissingTableOrColumnError(existingError)) {
        console.warn("[quote projects] ensure existing lookup failed", {
          quoteId,
          error: serializeSupabaseError(existingError),
        });
      }

      shouldSetDefaultStatus = !existingRow?.id;
    } catch (existingError) {
      console.warn("[quote projects] ensure existing lookup crashed", {
        quoteId,
        error: serializeSupabaseError(existingError),
      });
      // Best-effort: if we can't determine existence, avoid forcing a status value.
      shouldSetDefaultStatus = false;
    }

    // Upsert winner linkage so awarded quotes always have a project row.
    // Intentionally do not overwrite customer-entered fields (PO/ship date/notes) and
    // avoid overriding status if it has progressed beyond the initial default.
    const payload = {
      quote_id: quoteId,
      supplier_id: winningSupplierId,
      ...(shouldSetDefaultStatus ? { status: "planning" } : {}),
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabaseServer()
      .from(TABLE_NAME)
      .upsert(payload, { onConflict: "quote_id" })
      .select(SELECT_COLUMNS)
      .single<QuoteProjectRecord>();

    if (error) {
      const serialized = serializeSupabaseError(error);

      if (isMissingTableOrColumnError(error)) {
        console.warn("[quote projects] ensure missing schema", {
          quoteId,
          winningSupplierId,
          error: serialized,
        });
        return {
          ok: false,
          project: null,
          reason: "schema_error",
          error: serialized,
        };
      }

      console.error("[quote projects] ensure failed", {
        quoteId,
        winningSupplierId,
        error: serialized,
      });
      return {
        ok: false,
        project: null,
        reason: "unknown",
        error: serialized,
      };
    }

    if (data) {
      console.info("[quote projects] ensure upserted", {
        quoteId,
        winningSupplierId,
        projectId: data.id,
      });
      return { ok: true, project: data };
    }

    console.error("[quote projects] ensure missing payload", {
      quoteId,
      winningSupplierId,
    });
    return {
      ok: false,
      project: null,
      reason: "unknown",
      error: "insert-missing-data",
    };
  } catch (error) {
    const serialized = serializeSupabaseError(error);
    const reason: QuoteProjectFailureReason = isMissingTableOrColumnError(error)
      ? "schema_error"
      : "unknown";

    if (reason === "schema_error") {
      console.warn("[quote projects] ensure crashed (missing schema)", {
        quoteId,
        winningSupplierId,
        error: serialized,
      });
    } else {
      console.error("[quote projects] ensure crashed", {
        quoteId,
        winningSupplierId,
        error: serialized ?? error,
      });
    }

    return {
      ok: false,
      project: null,
      reason,
      error: serialized ?? error,
    };
  }
}

export async function upsertQuoteProject(
  params: UpsertProjectParams,
): Promise<ProjectMutationResult> {
  const quoteId = normalizeId(params?.quoteId);
  const poNumber = sanitizePoNumber(params?.poNumber);
  const targetShipDate = sanitizeTargetShipDate(params?.targetShipDate);
  const notes = sanitizeNotes(params?.notes);

  if (!quoteId) {
    return {
      ok: false,
      data: null,
      error: MUTATION_GENERIC_ERROR,
    };
  }

  let hadExistingProject = false;
  try {
    const { data: existingRow, error: existingError } = await supabaseServer()
      .from(TABLE_NAME)
      .select("id")
      .eq("quote_id", quoteId)
      .maybeSingle<{ id: string }>();

    if (existingError && !isMissingTableOrColumnError(existingError)) {
      console.warn("[quote projects] existing lookup failed", {
        quoteId,
        error: serializeSupabaseError(existingError),
      });
    }
    hadExistingProject = Boolean(existingRow?.id);
  } catch (existingError) {
    console.warn("[quote projects] existing lookup crashed", {
      quoteId,
      error: serializeSupabaseError(existingError),
    });
  }

  console.log("[quote projects] upsert start", {
    quoteId,
    hasPoNumber: Boolean(poNumber),
    hasTargetDate: Boolean(targetShipDate),
  });

  try {
    const payload = {
      quote_id: quoteId,
      po_number: poNumber,
      target_ship_date: targetShipDate,
      notes,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabaseServer()
      .from(TABLE_NAME)
      .upsert(payload, { onConflict: "quote_id" })
      .select(SELECT_COLUMNS)
      .single<QuoteProjectRecord>();

    if (error || !data) {
      const serialized = serializeSupabaseError(error);
      if (isMissingTableOrColumnError(error)) {
        console.warn("[quote projects] upsert missing schema", {
          quoteId,
          error: serialized,
        });
      } else {
        console.error("[quote projects] upsert failed", {
          quoteId,
          error: serialized,
        });
      }
      return {
        ok: false,
        data: null,
        error: MUTATION_GENERIC_ERROR,
      };
    }

    console.log("[quote projects] upsert success", { quoteId });

    void notifyOnProjectKickoffChange({
      quoteId,
      project: data,
      created: !hadExistingProject,
    });

    return {
      ok: true,
      data,
      error: null,
    };
  } catch (error) {
    const serialized = serializeSupabaseError(error);
    if (isMissingTableOrColumnError(error)) {
      console.warn("[quote projects] upsert crashed (missing schema)", {
        quoteId,
        error: serialized,
      });
    } else {
      console.error("[quote projects] upsert crashed", {
        quoteId,
        error: serialized ?? error,
      });
    }
    return {
      ok: false,
      data: null,
      error: MUTATION_GENERIC_ERROR,
    };
  }
}

function logProjectLoadOutcome(
  quoteId: string,
  project: QuoteProjectRecord | null,
  failureReason: QuoteProjectFailureReason | null,
) {
  if (!quoteId) {
    return;
  }
  const unavailable =
    failureReason !== null && failureReason !== undefined && failureReason !== "not_found";
  console.info("[quote projects] load result", {
    quoteId,
    hasProject: Boolean(project),
    unavailable,
  });
}

function normalizeId(value?: string | null): string {
  return typeof value === "string" ? value.trim() : "";
}

function sanitizePoNumber(value?: string | null): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.slice(0, 100);
}

function sanitizeTargetShipDate(value?: string | null): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  return DATE_INPUT_REGEX.test(trimmed) ? trimmed : null;
}

function sanitizeNotes(value?: string | null): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.slice(0, 2000);
}

const MUTATION_GENERIC_ERROR =
  "We couldn’t update the project details. Please retry.";

const DATE_INPUT_REGEX = /^\d{4}-\d{2}-\d{2}$/;
