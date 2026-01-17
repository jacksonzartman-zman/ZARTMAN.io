import { isMissingTableOrColumnError } from "@/server/db/schemaErrors";

const RFQS_FEATURE_ENABLED =
  process.env.RFQS_ENABLED === "true" ||
  process.env.NEXT_PUBLIC_RFQS_ENABLED === "true";

export function isRfqsFeatureEnabled(): boolean {
  return RFQS_FEATURE_ENABLED;
}

export function isMissingRfqTableError(error: unknown): boolean {
  return isMissingTableOrColumnError(error);
}
