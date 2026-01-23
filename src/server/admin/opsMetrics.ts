import { supabaseServer } from "@/lib/supabaseServer";
import { requireAdminUser } from "@/server/auth";
import type { AdminLoaderResult } from "@/server/admin/types";
import { handleMissingSupabaseSchema, serializeSupabaseError } from "@/server/admin/logging";
import { hasColumns, schemaGate } from "@/server/db/schemaContract";

export type OpsMetricsWindow = "7d" | "30d";

export type OpsFunnelMetrics = {
  from: string;
  to: string;
  quotes_created: number;
  destinations_added: number;
  dispatch_started: number;
  submitted: number;
  offers_received: number;
  offers_selected: number;
};

export type OpsTimeMetrics = {
  created_to_destinations_added: number | null;
  destinations_added_to_dispatch_started: number | null;
  dispatch_started_to_submitted: number | null;
  submitted_to_first_offer_received: number | null;
};

export type OpsMetricsSnapshot = {
  window: OpsMetricsWindow;
  funnel: OpsFunnelMetrics;
  timeToStepHours: OpsTimeMetrics;
};

export type OpsMetricsSummary = {
  windows: Record<OpsMetricsWindow, OpsMetricsSnapshot>;
};

type QuoteRow = {
  id: string | null;
  created_at: string | null;
  selected_offer_id?: string | null;
  selected_at?: string | null;
  selection_confirmed_at?: string | null;
};

type DestinationRow = {
  rfq_id: string | null;
  created_at: string | null;
  dispatch_started_at?: string | null;
  submitted_at?: string | null;
};

type OfferRow = {
  rfq_id: string | null;
  received_at?: string | null;
  created_at: string | null;
};

type OpsEventRow = {
  quote_id: string | null;
  event_type: string | null;
  created_at: string | null;
};

type OpsEventSummary = {
  destinationAddedAt: number | null;
  dispatchStartedAt: number | null;
  submittedAt: number | null;
  firstOfferReceivedAt: number | null;
  offerSelectedAt: number | null;
};

type WindowSpec = {
  key: OpsMetricsWindow;
  days: number;
  from: string;
  to: string;
  fromMs: number;
  toMs: number;
};

type WindowStats = {
  funnel: Omit<OpsFunnelMetrics, "from" | "to">;
  createdToDestinations: number[];
  destinationsToDispatch: number[];
  dispatchToSubmitted: number[];
  submittedToOffer: number[];
};

const DEFAULT_ERROR = "Unable to load ops metrics.";

const DESTINATION_ADDED_EVENT_TYPES = new Set(["destination_added", "destinations_added"]);
const DISPATCH_STARTED_EVENT_TYPES = new Set(["destination_dispatch_started"]);
const SUBMITTED_EVENT_TYPES = new Set(["destination_submitted"]);
const OFFER_RECEIVED_EVENT_TYPES = new Set(["offer_upserted", "offer_revised"]);
const OFFER_SELECTED_EVENT_TYPES = new Set(["offer_selected"]);

