import "server-only";

import { supabaseServer } from "@/lib/supabaseServer";
import {
  isMissingTableOrColumnError,
  serializeSupabaseError,
} from "@/server/admin/logging";
import { schemaGate } from "@/server/db/schemaContract";
import { debugOnce } from "@/server/db/schemaErrors";
import { isDemoModeEnabled } from "@/server/demo/demoMode";

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
  supplierProviderId?: string | null | undefined;
  /**
   * Test-only override (and escape hatch for non-Next callsites):
   * When provided, skips reading the demo provider cookie.
   */
  demoProviderId?: string | null | undefined;
  /**
   * Test-only override: allows injecting a fake Supabase client.
   */
  supabase?: ReturnType<typeof supabaseServer>;
}): Promise<SupplierQuoteAccessResult> {
  const quoteId = normalizeId(args.quoteId);
  const supplierId = normalizeId(args.supplierId);
  const supplierUserEmail = normalizeEmail(args.supplierUserEmail);
  const supplierProviderId = normalizeId(args.supplierProviderId);
  const supabase = args.supabase ?? supabaseServer();

  if (!supplierId) {
    return { ok: false, reason: "profile_missing" };
  }
  if (!quoteId) {
    return { ok: false, reason: "no_access" };
  }

  try {
    const demoProviderId =
      normalizeId(args.demoProviderId) || (await readDemoProviderIdFromCookie());
    const demoModeEnabled = Boolean(demoProviderId) && isDemoModeEnabled();

    const [bidResult, quoteResult, inviteResult, rfqAwardResult] = await Promise.all([
      supabase
        .from("supplier_bids")
        .select("id")
        .eq("quote_id", quoteId)
        .eq("supplier_id", supplierId)
        .limit(1),
      supabase
        .from("quotes")
        .select("awarded_supplier_id,assigned_supplier_email")
        .eq("id", quoteId)
        .maybeSingle<{
          awarded_supplier_id: string | null;
          assigned_supplier_email: string | null;
        }>(),
      supabase
        .from("quote_invites")
        .select("id")
        .eq("quote_id", quoteId)
        .eq("supplier_id", supplierId)
        .limit(1),
      supplierProviderId
        ? (async () => {
            const rfqAwardsReady = await schemaGate({
              enabled: true,
              relation: "rfq_awards",
              requiredColumns: ["rfq_id", "provider_id"],
              warnPrefix: "[supplier access]",
              warnKey: "supplier_access:rfq_awards_schema",
            });
            if (!rfqAwardsReady) {
              return { data: null, error: null } as const;
            }
            const { data, error } = await supabase
              .from("rfq_awards")
              .select("provider_id")
              .eq("rfq_id", quoteId)
              .maybeSingle<{ provider_id: string | null }>();
            return { data: data ?? null, error: error ?? null } as const;
          })()
        : Promise.resolve({ data: null, error: null } as const),
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
    const awardedByProvider = (() => {
      if (!supplierProviderId) return false;
      if (rfqAwardResult.error) return false;
      const awardProviderId = normalizeId(rfqAwardResult.data?.provider_id);
      return Boolean(awardProviderId && awardProviderId === supplierProviderId);
    })();

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

    if (awarded || awardedByProvider) {
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

    if (demoModeEnabled && demoProviderId) {
      const { hasDestination, hasOffer, allowed } =
        await checkDemoProviderAssociation({
          rfqId: quoteId,
          providerId: demoProviderId,
          supabase,
        });

      debugOnce(
        `demo:supplier_access:${quoteId}:${demoProviderId}`,
        "[demo][supplier access] provider association gate",
        {
          rfqId: quoteId,
          providerId: demoProviderId,
          hasDestination,
          hasOffer,
          allowed,
        },
      );

      if (allowed) {
        return { ok: true, reason: "has_invite" };
      }
    }

    if (inviteResult.error && !inviteSchemaMissing) {
      const serialized = serializeSupabaseError(inviteResult.error);
      return {
        ok: false,
        reason: "unknown",
        error: serialized ?? inviteResult.error,
        debug: {
          awarded: awarded || awardedByProvider,
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
        awarded: awarded || awardedByProvider,
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

async function readDemoProviderIdFromCookie(): Promise<string> {
  // Avoid importing Next's cookies module in tests unless needed.
  if (!isDemoModeEnabled()) return "";
  try {
    const { getDemoSupplierProviderIdFromCookie } = await import(
      "@/server/demo/demoSupplierProvider"
    );
    const id = await getDemoSupplierProviderIdFromCookie();
    return normalizeId(id);
  } catch {
    return "";
  }
}

async function checkDemoProviderAssociation(args: {
  rfqId: string;
  providerId: string;
  supabase: ReturnType<typeof supabaseServer>;
}): Promise<{ hasDestination: boolean; hasOffer: boolean; allowed: boolean }> {
  const rfqId = normalizeId(args.rfqId);
  const providerId = normalizeId(args.providerId);
  if (!rfqId || !providerId) {
    return { hasDestination: false, hasOffer: false, allowed: false };
  }

  const [destinationResult, offerResult] = await Promise.all([
    args.supabase
      .from("rfq_destinations")
      .select("id")
      .eq("rfq_id", rfqId)
      .eq("provider_id", providerId)
      .limit(1)
      .maybeSingle<{ id: string }>(),
    args.supabase
      .from("rfq_offers")
      .select("id,status")
      .eq("rfq_id", rfqId)
      .eq("provider_id", providerId)
      .neq("status", "withdrawn")
      .limit(1)
      .maybeSingle<{ id: string; status: string | null }>(),
  ]);

  const hasDestination = Boolean(destinationResult.data) && !destinationResult.error;
  const hasOffer = Boolean(offerResult.data) && !offerResult.error;
  return { hasDestination, hasOffer, allowed: hasDestination || hasOffer };
}

