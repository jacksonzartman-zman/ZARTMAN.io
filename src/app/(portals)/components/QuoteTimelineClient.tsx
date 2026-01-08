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
  rfq: "RFQ",
  bidding: "Bidding",
  award: "Award",
  kickoff: "Kickoff",
  execution: "Execution",
};

export function QuoteTimelineClient({
  rawEvents,
  className,
  emptyState = "No timeline updates yet. We’ll log key milestones here as your RFQ moves forward.",
}: {
  rawEvents: QuoteEventRecord[];
  className?: string;
  emptyState?: string;
}) {
  const [filter, setFilter] = useState<TimelineFilterKey>("all");

  const timelineEvents: QuoteTimelineEvent[] = useMemo(() => {
    const events = Array.isArray(rawEvents) ? rawEvents : [];
    const mapped = events.map((event) =>
      mapRawEventToTimelineEvent({
        id: event.id,
        quote_id: event.quote_id,
        event_type: event.event_type,
        created_at: event.created_at,
        actor_role: event.actor_role,
        // Note: do not pass message body; quote_events metadata only contains safe identifiers.
        metadata: event.metadata ?? {},
        payload: event.payload ?? null,
      }),
    );

    // Chronological order for human-readable history.
    mapped.sort((a, b) => {
      const aMs = Date.parse(a.occurredAt) || 0;
      const bMs = Date.parse(b.occurredAt) || 0;
      return aMs - bMs;
    });

    return mapped;
  }, [rawEvents]);

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

  const hasAny = filteredEvents.length > 0;
  const dotClasses = "absolute left-0 top-2 h-2 w-2 rounded-full bg-emerald-400";

  return (
    <section className={clsx("space-y-3", className)}>
      <div className="flex flex-wrap items-center gap-2">
        <FilterPill
          active={filter === "all"}
          onClick={() => setFilter("all")}
        >
          All events
        </FilterPill>
        <FilterPill
          active={filter === "messages"}
          onClick={() => setFilter("messages")}
        >
          Messages only
        </FilterPill>
        <FilterPill
          active={filter === "status"}
          onClick={() => setFilter("status")}
        >
          Status changes
        </FilterPill>
        <FilterPill
          active={filter === "kickoff"}
          onClick={() => setFilter("kickoff")}
        >
          Kickoff only
        </FilterPill>
      </div>

      {!hasAny ? (
        <p className="text-xs text-slate-400">{emptyState}</p>
      ) : (
        <div className="space-y-6">
          {PHASE_ORDER.map((phase) => {
            const events = eventsByPhase[phase] ?? [];
            if (events.length === 0) return null;
            return (
              <div key={phase} className="space-y-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-slate-500">
                  {PHASE_LABELS[phase]}
                </p>
                <ol className="space-y-4 border-l border-slate-800">
                  {events.map((event) => (
                    <li key={event.id} className="relative pl-6">
                      <span className={dotClasses} />
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <p className="text-sm font-medium text-slate-100">
                          {event.title}
                        </p>
                        <p
                          className="text-xs text-slate-400"
                          title={formatDateTime(event.occurredAt, {
                            includeTime: true,
                          })}
                        >
                          {formatRelativeTimeFromTimestamp(
                            toTimestamp(event.occurredAt),
                          ) ?? "—"}
                        </p>
                      </div>
                      {event.description ? (
                        <p className="mt-1 text-xs text-slate-400">
                          {event.description}
                        </p>
                      ) : null}
                      {event.actorLabel ? (
                        <p className="mt-1 text-[10px] uppercase tracking-wide text-slate-500">
                          {event.actorLabel}
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ol>
              </div>
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

