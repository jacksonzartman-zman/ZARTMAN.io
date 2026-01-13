export function isRfqFeedbackEnabled(): boolean {
  const raw = typeof process.env.RFQ_FEEDBACK_ENABLED === "string" ? process.env.RFQ_FEEDBACK_ENABLED : "";
  const normalized = raw.trim().toLowerCase();
  if (!normalized) return false;
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

