export type SerializedSupabaseError = {
  message?: string;
  details?: string;
  hint?: string;
  code?: string;
};

type LogContext = Record<string, unknown | null | undefined>;

const WARN_ONCE_KEYS = new Set<string>();

function sanitizeContext(context?: LogContext | null) {
  if (!context) return null;
  const entries = Object.entries(context).filter(([, value]) => typeof value !== "undefined");
  if (entries.length === 0) return null;
  return Object.fromEntries(entries);
}

/**
 * Log a single stable warning line per process.
 * (Avoids repeating PostgREST schema drift spam across requests.)
 */
export function warnOnce(key: string, message: string, context?: LogContext) {
  if (WARN_ONCE_KEYS.has(key)) return;
  WARN_ONCE_KEYS.add(key);
  const payload = sanitizeContext(context);
  if (payload && Object.keys(payload).length > 0) {
    console.warn(message, payload);
  } else {
    console.warn(message);
  }
}

export function extractSupabaseSource(error: unknown): unknown {
  if (
    error &&
    typeof error === "object" &&
    "supabaseError" in error &&
    (error as { supabaseError?: unknown }).supabaseError
  ) {
    return (error as { supabaseError?: unknown }).supabaseError;
  }
  return error;
}

function readStringProp(obj: unknown, key: string): string | null {
  if (!obj || typeof obj !== "object") return null;
  return key in obj && typeof (obj as any)[key] === "string" ? ((obj as any)[key] as string) : null;
}

function readNumberProp(obj: unknown, key: string): number | null {
  if (!obj || typeof obj !== "object") return null;
  return key in obj && typeof (obj as any)[key] === "number" ? ((obj as any)[key] as number) : null;
}

export function serializeSupabaseError(error: unknown): SerializedSupabaseError {
  const source = extractSupabaseSource(error);
  if (!source) return {};

  if (typeof source !== "object") {
    return { message: String(source) };
  }

  const maybeError = source as Record<string, unknown>;

  return {
    code: typeof maybeError.code === "string" ? maybeError.code : undefined,
    message: typeof maybeError.message === "string" ? maybeError.message : undefined,
    details: typeof maybeError.details === "string" ? maybeError.details : undefined,
    hint: typeof maybeError.hint === "string" ? maybeError.hint : undefined,
  };
}

function normalizeSupabaseErrorText(error: unknown): string {
  const serialized: SerializedSupabaseError = serializeSupabaseError(error);
  const parts = [serialized.message, serialized.details, serialized.hint].filter(
    (value): value is string => typeof value === "string" && value.trim().length > 0,
  );
  return parts.join(" ").toLowerCase();
}

/**
 * PostgREST can surface missing relations as either:
 * - PostgrestError with code (ex: PGRST205 / 42P01), or
 * - a 404-ish error shape where the "status" may be present, but code is not.
 */
export function isMissingSupabaseRelationError(error: unknown): boolean {
  const source = extractSupabaseSource(error);
  if (!source || typeof source !== "object") return false;

  const code = readStringProp(source, "code");
  const message = readStringProp(source, "message");
  const details = readStringProp(source, "details");

  // Common "missing resource" variants.
  if (code === "42P01") return true; // undefined_table / undefined_relation
  if (code === "PGRST205") {
    const blob = `${message ?? ""} ${details ?? ""}`.toLowerCase();
    return (
      blob.includes("schema cache") ||
      blob.includes("could not find") ||
      blob.includes("table") ||
      blob.includes("view") ||
      blob.includes("relation")
    );
  }

  // Some adapters attach an HTTP status without exposing a PostgREST code.
  const status = readNumberProp(source, "status") ?? readNumberProp(source, "statusCode") ?? null;
  if (status === 404) {
    const blob = `${message ?? ""} ${details ?? ""}`.toLowerCase();
    return (
      blob.includes("schema cache") ||
      blob.includes("could not find") ||
      blob.includes("table") ||
      blob.includes("view") ||
      blob.includes("relation") ||
      blob.includes("does not exist")
    );
  }

  // Strict fallback: only when it clearly indicates a missing relation.
  const blob = `${message ?? ""} ${details ?? ""}`.toLowerCase();
  return blob.includes("schema cache") && (blob.includes("could not find") || blob.includes("not found"));
}

// Missing schema drift codes:
// - PGRST205: PostgREST schema cache / missing relation/column
// - 42703: undefined_column
// - 42P01: undefined_table / undefined_relation (includes missing views)
const MISSING_SCHEMA_CODES = new Set(["PGRST205", "42703", "42P01"]);

