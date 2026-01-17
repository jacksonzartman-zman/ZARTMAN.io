import { supabaseServer } from "@/lib/supabaseServer";
import { isMissingRfqTableError, isRfqsFeatureEnabled } from "./flags";
import { listMarketplaceRfqsByIds } from "./rfqs";
import type { MarketplaceRfq, RfqBidRecord } from "./types";
import { marketplacePowerProfile, type MarketPowerProfile } from "./strategy";
import { logMarketplaceEvent } from "./events";

const DEFAULT_CURRENCY = "USD";
const DEFAULT_PRICE_SEED = 5_000;

export type PricingRecommendation = {
  rfqId: string;
  band: "floor" | "ceiling";
  amount: number;
  currency: string;
  confidence: number;
  inputs: {
    base: number;
    scarcity: number;
    urgency: number;
    bidCoverageGap: number;
    historicalSample: number;
  };
};

export type MarketPressureReading = {
  rfqId: string;
  score: number;
  label: "stable" | "elevated" | "critical";
  components: {
    scarcity: number;
    urgency: number;
    bidCoverageGap: number;
  };
};

type PricingOptions = {
  bids?: RfqBidRecord[];
  logEvent?: boolean;
};

type MarketPressureOptions = PricingOptions & {
  marketProfile?: MarketPowerProfile;
};

type PricingContext = {
  bids: RfqBidRecord[];
  bidStats: BidStats;
  marketProfile: MarketPowerProfile;
  historical: HistoricalWinStats;
  pressure: MarketPressureReading;
  currency: string;
};

type BidStats = {
  count: number;
  min: number | null;
  max: number | null;
  average: number | null;
  median: number | null;
  distribution: number[];
};

type HistoricalWinStats = {
  sampleSize: number;
  p25: number | null;
  p50: number | null;
  p75: number | null;
};

export async function calculateMarketPressure(
  rfq: MarketplaceRfq,
  options?: MarketPressureOptions,
): Promise<MarketPressureReading> {
  const bids = options?.bids ?? (await loadBidsForRfq(rfq.id));
  const marketProfile =
    options?.marketProfile ??
    (await marketplacePowerProfile(rfq, { bids, logEvent: false }));

  const scarcity = clamp(marketProfile.diagnostics.scarcityIndex / 2, 0, 1);
  const urgency = marketProfile.responsePressure.index;
  const bidCoverageGap = clamp(
    1 -
      marketProfile.diagnostics.uniqueBiddingSuppliers /
        Math.max(marketProfile.diagnostics.estimatedQualifiedSuppliers, 1),
    0,
    1,
  );

  const score = clamp(scarcity * 0.45 + urgency * 0.35 + bidCoverageGap * 0.2, 0, 1);
  const label = score >= 0.75 ? "critical" : score >= 0.45 ? "elevated" : "stable";

  const reading: MarketPressureReading = {
    rfqId: rfq.id,
    score,
    label,
    components: {
      scarcity,
      urgency,
      bidCoverageGap,
    },
  };

  if (options?.logEvent !== false) {
    await logMarketplaceEvent({
      rfqId: rfq.id,
      type: "market_pressure_calculated",
      customerId: rfq.customer_id ?? null,
      payload: {
        source: "pricing_layer",
        score,
        label,
        components: reading.components,
      },
    });
  }

  return reading;
}

export async function recommendPriceFloor(
  rfq: MarketplaceRfq,
  options?: PricingOptions,
): Promise<PricingRecommendation> {
  const context = await buildPricingContext(rfq, options);
  const floorComputation = computeFloor(context);
  const confidence = computeConfidence(context, floorComputation.amount);

  const recommendation: PricingRecommendation = {
    rfqId: rfq.id,
    band: "floor",
    amount: floorComputation.amount,
    currency: context.currency,
    confidence,
    inputs: {
      base: floorComputation.base,
      scarcity: context.pressure.components.scarcity,
      urgency: context.pressure.components.urgency,
      bidCoverageGap: context.pressure.components.bidCoverageGap,
      historicalSample: context.historical.sampleSize,
    },
  };

  if (options?.logEvent !== false) {
    await logMarketplaceEvent({
      rfqId: rfq.id,
      type: "pricing_band_recommended",
      customerId: rfq.customer_id ?? null,
      payload: {
        band: "floor",
        amount: recommendation.amount,
        currency: recommendation.currency,
        confidence: recommendation.confidence,
        inputs: recommendation.inputs,
      },
    });
  }

  return recommendation;
}

