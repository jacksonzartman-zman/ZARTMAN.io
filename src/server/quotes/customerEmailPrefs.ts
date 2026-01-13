import { supabaseServer } from "@/lib/supabaseServer";
import { schemaGate } from "@/server/db/schemaContract";
import {
  handleMissingSupabaseSchema,
  isSupabaseRelationMarkedMissing,
  serializeSupabaseError,
  warnOnce,
} from "@/server/db/schemaErrors";

const WARN_PREFIX = "[email_prefs]";
const RELATION = "quote_email_prefs";

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeBool(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (v === "true") return true;
    if (v === "false") return false;
  }
  return null;
}

export function isCustomerEmailBridgeEnabled(): boolean {
  return normalizeBool(process.env.CUSTOMER_EMAIL_BRIDGE_ENABLED) === true;
}

export async function isCustomerEmailOptedIn(args: {
  quoteId: string;
  customerId: string;
}): Promise<boolean> {
  const quoteId = normalizeString(args.quoteId);
  const customerId = normalizeString(args.customerId);
  if (!quoteId || !customerId) return false;

  // When disabled by env, do not query DB.
  if (!isCustomerEmailBridgeEnabled()) return false;

  const hasSchema = await schemaGate({
    enabled: true,
    relation: RELATION,
    requiredColumns: ["quote_id", "customer_id", "customer_email_enabled"],
    warnPrefix: WARN_PREFIX,
    warnKey: "email_prefs:quote_email_prefs",
  });
  if (!hasSchema) {
    warnOnce("email_prefs:missing_relation", `${WARN_PREFIX} missing relation; skipping`);
    return false;
  }

  if (isSupabaseRelationMarkedMissing(RELATION)) {
    return false;
  }

  try {
    const { data, error } = await supabaseServer
      .from(RELATION)
      .select("customer_email_enabled")
      .eq("quote_id", quoteId)
      .eq("customer_id", customerId)
      .maybeSingle<{ customer_email_enabled: boolean | null }>();

    if (error) {
      if (
        handleMissingSupabaseSchema({
          relation: RELATION,
          error,
          warnPrefix: WARN_PREFIX,
          warnKey: "email_prefs:missing_relation_runtime",
        })
      ) {
        return false;
      }
      warnOnce("email_prefs:select_failed", `${WARN_PREFIX} prefs lookup failed; defaulting disabled`, {
        code: serializeSupabaseError(error).code,
      });
      return false;
    }

    return Boolean(data?.customer_email_enabled);
  } catch (error) {
    if (
      handleMissingSupabaseSchema({
        relation: RELATION,
        error,
        warnPrefix: WARN_PREFIX,
        warnKey: "email_prefs:missing_relation_crash",
      })
    ) {
      return false;
    }
    warnOnce("email_prefs:select_crash", `${WARN_PREFIX} prefs lookup crashed; defaulting disabled`, {
      error: String(error),
    });
    return false;
  }
}

export async function setCustomerEmailOptIn(args: {
  quoteId: string;
  customerId: string;
  enabled: boolean;
}): Promise<{ ok: true } | { ok: false; error: "disabled" | "unsupported" }> {
  const quoteId = normalizeString(args.quoteId);
  const customerId = normalizeString(args.customerId);
  if (!quoteId || !customerId) {
    return { ok: false, error: "unsupported" };
  }

  if (!isCustomerEmailBridgeEnabled()) {
    return { ok: false, error: "disabled" };
  }

  const hasSchema = await schemaGate({
    enabled: true,
    relation: RELATION,
    requiredColumns: ["quote_id", "customer_id", "customer_email_enabled", "updated_at"],
    warnPrefix: WARN_PREFIX,
    warnKey: "email_prefs:quote_email_prefs_upsert",
  });
  if (!hasSchema) {
    warnOnce("email_prefs:upsert_unsupported", `${WARN_PREFIX} missing relation; skipping`);
    return { ok: false, error: "unsupported" };
  }

  if (isSupabaseRelationMarkedMissing(RELATION)) {
    return { ok: false, error: "unsupported" };
  }

  try {
    const { error } = await supabaseServer.from(RELATION).upsert(
      {
        quote_id: quoteId,
        customer_id: customerId,
        customer_email_enabled: Boolean(args.enabled),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "quote_id,customer_id" },
    );

    if (error) {
      if (
        handleMissingSupabaseSchema({
          relation: RELATION,
          error,
          warnPrefix: WARN_PREFIX,
          warnKey: "email_prefs:upsert_missing_schema",
        })
      ) {
        return { ok: false, error: "unsupported" };
      }
      warnOnce("email_prefs:upsert_failed", `${WARN_PREFIX} upsert failed; skipping`, {
        code: serializeSupabaseError(error).code,
      });
      return { ok: false, error: "unsupported" };
    }

    return { ok: true };
  } catch (error) {
    if (
      handleMissingSupabaseSchema({
        relation: RELATION,
        error,
        warnPrefix: WARN_PREFIX,
        warnKey: "email_prefs:upsert_crash_missing_schema",
      })
    ) {
      return { ok: false, error: "unsupported" };
    }
    warnOnce("email_prefs:upsert_crash", `${WARN_PREFIX} upsert crashed; skipping`, {
      error: String(error),
    });
    return { ok: false, error: "unsupported" };
  }
}

