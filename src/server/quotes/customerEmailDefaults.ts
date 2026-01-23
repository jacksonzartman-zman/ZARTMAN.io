import { supabaseServer } from "@/lib/supabaseServer";
import { schemaGate } from "@/server/db/schemaContract";
import {
  handleMissingSupabaseSchema,
  isSupabaseRelationMarkedMissing,
  serializeSupabaseError,
  warnOnce,
} from "@/server/db/schemaErrors";
import { isCustomerEmailBridgeEnabled } from "@/server/quotes/customerEmailPrefs";

const WARN_PREFIX = "[customer_email_defaults]";
const CUSTOMER_PREFS_RELATION = "customer_email_prefs";
const QUOTE_PREFS_RELATION = "quote_email_prefs";

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export type CustomerEmailDefaultOptInResult =
  | { ok: true; optedIn: boolean }
  | { ok: false; reason: "disabled" | "unsupported" };

export async function getCustomerEmailDefaultOptIn(
  customerId: string,
): Promise<CustomerEmailDefaultOptInResult> {
  const id = normalizeString(customerId);
  if (!id) return { ok: false, reason: "unsupported" };

  // Safe-by-default: if disabled, do not probe DB.
  if (!isCustomerEmailBridgeEnabled()) {
    return { ok: false, reason: "disabled" };
  }

  const hasSchema = await schemaGate({
    enabled: true,
    relation: CUSTOMER_PREFS_RELATION,
    requiredColumns: ["customer_id", "email_replies_default", "updated_at"],
    warnPrefix: WARN_PREFIX,
    warnKey: "customer_email_defaults:customer_email_prefs",
  });
  if (!hasSchema) {
    warnOnce(
      "customer_email_defaults:customer_email_prefs_missing",
      `${WARN_PREFIX} missing relation; skipping`,
    );
    return { ok: false, reason: "unsupported" };
  }

  if (isSupabaseRelationMarkedMissing(CUSTOMER_PREFS_RELATION)) {
    return { ok: false, reason: "unsupported" };
  }

  try {
    const { data, error } = await supabaseServer()
      .from(CUSTOMER_PREFS_RELATION)
      .select("email_replies_default")
      .eq("customer_id", id)
      .maybeSingle<{ email_replies_default: boolean | null }>();

    if (error) {
      if (
        handleMissingSupabaseSchema({
          relation: CUSTOMER_PREFS_RELATION,
          error,
          warnPrefix: WARN_PREFIX,
          warnKey: "customer_email_defaults:customer_email_prefs_missing_runtime",
        })
      ) {
        return { ok: false, reason: "unsupported" };
      }
      warnOnce(
        "customer_email_defaults:select_failed",
        `${WARN_PREFIX} lookup failed; defaulting disabled`,
        { code: serializeSupabaseError(error).code },
      );
      return { ok: true, optedIn: false };
    }

    return { ok: true, optedIn: Boolean(data?.email_replies_default) };
  } catch (error) {
    if (
      handleMissingSupabaseSchema({
        relation: CUSTOMER_PREFS_RELATION,
        error,
        warnPrefix: WARN_PREFIX,
        warnKey: "customer_email_defaults:customer_email_prefs_missing_crash",
      })
    ) {
      return { ok: false, reason: "unsupported" };
    }
    warnOnce(
      "customer_email_defaults:select_crash",
      `${WARN_PREFIX} lookup crashed; defaulting disabled`,
      { error: String(error) },
    );
    return { ok: true, optedIn: false };
  }
}

