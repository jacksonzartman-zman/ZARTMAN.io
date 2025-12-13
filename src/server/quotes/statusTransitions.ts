import { normalizeQuoteStatus, type QuoteStatus } from "@/server/quotes/status";
import type { QuoteEventActorRole } from "@/server/quotes/events";

export type QuoteStatusAction = "archive" | "reopen";

export function normalizeTargetStatus(action: QuoteStatusAction): QuoteStatus {
  if (action === "archive") return "cancelled";
  return "in_review";
}

export function canTransitionQuoteStatus(
  from: string | null | undefined,
  to: string | null | undefined,
  actorRole: QuoteEventActorRole,
): boolean {
  const fromStatus = normalizeQuoteStatus(from);
  const toStatus = normalizeQuoteStatus(to);
  const role = (actorRole ?? "").toString().trim().toLowerCase();

  // Only admin/customer are permitted to use these status transitions.
  if (role !== "admin" && role !== "customer") {
    return false;
  }

  // Archive maps to Cancelled.
  if (toStatus === "cancelled") {
    return fromStatus !== "cancelled";
  }

  // Reopen maps to In review.
  if (toStatus === "in_review") {
    return fromStatus === "cancelled" || fromStatus === "lost";
  }

  return false;
}
