import clsx from "clsx";
import { Fragment } from "react";
import { formatQuoteEvent } from "@/lib/quoteEvents/formatQuoteEvent";
import { formatRelativeTimeFromTimestamp, toTimestamp } from "@/lib/relativeTime";
import {
  getQuoteEventsForTimeline,
  type QuoteEventActorRole,
} from "@/server/quotes/events";

type QuoteTimelineProps = {
  quoteId: string;
  actorRole: Exclude<QuoteEventActorRole, "system">;
  actorUserId: string | null;
  className?: string;
  emptyState?: string;
};

/**
 * Shared quote timeline (admin + customer + supplier).
 * - Newest first
 * - Uses the shared quote event formatter
 * - Uses relative timestamps
 * - Server-side filtering ensures non-admins only see safe events
 */
export async function QuoteTimeline({
  quoteId,
  actorRole,
  actorUserId,
  className,
  emptyState = "No updates yet.",
}: QuoteTimelineProps) {
  const result = await getQuoteEventsForTimeline({
    quoteId,
    actorRole,
    actorUserId,
  });

  const events = result.ok ? result.events : [];

  if (events.length === 0) {
    return <p className={clsx("text-xs text-slate-400", className)}>{emptyState}</p>;
  }

  const dotClasses =
    "absolute left-0 top-2 h-2 w-2 rounded-full bg-emerald-400";

  return (
    <ol className={clsx("space-y-4 border-l border-slate-800", className)}>
      {events.map((event, index) => {
        const formatted = formatQuoteEvent(event);
        const relative =
          formatRelativeTimeFromTimestamp(toTimestamp(event.created_at)) ??
          "—";
        const showSubtitle =
          typeof formatted.subtitle === "string" && formatted.subtitle.trim().length > 0;
        const showActor =
          typeof formatted.actorLabel === "string" &&
          formatted.actorLabel.trim().length > 0;

        return (
          <Fragment key={event.id}>
            <li className={clsx("relative pl-6", index === 0 ? "pt-0" : "pt-1")}>
              <span className={dotClasses} />
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="text-sm font-medium text-slate-100">
                  {formatted.title}
                </p>
                <p className="text-xs text-slate-400">{relative}</p>
              </div>
              {showSubtitle ? (
                <p className="mt-1 text-xs text-slate-400">
                  {formatted.subtitle}
                </p>
              ) : null}
              {showActor ? (
                <p className="mt-1 text-[10px] uppercase tracking-wide text-slate-500">
                  {formatted.actorLabel}
                </p>
              ) : null}
            </li>
          </Fragment>
        );
      })}
    </ol>
  );
}

