import clsx from "clsx";
import {
  getQuoteEventsForTimeline,
  type QuoteEventActorRole,
} from "@/server/quotes/events";
import { QuoteTimelineClient } from "@/app/(portals)/components/QuoteTimelineClient";

type QuoteTimelineProps = {
  quoteId: string;
  actorRole: Exclude<QuoteEventActorRole, "system">;
  actorUserId: string | null;
  className?: string;
  emptyState?: string;
};

/**
 * Shared quote timeline (admin + customer + supplier).
 * - Phase-grouped history (RFQ → Bidding → Award → Kickoff → Execution)
 * - Client-side filters (All / Messages / Status changes / Kickoff)
 * - Server-side filtering ensures non-admins only see safe events
 */
export async function QuoteTimeline({
  quoteId,
  actorRole,
  actorUserId,
  className,
  emptyState = "No timeline updates yet. We’ll log key milestones here as your RFQ moves forward.",
}: QuoteTimelineProps) {
  const result = await getQuoteEventsForTimeline({
    quoteId,
    actorRole,
    actorUserId,
  });

  const events = result.ok ? result.events : [];

  return (
    <QuoteTimelineClient
      rawEvents={events}
      className={clsx(className)}
      emptyState={emptyState}
    />
  );
}

