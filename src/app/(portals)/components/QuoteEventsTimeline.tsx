/**
 * Durable quote events timeline shared by all portals.
 * Newest-first, human-readable, and safe to show across roles.
 */
import clsx from "clsx";
import { formatDateTime } from "@/lib/formatDate";
import type { QuoteEventRecord } from "@/server/quotes/events";
import { formatQuoteEvent } from "@/lib/quoteEvents/formatQuoteEvent";
import { Fragment } from "react";
import { EmptyStateCard } from "@/components/EmptyStateCard";

type QuoteEventsTimelineProps = {
  events: QuoteEventRecord[];
  className?: string;
  headingLabel?: string;
  title?: string;
  description?: string;
  emptyState?: string;
  dotClassName?: string;
};

export function QuoteEventsTimeline({
  events,
  className,
  headingLabel,
  title = "Activity",
  description,
  emptyState = "No activity yet.",
  dotClassName,
}: QuoteEventsTimelineProps) {
  const hasEvents = Array.isArray(events) && events.length > 0;
  const formattedEvents = hasEvents
    ? events.map((event) => ({ event, formatted: formatQuoteEvent(event) }))
    : [];
  const dotClasses = clsx(
    "absolute left-0 top-1.5 h-2 w-2 rounded-full bg-emerald-400",
    dotClassName,
  );

  return (
    <section className={clsx("space-y-3", className)}>
      <header>
        {headingLabel ? (
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            {headingLabel}
          </p>
        ) : null}
        <h2 className="mt-1 text-lg font-semibold text-white">{title}</h2>
        {description ? (
          <p className="mt-1 text-sm text-slate-300">{description}</p>
        ) : null}
      </header>

      {!hasEvents ? (
        <EmptyStateCard
          title="No activity yet"
          description={emptyState}
          className="px-4 py-3"
        />
      ) : (
        <ol className="mt-4 space-y-3 border-l border-slate-800">
          {formattedEvents.map((entry, index) => {
            const mapped = entry.formatted;
            const previousGroupKey =
              index > 0 ? formattedEvents[index - 1]?.formatted.groupKey : null;
            const showGroupHeader =
              index === 0 || mapped.groupKey !== previousGroupKey;
            return (
              <Fragment key={entry.event.id}>
                {showGroupHeader ? (
                  <li
                    className={clsx(
                      "relative pl-6",
                      index === 0 ? "pt-0" : "pt-4",
                    )}
                  >
                    <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-slate-500">
                      {mapped.groupLabel}
                    </p>
                  </li>
                ) : null}
                <li className="relative pl-6">
                  <span className={dotClasses} />
                  <p className="text-sm font-medium text-slate-100">
                    {mapped.title}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-400">
                    {formatDateTime(entry.event.created_at, { includeTime: true })}
                  </p>
                  {mapped.subtitle ? (
                    <p className="mt-0.5 text-xs text-slate-500">
                      {mapped.subtitle}
                    </p>
                  ) : null}
                  {mapped.actorLabel ? (
                    <p className="mt-0.5 text-[10px] uppercase tracking-wide text-slate-500">
                      {mapped.actorLabel}
                    </p>
                  ) : null}
                </li>
              </Fragment>
            );
          })}
        </ol>
      )}
    </section>
  );
}

