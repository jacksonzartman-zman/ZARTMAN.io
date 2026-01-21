import clsx from "clsx";
import Link from "next/link";

import { formatDateTime } from "@/lib/formatDate";
import {
  formatRelativeTimeCompactFromTimestamp,
  toTimestamp,
} from "@/lib/relativeTime";
import type { OpsEventRecord } from "@/server/ops/events";
import type { RfqDestination } from "@/server/rfqs/destinations";
import type { RfqOffer } from "@/server/rfqs/offers";

type SearchActivityEventKind =
  | "quote-created"
  | "quote-updated"
  | "dispatch-started"
  | "destination-submitted"
  | "offer-received"
  | "offer-revised"
  | "supplier-invited"
  | "estimate-shown";

export type SearchActivityFeedEvent = {
  id: string;
  timestamp: string;
  title: string;
  detail?: string | null;
  ctaLabel?: string;
  ctaHref?: string;
  kind?: SearchActivityEventKind;
};

type SearchActivityQuote = {
  id: string;
  created_at?: string | null;
  updated_at?: string | null;
};

type SearchActivityFeedInput = {
  quote: SearchActivityQuote | null;
  destinations?: RfqDestination[] | null;
  offers?: RfqOffer[] | null;
  opsEvents?: OpsEventRecord[] | null;
  inviteSupplierHref?: string | null;
  viewResultsHref?: string | null;
  compareOffersHref?: string | null;
};

type SearchActivityFeedProps = {
  events: SearchActivityFeedEvent[];
  title?: string;
  description?: string;
  emptyState?: string;
  maxVisible?: number;
  className?: string;
};

const DEFAULT_TITLE = "Search activity";
const DEFAULT_DESCRIPTION = "Recent updates as suppliers respond to your RFQ.";
const DEFAULT_EMPTY_STATE = "Activity will appear here once the search starts.";

export function buildSearchActivityFeedEvents({
  quote,
  destinations,
  offers,
  opsEvents,
  inviteSupplierHref,
  viewResultsHref,
  compareOffersHref,
}: SearchActivityFeedInput): SearchActivityFeedEvent[] {
  if (!quote) {
    return [];
  }

  const events: SearchActivityFeedEvent[] = [];
  const normalizedCreatedAt = normalizeTimestamp(quote.created_at);
  const normalizedUpdatedAt = normalizeTimestamp(quote.updated_at);
  const destinationList = Array.isArray(destinations) ? destinations : [];
  const offerList = Array.isArray(offers) ? offers : [];
  const opsEventList = Array.isArray(opsEvents) ? opsEvents : [];
  const destinationById = new Map(
    destinationList.map((destination) => [destination.id, destination]),
  );
  const submittedDestinationIds = new Set<string>();

  if (normalizedCreatedAt) {
    events.push({
      id: `quote-created:${quote.id}`,
      kind: "quote-created",
      timestamp: normalizedCreatedAt,
      title: "Search created",
      detail: "We received your RFQ and queued it for matching.",
    });
  }

  if (normalizedUpdatedAt && normalizedUpdatedAt !== normalizedCreatedAt) {
    events.push({
      id: `quote-updated:${quote.id}`,
      kind: "quote-updated",
      timestamp: normalizedUpdatedAt,
      title: "Search updated",
      detail: "Search details were refreshed.",
    });
  }

  for (const destination of destinationList) {
    const providerLabel = resolveProviderLabel(destination.provider?.name ?? null);
    const dispatchStartedAt = normalizeTimestamp(destination.dispatch_started_at);
    if (dispatchStartedAt) {
      events.push({
        id: `dispatch-started:${destination.id}`,
        kind: "dispatch-started",
        timestamp: dispatchStartedAt,
        title: "Dispatch started",
        detail: providerLabel ? `Sent to ${providerLabel}` : null,
      });
    }

    const submittedAt = normalizeTimestamp(destination.submitted_at);
    if (submittedAt) {
      submittedDestinationIds.add(destination.id);
      events.push({
        id: `destination-submitted:${destination.id}`,
        kind: "destination-submitted",
        timestamp: submittedAt,
        title: "Supplier submitted response",
        detail: providerLabel ? `From ${providerLabel}` : null,
      });
    }
  }

  for (const offer of offerList) {
    const providerLabel = resolveProviderLabel(offer.provider?.name ?? null);
    const revisedAt = normalizeTimestamp(readOfferRevisionTimestamp(offer));
    const receivedAt = normalizeTimestamp(offer.received_at ?? offer.created_at);
    const status = (offer.status ?? "").trim().toLowerCase();
    if (status === "revised") {
      const timestamp = revisedAt ?? receivedAt;
      if (!timestamp) continue;
      events.push({
        id: `offer-revised:${offer.id}`,
        kind: "offer-revised",
        timestamp,
        title: "Offer revised",
        detail: providerLabel ? `From ${providerLabel}` : null,
      });
    } else if (receivedAt) {
      events.push({
        id: `offer-received:${offer.id}`,
        kind: "offer-received",
        timestamp: receivedAt,
        title: "Offer received",
        detail: providerLabel ? `From ${providerLabel}` : null,
      });
    }
  }

  if (opsEventList.length > 0) {
    events.push(
      ...buildOpsActivityEvents({
        opsEvents: opsEventList,
        destinationById,
        submittedDestinationIds,
      }),
    );
  }

  let sorted = sortSearchActivityEvents(events);

  if (inviteSupplierHref && destinationList.length === 0) {
    sorted = attachCta(
      sorted,
      (event) =>
        event.kind === "quote-updated" || event.kind === "quote-created",
      {
        label: "Invite a supplier",
        href: inviteSupplierHref,
      },
    );
  }

  if (compareOffersHref) {
    sorted = attachCta(
      sorted,
      (event) =>
        event.kind === "offer-received" || event.kind === "offer-revised",
      {
        label: "Compare offers",
        href: compareOffersHref,
      },
    );
  }

  if (viewResultsHref) {
    sorted = attachCta(sorted, () => true, {
      label: "View results",
      href: viewResultsHref,
    });
  }

  return sorted;
}

