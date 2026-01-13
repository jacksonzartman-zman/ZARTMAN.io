const ADMIN_PREFIXES = {
  quotes: "[admin quotes]",
  uploads: "[admin uploads]",
  dashboard: "[admin dashboard]",
} as const;

type AdminLogScope = keyof typeof ADMIN_PREFIXES;
type LogLevel = "info" | "warn" | "error";

type LogContext = Record<string, unknown | null | undefined>;

export type { SerializedSupabaseError } from "@/server/db/schemaErrors";
export {
  extractSupabaseSource,
  handleMissingSupabaseRelation,
  handleMissingSupabaseSchema,
  isMissingColumnError,
  isMissingSchemaError,
  isMissingSupabaseRelationError,
  isMissingTableOrColumnError,
  isRowLevelSecurityDeniedError,
  isSupabaseRelationMarkedMissing,
  isSupabaseSelectIncompatibleError,
  isSupabaseSelectParseError,
  isSupabaseUnknownRelationshipError,
  markSupabaseRelationMissing,
  serializeSupabaseError,
  warnOnce,
} from "@/server/db/schemaErrors";

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