export function isMissingTableOrColumnError(error: unknown): boolean {
  const source = extractSupabaseSource(error);
  if (!source || typeof source !== "object") {
    return false;
  }

  const code = readStringProp(source, "code");
  if (!code) {
    return isMissingSupabaseRelationError(error);
  }

  return MISSING_SCHEMA_CODES.has(code) || isMissingSupabaseRelationError(error);
}

// Alias for clarity when guarding admin-only views / RPCs.
export function isMissingSchemaError(error: unknown): boolean {
  return isMissingTableOrColumnError(error);
}

export function isMissingColumnError(error: unknown, column: string): boolean {
  if (!column) return false;
  if (!isMissingTableOrColumnError(error)) return false;
  const text = normalizeSupabaseErrorText(error);
  return text.includes(column.toLowerCase());
}

export function isSupabaseSelectParseError(error: unknown): boolean {
  const serialized = serializeSupabaseError(error);
  const code = typeof serialized?.code === "string" ? serialized.code : null;
  if (code === "PGRST100") return true;

  const text = normalizeSupabaseErrorText(error);
  return (
    text.includes("failed to parse") ||
    (text.includes("parse") && text.includes("select")) ||
    text.includes("unexpected") ||
    text.includes("syntax error")
  );
}

/**
 * "Unknown relationship" / "could not find foreign key relationship" errors when
 * using embedded resources in a `select(...)`.
 */
export function isSupabaseUnknownRelationshipError(error: unknown): boolean {
  const serialized = serializeSupabaseError(error);
  const code = typeof serialized?.code === "string" ? serialized.code : null;
  if (code === "PGRST200" || code === "PGRST201") return true;

  const text = normalizeSupabaseErrorText(error);
  return (
    text.includes("relationship") &&
    (text.includes("could not find") || text.includes("not found") || text.includes("unknown"))
  );
}

/**
 * Conservative guard for "this select string won't work on this schema variant".
 */
export function isSupabaseSelectIncompatibleError(error: unknown): boolean {
  return (
    isSupabaseSelectParseError(error) ||
    isSupabaseUnknownRelationshipError(error) ||
    isMissingTableOrColumnError(error)
  );
}

const MISSING_RELATIONS = new Set<string>();

export function isSupabaseRelationMarkedMissing(relation: string): boolean {
  const normalized = typeof relation === "string" ? relation.trim() : "";
  if (!normalized) return false;
  return MISSING_RELATIONS.has(normalized);
}

export function markSupabaseRelationMissing(relation: string) {
  const normalized = typeof relation === "string" ? relation.trim() : "";
  if (!normalized) return;
  MISSING_RELATIONS.add(normalized);
}

/**
 * Shared helper to:
 * - detect missing schema drift (missing relation OR missing column),
 * - cache the relation as missing (so we stop querying it),
 * - emit a single stable warning line.
 */
export function handleMissingSupabaseSchema(args: {
  relation: string;
  error: unknown;
  warnPrefix: string;
  warnKey?: string;
}): boolean {
  if (!isMissingTableOrColumnError(args.error)) return false;

  markSupabaseRelationMissing(args.relation);

  const serialized = serializeSupabaseError(args.error);
  const key = args.warnKey ?? `missing_relation:${args.relation}`;
  warnOnce(key, `${args.warnPrefix} missing relation; skipping`, {
    code: serialized.code,
    message: serialized.message,
  });

  return true;
}

/**
 * Compatibility wrapper for older call-sites that only handled the "relation missing" subset.
 */
export function handleMissingSupabaseRelation(args: {
  relation: string;
  error: unknown;
  warnPrefix: string;
}): boolean {
  if (!isMissingSupabaseRelationError(args.error)) return false;
  return handleMissingSupabaseSchema({
    relation: args.relation,
    error: args.error,
    warnPrefix: args.warnPrefix,
  });
}

const RLS_DENIED_CODES = new Set([
  // Postgres: insufficient_privilege (commonly returned for RLS violations)
  "42501",
  // PostgREST: insufficient privileges / RLS blocked (varies by version)
  "PGRST301",
]);

export function isRowLevelSecurityDeniedError(error: unknown): boolean {
  const source = extractSupabaseSource(error);
  if (!source || typeof source !== "object") {
    return false;
  }

  const code = readStringProp(source, "code");
  const message = readStringProp(source, "message");

  if (code && RLS_DENIED_CODES.has(code)) {
    return true;
  }

  if (!message) {
    return false;
  }

  const normalized = message.toLowerCase();
  return (
    normalized.includes("row-level security") ||
    normalized.includes("new row violates row-level security policy") ||
    normalized.includes("permission denied")
  );
}

