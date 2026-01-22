"use client";

import clsx from "clsx";
import { useMemo, useState } from "react";
import { formatDateTime } from "@/lib/formatDate";
import { formatRelativeTimeFromTimestamp, toTimestamp } from "@/lib/relativeTime";
import type { QuoteEventRecord } from "@/server/quotes/events";
import {
  groupTimelineEventsByPhase,
  isMessageTimelineEvent,
  isStatusChangeTimelineEvent,
  mapRawEventToTimelineEvent,
  type QuotePhase,
  type QuoteTimelineEvent,
} from "@/lib/timeline/quoteTimeline";

type TimelineFilterKey = "all" | "messages" | "status" | "kickoff";

const PHASE_ORDER: QuotePhase[] = [
  "rfq",
  "bidding",
  "award",
  "kickoff",
  "execution",
];

const PHASE_LABELS: Record<QuotePhase, string> = {
  rfq: "Search request",
  bidding: "Offers",
  award: "Introduction",
  kickoff: "Kickoff",
  execution: "Execution",
};

export function QuoteTimelineClient({
  rawEvents,
  className,
  emptyState = "Updates will appear here as files, offers, and introductions progress.",
  rfqPhaseLabel,
}: {
  rawEvents: QuoteEventRecord[];
  className?: string;
  emptyState?: string;
  rfqPhaseLabel?: string;
}) {
  const [filter, setFilter] = useState<TimelineFilterKey>("all");
  const phaseLabels = useMemo(
    () => ({
      ...PHASE_LABELS,
      rfq: rfqPhaseLabel ?? PHASE_LABELS.rfq,
    }),
    [rfqPhaseLabel],
  );
  const copyVariant = rfqPhaseLabel ? "search" : "rfq";

  const timelineEvents: QuoteTimelineEvent[] = useMemo(() => {
    const events = Array.isArray(rawEvents) ? rawEvents : [];
    const mapped = events.map((event) =>
      mapRawEventToTimelineEvent(
        {
          id: event.id,
          quote_id: event.quote_id,
          event_type: event.event_type,
          created_at: event.created_at,
          actor_role: event.actor_role,
          // Note: do not pass message body; quote_events metadata only contains safe identifiers.
          metadata: event.metadata ?? {},
          payload: event.payload ?? null,
        },
        { copyVariant },
      ),
    );

    // Chronological order for human-readable history.
    mapped.sort((a, b) => {
      const aMs = Date.parse(a.occurredAt) || 0;
      const bMs = Date.parse(b.occurredAt) || 0;
      return aMs - bMs;
    });

    return mapped;
  }, [rawEvents, copyVariant]);

  const filteredEvents = useMemo(() => {
    if (filter === "all") return timelineEvents;
    if (filter === "messages") {
      return timelineEvents.filter((e) => isMessageTimelineEvent(e.type));
    }
    if (filter === "status") {
      return timelineEvents.filter((e) => isStatusChangeTimelineEvent(e.type));
    }
    if (filter === "kickoff") {
      return timelineEvents.filter(
        (e) => e.phase === "kickoff" || e.type.startsWith("kickoff_"),
      );
    }
    return timelineEvents;
  }, [filter, timelineEvents]);

  const eventsByPhase = useMemo(
    () => groupTimelineEventsByPhase(filteredEvents),
    [filteredEvents],
  );

  const hasAnyEvents = timelineEvents.length > 0;
  const hasAnyFiltered = filteredEvents.length > 0;

  return (
    <section className={clsx("space-y-4", className)}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
            Activity log
          </p>
          <p className="mt-1 text-sm text-slate-300">
            {hasAnyEvents
              ? `${filteredEvents.length} update${filteredEvents.length === 1 ? "" : "s"} shown`
              : emptyState}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <FilterPill active={filter === "all"} onClick={() => setFilter("all")}>
            All
          </FilterPill>
          <FilterPill active={filter === "messages"} onClick={() => setFilter("messages")}>
            Messages
          </FilterPill>
          <FilterPill active={filter === "status"} onClick={() => setFilter("status")}>
            Status
          </FilterPill>
          <FilterPill active={filter === "kickoff"} onClick={() => setFilter("kickoff")}>
            Kickoff
          </FilterPill>
        </div>
      </header>

      {!hasAnyEvents ? null : !hasAnyFiltered ? (
        <p className="rounded-xl border border-dashed border-slate-800/70 bg-black/20 px-4 py-3 text-sm text-slate-300">
          No updates match this filter.
        </p>
      ) : (
        <div className="space-y-6">
          {PHASE_ORDER.map((phase) => {
            const events = eventsByPhase[phase] ?? [];
            if (events.length === 0) return null;

            return (
              <section
                key={phase}
                className="overflow-hidden rounded-2xl border border-slate-900/60 bg-slate-950/30"
              >
                <div className="border-b border-slate-900/60 bg-slate-950/50 px-4 py-3 sm:px-5">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-slate-500">
                    {phaseLabels[phase]}
                  </p>
                </div>
                <ol className="divide-y divide-slate-900/60">
                  {events.map((event) => {
                    const absoluteLabel =
                      formatDateTime(event.occurredAt, { includeTime: true }) ??
                      formatDateTime(event.occurredAt) ??
                      "—";
                    const relativeLabel =
                      formatRelativeTimeFromTimestamp(toTimestamp(event.occurredAt)) ?? null;

                    return (
                      <li key={event.id} className="px-4 py-3 sm:px-5">
                        <div className="grid gap-3 sm:grid-cols-[11rem_minmax(0,1fr)] sm:items-start">
                          <div className="text-xs text-slate-400">
                            <p className="whitespace-nowrap tabular-nums" title={absoluteLabel}>
                              {absoluteLabel}
                            </p>
                            {relativeLabel ? (
                              <p className="mt-1 whitespace-nowrap text-[11px] text-slate-500">
                                {relativeLabel}
                              </p>
                            ) : null}
                          </div>

                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-slate-100">
                              {event.title}
                            </p>
                            {event.description ? (
                              <p className="mt-1 text-xs text-slate-400">
                                {event.description}
                              </p>
                            ) : null}
                            {event.actorLabel ? (
                              <p className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                                {event.actorLabel}
                              </p>
                            ) : null}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </section>
            );
          })}
        </div>
      )}
    </section>
  );
}

function FilterPill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        "rounded-full border px-3 py-1 text-xs font-semibold transition",
        active
          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-100"
          : "border-slate-800 bg-slate-950/50 text-slate-200 hover:border-slate-700 hover:text-white",
      )}
    >
      {children}
    </button>
  );
}

