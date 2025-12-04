const SUPPLIER_ASSIGNMENTS_ENABLED =
  process.env.SUPPLIER_ASSIGNMENTS_ENABLED === "true" ||
  process.env.NEXT_PUBLIC_SUPPLIER_ASSIGNMENTS_ENABLED === "true";

const SUPPLIER_APPROVALS_ENABLED =
  process.env.SUPPLIER_APPROVALS_ENABLED === "true" ||
  process.env.NEXT_PUBLIC_SUPPLIER_APPROVALS_ENABLED === "true";

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
