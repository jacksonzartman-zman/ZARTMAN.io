import {
  computeDestinationNeedsAction,
  computeQuoteNeedsAction,
  DEFAULT_SLA_CONFIG,
} from "./sla";

// Dev-only examples for SLA logic. Not imported by production bundles.
const now = new Date("2025-01-01T12:00:00Z");

// Example: queued older than 4 hours should need action.
const queuedDestination = {
  status: "queued",
  created_at: "2025-01-01T06:00:00Z",
  last_status_at: "2025-01-01T06:00:00Z",
  provider_id: "provider-queued",
};
console.log(
  "queuedDestination",
  computeDestinationNeedsAction(queuedDestination, now, DEFAULT_SLA_CONFIG),
);

// Example: sent with no offer after 48 hours should need reply.
const sentNoReplyDestination = {
  status: "sent",
  sent_at: "2024-12-30T00:00:00Z",
  last_status_at: "2024-12-30T00:00:00Z",
  created_at: "2024-12-29T12:00:00Z",
  provider_id: "provider-no-offer",
};
console.log(
  "sentNoReplyDestination",
  computeDestinationNeedsAction(
    { ...sentNoReplyDestination, hasOffer: false },
    now,
    DEFAULT_SLA_CONFIG,
  ),
);

// Example: viewed should use last_status_at when sent_at is missing.
const viewedFallbackDestination = {
  status: "viewed",
  sent_at: null,
  last_status_at: "2024-12-30T06:00:00Z",
  created_at: "2024-12-29T12:00:00Z",
  provider_id: "provider-viewed",
};
console.log(
  "viewedFallbackDestination",
  computeDestinationNeedsAction(
    { ...viewedFallbackDestination, hasOffer: false },
    now,
    DEFAULT_SLA_CONFIG,
  ),
);

// Example: errors can be optionally excluded by config.
const errorDestination = {
  status: "error",
  last_status_at: "2025-01-01T10:00:00Z",
  created_at: "2024-12-31T12:00:00Z",
  provider_id: "provider-error",
};
console.log(
  "errorDestination",
  computeDestinationNeedsAction(errorDestination, now, DEFAULT_SLA_CONFIG),
);
console.log(
  "errorDestinationIgnored",
  computeDestinationNeedsAction(errorDestination, now, {
    ...DEFAULT_SLA_CONFIG,
    errorAlwaysNeedsAction: false,
  }),
);

// Example: quote rollup uses provider_id to detect offers.
const quoteSummary = computeQuoteNeedsAction(
  {
    destinations: [
      queuedDestination,
      sentNoReplyDestination,
      viewedFallbackDestination,
      errorDestination,
      {
        status: "quoted",
        created_at: "2024-12-28T12:00:00Z",
        last_status_at: "2024-12-31T12:00:00Z",
        provider_id: "provider-quoted",
      },
    ],
    offers: [{ provider_id: "provider-viewed" }],
  },
  now,
  DEFAULT_SLA_CONFIG,
);
console.log("quoteSummary", quoteSummary);
