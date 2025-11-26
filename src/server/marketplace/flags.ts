const RFQS_FEATURE_ENABLED =
  process.env.RFQS_ENABLED === "true" ||
  process.env.NEXT_PUBLIC_RFQS_ENABLED === "true";

export function isRfqsFeatureEnabled(): boolean {
  return RFQS_FEATURE_ENABLED;
}

export function isMissingRfqTableError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const code =
    "code" in error && typeof (error as { code?: unknown }).code === "string"
      ? (error as { code?: string }).code
      : undefined;
  return code === "PGRST205";
}
