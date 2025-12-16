export type AwardFeedbackReason =
  | "best_capacity"
  | "best_price"
  | "best_lead_time"
  | "best_quality"
  | "existing_relationship"
  | "only_bidder"
  | "other";

export type AwardFeedbackConfidence = "high" | "medium" | "low";

export const AWARD_FEEDBACK_REASON_OPTIONS: Array<{
  value: AwardFeedbackReason;
  label: string;
}> = [
  { value: "best_capacity", label: "Best capacity" },
  { value: "best_price", label: "Best price" },
  { value: "best_lead_time", label: "Best lead time" },
  { value: "best_quality", label: "Best quality" },
  { value: "existing_relationship", label: "Existing relationship" },
  { value: "only_bidder", label: "Only bidder" },
  { value: "other", label: "Other" },
];

export const AWARD_FEEDBACK_CONFIDENCE_OPTIONS: Array<{
  value: AwardFeedbackConfidence;
  label: string;
}> = [
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
];

export const AWARD_FEEDBACK_MAX_NOTES_LENGTH = 280;

export function isAwardFeedbackReason(value: unknown): value is AwardFeedbackReason {
  return (
    typeof value === "string" &&
    AWARD_FEEDBACK_REASON_OPTIONS.some((opt) => opt.value === value)
  );
}

export function isAwardFeedbackConfidence(
  value: unknown,
): value is AwardFeedbackConfidence {
  return (
    typeof value === "string" &&
    AWARD_FEEDBACK_CONFIDENCE_OPTIONS.some((opt) => opt.value === value)
  );
}

export function formatAwardFeedbackReasonLabel(
  value: unknown,
): string | null {
  if (typeof value !== "string") return null;
  const match = AWARD_FEEDBACK_REASON_OPTIONS.find((opt) => opt.value === value);
  return match?.label ?? null;
}

export function formatAwardFeedbackConfidenceLabel(
  value: unknown,
): string | null {
  if (typeof value !== "string") return null;
  const match = AWARD_FEEDBACK_CONFIDENCE_OPTIONS.find(
    (opt) => opt.value === value,
  );
  return match?.label ?? null;
}

export function truncateForTimeline(
  value: unknown,
  maxLen: number,
): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length <= maxLen) return trimmed;
  return `${trimmed.slice(0, Math.max(0, maxLen - 1))}…`;
}

