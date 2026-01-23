import { supabaseServer } from "@/lib/supabaseServer";
import { schemaGate } from "@/server/db/schemaContract";
import {
  handleMissingSupabaseSchema,
  isMissingTableOrColumnError,
  serializeSupabaseError,
  warnOnce,
} from "@/server/db/schemaErrors";
import { getCustomerEmailOptInStatus, isCustomerEmailBridgeEnabled } from "@/server/quotes/customerEmailPrefs";
import { buildCustomerThreadEmail, buildSupplierThreadEmail, getEmailOutboundStatus, getEmailSender } from "@/server/quotes/emailOutbound";

const WARN_PREFIX = "[email_invites]";

const QUOTES_RELATION = "quotes";
const CUSTOMERS_RELATION = "customers";
const SUPPLIERS_RELATION = "suppliers";

export type SendInviteResult =
  | { ok: true }
  | {
      ok: false;
      error:
        | "disabled"
        | "unsupported"
        | "missing_recipient"
        | "not_opted_in"
        | "send_failed";
    };

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;
  if (!trimmed.includes("@") || trimmed.includes(" ")) return null;
  if (trimmed.length > 320) return null;
  return trimmed;
}

function looksLikeUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

const INVITE_SUBJECT = "Reply to this search request by email";
const INVITE_BODY = [
  "Reply to this email to respond to this search request.",
  "Attach files directly—your message and attachments will appear in the portal thread.",
  "",
  "Tip: keep the “To” address unchanged so your reply stays attached to this thread.",
].join("\n");

async function resolveCustomerIdByEmail(email: string): Promise<string | null> {
  const supported = await schemaGate({
    enabled: true,
    relation: CUSTOMERS_RELATION,
    requiredColumns: ["id", "email"],
    warnPrefix: WARN_PREFIX,
    warnKey: "email_invites:customers_email",
  });
  if (!supported) return null;

  try {
    const { data, error } = await supabaseServer()
      .from(CUSTOMERS_RELATION)
      .select("id")
      .eq("email", email)
      .maybeSingle<{ id: string | null }>();
    if (error) {
      if (isMissingTableOrColumnError(error)) return null;
      return null;
    }
    const id = normalizeString(data?.id);
    return id || null;
  } catch {
    return null;
  }
}

async function resolveCustomerRecipient(args: {
  quoteId: string;
  customerId?: string | null;
}): Promise<{ ok: true; customerId: string; toEmail: string } | { ok: false; error: "unsupported" | "missing_recipient" }> {
  const quoteId = normalizeString(args.quoteId);
  const providedCustomerId = normalizeString(args.customerId ?? null);
  if (!quoteId || !looksLikeUuid(quoteId)) return { ok: false, error: "unsupported" };

  const supported = await schemaGate({
    enabled: true,
    relation: QUOTES_RELATION,
    requiredColumns: ["id", "customer_id", "customer_email"],
    warnPrefix: WARN_PREFIX,
    warnKey: "email_invites:quotes_customer",
  });
  if (!supported) return { ok: false, error: "unsupported" };

  type QuoteRow = { customer_id: string | null; customer_email: string | null };

  try {
    const { data, error } = await supabaseServer()
      .from(QUOTES_RELATION)
      .select("customer_id,customer_email")
      .eq("id", quoteId)
      .maybeSingle<QuoteRow>();

    if (error) {
      if (
        handleMissingSupabaseSchema({
          relation: QUOTES_RELATION,
          error,
          warnPrefix: WARN_PREFIX,
          warnKey: "email_invites:quotes_select_missing_schema",
        })
      ) {
        return { ok: false, error: "unsupported" };
      }
      warnOnce("email_invites:customer_quote_lookup_failed", `${WARN_PREFIX} quote lookup failed; skipping`, {
        code: serializeSupabaseError(error).code,
      });
      return { ok: false, error: "unsupported" };
    }

    const quoteCustomerId = normalizeString(data?.customer_id);
    const quoteEmail = normalizeEmail(data?.customer_email ?? null);
    if (!quoteEmail) {
      return { ok: false, error: "missing_recipient" };
    }

    const customerId =
      providedCustomerId ||
      quoteCustomerId ||
      (await resolveCustomerIdByEmail(quoteEmail));
    if (!customerId) {
      return { ok: false, error: "unsupported" };
    }

    return { ok: true, customerId, toEmail: quoteEmail };
  } catch (error) {
    if (
      handleMissingSupabaseSchema({
        relation: QUOTES_RELATION,
        error,
        warnPrefix: WARN_PREFIX,
        warnKey: "email_invites:quotes_select_missing_schema_crash",
      })
    ) {
      return { ok: false, error: "unsupported" };
    }
    warnOnce("email_invites:customer_quote_lookup_crashed", `${WARN_PREFIX} quote lookup crashed; skipping`, {
      code: serializeSupabaseError(error).code,
    });
    return { ok: false, error: "unsupported" };
  }
}