export async function loadAdminOpsMetrics(): Promise<AdminLoaderResult<OpsMetricsSummary>> {
  await requireAdminUser();

  const nowMs = Date.now();
  const window30 = buildWindow("30d", 30, nowMs);
  const window7 = buildWindow("7d", 7, nowMs);

  const emptySummary: OpsMetricsSummary = {
    windows: {
      "7d": buildEmptySnapshot(window7),
      "30d": buildEmptySnapshot(window30),
    },
  };

  const quotesSupported = await schemaGate({
    enabled: true,
    relation: "quotes",
    requiredColumns: ["id", "created_at"],
    warnPrefix: "[ops metrics]",
    warnKey: "ops_metrics:quotes",
  });
  if (!quotesSupported) {
    return { ok: false, data: emptySummary, error: DEFAULT_ERROR };
  }

  const [supportsSelectedOfferId, supportsSelectedAt, supportsSelectionConfirmedAt] =
    await Promise.all([
      hasColumns("quotes", ["selected_offer_id"]),
      hasColumns("quotes", ["selected_at"]),
      hasColumns("quotes", ["selection_confirmed_at"]),
    ]);

  const quoteSelect = ["id", "created_at"];
  if (supportsSelectedOfferId) quoteSelect.push("selected_offer_id");
  if (supportsSelectedAt) quoteSelect.push("selected_at");
  if (supportsSelectionConfirmedAt) quoteSelect.push("selection_confirmed_at");

  let quotes: QuoteRow[] = [];
  try {
    const { data, error } = await supabaseServer()
      .from("quotes")
      .select(quoteSelect.join(","))
      .gte("created_at", window30.from)
      .lte("created_at", window30.to)
      .returns<QuoteRow[]>();

    if (error) {
      if (
        handleMissingSupabaseSchema({
          relation: "quotes",
          error,
          warnPrefix: "[ops metrics]",
          warnKey: "ops_metrics:quotes_missing_schema",
        })
      ) {
        return { ok: false, data: emptySummary, error: DEFAULT_ERROR };
      }
      console.error("[ops metrics] quotes query failed", {
        error: serializeSupabaseError(error),
      });
      return { ok: false, data: emptySummary, error: DEFAULT_ERROR };
    }

    quotes = Array.isArray(data) ? data : [];
  } catch (error) {
    if (
      handleMissingSupabaseSchema({
        relation: "quotes",
        error,
        warnPrefix: "[ops metrics]",
        warnKey: "ops_metrics:quotes_missing_schema_crash",
      })
    ) {
      return { ok: false, data: emptySummary, error: DEFAULT_ERROR };
    }
    console.error("[ops metrics] quotes query crashed", {
      error: serializeSupabaseError(error) ?? error,
    });
    return { ok: false, data: emptySummary, error: DEFAULT_ERROR };
  }

  if (quotes.length === 0) {
    return { ok: true, data: emptySummary, error: null };
  }

  const quoteIds = quotes
    .map((row) => normalizeId(row?.id))
    .filter((id): id is string => Boolean(id));
  if (quoteIds.length === 0) {
    return { ok: true, data: emptySummary, error: null };
  }

  const [destinationsByQuoteId, offersByQuoteId, opsEventSummaryByQuoteId] =
    await Promise.all([
      loadDestinationsByQuoteId(quoteIds),
      loadOffersByQuoteId(quoteIds),
      loadOpsEventSummaries(quoteIds, window30.from),
    ]);

  const statsByWindow: Record<OpsMetricsWindow, WindowStats> = {
    "7d": buildWindowStats(),
    "30d": buildWindowStats(),
  };

  for (const quote of quotes) {
    const quoteId = normalizeId(quote?.id);
    if (!quoteId) continue;

    const createdAtMs = parseIsoMs(quote?.created_at);
    if (!createdAtMs) continue;

    const in30 = createdAtMs >= window30.fromMs;
    if (!in30) continue;

    const in7 = createdAtMs >= window7.fromMs;
    const destinationSummary = summarizeDestinations(destinationsByQuoteId.get(quoteId) ?? []);
    const offerSummary = summarizeOffers(offersByQuoteId.get(quoteId) ?? []);
    const opsSummary = opsEventSummaryByQuoteId.get(quoteId) ?? buildOpsEventSummary();

    const destinationAddedAtMs = minTimestamp(
      opsSummary.destinationAddedAt,
      destinationSummary.destinationAddedAt,
    );
    const dispatchStartedAtMs = minTimestamp(
      opsSummary.dispatchStartedAt,
      destinationSummary.dispatchStartedAt,
    );
    const submittedAtMs = minTimestamp(opsSummary.submittedAt, destinationSummary.submittedAt);
    const firstOfferReceivedAtMs = minTimestamp(
      opsSummary.firstOfferReceivedAt,
      offerSummary.firstOfferReceivedAt,
    );

    const selectedAtMs = minTimestamp(
      opsSummary.offerSelectedAt,
      parseIsoMs(quote?.selected_at),
      parseIsoMs(quote?.selection_confirmed_at),
    );

    const hasSelectedOffer =
      Boolean(selectedAtMs) ||
      (supportsSelectedOfferId && Boolean(normalizeId(quote?.selected_offer_id)));

    if (in30) {
      updateWindowStats(statsByWindow["30d"], {
        createdAtMs,
        destinationAddedAtMs,
        dispatchStartedAtMs,
        submittedAtMs,
        firstOfferReceivedAtMs,
        hasSelectedOffer,
      });
    }

    if (in7) {
      updateWindowStats(statsByWindow["7d"], {
        createdAtMs,
        destinationAddedAtMs,
        dispatchStartedAtMs,
        submittedAtMs,
        firstOfferReceivedAtMs,
        hasSelectedOffer,
      });
    }
  }

  return {
    ok: true,
    data: {
      windows: {
        "7d": finalizeWindowStats(window7, statsByWindow["7d"]),
        "30d": finalizeWindowStats(window30, statsByWindow["30d"]),
      },
    },
    error: null,
  };
}

