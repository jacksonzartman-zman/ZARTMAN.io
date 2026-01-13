import { supabaseServer } from "@/lib/supabaseServer";
import { schemaGate } from "@/server/db/schemaContract";
import {
  handleMissingSupabaseRelation,
  isMissingTableOrColumnError,
  isSupabaseRelationMarkedMissing,
  markSupabaseRelationMissing,
  serializeSupabaseError,
  warnOnce,
} from "@/server/admin/logging";

const RELATION = "quote_supplier_bid_drafts";

function normalizeId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function isBidDraftsEnabled(): boolean {
  const raw = process.env.BID_DRAFTS_ENABLED;
  if (!raw) return false;
  const normalized = raw.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

export async function loadSupplierBidDraft(input: {
  quoteId: string;
  supplierId: string;
}): Promise<{ draft: unknown | null }> {
  const quoteId = normalizeId(input.quoteId);
  const supplierId = normalizeId(input.supplierId);
  if (!quoteId || !supplierId) return { draft: null };

  if (!isBidDraftsEnabled()) {
    // Feature disabled; do not query Supabase.
    return { draft: null };
  }

  const hasSchema = await schemaGate({
    enabled: true,
    relation: RELATION,
    requiredColumns: ["quote_id", "supplier_id", "draft"],
    warnPrefix: "[bid_drafts]",
  });
  if (!hasSchema) {
    return { draft: null };
  }

  if (isSupabaseRelationMarkedMissing(RELATION)) {
    // Feature not enabled in this env; skip entirely.
    return { draft: null };
  }

  try {
    const { data, error } = await supabaseServer
      .from(RELATION)
      .select("draft")
      .eq("quote_id", quoteId)
      .eq("supplier_id", supplierId)
      .maybeSingle<{ draft: unknown }>();

    if (error) {
      if (
        handleMissingSupabaseRelation({
          relation: RELATION,
          error,
          warnPrefix: "[bid_drafts]",
        }) ||
        isMissingTableOrColumnError(error)
      ) {
        // Mark once + fail-soft.
        markSupabaseRelationMissing(RELATION);
        const serialized = serializeSupabaseError(error);
        warnOnce(`missing_relation:${RELATION}`, "[bid_drafts] missing relation; skipping", {
          code: serialized.code,
          message: serialized.message,
        });
        return { draft: null };
      }

      console.error("[bid_drafts] load failed", {
        quoteId,
        supplierId,
        error: serializeSupabaseError(error) ?? error,
      });
      return { draft: null };
    }

    return { draft: (data?.draft ?? null) as unknown | null };
  } catch (error) {
    if (
      handleMissingSupabaseRelation({
        relation: RELATION,
        error,
        warnPrefix: "[bid_drafts]",
      }) ||
      isMissingTableOrColumnError(error)
    ) {
      markSupabaseRelationMissing(RELATION);
      const serialized = serializeSupabaseError(error);
      warnOnce(`missing_relation:${RELATION}`, "[bid_drafts] missing relation; skipping", {
        code: serialized.code,
        message: serialized.message,
      });
      return { draft: null };
    }

    console.error("[bid_drafts] load crashed", {
      quoteId,
      supplierId,
      error: serializeSupabaseError(error) ?? error,
    });
    return { draft: null };
  }
}

export async function saveSupplierBidDraft(input: {
  quoteId: string;
  supplierId: string;
  draft: unknown;
}): Promise<{ ok: true } | { ok: false; error: unknown }> {
  const quoteId = normalizeId(input.quoteId);
  const supplierId = normalizeId(input.supplierId);
  if (!quoteId || !supplierId) return { ok: true };

  if (!isBidDraftsEnabled()) {
    // Feature disabled; do not query Supabase.
    return { ok: true };
  }

  const hasSchema = await schemaGate({
    enabled: true,
    relation: RELATION,
    requiredColumns: ["quote_id", "supplier_id", "draft"],
    warnPrefix: "[bid_drafts]",
  });
  if (!hasSchema) {
    return { ok: true };
  }

  if (isSupabaseRelationMarkedMissing(RELATION)) {
    // Feature not enabled in this env; skip entirely.
    return { ok: true };
  }

  const payload = {
    quote_id: quoteId,
    supplier_id: supplierId,
    draft: input.draft ?? null,
  };

  try {
    const { error } = await supabaseServer
      .from(RELATION)
      .upsert(payload, { onConflict: "quote_id,supplier_id" });

    if (error) {
      if (
        handleMissingSupabaseRelation({
          relation: RELATION,
          error,
          warnPrefix: "[bid_drafts]",
        }) ||
        isMissingTableOrColumnError(error)
      ) {
        markSupabaseRelationMissing(RELATION);
        const serialized = serializeSupabaseError(error);
        // Log line (exact) required by task.
        warnOnce(`missing_relation:${RELATION}`, "[bid_drafts] missing relation; skipping", {
          code: serialized.code,
          message: serialized.message,
        });
        return { ok: true };
      }

      return { ok: false, error };
    }

    return { ok: true };
  } catch (error) {
    if (
      handleMissingSupabaseRelation({
        relation: RELATION,
        error,
        warnPrefix: "[bid_drafts]",
      }) ||
      isMissingTableOrColumnError(error)
    ) {
      markSupabaseRelationMissing(RELATION);
      const serialized = serializeSupabaseError(error);
      // Log line (exact) required by task.
      warnOnce(`missing_relation:${RELATION}`, "[bid_drafts] missing relation; skipping", {
        code: serialized.code,
        message: serialized.message,
      });
      return { ok: true };
    }

    return { ok: false, error };
  }
}