async function resolveAwardedSupplierId(args: { quoteId: string }): Promise<string | null> {
  const quoteId = normalizeString(args.quoteId);
  if (!quoteId || !looksLikeUuid(quoteId)) return null;

  const supported = await schemaGate({
    enabled: true,
    relation: QUOTES_RELATION,
    requiredColumns: ["id", "awarded_supplier_id"],
    warnPrefix: WARN_PREFIX,
    warnKey: "email_invites:quotes_awarded_supplier_id",
  });
  if (!supported) return null;

  try {
    const { data, error } = await supabaseServer()
      .from(QUOTES_RELATION)
      .select("awarded_supplier_id")
      .eq("id", quoteId)
      .maybeSingle<{ awarded_supplier_id: string | null }>();
    if (error) {
      if (isMissingTableOrColumnError(error)) return null;
      warnOnce("email_invites:awarded_supplier_lookup_failed", `${WARN_PREFIX} quote lookup failed; skipping`, {
        code: serializeSupabaseError(error).code,
      });
      return null;
    }
    const id = normalizeString(data?.awarded_supplier_id);
    return id || null;
  } catch {
    return null;
  }
}

async function resolveSupplierEmail(args: { supplierId: string }): Promise<string | null> {
  const supplierId = normalizeString(args.supplierId);
  if (!supplierId) return null;

  const emailSupported = await schemaGate({
    enabled: true,
    relation: SUPPLIERS_RELATION,
    requiredColumns: ["id", "email"],
    warnPrefix: WARN_PREFIX,
    warnKey: "email_invites:suppliers_email",
  });
  const primarySupported = !emailSupported
    ? await schemaGate({
        enabled: true,
        relation: SUPPLIERS_RELATION,
        requiredColumns: ["id", "primary_email"],
        warnPrefix: WARN_PREFIX,
        warnKey: "email_invites:suppliers_primary_email",
      })
    : false;

  if (!emailSupported && !primarySupported) return null;

  try {
    const select = emailSupported ? "email" : "primary_email";
    const { data, error } = await supabaseServer()
      .from(SUPPLIERS_RELATION)
      .select(select)
      .eq("id", supplierId)
      .maybeSingle<Record<string, string | null>>();

    if (error) {
      if (isMissingTableOrColumnError(error)) return null;
      warnOnce("email_invites:supplier_lookup_failed", `${WARN_PREFIX} supplier lookup failed; skipping`, {
        code: serializeSupabaseError(error).code,
      });
      return null;
    }

    return normalizeEmail(data?.[select] ?? null);
  } catch (error) {
    warnOnce("email_invites:supplier_lookup_crashed", `${WARN_PREFIX} supplier lookup crashed; skipping`, {
      code: serializeSupabaseError(error).code,
    });
    return null;
  }
}

/**
 * Sends the masked "reply-to" invite email to the quote's customer recipient.
 * Fail-soft: never throws; returns {ok:false,...} instead.
 */
export async function sendCustomerInviteEmail(args: {
  quoteId: string;
  customerId?: string | null;
}): Promise<SendInviteResult> {
  const quoteId = normalizeString(args.quoteId);
  if (!quoteId) return { ok: false, error: "unsupported" };

  const status = getEmailOutboundStatus();
  if (!status.enabled) {
    return { ok: false, error: "disabled" };
  }

  // Customer email bridge is separately gated; if disabled, do not probe DB.
  if (!isCustomerEmailBridgeEnabled()) {
    return { ok: false, error: "disabled" };
  }

  const resolved = await resolveCustomerRecipient({ quoteId, customerId: args.customerId });
  if (!resolved.ok) {
    return { ok: false, error: resolved.error };
  }

  const optIn = await getCustomerEmailOptInStatus({ quoteId, customerId: resolved.customerId });
  if (!optIn.ok) {
    return { ok: false, error: optIn.error === "disabled" ? "disabled" : "unsupported" };
  }
  if (!optIn.optedIn) {
    return { ok: false, error: "not_opted_in" };
  }

  const emailReq = buildCustomerThreadEmail({
    quoteId,
    customerId: resolved.customerId,
    toEmail: resolved.toEmail,
    adminMessageText: INVITE_BODY,
    subjectOverride: INVITE_SUBJECT,
  });
  if (!emailReq) {
    return { ok: false, error: "disabled" };
  }

  const sendResult = await getEmailSender().send(emailReq);
  if (!sendResult.ok) {
    return { ok: false, error: "send_failed" };
  }

  return { ok: true };
}

/**
 * Sends the masked "reply-to" invite email to a supplier (typically after award).
 * Fail-soft: never throws; returns {ok:false,...} instead.
 */
export async function sendSupplierInviteEmail(args: {
  quoteId: string;
  supplierId?: string | null;
}): Promise<SendInviteResult> {
  const quoteId = normalizeString(args.quoteId);
  if (!quoteId) return { ok: false, error: "unsupported" };

  const status = getEmailOutboundStatus();
  if (!status.enabled) {
    return { ok: false, error: "disabled" };
  }

  const supplierId = normalizeString(args.supplierId ?? null) || (await resolveAwardedSupplierId({ quoteId }));
  if (!supplierId) {
    return { ok: false, error: "unsupported" };
  }

  const toEmail = await resolveSupplierEmail({ supplierId });
  if (!toEmail) {
    return { ok: false, error: "missing_recipient" };
  }

  const emailReq = buildSupplierThreadEmail({
    quoteId,
    supplierId,
    toEmail,
    adminMessageText: INVITE_BODY,
    subjectOverride: INVITE_SUBJECT,
  });
  if (!emailReq) {
    return { ok: false, error: "disabled" };
  }

  const sendResult = await getEmailSender().send(emailReq);
  if (!sendResult.ok) {
    return { ok: false, error: "send_failed" };
  }

  return { ok: true };
}