async function loadDestinationsByQuoteId(
  quoteIds: string[],
): Promise<Map<string, DestinationRow[]>> {
  const map = new Map<string, DestinationRow[]>();
  if (quoteIds.length === 0) return map;

  const supported = await schemaGate({
    enabled: true,
    relation: "rfq_destinations",
    requiredColumns: ["rfq_id", "created_at"],
    warnPrefix: "[ops metrics]",
    warnKey: "ops_metrics:rfq_destinations",
  });
  if (!supported) return map;

  const [supportsDispatchStartedAt, supportsSubmittedAt] = await Promise.all([
    hasColumns("rfq_destinations", ["dispatch_started_at"]),
    hasColumns("rfq_destinations", ["submitted_at"]),
  ]);

  const destinationSelect = [
    "rfq_id",
    "created_at",
    supportsDispatchStartedAt ? "dispatch_started_at" : null,
    supportsSubmittedAt ? "submitted_at" : null,
  ]
    .filter(Boolean)
    .join(",");

  try {
    const { data, error } = await supabaseServer()
      .from("rfq_destinations")
      .select(destinationSelect)
      .in("rfq_id", quoteIds)
      .returns<DestinationRow[]>();

    if (error) {
      if (
        handleMissingSupabaseSchema({
          relation: "rfq_destinations",
          error,
          warnPrefix: "[ops metrics]",
          warnKey: "ops_metrics:rfq_destinations_missing_schema",
        })
      ) {
        return map;
      }
      console.warn("[ops metrics] destinations query failed", {
        error: serializeSupabaseError(error),
      });
      return map;
    }

    for (const row of Array.isArray(data) ? data : []) {
      const quoteId = normalizeId(row?.rfq_id);
      if (!quoteId) continue;
      if (!map.has(quoteId)) {
        map.set(quoteId, []);
      }
      map.get(quoteId)!.push(row);
    }
  } catch (error) {
    if (
      handleMissingSupabaseSchema({
        relation: "rfq_destinations",
        error,
        warnPrefix: "[ops metrics]",
        warnKey: "ops_metrics:rfq_destinations_missing_schema_crash",
      })
    ) {
      return map;
    }
    console.warn("[ops metrics] destinations query crashed", {
      error: serializeSupabaseError(error) ?? error,
    });
  }

  return map;
}

async function loadOffersByQuoteId(quoteIds: string[]): Promise<Map<string, OfferRow[]>> {
  const map = new Map<string, OfferRow[]>();
  if (quoteIds.length === 0) return map;

  const supported = await schemaGate({
    enabled: true,
    relation: "rfq_offers",
    requiredColumns: ["rfq_id", "created_at"],
    warnPrefix: "[ops metrics]",
    warnKey: "ops_metrics:rfq_offers",
  });
  if (!supported) return map;

  const supportsReceivedAt = await hasColumns("rfq_offers", ["received_at"]);
  const offerSelect = ["rfq_id", "created_at", supportsReceivedAt ? "received_at" : null]
    .filter(Boolean)
    .join(",");

  try {
    const { data, error } = await supabaseServer()
      .from("rfq_offers")
      .select(offerSelect)
      .in("rfq_id", quoteIds)
      .returns<OfferRow[]>();

    if (error) {
      if (
        handleMissingSupabaseSchema({
          relation: "rfq_offers",
          error,
          warnPrefix: "[ops metrics]",
          warnKey: "ops_metrics:rfq_offers_missing_schema",
        })
      ) {
        return map;
      }
      console.warn("[ops metrics] offers query failed", {
        error: serializeSupabaseError(error),
      });
      return map;
    }

    for (const row of Array.isArray(data) ? data : []) {
      const quoteId = normalizeId(row?.rfq_id);
      if (!quoteId) continue;
      if (!map.has(quoteId)) {
        map.set(quoteId, []);
      }
      map.get(quoteId)!.push(row);
    }
  } catch (error) {
    if (
      handleMissingSupabaseSchema({
        relation: "rfq_offers",
        error,
        warnPrefix: "[ops metrics]",
        warnKey: "ops_metrics:rfq_offers_missing_schema_crash",
      })
    ) {
      return map;
    }
    console.warn("[ops metrics] offers query crashed", {
      error: serializeSupabaseError(error) ?? error,
    });
  }

  return map;
}

