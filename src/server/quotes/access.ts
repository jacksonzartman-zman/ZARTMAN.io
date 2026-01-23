import { supabaseServer } from "@/lib/supabaseServer";
import {
  isMissingTableOrColumnError,
  serializeSupabaseError,
} from "@/server/admin/logging";

export type SupplierQuoteAccessDeniedReason =
  | "no_access"
  | "awarded"
  | "has_bid"
  | "has_invite"
  | "assigned_email_match"
  | "profile_missing"
  | "schema_error"
  | "unknown";

export type SupplierQuoteAccessResult =
  | {
      ok: true;
      reason: "awarded" | "has_bid" | "has_invite" | "assigned_email_match";
    }
  | {
      ok: false;
      reason: SupplierQuoteAccessDeniedReason;
      error?: any;
      debug?: {
        awarded: boolean;
        has_bid: boolean;
        has_invite: boolean;
        assigned_email_match: boolean;
      };
    };

export async function assertSupplierQuoteAccess(args: {
  quoteId: string;
  supplierId: string | null | undefined;
  supplierUserEmail?: string | null | undefined;
}): Promise<SupplierQuoteAccessResult> {
  const quoteId = normalizeId(args.quoteId);
  const supplierId = normalizeId(args.supplierId);
  const supplierUserEmail = normalizeEmail(args.supplierUserEmail);

  if (!supplierId) {
    return { ok: false, reason: "profile_missing" };
  }
  if (!quoteId) {
    return { ok: false, reason: "no_access" };
  }

  try {
    const [bidResult, quoteResult, inviteResult] = await Promise.all([
      supabaseServer()
        .from("supplier_bids")
        .select("id")
        .eq("quote_id", quoteId)
        .eq("supplier_id", supplierId)
        .limit(1),
      supabaseServer()
        .from("quotes")
        .select("awarded_supplier_id,assigned_supplier_email")
        .eq("id", quoteId)
        .maybeSingle<{
          awarded_supplier_id: string | null;
          assigned_supplier_email: string | null;
        }>(),
      supabaseServer()
        .from("quote_invites")
        .select("id")
        .eq("quote_id", quoteId)
        .eq("supplier_id", supplierId)
        .limit(1),
    ]);

    if (bidResult.error) {
      const serialized = serializeSupabaseError(bidResult.error);
      return {
        ok: false,
        reason: isMissingTableOrColumnError(bidResult.error)
          ? "schema_error"
          : "unknown",
        error: serialized ?? bidResult.error,
      };
    }

    if (quoteResult.error) {
      const serialized = serializeSupabaseError(quoteResult.error);
      return {
        ok: false,
        reason: isMissingTableOrColumnError(quoteResult.error)
          ? "schema_error"
          : "unknown",
        error: serialized ?? quoteResult.error,
      };
    }

    const hasBid = Array.isArray(bidResult.data) && bidResult.data.length > 0;
    const awardedSupplierId = normalizeId(quoteResult.data?.awarded_supplier_id);
    const awarded = Boolean(awardedSupplierId && awardedSupplierId === supplierId);

    const inviteSchemaMissing = Boolean(
      inviteResult.error && isMissingTableOrColumnError(inviteResult.error),
    );
    const hasInvite =
      !inviteResult.error &&
      Array.isArray(inviteResult.data) &&
      inviteResult.data.length > 0;

    const assignedSupplierEmail = normalizeEmail(
      quoteResult.data?.assigned_supplier_email,
    );
    const assignedEmailMatch = Boolean(
      assignedSupplierEmail &&
        supplierUserEmail &&
        assignedSupplierEmail === supplierUserEmail,
    );

    if (awarded) {
      return { ok: true, reason: "awarded" };
    }

    if (hasBid) {
      return { ok: true, reason: "has_bid" };
    }

    if (hasInvite) {
      return { ok: true, reason: "has_invite" };
    }

    if (assignedEmailMatch) {
      return { ok: true, reason: "assigned_email_match" };
    }

    if (inviteResult.error && !inviteSchemaMissing) {
      const serialized = serializeSupabaseError(inviteResult.error);
      return {
        ok: false,
        reason: "unknown",
        error: serialized ?? inviteResult.error,
        debug: {
          awarded,
          has_bid: hasBid,
          has_invite: false,
          assigned_email_match: assignedEmailMatch,
        },
      };
    }

    return {
      ok: false,
      reason: "no_access",
      debug: {
        awarded,
        has_bid: hasBid,
        has_invite: false,
        assigned_email_match: assignedEmailMatch,
      },
    };
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

function normalizeEmail(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  const trimmed = value.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : "";
}

