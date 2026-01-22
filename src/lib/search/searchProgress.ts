import { formatRelativeTimeFromTimestamp, toTimestamp } from "@/lib/relativeTime";
import {
  formatSearchStateActionLabel,
  type SearchStateRecommendedAction,
  type SearchStateStatusLabel,
  type SearchStateSummary,
} from "@/lib/search/searchState";

export const EMPTY_SEARCH_STATE_COUNTS: SearchStateSummary["counts"] = {
  destinations_total: 0,
  destinations_pending: 0,
  destinations_error: 0,
  offers_total: 0,
};

export const EMPTY_SEARCH_STATE_TIMESTAMPS: SearchStateSummary["timestamps"] = {
  last_destination_activity_at: null,
  last_offer_received_at: null,
};

export type SearchProgressInput = {
  counts: SearchStateSummary["counts"];
  timestamps?: SearchStateSummary["timestamps"];
  statusLabel: SearchStateStatusLabel;
  recommendedAction: SearchStateRecommendedAction;
  quoteId?: string | null;
  isInitializing?: boolean;
};

export type SearchProgressResult = {
  statusTag: string;
  statusHeadline: string;
  statusDetail: string;
  recommendedActionLabel?: string;
  recommendedActionHref?: string;
  lastUpdatedLabel?: string;
};

type SearchProgressStatus = SearchStateStatusLabel | "initializing";

const SUPPORT_EMAIL = "support@zartman.app";

export function buildSearchProgress(input: SearchProgressInput): SearchProgressResult {
  const status = resolveStatus(input);
  const { statusTag, statusHeadline, statusDetail } = buildStatusCopy(status, input.counts);
  const recommendedAction = buildRecommendedAction(input);
  const lastUpdatedLabel = buildLastUpdatedLabel(status, input);

  return {
    statusTag,
    statusHeadline,
    statusDetail,
    ...recommendedAction,
    lastUpdatedLabel,
  };
}

function resolveStatus(input: SearchProgressInput): SearchProgressStatus {
  if (input.isInitializing) {
    return "initializing";
  }
  return input.statusLabel;
}

function buildStatusCopy(
  status: SearchProgressStatus,
  counts: SearchStateSummary["counts"],
): {
  statusTag: string;
  statusHeadline: string;
  statusDetail: string;
} {
  switch (status) {
    case "initializing":
      return {
        statusTag: "Initializing",
        statusHeadline: "Contacting suppliers...",
        statusDetail: "We’re preparing your request and contacting suppliers that match it.",
      };
    case "results_available":
      return {
        statusTag: "Results",
        statusHeadline: "Results available",
        statusDetail: "Review pricing and lead times from responding suppliers.",
      };
    case "needs_attention":
      return {
        statusTag: "Needs attention",
        statusHeadline: "Search needs attention",
        statusDetail:
          counts.destinations_error > 0
            ? "Some suppliers could not be contacted. Contact support for help."
            : "No suppliers are still pending. Add details or invite a supplier to restart outreach.",
      };
    case "no_destinations":
      return {
        statusTag: "No suppliers contacted",
        statusHeadline: "Invite a supplier to start",
        statusDetail: "Invite a supplier (or add more details) to start collecting offers.",
      };
    case "searching":
    default:
      return {
        statusTag: "Searching",
        statusHeadline: "Waiting for replies",
        statusDetail: "We’ve contacted suppliers and we’re waiting for replies.",
      };
  }
}

function buildRecommendedAction(
  input: SearchProgressInput,
): Pick<SearchProgressResult, "recommendedActionLabel" | "recommendedActionHref"> {
  if (input.isInitializing) {
    return {};
  }

  switch (input.recommendedAction) {
    case "adjust_search": {
      if (!input.quoteId) {
        return {};
      }
      return {
        recommendedActionLabel: formatSearchStateActionLabel(input.recommendedAction),
        recommendedActionHref: `/customer/quotes/${input.quoteId}#uploads`,
      };
    }
    case "contact_support":
      return {
        recommendedActionLabel: formatSearchStateActionLabel(input.recommendedAction),
        recommendedActionHref: `mailto:${SUPPORT_EMAIL}`,
      };
    case "refresh":
    default:
      return {};
  }
}

function buildLastUpdatedLabel(
  status: SearchProgressStatus,
  input: SearchProgressInput,
): string | undefined {
  if (status === "initializing") {
    return undefined;
  }

  const timestamps = input.timestamps ?? EMPTY_SEARCH_STATE_TIMESTAMPS;
  const lastActivity =
    input.counts.offers_total > 0
      ? timestamps.last_offer_received_at ?? timestamps.last_destination_activity_at
      : timestamps.last_destination_activity_at ?? timestamps.last_offer_received_at;
  const relativeTime = formatRelativeTimeFromTimestamp(toTimestamp(lastActivity));

  return relativeTime ? `Last updated ${relativeTime}` : undefined;
}