export async function setCustomerEmailDefaultOptIn(
  customerId: string,
  optedIn: boolean,
): Promise<{ ok: true } | { ok: false; reason: "disabled" | "unsupported" }> {
  const id = normalizeString(customerId);
  if (!id) return { ok: false, reason: "unsupported" };

  // Safe-by-default: if disabled, do not probe DB.
  if (!isCustomerEmailBridgeEnabled()) {
    return { ok: false, reason: "disabled" };
  }

  const hasSchema = await schemaGate({
    enabled: true,
    relation: CUSTOMER_PREFS_RELATION,
    requiredColumns: ["customer_id", "email_replies_default", "updated_at"],
    warnPrefix: WARN_PREFIX,
    warnKey: "customer_email_defaults:customer_email_prefs_upsert",
  });
  if (!hasSchema) {
    warnOnce(
      "customer_email_defaults:customer_email_prefs_upsert_missing",
      `${WARN_PREFIX} missing relation; skipping`,
    );
    return { ok: false, reason: "unsupported" };
  }

  if (isSupabaseRelationMarkedMissing(CUSTOMER_PREFS_RELATION)) {
    return { ok: false, reason: "unsupported" };
  }

  try {
    const { error } = await supabaseServer().from(CUSTOMER_PREFS_RELATION).upsert(
      {
        customer_id: id,
        email_replies_default: Boolean(optedIn),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "customer_id" },
    );

    if (error) {
      if (
        handleMissingSupabaseSchema({
          relation: CUSTOMER_PREFS_RELATION,
          error,
          warnPrefix: WARN_PREFIX,
          warnKey: "customer_email_defaults:customer_email_prefs_upsert_missing_schema",
        })
      ) {
        return { ok: false, reason: "unsupported" };
      }
      warnOnce(
        "customer_email_defaults:upsert_failed",
        `${WARN_PREFIX} upsert failed; skipping`,
        { code: serializeSupabaseError(error).code },
      );
      return { ok: false, reason: "unsupported" };
    }

    return { ok: true };
  } catch (error) {
    if (
      handleMissingSupabaseSchema({
        relation: CUSTOMER_PREFS_RELATION,
        error,
        warnPrefix: WARN_PREFIX,
        warnKey: "customer_email_defaults:customer_email_prefs_upsert_crash_missing_schema",
      })
    ) {
      return { ok: false, reason: "unsupported" };
    }
    warnOnce(
      "customer_email_defaults:upsert_crash",
      `${WARN_PREFIX} upsert crashed; skipping`,
      { error: String(error) },
    );
    return { ok: false, reason: "unsupported" };
  }
}

/**
 * Best-effort helper: if the customer has opted into email-first defaults,
 * initialize quote_email_prefs for new quotes (does not touch existing quotes).
 *
 * Safe-by-default: if CUSTOMER_EMAIL_BRIDGE_ENABLED is off, no DB probes/writes occur.
 * Fail-soft: never throws and never blocks quote creation.
 */
export async function applyCustomerEmailDefaultToNewQuote(args: {
  quoteId: string;
  customerId: string;
}): Promise<void> {
  const quoteId = normalizeString(args.quoteId);
  const customerId = normalizeString(args.customerId);
  if (!quoteId || !customerId) return;

  // Safe-by-default: if disabled, do not probe DB.
  if (!isCustomerEmailBridgeEnabled()) return;

  const defaultStatus = await getCustomerEmailDefaultOptIn(customerId);
  if (!defaultStatus.ok || !defaultStatus.optedIn) return;

  const hasSchema = await schemaGate({
    enabled: true,
    relation: QUOTE_PREFS_RELATION,
    requiredColumns: ["quote_id", "customer_id", "customer_email_enabled", "updated_at"],
    warnPrefix: WARN_PREFIX,
    warnKey: "customer_email_defaults:quote_email_prefs",
  });
  if (!hasSchema) {
    // Per requirements: fail-soft (no crashes, no 404 spam). warnOnce is already deduped.
    warnOnce(
      "customer_email_defaults:quote_email_prefs_missing",
      `${WARN_PREFIX} quote_email_prefs missing; skipping`,
    );
    return;
  }

  if (isSupabaseRelationMarkedMissing(QUOTE_PREFS_RELATION)) {
    return;
  }

  try {
    const { error } = await supabaseServer().from(QUOTE_PREFS_RELATION).upsert(
      {
        quote_id: quoteId,
        customer_id: customerId,
        customer_email_enabled: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "quote_id,customer_id" },
    );

    if (error) {
      if (
        handleMissingSupabaseSchema({
          relation: QUOTE_PREFS_RELATION,
          error,
          warnPrefix: WARN_PREFIX,
          warnKey: "customer_email_defaults:quote_email_prefs_missing_schema",
        })
      ) {
        return;
      }
      warnOnce(
        "customer_email_defaults:quote_email_prefs_upsert_failed",
        `${WARN_PREFIX} quote prefs upsert failed; skipping`,
        { code: serializeSupabaseError(error).code },
      );
    }
  } catch (error) {
    if (
      handleMissingSupabaseSchema({
        relation: QUOTE_PREFS_RELATION,
        error,
        warnPrefix: WARN_PREFIX,
        warnKey: "customer_email_defaults:quote_email_prefs_crash_missing_schema",
      })
    ) {
      return;
    }
    warnOnce(
      "customer_email_defaults:quote_email_prefs_upsert_crash",
      `${WARN_PREFIX} quote prefs upsert crashed; skipping`,
      { error: String(error) },
    );
  }
}

