/**
 * Compact audit-trail timeline shared by all portals.
 * Emphasizes dense rhythm, aligned markers, and subdued metadata styling.
 */
import clsx from "clsx";

import { formatDateTime } from "@/lib/formatDate";
import type { QuoteTimelineEvent } from "@/lib/quote/tracking";
import { EmptyStateCard } from "@/components/EmptyStateCard";

type QuoteActivityTimelineProps = {
  events: QuoteTimelineEvent[];
  className?: string;
  headingLabel?: string;
  title: string;
  description?: string;
  emptyState?: string;
  dotClassName?: string;
};

export function QuoteActivityTimeline({
  events,
  className,
  headingLabel,
  title,
  description,
  emptyState,
  dotClassName,
}: QuoteActivityTimelineProps) {
  const hasEvents = Array.isArray(events) && events.length > 0;
  const dotClasses = clsx(
    "absolute left-0 top-1 h-2 w-2 rounded-full bg-emerald-400",
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
          description={
            emptyState ??
            "Timeline data will populate once we record RFQ or offer activity."
          }
          className="px-4 py-3"
        />
      ) : (
        <ol className="mt-4 space-y-3 border-l border-slate-800">
          {events.map((event) => (
            <li key={event.id} className="relative pl-6">
              <span className={dotClasses} />
              <p className="text-sm font-medium text-slate-100">
                {event.title}
              </p>
              <p className="mt-0.5 text-xs text-slate-400">
                {formatDateTime(event.at, { includeTime: true })}
              </p>
              {event.description ? (
                <p className="mt-0.5 text-xs text-slate-500">
                  {event.description}
                </p>
              ) : null}
              {event.actorLabel ? (
                <p className="mt-0.5 text-[10px] uppercase tracking-wide text-slate-500">
                  {event.actorLabel}
                </p>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
