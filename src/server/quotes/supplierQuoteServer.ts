import { supabaseServer } from "@/lib/supabaseServer";
import type { QuoteWithUploadsRow } from "@/server/quotes/types";
import {
  SAFE_QUOTE_WITH_UPLOADS_FIELDS,
  type SafeQuoteWithUploadsField,
} from "@/server/suppliers/types";

export type SupplierMessageFormState = {
  ok: boolean;
  message?: string | null;
  error?: string | null;
  fieldErrors?: {
    body?: string;
  };
};

export const SUPPLIER_MESSAGE_PROFILE_ERROR =
  "We couldn’t find your supplier profile.";
export const SUPPLIER_MESSAGE_GENERIC_ERROR =
  "We couldn’t send your message. Please try again.";
export const SUPPLIER_MESSAGE_ACCESS_ERROR =
  "Chat is only available after your bid is selected for this RFQ.";
export const SUPPLIER_MESSAGE_LOCKED_ERROR =
  "Chat unlocks after your bid is accepted for this RFQ.";

export type SupplierBidActionState =
  | { ok: true; message: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

export const BID_SUBMIT_ERROR = "We couldn't submit your bid. Please try again.";
export const BID_ENV_DISABLED_ERROR =
  "Bids are not enabled in this environment yet.";
export const BID_AMOUNT_INVALID_ERROR =
  "Enter a valid bid amount greater than 0.";
export const SUPPLIER_BIDS_MISSING_SCHEMA_MESSAGE =
  "Bids are not available in this environment.";

const QUOTE_ACCESS_SELECT = SAFE_QUOTE_WITH_UPLOADS_FIELDS.join(",");

type QuoteAccessRow = Pick<QuoteWithUploadsRow, SafeQuoteWithUploadsField>;

export async function loadQuoteAccessRow(quoteId: string) {
  return supabaseServer
    .from("quotes_with_uploads")
    .select(QUOTE_ACCESS_SELECT)
    .eq("id", quoteId)
    .maybeSingle<QuoteAccessRow>();
}

export async function loadUploadProcessHint(
  uploadId: string | null,
): Promise<string | null> {
  if (!uploadId) {
    return null;
  }
  const { data, error } = await supabaseServer
    .from("uploads")
    .select("manufacturing_process")
    .eq("id", uploadId)
    .maybeSingle<{ manufacturing_process: string | null }>();

  if (error) {
    console.error("Supplier bid action: upload lookup failed", error);
    return null;
  }

  return data?.manufacturing_process ?? null;
}

export function parseSupplierBidAmount(
  value: FormDataEntryValue | null,
): number | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().replace(/[,\s]/g, "");
  if (normalized.length === 0) {
    return null;
  }
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return parsed;
}

export function logBidSubmitFailure(args: {
  quoteId: string | null;
  supplierId: string | null;
  reason: string;
  phase?: string;
  supabaseError?: unknown;
  details?: unknown;
}) {
  const { quoteId, supplierId, reason, phase, supabaseError, details } = args;
  console.error("[bids] submit failed", {
    quoteId,
    supplierId,
    reason,
    phase,
    supabaseError,
    details,
  });
}

export function parseLeadTimeDays(
  value: FormDataEntryValue | null,
): { ok: true; value: number | null } | { ok: false; error: string } {
  if (typeof value !== "string") {
    return { ok: true, value: null };
  }

  const normalized = value.trim().replace(/[,]/g, "");
  if (normalized.length === 0) {
    return { ok: true, value: null };
  }

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return { ok: false, error: "Lead time must be zero or more days." };
  }

  return { ok: true, value: parsed };
}

export function isBidsEnvErrorMessage(message?: string | null): boolean {
  if (!message) {
    return false;
  }
  return message.includes(SUPPLIER_BIDS_MISSING_SCHEMA_MESSAGE);
}

export const SUPPLIER_KICKOFF_TASKS_TABLE = "quote_kickoff_tasks";
export const KICKOFF_TASKS_GENERIC_ERROR =
  "We couldn’t update the kickoff checklist. Please try again.";
export const KICKOFF_TASKS_SCHEMA_ERROR =
  "Kickoff checklist isn’t available in this environment yet.";

export type ToggleSupplierKickoffTaskInput = {
  quoteId: string;
  supplierId: string;
  taskKey: string;
  completed: boolean;
  title?: string | null;
  description?: string | null;
  sortOrder?: number | null;
};

export type SupplierKickoffTaskActionState =
  | { ok: true; message: string }
  | { ok: false; error: string };

export function normalizeIdentifier(value?: string | null): string {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeTaskKey(value?: string | null): string {
  const key = typeof value === "string" ? value.trim().toLowerCase() : "";
  return key.replace(/[^a-z0-9_-]/gi, "");
}

export function normalizeTaskTitle(
  value: string | null | undefined,
  fallback: string,
): string {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim().slice(0, 120);
  }
  return fallback;
}

export function normalizeTaskDescription(
  value: string | null | undefined,
): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.slice(0, 500);
}

export function normalizeSortOrder(value?: number | null): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return null;
}
