const ADMIN_PREFIXES = {
  quotes: "[admin quotes]",
  uploads: "[admin uploads]",
  dashboard: "[admin dashboard]",
} as const;

type AdminLogScope = keyof typeof ADMIN_PREFIXES;
type LogLevel = "info" | "warn" | "error";

type LogContext = Record<string, unknown | null | undefined>;

export type SerializedSupabaseError = {
  message?: string;
  details?: string;
  hint?: string;
  code?: string;
};

function logWithScope(
  scope: AdminLogScope,
  level: LogLevel,
  message: string,
  context?: LogContext,
) {
  const prefix = ADMIN_PREFIXES[scope];
  const payload = sanitizeContext(context);
  const body =
    payload && Object.keys(payload).length > 0 ? [payload] : ([] as unknown[]);
  const args = [`${prefix} ${message}`, ...body];

  if (level === "error") {
    console.error(...args);
    return;
  }
  if (level === "warn") {
    console.warn(...args);
    return;
  }
  console.log(...args);
}

function sanitizeContext(context?: LogContext | null) {
  if (!context) {
    return null;
  }
  const entries = Object.entries(context).filter(
    ([, value]) => typeof value !== "undefined",
  );
  if (entries.length === 0) {
    return null;
  }
  return Object.fromEntries(entries);
}

export function logAdminQuotesInfo(message: string, context?: LogContext) {
  logWithScope("quotes", "info", message, context);
}

export function logAdminQuotesWarn(message: string, context?: LogContext) {
  logWithScope("quotes", "warn", message, context);
}

export function logAdminQuotesError(message: string, context?: LogContext) {
  logWithScope("quotes", "error", message, context);
}

export function logAdminUploadsInfo(message: string, context?: LogContext) {
  logWithScope("uploads", "info", message, context);
}

export function logAdminUploadsWarn(message: string, context?: LogContext) {
  logWithScope("uploads", "warn", message, context);
}

export function logAdminUploadsError(message: string, context?: LogContext) {
  logWithScope("uploads", "error", message, context);
}

export function logAdminDashboardInfo(message: string, context?: LogContext) {
  logWithScope("dashboard", "info", message, context);
}

export function logAdminDashboardWarn(message: string, context?: LogContext) {
  logWithScope("dashboard", "warn", message, context);
}

export function logAdminDashboardError(message: string, context?: LogContext) {
  logWithScope("dashboard", "error", message, context);
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

  const code =
    "code" in source && typeof (source as { code?: unknown }).code === "string"
      ? ((source as { code?: string }).code as string)
      : null;

  if (!code) {
    return false;
  }

  return MISSING_SCHEMA_CODES.has(code);
}

// Alias for clarity when guarding admin-only views / RPCs.
export function isMissingSchemaError(error: unknown): boolean {
  return isMissingTableOrColumnError(error);
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

  const code =
    "code" in source && typeof (source as { code?: unknown }).code === "string"
      ? ((source as { code?: string }).code as string)
      : null;
  const message =
    "message" in source &&
    typeof (source as { message?: unknown }).message === "string"
      ? ((source as { message?: string }).message as string)
      : null;

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
