import type { RfqDestination, RfqDestinationStatus } from "@/server/rfqs/destinations";
import type { RfqOffer } from "@/server/rfqs/offers";

export type SearchStateStatusLabel =
  | "searching"
  | "results_available"
  | "needs_attention"
  | "no_destinations";

export type SearchStateRecommendedAction = "refresh" | "contact_support" | "adjust_search";

export type SearchStateSummary = {
  counts: {
    destinations_total: number;
    destinations_pending: number;
    destinations_error: number;
    offers_total: number;
  };
  timestamps: {
    last_destination_activity_at: string | null;
    last_offer_received_at: string | null;
  };
  status_label: SearchStateStatusLabel;
  recommended_action: SearchStateRecommendedAction;
};

const PENDING_DESTINATION_STATUSES: ReadonlySet<RfqDestinationStatus> = new Set([
  "draft",
  "queued",
  "sent",
  "submitted",
  "viewed",
]);

export function buildSearchStateSummary(args: {
  destinations: RfqDestination[];
  offers: RfqOffer[];
}): SearchStateSummary {
  const counts: SearchStateSummary["counts"] = {
    destinations_total: args.destinations.length,
    destinations_pending: 0,
    destinations_error: 0,
    offers_total: args.offers.length,
  };

  for (const destination of args.destinations) {
    if (destination.status === "error") {
      counts.destinations_error += 1;
      continue;
    }
    if (PENDING_DESTINATION_STATUSES.has(destination.status)) {
      counts.destinations_pending += 1;
    }
  }

  const last_destination_activity_at = getLatestTimestamp(args.destinations, (destination) =>
    destination.last_status_at,
  );
  const last_offer_received_at = getLatestTimestamp(
    args.offers,
    (offer) => offer.received_at ?? offer.created_at,
  );

  const status_label = deriveSearchStateLabel(counts);
  const recommended_action = deriveRecommendedAction({ status_label, counts });

  return {
    counts,
    timestamps: {
      last_destination_activity_at,
      last_offer_received_at,
    },
    status_label,
    recommended_action,
  };
}

export function formatSearchStateLabel(status: SearchStateStatusLabel): string {
  switch (status) {
    case "results_available":
      return "Results available";
    case "needs_attention":
      return "Needs attention";
    case "no_destinations":
      return "No destinations";
    case "searching":
    default:
      return "Searching";
  }
}

export function formatSearchStateActionLabel(action: SearchStateRecommendedAction): string {
  switch (action) {
    case "adjust_search":
      return "Adjust search";
    case "contact_support":
      return "Contact support";
    case "refresh":
    default:
      return "Refresh results";
  }
}

export function searchStateLabelTone(status: SearchStateStatusLabel): "slate" | "blue" | "amber" | "emerald" | "red" {
  switch (status) {
    case "results_available":
      return "emerald";
    case "needs_attention":
      return "red";
    case "no_destinations":
      return "amber";
    case "searching":
    default:
      return "blue";
  }
}

function deriveSearchStateLabel(counts: SearchStateSummary["counts"]): SearchStateStatusLabel {
  if (counts.destinations_total === 0) {
    return "no_destinations";
  }
  if (counts.offers_total > 0) {
    return "results_available";
  }
  if (counts.destinations_error > 0 || counts.destinations_pending === 0) {
    return "needs_attention";
  }
  return "searching";
}

function deriveRecommendedAction(args: {
  status_label: SearchStateStatusLabel;
  counts: SearchStateSummary["counts"];
}): SearchStateRecommendedAction {
  switch (args.status_label) {
    case "no_destinations":
      return "adjust_search";
    case "needs_attention":
      return args.counts.destinations_error > 0 ? "contact_support" : "adjust_search";
    case "results_available":
    case "searching":
    default:
      return "refresh";
  }
}

function getLatestTimestamp<T>(
  items: T[],
  readValue: (item: T) => string | null | undefined,
): string | null {
  let latestValue: string | null = null;
  let latestMs: number | null = null;

  for (const item of items) {
    const value = readValue(item);
    const ms = parseTimestamp(value);
    if (ms == null) {
      continue;
    }
    if (latestMs == null || ms > latestMs) {
      latestMs = ms;
      latestValue = value ?? null;
    }
  }

  return latestValue;
}

function parseTimestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}