export async function recommendPriceCeiling(
  rfq: MarketplaceRfq,
  options?: PricingOptions,
): Promise<PricingRecommendation> {
  const context = await buildPricingContext(rfq, options);
  const floor = computeFloor(context);
  const ceilingComputation = computeCeiling(context, floor.amount);
  const confidence = computeConfidence(context, ceilingComputation.amount);

  const recommendation: PricingRecommendation = {
    rfqId: rfq.id,
    band: "ceiling",
    amount: ceilingComputation.amount,
    currency: context.currency,
    confidence,
    inputs: {
      base: ceilingComputation.base,
      scarcity: context.pressure.components.scarcity,
      urgency: context.pressure.components.urgency,
      bidCoverageGap: context.pressure.components.bidCoverageGap,
      historicalSample: context.historical.sampleSize,
    },
  };

  if (options?.logEvent !== false) {
    await logMarketplaceEvent({
      rfqId: rfq.id,
      type: "pricing_band_recommended",
      customerId: rfq.customer_id ?? null,
      payload: {
        band: "ceiling",
        amount: recommendation.amount,
        currency: recommendation.currency,
        confidence: recommendation.confidence,
        inputs: recommendation.inputs,
      },
    });
  }

  return recommendation;
}

async function buildPricingContext(
  rfq: MarketplaceRfq,
  options?: PricingOptions,
): Promise<PricingContext> {
  const bids = options?.bids ?? (await loadBidsForRfq(rfq.id));
  const marketProfile = await marketplacePowerProfile(rfq, { bids, logEvent: false });
  const pressure = await calculateMarketPressure(rfq, {
    bids,
    marketProfile,
    logEvent: false,
  });

  const bidStats = computeBidStats(bids);
  const historical = await loadHistoricalWinBands(
    marketProfile.supplyDemand.map((signal) => signal.process),
  );

  const currency = deriveCurrency(bids) ?? DEFAULT_CURRENCY;

  return {
    bids,
    bidStats,
    marketProfile,
    historical,
    pressure,
    currency,
  };
}

function computeBidStats(bids: RfqBidRecord[]): BidStats {
  if (bids.length === 0) {
    return {
      count: 0,
      min: null,
      max: null,
      average: null,
      median: null,
      distribution: [],
    };
  }

  const values = bids
    .map((bid) => {
      const price =
        typeof bid.price_total === "string"
          ? Number.parseFloat(bid.price_total)
          : bid.price_total;
      return Number.isFinite(price ?? NaN) ? (price as number) : null;
    })
    .filter((value): value is number => Number.isFinite(value));

  if (values.length === 0) {
    return {
      count: 0,
      min: null,
      max: null,
      average: null,
      median: null,
      distribution: [],
    };
  }

  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, value) => acc + value, 0);
  const average = sum / sorted.length;
  const median = computePercentile(sorted, 0.5);

  return {
    count: sorted.length,
    min: sorted[0] ?? null,
    max: sorted[sorted.length - 1] ?? null,
    average,
    median,
    distribution: sorted,
  };
}

async function loadHistoricalWinBands(processes: string[]): Promise<HistoricalWinStats> {
  const normalized = [...new Set(processes.map((value) => value.toLowerCase()))];
  const emptyResult: HistoricalWinStats = {
    sampleSize: 0,
    p25: null,
    p50: null,
    p75: null,
  };
  if (normalized.length === 0 || !isRfqsFeatureEnabled()) {
    return emptyResult;
  }

  try {
    const { data, error } = await supabaseServer
      .from("rfq_bids")
      .select("rfq_id,price_total")
      .eq("status", "accepted")
      .order("updated_at", { ascending: false })
      .limit(200);

    if (error) {
      if (isMissingRfqTableError(error)) {
        return emptyResult;
      }
      console.error("pricing: historical bids query failed", { error });
      return emptyResult;
    }

    const rows =
      (data as Array<{ rfq_id: string; price_total: number | string | null }>) ?? [];
    if (rows.length === 0) {
      return emptyResult;
    }

    const rfqIds = [...new Set(rows.map((row) => row.rfq_id).filter(Boolean))];
    const processMap = await loadProcessMap(rfqIds);

    const prices = rows
      .filter((row) => {
        const processesForBid = processMap[row.rfq_id] ?? [];
        return processesForBid.some((process) => normalized.includes(process));
      })
      .map((row) => {
        const value =
          typeof row.price_total === "string"
            ? Number.parseFloat(row.price_total)
            : row.price_total;
        return Number.isFinite(value ?? NaN) ? (value as number) : null;
      })
      .filter((value): value is number => Number.isFinite(value));

    if (prices.length === 0) {
      return emptyResult;
    }

    const sorted = prices.sort((a, b) => a - b);

    return {
      sampleSize: sorted.length,
      p25: computePercentile(sorted, 0.25),
      p50: computePercentile(sorted, 0.5),
      p75: computePercentile(sorted, 0.75),
    };
  } catch (error) {
    if (isMissingRfqTableError(error)) {
      return emptyResult;
    }
    console.error("pricing: historical query unexpected error", { error });
    return emptyResult;
  }
}

async function loadProcessMap(rfqIds: string[]) {
  if (rfqIds.length === 0 || !isRfqsFeatureEnabled()) {
    return {};
  }

  try {
    const rfqs = await listMarketplaceRfqsByIds(rfqIds);
    return rfqs.reduce<Record<string, string[]>>((map, rfq) => {
      map[rfq.id] = normalizeProcessArray(rfq.process_requirements);
      return map;
    }, {});
  } catch (error) {
    console.error("pricing: process map unexpected error", { error });
    return {};
  }
}