export function SearchActivityFeed({
  events,
  title = DEFAULT_TITLE,
  description = DEFAULT_DESCRIPTION,
  emptyState = DEFAULT_EMPTY_STATE,
  maxVisible = 4,
  className,
}: SearchActivityFeedProps) {
  const sortedEvents = sortSearchActivityEvents(events);
  const visibleEvents = sortedEvents.slice(0, maxVisible);
  const hiddenEvents = sortedEvents.slice(maxVisible);

  return (
    <section
      className={clsx(
        "rounded-2xl border border-slate-900/60 bg-slate-950/40 px-4 py-4",
        className,
      )}
    >
      <header>
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">
          {title}
        </p>
        {description ? (
          <p className="mt-1 text-xs text-slate-400">{description}</p>
        ) : null}
      </header>

      {sortedEvents.length === 0 ? (
        <p className="mt-3 text-xs text-slate-400">{emptyState}</p>
      ) : (
        <div className="mt-3 space-y-3">
          <ol className="space-y-3 border-l border-slate-800">
            {visibleEvents.map((event) => (
              <SearchActivityFeedRow key={event.id} event={event} />
            ))}
          </ol>
          {hiddenEvents.length > 0 ? (
            <details className="group">
              <summary
                className={clsx(
                  "cursor-pointer text-xs font-semibold text-slate-300",
                  "underline-offset-4 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-400/70",
                )}
              >
                Show all activity ({hiddenEvents.length} more)
              </summary>
              <ol className="mt-3 space-y-3 border-l border-slate-800">
                {hiddenEvents.map((event) => (
                  <SearchActivityFeedRow key={event.id} event={event} />
                ))}
              </ol>
            </details>
          ) : null}
        </div>
      )}
    </section>
  );
}

function SearchActivityFeedRow({ event }: { event: SearchActivityFeedEvent }) {
  const absoluteLabel = formatDateTime(event.timestamp, { includeTime: true });
  const relativeLabel = formatRelativeTimeCompactFromTimestamp(
    toTimestamp(event.timestamp),
  );
  const timeLabel = relativeLabel ?? absoluteLabel;
  const cta = renderCta(event);

  return (
    <li className="relative pl-5">
      <span className="absolute left-0 top-2 h-2 w-2 rounded-full bg-emerald-400" />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-semibold text-slate-100">{event.title}</p>
          {event.detail ? (
            <p className="text-xs text-slate-400">{event.detail}</p>
          ) : null}
          {cta ? <div>{cta}</div> : null}
        </div>
        <time
          className="shrink-0 text-[11px] font-semibold text-slate-500"
          title={absoluteLabel}
          dateTime={event.timestamp}
        >
          {timeLabel}
        </time>
      </div>
    </li>
  );
}

function renderCta(event: SearchActivityFeedEvent) {
  if (!event.ctaLabel || !event.ctaHref) {
    return null;
  }

  const classes =
    "text-xs font-semibold text-emerald-200 hover:text-emerald-100";
  const isExternal =
    event.ctaHref.startsWith("http") || event.ctaHref.startsWith("mailto:");

  if (isExternal) {
    return (
      <a
        href={event.ctaHref}
        className={classes}
        rel="noreferrer"
        target="_blank"
      >
        {event.ctaLabel}
      </a>
    );
  }

  return (
    <Link href={event.ctaHref} className={classes}>
      {event.ctaLabel}
    </Link>
  );
}

