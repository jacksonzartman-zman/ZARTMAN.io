const SUPPLIER_ASSIGNMENTS_ENABLED =
  process.env.SUPPLIER_ASSIGNMENTS_ENABLED === "true" ||
  process.env.NEXT_PUBLIC_SUPPLIER_ASSIGNMENTS_ENABLED === "true";

const SUPPLIER_APPROVALS_ENABLED =
  process.env.SUPPLIER_APPROVALS_ENABLED === "true" ||
  process.env.NEXT_PUBLIC_SUPPLIER_APPROVALS_ENABLED === "true";

const AWARD_COLUMN_TOKENS = [
  "awarded_bid_id",
  "awarded_supplier_id",
  "awarded_at",
  "awarded_by_user_id",
  "awarded_by_role",
] as const;

export function isSupplierAssignmentsEnabled(): boolean {
  return SUPPLIER_ASSIGNMENTS_ENABLED;
}

export function approvalsEnabled(): boolean {
  return SUPPLIER_APPROVALS_ENABLED;
}

export function isMissingSupplierAssignmentsColumnError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const maybeError = error as { code?: unknown; message?: unknown };
  const code = typeof maybeError.code === "string" ? maybeError.code : null;
  if (code !== "42703") {
    return false;
  }

  const message =
    typeof maybeError.message === "string" ? maybeError.message.toLowerCase() : "";

  return message.includes("assigned_supplier_email");
}

export function isMissingQuoteAwardColumnsError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const maybeError = error as {
    code?: unknown;
    message?: unknown;
    details?: unknown;
    hint?: unknown;
  };

  const code =
    typeof maybeError.code === "string"
      ? maybeError.code.trim().toUpperCase()
      : null;

  const haystack = [
    typeof maybeError.message === "string"
      ? maybeError.message.toLowerCase()
      : "",
    typeof maybeError.details === "string"
      ? maybeError.details.toLowerCase()
      : "",
    typeof maybeError.hint === "string" ? maybeError.hint.toLowerCase() : "",
  ].join(" ");

  const mentionsAwardColumn = AWARD_COLUMN_TOKENS.some((token) =>
    haystack.includes(token),
  );
  if (!mentionsAwardColumn) {
    return false;
  }

  if (!code) {
    return true;
  }

  if (code === "42703") {
    return true;
  }

  if (code.startsWith("PGRST")) {
    return true;
  }

  return haystack.includes("schema") || haystack.includes("column");
}
