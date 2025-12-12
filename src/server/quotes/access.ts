import { supabaseServer } from "@/lib/supabaseServer";
import {
  isMissingTableOrColumnError,
  serializeSupabaseError,
} from "@/server/admin/logging";

export type SupplierQuoteAccessDeniedReason =
  | "no_access"
  | "profile_missing"
  | "schema_error"
  | "unknown";

export type SupplierQuoteAccessResult =
  | { ok: true }
  | {
      ok: false;
      reason: SupplierQuoteAccessDeniedReason;
      error?: any;
    };

export async function assertSupplierQuoteAccess(args: {
  quoteId: string;
  supplierId: string | null | undefined;
}): Promise<SupplierQuoteAccessResult> {
  const quoteId = normalizeId(args.quoteId);
  const supplierId = normalizeId(args.supplierId);

  if (!supplierId) {
    return { ok: false, reason: "profile_missing" };
  }
  if (!quoteId) {
    return { ok: false, reason: "no_access" };
  }

  try {
    // (1) Supplier has a bid on the quote
    {
      const { data, error } = await supabaseServer
        .from("supplier_bids")
        .select("id")
        .eq("quote_id", quoteId)
        .eq("supplier_id", supplierId)
        .limit(1);

      if (error) {
        const serialized = serializeSupabaseError(error);
        return {
          ok: false,
          reason: isMissingTableOrColumnError(error) ? "schema_error" : "unknown",
          error: serialized ?? error,
        };
      }

      if (Array.isArray(data) && data.length > 0) {
        return { ok: true };
      }
    }

    // (2) Supplier is explicitly assigned/invited for the quote
    {
      const { data, error } = await supabaseServer
        .from("quote_suppliers")
        .select("id")
        .eq("quote_id", quoteId)
        .eq("supplier_id", supplierId)
        .limit(1);

      if (error) {
        const serialized = serializeSupabaseError(error);
        return {
          ok: false,
          reason: isMissingTableOrColumnError(error) ? "schema_error" : "unknown",
          error: serialized ?? error,
        };
      }

      if (Array.isArray(data) && data.length > 0) {
        return { ok: true };
      }
    }

    // (3) Supplier is the awarded supplier for the quote
    {
      const { data, error } = await supabaseServer
        .from("quotes")
        .select("awarded_supplier_id")
        .eq("id", quoteId)
        .maybeSingle<{ awarded_supplier_id: string | null }>();

      if (error) {
        const serialized = serializeSupabaseError(error);
        return {
          ok: false,
          reason: isMissingTableOrColumnError(error) ? "schema_error" : "unknown",
          error: serialized ?? error,
        };
      }

      const awardedSupplierId = normalizeId(data?.awarded_supplier_id);
      if (awardedSupplierId && awardedSupplierId === supplierId) {
        return { ok: true };
      }
    }

    return { ok: false, reason: "no_access" };
  } catch (error) {
    return { ok: false, reason: "unknown", error };
  }
}

export async function supplierCanAccessQuote(args: {
  quoteId: string;
  supplierId: string | null | undefined;
}): Promise<boolean> {
  const result = await assertSupplierQuoteAccess(args);
  return result.ok;
}

function normalizeId(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : "";
}

