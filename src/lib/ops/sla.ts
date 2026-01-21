export type SlaConfig = {
  queuedMaxHours: number;
  sentNoReplyMaxHours: number;
  errorAlwaysNeedsAction: boolean;
};

export type SlaReason = "queued_too_long" | "sent_no_reply" | "error" | null;

export type DestinationNeedsActionResult = {
  needsAction: boolean;
  reason: SlaReason;
  ageHours: number;
};

export type DestinationNeedsActionInput = {
  status?: string | null;
  created_at?: string | null;
  last_status_at?: string | null;
  sent_at?: string | null;
  provider_id?: string | null;
  has_offer?: boolean | null;
  hasOffer?: boolean | null;
};

export type QuoteNeedsActionInput = {
  destinations: DestinationNeedsActionInput[];
  offers: Array<{
    provider_id?: string | null;
  }>;
};

export type QuoteNeedsActionResult = {
  needsActionCount: number;
  needsReplyCount: number;
  errorsCount: number;
  queuedStaleCount: number;
};

export const DEFAULT_SLA_CONFIG: SlaConfig = {
  queuedMaxHours: 4,
  sentNoReplyMaxHours: 48,
  errorAlwaysNeedsAction: true,
};

const HOURS_IN_MS = 60 * 60 * 1000;
const DESTINATION_STATUSES = new Set([
  "draft",
  "queued",
  "sent",
  "submitted",
  "viewed",
  "quoted",
  "declined",
  "error",
]);

export function formatSlaResponseTime(hours: number): string | null {
  if (!Number.isFinite(hours) || hours <= 0) {
    return null;
  }
  const roundedHours = Math.max(1, Math.round(hours));
  if (roundedHours < 24) {
    return `within ${roundedHours} hour${roundedHours === 1 ? "" : "s"}`;
  }
  const days = Math.max(1, Math.ceil(roundedHours / 24));
  return `within ${days} day${days === 1 ? "" : "s"}`;
}

type DestinationStatus =
  | "draft"
  | "queued"
  | "sent"
  | "submitted"
  | "viewed"
  | "quoted"
  | "declined"
  | "error";

/**
 * Deterministic SLA check for a single destination.
 * For sent/viewed checks, pass `hasOffer`/`has_offer` when offers are available.
 */
export function computeDestinationNeedsAction(
  destination: DestinationNeedsActionInput,
  now: Date | string | number,
  config?: Partial<SlaConfig>,
): DestinationNeedsActionResult {
  const resolvedConfig = resolveSlaConfig(config);
  const status = normalizeStatus(destination.status);
  const nowDate = coerceDate(now) ?? new Date(0);
  const nowTime = nowDate.getTime();
  const hasOffer = destination.has_offer === true || destination.hasOffer === true;
  const referenceDate = resolveReferenceDate(status, destination);
  const ageHours = computeAgeHours(nowTime, referenceDate);

  switch (status) {
    case "error":
      return resolvedConfig.errorAlwaysNeedsAction
        ? { needsAction: true, reason: "error", ageHours }
        : { needsAction: false, reason: null, ageHours };
    case "queued":
      return ageHours > resolvedConfig.queuedMaxHours
        ? { needsAction: true, reason: "queued_too_long", ageHours }
        : { needsAction: false, reason: null, ageHours };
    case "sent":
    case "submitted":
    case "viewed":
      return !hasOffer && ageHours > resolvedConfig.sentNoReplyMaxHours
        ? { needsAction: true, reason: "sent_no_reply", ageHours }
        : { needsAction: false, reason: null, ageHours };
    case "quoted":
    case "declined":
    default:
      return { needsAction: false, reason: null, ageHours };
  }
}

export function computeQuoteNeedsAction(
  { destinations, offers }: QuoteNeedsActionInput,
  now: Date | string | number,
  config?: Partial<SlaConfig>,
): QuoteNeedsActionResult {
  const resolvedConfig = resolveSlaConfig(config);
  const offerProviderIds = new Set<string>();

  (offers ?? []).forEach((offer) => {
    const providerId = normalizeId(offer?.provider_id);
    if (providerId) {
      offerProviderIds.add(providerId);
    }
  });

  const counts: QuoteNeedsActionResult = {
    needsActionCount: 0,
    needsReplyCount: 0,
    errorsCount: 0,
    queuedStaleCount: 0,
  };

  (destinations ?? []).forEach((destination) => {
    const providerId = normalizeId(destination?.provider_id);
    const hasOffer = providerId ? offerProviderIds.has(providerId) : false;
    const result = computeDestinationNeedsAction(
      { ...destination, hasOffer },
      now,
      resolvedConfig,
    );

    if (result.needsAction) {
      counts.needsActionCount += 1;
    }
    if (result.reason === "sent_no_reply") {
      counts.needsReplyCount += 1;
    }
    if (result.reason === "error") {
      counts.errorsCount += 1;
    }
    if (result.reason === "queued_too_long") {
      counts.queuedStaleCount += 1;
    }
  });

  return counts;
}

function resolveReferenceDate(
  status: DestinationStatus,
  destination: DestinationNeedsActionInput,
): Date | null {
  if (status === "queued") {
    return resolveTimestamp(destination.created_at, destination.last_status_at);
  }
  if (status === "sent" || status === "submitted" || status === "viewed") {
    return resolveTimestamp(
      destination.sent_at,
      destination.last_status_at,
      destination.created_at,
    );
  }
  if (status === "error") {
    return resolveTimestamp(destination.last_status_at, destination.created_at);
  }
  return resolveTimestamp(
    destination.last_status_at,
    destination.created_at,
    destination.sent_at,
  );
}

function computeAgeHours(nowTime: number, since: Date | null): number {
  if (!since) {
    return 0;
  }
  const diffMs = nowTime - since.getTime();
  if (!Number.isFinite(diffMs) || diffMs <= 0) {
    return 0;
  }
  return diffMs / HOURS_IN_MS;
}

function resolveSlaConfig(config?: Partial<SlaConfig>): SlaConfig {
  return {
    queuedMaxHours: config?.queuedMaxHours ?? DEFAULT_SLA_CONFIG.queuedMaxHours,
    sentNoReplyMaxHours: config?.sentNoReplyMaxHours ?? DEFAULT_SLA_CONFIG.sentNoReplyMaxHours,
    errorAlwaysNeedsAction:
      config?.errorAlwaysNeedsAction ?? DEFAULT_SLA_CONFIG.errorAlwaysNeedsAction,
  };
}

function resolveTimestamp(...values: Array<string | number | Date | null | undefined>): Date | null {
  for (const value of values) {
    const date = coerceDate(value);
    if (date) {
      return date;
    }
  }
  return null;
}

function coerceDate(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

function normalizeStatus(value: unknown): DestinationStatus {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (DESTINATION_STATUSES.has(normalized)) {
    return normalized as DestinationStatus;
  }
  return "draft";
}

function normalizeId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
