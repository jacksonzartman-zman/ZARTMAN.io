import { supabaseServer } from "@/lib/supabaseServer";
import {
  isMissingTableOrColumnError,
  serializeSupabaseError,
} from "@/server/admin/logging";

export type SupplierBidLineInput = {
  partId: string;
  quantity?: number | null;
  unitPrice?: number | null; // stored as numeric
  leadTimeDays?: number | null;
};

export type SupplierBidDraft = {
  bidLines: SupplierBidLineInput[];
  notes?: string | null;
};

const DRAFTS_TABLE = "quote_supplier_bid_drafts";

function normalizeId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeBidLines(input: unknown): SupplierBidLineInput[] {
  const rows = Array.isArray(input) ? input : [];
  const out: SupplierBidLineInput[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const partId = normalizeId((row as any).partId);
    if (!partId || seen.has(partId)) continue;
    seen.add(partId);

    const quantityRaw = (row as any).quantity;
    const unitPriceRaw = (row as any).unitPrice;
    const leadTimeRaw = (row as any).leadTimeDays;

    const quantity =
      typeof quantityRaw === "number" && Number.isFinite(quantityRaw)
        ? quantityRaw
        : quantityRaw === null
          ? null
          : undefined;

    const unitPrice =
      typeof unitPriceRaw === "number" && Number.isFinite(unitPriceRaw)
        ? unitPriceRaw
        : unitPriceRaw === null
          ? null
          : undefined;

    const leadTimeDays =
      typeof leadTimeRaw === "number" && Number.isFinite(leadTimeRaw)
        ? leadTimeRaw
        : leadTimeRaw === null
          ? null
          : undefined;

    out.push({
      partId,
      quantity,
      unitPrice,
      leadTimeDays,
    });
  }

  return out;
}

function coerceDraft(raw: unknown): SupplierBidDraft | null {
  if (!raw || typeof raw !== "object") return null;

  const bidLines = normalizeBidLines((raw as any).bidLines);
  if (!Array.isArray(bidLines)) return null;

  const notesRaw = (raw as any).notes;
  const notes =
    notesRaw === undefined
      ? undefined
      : notesRaw === null
        ? null
        : typeof notesRaw === "string"
          ? notesRaw
          : undefined;

  return {
    bidLines,
    ...(notesRaw !== undefined ? { notes } : {}),
  };
}

export async function upsertSupplierBidDraft(
  quoteId: string,
  supplierId: string,
  draft: SupplierBidDraft,
): Promise<void> {
  const normalizedQuoteId = normalizeId(quoteId);
  const normalizedSupplierId = normalizeId(supplierId);
  if (!normalizedQuoteId || !normalizedSupplierId) {
    throw new Error("invalid_quote_or_supplier");
  }

  // Merge fields for idempotency (preserve existing values when undefined).
  const existing = await loadSupplierBidDraft(normalizedQuoteId, normalizedSupplierId);
  const merged: SupplierBidDraft = {
    bidLines:
      Array.isArray(draft?.bidLines)
        ? draft.bidLines
        : (existing?.bidLines ?? []),
    ...(draft?.notes !== undefined ? { notes: draft.notes } : {}),
  };

  const payload = {
    quote_id: normalizedQuoteId,
    supplier_id: normalizedSupplierId,
    draft: merged,
    updated_at: new Date().toISOString(),
  };

  try {
    const { error } = await supabaseServer
      .from(DRAFTS_TABLE)
      .upsert(payload, { onConflict: "quote_id,supplier_id" });

    if (error) {
      if (isMissingTableOrColumnError(error)) {
        console.warn("[bid draft] missing schema; skipping persist", {
          quoteId: normalizedQuoteId,
          supplierId: normalizedSupplierId,
          error: serializeSupabaseError(error),
        });
        return;
      }

      console.error("[bid draft] upsert failed", {
        quoteId: normalizedQuoteId,
        supplierId: normalizedSupplierId,
        error: serializeSupabaseError(error),
      });
      throw error;
    }
  } catch (error) {
    if (isMissingTableOrColumnError(error)) {
      console.warn("[bid draft] missing schema; skipping persist", {
        quoteId: normalizedQuoteId,
        supplierId: normalizedSupplierId,
        error: serializeSupabaseError(error),
      });
      return;
    }

    console.error("[bid draft] upsert crashed", {
      quoteId: normalizedQuoteId,
      supplierId: normalizedSupplierId,
      error: serializeSupabaseError(error) ?? error,
    });
    throw error;
  }
}

export async function loadSupplierBidDraft(
  quoteId: string,
  supplierId: string,
): Promise<SupplierBidDraft | null> {
  const normalizedQuoteId = normalizeId(quoteId);
  const normalizedSupplierId = normalizeId(supplierId);
  if (!normalizedQuoteId || !normalizedSupplierId) {
    return null;
  }

  try {
    const { data, error } = await supabaseServer
      .from(DRAFTS_TABLE)
      .select("draft")
      .eq("quote_id", normalizedQuoteId)
      .eq("supplier_id", normalizedSupplierId)
      .maybeSingle<{ draft: unknown }>();

    if (error) {
      if (isMissingTableOrColumnError(error)) {
        return null;
      }

      console.error("[bid draft] load failed", {
        quoteId: normalizedQuoteId,
        supplierId: normalizedSupplierId,
        error: serializeSupabaseError(error),
      });
      return null;
    }

    const typed = coerceDraft(data?.draft);
    return typed;
  } catch (error) {
    if (isMissingTableOrColumnError(error)) {
      return null;
    }

    console.error("[bid draft] load crashed", {
      quoteId: normalizedQuoteId,
      supplierId: normalizedSupplierId,
      error: serializeSupabaseError(error) ?? error,
    });
    return null;
  }
}
