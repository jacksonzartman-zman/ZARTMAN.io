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
 * - Phase-grouped history (Search → Bidding → Award → Kickoff → Execution)
 * - Client-side filters (All / Messages / Status changes / Kickoff)
 * - Server-side filtering ensures non-admins only see safe events
 */
export async function QuoteTimeline({
  quoteId,
  actorRole,
  actorUserId,
  className,
  emptyState = "Updates will appear here as files, bids, and selections progress.",
}: QuoteTimelineProps) {
  const result = await getQuoteEventsForTimeline({
    quoteId,
    actorRole,
    actorUserId,
  });

  const events = result.ok ? result.events : [];
  const rfqPhaseLabel = actorRole === "admin" ? undefined : "Search";

  return (
    <QuoteTimelineClient
      rawEvents={events}
      className={clsx(className)}
      emptyState={emptyState}
      rfqPhaseLabel={rfqPhaseLabel}
    />
  );
}

