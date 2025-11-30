"use client";

import clsx from "clsx";
import { formatDateTime } from "@/lib/formatDate";
import type { QuoteTimelineEvent } from "@/lib/quote/tracking";

type CustomerQuoteTrackingCardProps = {
  events: QuoteTimelineEvent[];
  className?: string;
};

export function CustomerQuoteTrackingCard({
  events,
  className,
}: CustomerQuoteTrackingCardProps) {
  const hasEvents = Array.isArray(events) && events.length > 0;

  return (
    <section className={clsx(className, "space-y-3")}>
      <header>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Tracking
        </p>
        <h2 className="mt-1 text-lg font-semibold text-white">
          Production milestones
        </h2>
        <p className="mt-1 text-sm text-slate-300">
          Follow RFQ progress, supplier bids, and status changes for this quote.
        </p>
      </header>

      {!hasEvents ? (
        <p className="text-xs text-slate-400">
          We’ll show your RFQ and bid activity here as things progress.
        </p>
      ) : (
        <ol className="mt-2 space-y-6 border-l border-slate-800 pl-5">
          {events.map((event) => (
            <li key={event.id} className="relative pb-1 last:pb-0">
              <span className="absolute -left-[9px] mt-1 h-4 w-4 rounded-full border-2 border-emerald-400/60 bg-emerald-500/20" />
              <div className="space-y-1">
                <p className="text-sm font-semibold text-white">{event.title}</p>
                <p className="text-xs text-slate-500">
                  {formatDateTime(event.at, { includeTime: true })}
                </p>
                {event.description ? (
                  <p className="text-sm text-slate-200">{event.description}</p>
                ) : null}
                {event.actorLabel ? (
                  <p className="text-xs uppercase tracking-wide text-slate-500">
                    {event.actorLabel}
                  </p>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