function normalizeProcessArray(values?: string[] | null): string[] {
  if (!Array.isArray(values) || values.length === 0) {
    return [];
  }
  return values
    .map((value) => (typeof value === "string" ? value.trim().toLowerCase() : ""))
    .filter((value) => value.length > 0);
}

function computeFloor(context: PricingContext) {
  const historicalBase =
    context.historical.p25 ??
    (context.historical.p50 ? context.historical.p50 * 0.9 : null);
  const bidBase =
    context.bidStats.median ??
    (context.bidStats.average ? context.bidStats.average * 0.95 : null);
  const base = sanitizeAmount(historicalBase ?? bidBase ?? DEFAULT_PRICE_SEED);

  const scarcityLift = base * context.pressure.components.scarcity * 0.15;
  const urgencyLift = base * context.pressure.components.urgency * 0.1;
  const floorAmount = sanitizeAmount(base + scarcityLift + urgencyLift);

  return {
    amount: floorAmount,
    base,
    scarcityLift,
    urgencyLift,
  };
}

function computeCeiling(context: PricingContext, floorAmount: number) {
  const historicalBase =
    context.historical.p75 ??
    (context.historical.p50 ? context.historical.p50 * 1.15 : null);
  const bidBase =
    context.bidStats.max ??
    (context.bidStats.median ? context.bidStats.median * 1.1 : null);
  const base = sanitizeAmount(historicalBase ?? bidBase ?? DEFAULT_PRICE_SEED * 1.2);

  const scarcityLift = base * context.pressure.components.scarcity * 0.1;
  const urgencyDrag = base * context.pressure.components.urgency * 0.15;
  const pressureDrag = context.pressure.score * 0.05 * base;

  let amount = sanitizeAmount(base + scarcityLift - urgencyDrag - pressureDrag);
  if (amount < floorAmount) {
    amount = floorAmount * 1.05;
  }

  return {
    amount,
    base,
    scarcityLift,
    urgencyDrag: urgencyDrag + pressureDrag,
  };
}

function computeConfidence(context: PricingContext, amount: number) {
  const historicalWeight = context.historical.sampleSize
    ? Math.min(context.historical.sampleSize / 25, 1)
    : 0;
  const bidWeight = context.bidStats.count ? Math.min(context.bidStats.count / 5, 1) : 0;
  const stabilityWeight = 1 - context.pressure.score;

  const confidence = clamp(
    historicalWeight * 0.4 + bidWeight * 0.3 + stabilityWeight * 0.3,
    0.2,
    0.95,
  );

  // small premium when the recommendation relies on internal heuristics
  if (amount === DEFAULT_PRICE_SEED) {
    return Math.min(confidence, 0.6);
  }

  return confidence;
}

async function loadBidsForRfq(rfqId: string): Promise<RfqBidRecord[]> {
  if (!rfqId || !isRfqsFeatureEnabled()) {
    return [];
  }

  try {
    const { data, error } = await supabaseServer
      .from("rfq_bids")
      .select(
        "id,rfq_id,supplier_id,price_total,currency,lead_time_days,notes,status,created_at,updated_at",
      )
      .eq("rfq_id", rfqId)
      .order("created_at", { ascending: true });

    if (error) {
      if (isMissingRfqTableError(error)) {
        return [];
      }
      console.error("pricing: bids query failed", { rfqId, error });
      return [];
    }

    return (data as RfqBidRecord[]) ?? [];
  } catch (error) {
    if (isMissingRfqTableError(error)) {
      return [];
    }
    console.error("pricing: bids query unexpected error", { rfqId, error });
    return [];
  }
}

function deriveCurrency(bids: RfqBidRecord[]): string | null {
  if (!Array.isArray(bids) || bids.length === 0) {
    return null;
  }
  const tally = bids.reduce<Record<string, number>>((map, bid) => {
    const currency =
      typeof bid.currency === "string" && bid.currency.length > 0
        ? bid.currency.toUpperCase()
        : DEFAULT_CURRENCY;
    map[currency] = (map[currency] ?? 0) + 1;
    return map;
  }, {});
  const [top] =
    Object.entries(tally).sort((a, b) => {
      if (b[1] === a[1]) {
        return a[0].localeCompare(b[0]);
      }
      return b[1] - a[1];
    })[0] ?? [];
  return top ?? null;
}

function sanitizeAmount(value: number) {
  if (!Number.isFinite(value)) {
    return DEFAULT_PRICE_SEED;
  }
  return Math.max(Math.round(value), 1);
}

function computePercentile(values: number[], percentile: number) {
  if (values.length === 0) {
    return null;
  }
  if (values.length === 1) {
    return values[0];
  }
  const index = (values.length - 1) * percentile;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) {
    return values[lower];
  }
  const weight = index - lower;
  return values[lower] * (1 - weight) + values[upper] * weight;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
