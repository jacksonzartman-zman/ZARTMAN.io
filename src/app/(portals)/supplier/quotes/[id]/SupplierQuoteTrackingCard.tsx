"use client";

import clsx from "clsx";
import { formatDateTime } from "@/lib/formatDate";
import type { QuoteTimelineEvent } from "@/lib/quote/tracking";

type SupplierQuoteTrackingCardProps = {
  events: QuoteTimelineEvent[];
  className?: string;
};

export function SupplierQuoteTrackingCard({
  events,
  className,
}: SupplierQuoteTrackingCardProps) {
  const hasEvents = Array.isArray(events) && events.length > 0;

  return (
    <section className={clsx(className, "space-y-3")}>
      <header>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          TIMELINE
        </p>
        <h2 className="mt-1 text-lg font-semibold text-white">
          Quote activity timeline
        </h2>
        <p className="mt-1 text-sm text-slate-300">
          Keep tabs on RFQ milestones, your bid submissions, and final decisions.
        </p>
      </header>

      {!hasEvents ? (
        <p className="text-xs text-slate-400">
          We’ll surface status changes and your bid history once activity begins.
        </p>
      ) : (
        <ol className="mt-2 space-y-4 border-l border-slate-800 pl-5">
          {events.map((event) => (
            <li key={event.id} className="relative pb-2 last:pb-0">
              <span className="absolute -left-[6px] mt-1 h-3 w-3 rounded-full border-2 border-blue-400/50 bg-blue-400/10" />
              <div className="space-y-0.5">
                <p className="text-sm font-semibold text-white">{event.title}</p>
                <p className="text-[11px] text-slate-500">
                  {formatDateTime(event.at, { includeTime: true })}
                </p>
                {event.description ? (
                  <p className="text-xs text-slate-200">{event.description}</p>
                ) : null}
                {event.actorLabel ? (
                  <p className="text-[10px] uppercase tracking-wide text-slate-500">
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
