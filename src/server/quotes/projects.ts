import { supabaseServer } from "@/lib/supabaseServer";
import {
  serializeSupabaseError,
  isMissingTableOrColumnError,
} from "@/server/admin/logging";
import type { LoadResult, MutationResult } from "@/server/types/results";

export interface QuoteProjectRow {
  id: string;
  quote_id: string;
  po_number: string | null;
  target_ship_date: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export type ProjectLoadResult = LoadResult<QuoteProjectRow | null>;
export type ProjectMutationResult = MutationResult<QuoteProjectRow>;

type UpsertProjectParams = {
  quoteId: string;
  poNumber?: string | null;
  targetShipDate?: string | null;
  notes?: string | null;
};

const TABLE_NAME = "quote_projects";
const SELECT_COLUMNS =
  "id,quote_id,po_number,target_ship_date,notes,created_at,updated_at";
const LOAD_GENERIC_ERROR =
  "Project details are unavailable right now. Please try again.";
const MUTATION_GENERIC_ERROR =
  "We couldn’t update the project details. Please retry.";

export async function loadQuoteProject(
  quoteId: string,
): Promise<ProjectLoadResult> {
  const normalizedQuoteId = normalizeId(quoteId);

  if (!normalizedQuoteId) {
    return {
      ok: false,
      data: null,
      error: "quoteId is required",
    };
  }

  try {
    const { data, error } = await supabaseServer
      .from(TABLE_NAME)
      .select(SELECT_COLUMNS)
      .eq("quote_id", normalizedQuoteId)
      .maybeSingle<QuoteProjectRow>();

    if (error) {
      const serialized = serializeSupabaseError(error);
      if (isMissingTableOrColumnError(error)) {
        console.warn("[quote projects] load missing schema", {
          quoteId: normalizedQuoteId,
          error: serialized,
        });
        return {
          ok: false,
          data: null,
          error: LOAD_GENERIC_ERROR,
        };
      }
      console.error("[quote projects] load failed", {
        quoteId: normalizedQuoteId,
        error: serialized,
      });
      return {
        ok: false,
        data: null,
        error: LOAD_GENERIC_ERROR,
      };
    }

    const project = data ?? null;
    console.log("[quote projects] load success", {
      quoteId: normalizedQuoteId,
      hasProject: Boolean(project),
    });

    return {
      ok: true,
      data: project,
      error: null,
    };
  } catch (error) {
    const serialized = serializeSupabaseError(error);
    if (isMissingTableOrColumnError(error)) {
      console.warn("[quote projects] load crashed (missing schema)", {
        quoteId: normalizedQuoteId,
        error: serialized,
      });
      return {
        ok: false,
        data: null,
        error: LOAD_GENERIC_ERROR,
      };
    }
    console.error("[quote projects] load crashed", {
      quoteId: normalizedQuoteId,
      error: serialized ?? error,
    });
    return {
      ok: false,
      data: null,
      error: LOAD_GENERIC_ERROR,
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

    const { data, error } = await supabaseServer
      .from(TABLE_NAME)
      .upsert(payload, { onConflict: "quote_id" })
      .select(SELECT_COLUMNS)
      .single<QuoteProjectRow>();

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

const DATE_INPUT_REGEX = /^\d{4}-\d{2}-\d{2}$/;
