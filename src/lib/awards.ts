type AwardedByPerspective = "customer" | "admin" | "supplier";

export function formatAwardedByLabel(
  role?: string | null,
  options?: { perspective?: AwardedByPerspective },
): string {
  const normalized = typeof role === "string" ? role.trim().toLowerCase() : "";

  if (normalized === "customer") {
    return options?.perspective === "customer" ? "You" : "Customer";
  }

  if (normalized === "admin") {
    return options?.perspective === "admin" ? "You" : "Admin";
  }

  return "Zartman team";
}

export function formatShortId(value?: string | null): string {
  if (typeof value !== "string") {
    return "-";
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return "-";
  }
  if (trimmed.length <= 8) {
    return trimmed;
  }
  return `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`;
}