async function loadOpsEventSummaries(
  quoteIds: string[],
  fromIso: string,
): Promise<Map<string, OpsEventSummary>> {
  const map = new Map<string, OpsEventSummary>();
  if (quoteIds.length === 0) return map;

  const supported = await schemaGate({
    enabled: true,
    relation: "ops_events",
    requiredColumns: ["quote_id", "event_type", "created_at"],
    warnPrefix: "[ops metrics]",
    warnKey: "ops_metrics:ops_events",
  });
  if (!supported) return map;

  try {
    const { data, error } = await supabaseServer()
      .from("ops_events")
      .select("quote_id,event_type,created_at")
      .in("quote_id", quoteIds)
      .gte("created_at", fromIso)
      .returns<OpsEventRow[]>();

    if (error) {
      if (
        handleMissingSupabaseSchema({
          relation: "ops_events",
          error,
          warnPrefix: "[ops metrics]",
          warnKey: "ops_metrics:ops_events_missing_schema",
        })
      ) {
        return map;
      }
      console.warn("[ops metrics] ops events query failed", {
        error: serializeSupabaseError(error),
      });
      return map;
    }

    for (const row of Array.isArray(data) ? data : []) {
      const quoteId = normalizeId(row?.quote_id);
      const eventType = normalizeEventType(row?.event_type);
      const createdAtMs = parseIsoMs(row?.created_at);
      if (!quoteId || !eventType || !createdAtMs) continue;

      const summary = map.get(quoteId) ?? buildOpsEventSummary();
      if (DESTINATION_ADDED_EVENT_TYPES.has(eventType)) {
        summary.destinationAddedAt = minTimestamp(summary.destinationAddedAt, createdAtMs);
      } else if (DISPATCH_STARTED_EVENT_TYPES.has(eventType)) {
        summary.dispatchStartedAt = minTimestamp(summary.dispatchStartedAt, createdAtMs);
      } else if (SUBMITTED_EVENT_TYPES.has(eventType)) {
        summary.submittedAt = minTimestamp(summary.submittedAt, createdAtMs);
      } else if (OFFER_RECEIVED_EVENT_TYPES.has(eventType)) {
        summary.firstOfferReceivedAt = minTimestamp(summary.firstOfferReceivedAt, createdAtMs);
      } else if (OFFER_SELECTED_EVENT_TYPES.has(eventType)) {
        summary.offerSelectedAt = minTimestamp(summary.offerSelectedAt, createdAtMs);
      }

      map.set(quoteId, summary);
    }
  } catch (error) {
    if (
      handleMissingSupabaseSchema({
        relation: "ops_events",
        error,
        warnPrefix: "[ops metrics]",
        warnKey: "ops_metrics:ops_events_missing_schema_crash",
      })
    ) {
      return map;
    }
    console.warn("[ops metrics] ops events query crashed", {
      error: serializeSupabaseError(error) ?? error,
    });
  }

  return map;
}

function summarizeDestinations(destinations: DestinationRow[]) {
  let destinationAddedAt: number | null = null;
  let dispatchStartedAt: number | null = null;
  let submittedAt: number | null = null;

  for (const destination of destinations) {
    destinationAddedAt = minTimestamp(destinationAddedAt, parseIsoMs(destination?.created_at));
    dispatchStartedAt = minTimestamp(
      dispatchStartedAt,
      parseIsoMs(destination?.dispatch_started_at),
    );
    submittedAt = minTimestamp(submittedAt, parseIsoMs(destination?.submitted_at));
  }

  return { destinationAddedAt, dispatchStartedAt, submittedAt };
}

function summarizeOffers(offers: OfferRow[]) {
  let firstOfferReceivedAt: number | null = null;

  for (const offer of offers) {
    const receivedAt = parseIsoMs(offer?.received_at);
    const createdAt = parseIsoMs(offer?.created_at);
    firstOfferReceivedAt = minTimestamp(firstOfferReceivedAt, receivedAt ?? createdAt);
  }

  return { firstOfferReceivedAt };
}