function sortSearchActivityEvents(
  events: SearchActivityFeedEvent[],
): SearchActivityFeedEvent[] {
  return [...events].sort((a, b) => {
    const aTime = Date.parse(a.timestamp);
    const bTime = Date.parse(b.timestamp);

    if (Number.isFinite(aTime) && Number.isFinite(bTime) && aTime !== bTime) {
      return bTime - aTime;
    }
    if (Number.isFinite(aTime) && !Number.isFinite(bTime)) {
      return -1;
    }
    if (!Number.isFinite(aTime) && Number.isFinite(bTime)) {
      return 1;
    }

    const aKey = `${a.kind ?? ""}:${a.id}`;
    const bKey = `${b.kind ?? ""}:${b.id}`;
    return aKey.localeCompare(bKey);
  });
}

function attachCta(
  events: SearchActivityFeedEvent[],
  predicate: (event: SearchActivityFeedEvent) => boolean,
  cta: { label: string; href: string },
): SearchActivityFeedEvent[] {
  const index = events.findIndex(
    (event) => predicate(event) && !event.ctaHref,
  );
  if (index === -1) {
    return events;
  }
  const next = [...events];
  next[index] = {
    ...next[index],
    ctaLabel: cta.label,
    ctaHref: cta.href,
  };
  return next;
}

function normalizeTimestamp(value?: string | null): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Date.parse(trimmed);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString();
}

function resolveProviderLabel(name?: string | null): string | null {
  if (typeof name !== "string") return null;
  const trimmed = name.trim();
  return trimmed.length > 0 ? trimmed : null;
}

type RfqOfferWithRevision = RfqOffer & {
  revised_received_at?: string | null;
  revised_at?: string | null;
};

function readOfferRevisionTimestamp(offer: RfqOffer): string | null {
  const revision = offer as RfqOfferWithRevision;
  return revision.revised_received_at ?? revision.revised_at ?? null;
}

function buildOpsActivityEvents(args: {
  opsEvents: OpsEventRecord[];
  destinationById: Map<string, RfqDestination>;
  submittedDestinationIds: Set<string>;
}): SearchActivityFeedEvent[] {
  const events: SearchActivityFeedEvent[] = [];
  let latestEstimate:
    | { record: OpsEventRecord; timestamp: string; ms: number }
    | null = null;
  const seenDestinationIds = new Set<string>();

  for (const opsEvent of args.opsEvents) {
    const timestamp = normalizeTimestamp(opsEvent.created_at);
    if (!timestamp) continue;

    if (opsEvent.event_type === "estimate_shown") {
      const ms = Date.parse(timestamp);
      if (!Number.isFinite(ms)) continue;
      if (!latestEstimate || ms > latestEstimate.ms) {
        latestEstimate = { record: opsEvent, timestamp, ms };
      }
      continue;
    }

    if (opsEvent.event_type === "supplier_invited") {
      if (!isCustomerInitiatedSupplierInvite(opsEvent.payload)) {
        continue;
      }
      const supplierName = readOpsPayloadText(opsEvent.payload, [
        "supplier_name",
        "supplierName",
        "supplier",
      ]);
      events.push({
        id: `supplier-invited:${opsEvent.id}`,
        kind: "supplier-invited",
        timestamp,
        title: "Supplier invited",
        detail: supplierName ? `Invited ${supplierName}` : null,
      });
      continue;
    }

    if (opsEvent.event_type === "destination_submitted") {
      const destinationId =
        typeof opsEvent.destination_id === "string"
          ? opsEvent.destination_id.trim()
          : "";
      if (!destinationId) continue;
      if (args.submittedDestinationIds.has(destinationId)) continue;
      if (seenDestinationIds.has(destinationId)) continue;
      const destination = args.destinationById.get(destinationId);
      if (!destination) continue;
      const providerLabel = resolveProviderLabel(destination.provider?.name ?? null);
      seenDestinationIds.add(destinationId);
      events.push({
        id: `destination-submitted:${destinationId}`,
        kind: "destination-submitted",
        timestamp,
        title: "Supplier submitted response",
        detail: providerLabel ? `From ${providerLabel}` : null,
      });
    }
  }

  if (latestEstimate) {
    events.push({
      id: `estimate-shown:${latestEstimate.record.id}`,
      kind: "estimate-shown",
      timestamp: latestEstimate.timestamp,
      title: "Estimate ready",
      detail: "Pricing estimate is available.",
    });
  }

  return events;
}

function isCustomerInitiatedSupplierInvite(payload: Record<string, unknown>): boolean {
  return Boolean(
    readOpsPayloadText(payload, [
      "customer_id",
      "customerId",
      "customer_email",
      "customerEmail",
      "user_id",
      "userId",
    ]),
  );
}

function readOpsPayloadText(
  payload: Record<string, unknown>,
  keys: string[],
): string | null {
  for (const key of keys) {
    const raw = payload[key];
    if (typeof raw !== "string") continue;
    const normalized = normalizePayloadText(raw);
    if (!normalized) continue;
    return truncateText(normalized, 120);
  }
  return null;
}

function normalizePayloadText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  const trimmed = value.slice(0, Math.max(0, maxLength - 3)).trim();
  return trimmed ? `${trimmed}...` : value.slice(0, maxLength);
}
