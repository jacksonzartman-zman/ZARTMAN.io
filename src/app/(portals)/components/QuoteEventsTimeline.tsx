/**
 * Durable quote events timeline shared by all portals.
 * Newest-first, human-readable, and safe to show across roles.
 */
import clsx from "clsx";
import { formatDateTime } from "@/lib/formatDate";
import type { QuoteEventRecord, QuoteEventActorRole } from "@/server/quotes/events";

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
        <p className="text-xs text-slate-400">{emptyState}</p>
      ) : (
        <ol className="mt-4 space-y-3 border-l border-slate-800">
          {events.map((event) => {
            const mapped = mapQuoteEvent(event);
            return (
              <li key={event.id} className="relative pl-6">
                <span className={dotClasses} />
                <p className="text-sm font-medium text-slate-100">
                  {mapped.title}
                </p>
                <p className="mt-0.5 text-xs text-slate-400">
                  {formatDateTime(event.created_at, { includeTime: true })}
                </p>
                {mapped.description ? (
                  <p className="mt-0.5 text-xs text-slate-500">
                    {mapped.description}
                  </p>
                ) : null}
                {mapped.actorLabel ? (
                  <p className="mt-0.5 text-[10px] uppercase tracking-wide text-slate-500">
                    {mapped.actorLabel}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

function mapQuoteEvent(
  event: QuoteEventRecord,
): { title: string; description?: string; actorLabel?: string } {
  const type = (event.event_type ?? "").trim().toLowerCase();
  const metadata = isRecord(event.metadata) ? event.metadata : {};
  const actorLabel = formatActorLabel(event.actor_role, metadata);

  if (type === "submitted") {
    return {
      title: "RFQ submitted",
      description: "RFQ received and queued for review.",
      actorLabel,
    };
  }

  if (type === "bid_received") {
    const supplierName = readString(metadata, "supplier_name");
    return {
      title: "Bid received",
      description: supplierName ? `From ${supplierName}.` : undefined,
      actorLabel,
    };
  }

  if (type === "awarded") {
    const supplierName = readString(metadata, "supplier_name");
    return {
      title: supplierName ? `Awarded to ${supplierName}` : "Awarded",
      description: readString(metadata, "bid_id")
        ? `Winning bid: ${String(metadata.bid_id)}`
        : undefined,
      actorLabel,
    };
  }

  if (type === "reopened") {
    return {
      title: "RFQ reopened",
      description: "Returned to reviewing bids.",
      actorLabel,
    };
  }

  if (type === "archived") {
    return {
      title: "RFQ archived",
      description: "Marked as cancelled.",
      actorLabel,
    };
  }

  if (type === "kickoff_updated") {
    const summary = readString(metadata, "summary_label");
    const taskTitle = readString(metadata, "task_title");
    const completed = readBoolean(metadata, "completed");
    const taskDescription = taskTitle
      ? `${completed ? "Completed" : "Updated"}: ${taskTitle}.`
      : undefined;
    return {
      title: "Kickoff updated",
      description: summary ? `${summary}${taskDescription ? ` · ${taskDescription}` : ""}` : taskDescription,
      actorLabel,
    };
  }

  if (type === "message_posted") {
    const senderName = readString(metadata, "sender_name");
    return {
      title: "Message posted",
      description: senderName ? `From ${senderName}.` : undefined,
      actorLabel,
    };
  }

  return {
    title: humanizeFallback(type || "event"),
    actorLabel,
  };
}

function formatActorLabel(
  role: QuoteEventActorRole,
  metadata: Record<string, unknown>,
): string {
  const normalized = (role ?? "").toString().toLowerCase();
  if (normalized === "supplier") {
    const supplierName = readString(metadata, "supplier_name");
    return supplierName ? `Supplier · ${supplierName}` : "Supplier";
  }
  if (normalized === "customer") {
    return "Customer";
  }
  if (normalized === "admin") {
    return "Admin";
  }
  return "System";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readString(
  metadata: Record<string, unknown>,
  key: string,
): string | null {
  const value = metadata[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readBoolean(
  metadata: Record<string, unknown>,
  key: string,
): boolean | null {
  const value = metadata[key];
  if (typeof value === "boolean") return value;
  return null;
}

function humanizeFallback(value: string): string {
  const cleaned = value.replace(/[_-]+/g, " ").trim();
  if (!cleaned) return "Event";
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