function updateWindowStats(
  stats: WindowStats,
  inputs: {
    createdAtMs: number;
    destinationAddedAtMs: number | null;
    dispatchStartedAtMs: number | null;
    submittedAtMs: number | null;
    firstOfferReceivedAtMs: number | null;
    hasSelectedOffer: boolean;
  },
) {
  stats.funnel.quotes_created += 1;

  if (inputs.destinationAddedAtMs) {
    stats.funnel.destinations_added += 1;
    const delta = diffHours(inputs.createdAtMs, inputs.destinationAddedAtMs);
    if (delta !== null) {
      stats.createdToDestinations.push(delta);
    }
  }

  if (inputs.dispatchStartedAtMs) {
    stats.funnel.dispatch_started += 1;
    const delta = diffHours(inputs.destinationAddedAtMs, inputs.dispatchStartedAtMs);
    if (delta !== null) {
      stats.destinationsToDispatch.push(delta);
    }
  }

  if (inputs.submittedAtMs) {
    stats.funnel.submitted += 1;
    const delta = diffHours(inputs.dispatchStartedAtMs, inputs.submittedAtMs);
    if (delta !== null) {
      stats.dispatchToSubmitted.push(delta);
    }
  }

  if (inputs.firstOfferReceivedAtMs) {
    stats.funnel.offers_received += 1;
    const delta = diffHours(inputs.submittedAtMs, inputs.firstOfferReceivedAtMs);
    if (delta !== null) {
      stats.submittedToOffer.push(delta);
    }
  }

  if (inputs.hasSelectedOffer) {
    stats.funnel.offers_selected += 1;
  }
}

function finalizeWindowStats(window: WindowSpec, stats: WindowStats): OpsMetricsSnapshot {
  return {
    window: window.key,
    funnel: {
      from: window.from,
      to: window.to,
      ...stats.funnel,
    },
    timeToStepHours: {
      created_to_destinations_added: median(stats.createdToDestinations),
      destinations_added_to_dispatch_started: median(stats.destinationsToDispatch),
      dispatch_started_to_submitted: median(stats.dispatchToSubmitted),
      submitted_to_first_offer_received: median(stats.submittedToOffer),
    },
  };
}

function buildWindowStats(): WindowStats {
  return {
    funnel: {
      quotes_created: 0,
      destinations_added: 0,
      dispatch_started: 0,
      submitted: 0,
      offers_received: 0,
      offers_selected: 0,
    },
    createdToDestinations: [],
    destinationsToDispatch: [],
    dispatchToSubmitted: [],
    submittedToOffer: [],
  };
}

function buildWindow(key: OpsMetricsWindow, days: number, nowMs: number): WindowSpec {
  const toMs = nowMs;
  const fromMs = toMs - days * 24 * 60 * 60 * 1000;
  return {
    key,
    days,
    from: new Date(fromMs).toISOString(),
    to: new Date(toMs).toISOString(),
    fromMs,
    toMs,
  };
}

function buildEmptySnapshot(window: WindowSpec): OpsMetricsSnapshot {
  return {
    window: window.key,
    funnel: {
      from: window.from,
      to: window.to,
      quotes_created: 0,
      destinations_added: 0,
      dispatch_started: 0,
      submitted: 0,
      offers_received: 0,
      offers_selected: 0,
    },
    timeToStepHours: {
      created_to_destinations_added: null,
      destinations_added_to_dispatch_started: null,
      dispatch_started_to_submitted: null,
      submitted_to_first_offer_received: null,
    },
  };
}

function buildOpsEventSummary(): OpsEventSummary {
  return {
    destinationAddedAt: null,
    dispatchStartedAt: null,
    submittedAt: null,
    firstOfferReceivedAt: null,
    offerSelectedAt: null,
  };
}

function normalizeId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeEventType(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function parseIsoMs(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function minTimestamp(...values: Array<number | null | undefined>): number | null {
  let min: number | null = null;
  for (const value of values) {
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    if (min === null || value < min) {
      min = value;
    }
  }
  return min;
}

function diffHours(startMs: number | null | undefined, endMs: number | null | undefined): number | null {
  if (typeof startMs !== "number" || typeof endMs !== "number") {
    return null;
  }
  const deltaMs = endMs - startMs;
  if (!Number.isFinite(deltaMs) || deltaMs < 0) {
    return null;
  }
  return deltaMs / (1000 * 60 * 60);
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const medianValue =
    sorted.length % 2 === 0
      ? (sorted[mid - 1]! + sorted[mid]!) / 2
      : sorted[mid]!;
  return Math.round(medianValue * 10) / 10;
}

