import clsx from "clsx";
import { formatDateTime } from "@/lib/formatDate";
import { formatShortId } from "@/lib/awards";
import type { RfqEventRecord } from "@/server/rfqs/events";

type TimelineItem = RfqEventRecord;

const EVENT_LABELS: Record<string, string> = {
  rfq_created: "RFQ created",
  quick_specs_updated: "Quick specs updated",
  offer_created: "Offer created",
  offer_revised: "Offer revised",
  offer_withdrawn: "Offer withdrawn",
  awarded: "Awarded",
  order_details_confirmed: "Order details confirmed",
  kickoff_task_completed: "Kickoff task completed",
};

function resolveEventLabel(eventType: string): string {
  const key = (eventType ?? "").toString().trim();
  const label = EVENT_LABELS[key] ?? key;
  return label || "Event";
}

function resolveIconAccent(eventType: string): { glyph: string; className: string } {
  const type = (eventType ?? "").toString().trim();
  switch (type) {
    case "rfq_created":
      return { glyph: "R", className: "bg-slate-800 text-slate-100 ring-slate-700/60" };
    case "quick_specs_updated":
      return { glyph: "Q", className: "bg-indigo-950/40 text-indigo-100 ring-indigo-500/20" };
    case "offer_created":
      return { glyph: "+", className: "bg-emerald-950/40 text-emerald-100 ring-emerald-500/20" };
    case "offer_revised":
      return { glyph: "↻", className: "bg-cyan-950/40 text-cyan-100 ring-cyan-500/20" };
    case "offer_withdrawn":
      return { glyph: "–", className: "bg-amber-950/40 text-amber-100 ring-amber-500/20" };
    case "awarded":
      return { glyph: "★", className: "bg-fuchsia-950/40 text-fuchsia-100 ring-fuchsia-500/20" };
    case "order_details_confirmed":
      return { glyph: "✓", className: "bg-sky-950/40 text-sky-100 ring-sky-500/20" };
    case "kickoff_task_completed":
      return { glyph: "✓", className: "bg-teal-950/40 text-teal-100 ring-teal-500/20" };
    default:
      return { glyph: "•", className: "bg-slate-900 text-slate-200 ring-slate-700/60" };
  }
}

function formatActorLabel(event: TimelineItem): string {
  const role = (event.actor_role ?? "system").toString().trim().toLowerCase();
  const base =
    role === "admin"
      ? "Admin"
      : role === "customer"
        ? "Customer"
        : role === "supplier"
          ? "Supplier"
          : "System";
  const userSuffix = event.actor_user_id ? ` (${formatShortId(event.actor_user_id)})` : "";
  return `${base}${userSuffix}`;
}

export function RfqTimelineCard({
  events,
  emptyState,
  className,
}: {
  events: TimelineItem[];
  emptyState?: string;
  className?: string;
}) {
  const emptyMessage =
    typeof emptyState === "string" && emptyState.trim().length > 0
      ? emptyState.trim()
      : "No events yet.";

  return (
    <section className={clsx("space-y-3", className)}>
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Timeline
        </p>
        <h2 className="text-base font-semibold text-slate-50">RFQ event log</h2>
        <p className="mt-1 text-sm text-slate-400">
          Reverse chronological record of key RFQ actions.
        </p>
      </div>

      {events.length === 0 ? (
        <p className="text-sm text-slate-400">{emptyMessage}</p>
      ) : (
        <div className="divide-y divide-slate-900/60 rounded-xl border border-slate-900/50 bg-slate-950/30">
          {events.map((event) => {
            const icon = resolveIconAccent(event.event_type);
            const timestamp =
              formatDateTime(event.created_at, { includeTime: true }) ?? event.created_at;
            const actor = formatActorLabel(event);
            const label = resolveEventLabel(event.event_type);
            const message = typeof event.message === "string" ? event.message.trim() : "";
            return (
              <div
                key={event.id}
                className="grid gap-3 px-4 py-3 sm:grid-cols-[24px_160px_minmax(0,1fr)]"
              >
                <div
                  className={clsx(
                    "mt-0.5 flex h-6 w-6 items-center justify-center rounded-full text-xs ring-1",
                    icon.className,
                  )}
                  aria-hidden="true"
                >
                  {icon.glyph}
                </div>
                <div className="text-xs text-slate-400">
                  <div>{timestamp}</div>
                  <div className="mt-0.5">{actor}</div>
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-100">{label}</p>
                  {message ? (
                    <p className="mt-0.5 whitespace-pre-wrap text-xs text-slate-400">
                      {message}
                    </p>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

