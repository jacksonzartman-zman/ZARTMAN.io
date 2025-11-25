import { supabaseServer } from "@/lib/supabaseServer";
import { logMarketplaceEvent } from "./events";
import { listBidsForRfq } from "./bids";
import { loadRfqById, OPEN_RFQ_STATUSES } from "./rfqs";
import {
  marketplacePowerProfile,
  customerPriorityProfile,
  type MarketPowerProfile,
} from "./strategy";
import type { MarketplaceRfq, RfqBidRecord } from "./types";

/**
 * Example shape:
 * {
 *   customerId: "cust_123",
 *   anchorRfqId: "rfq_456",
 *   leverageScore: 0.74,
 *   influenceTier: "growth",
 *   engagementSignals: {
 *     activeRfqs: 3,
 *     awardedRfqs: 7,
 *     winRate: 0.58,
 *     avgBidsPerRfq: 4.2,
 *     medianDecisionDays: 9,
 *     cadenceDays: 14
 *   },
 *   opticsPlaybook: {
 *     tone: "partner",
 *     proofPoints: ["Consistent conversion", "Leverages fast cycles"],
 *     supportLevers: ["paired_concierge", "nudge_supplier_pool"]
 *   },
 *   marketRead: {
 *     supplierPosture: "balanced",
 *     responsePressureLevel: "medium",
 *     scarcityIndex: 1.1
 *   },
 *   lastRefreshed: "2025-11-25T16:05:00.000Z"
 * }
 */
export type OpticsTone = "executive" | "partner" | "guide";

export type OpticsPlaybook = {
  tone: OpticsTone;
  proofPoints: string[];
  supportLevers: string[];
};

export type CustomerPowerProfile = {
  customerId: string | null;
  anchorRfqId: string | null;
  leverageScore: number;
  influenceTier: "flagship" | "growth" | "builder" | "emerging";
  engagementSignals: {
    activeRfqs: number;
    awardedRfqs: number;
    winRate: number;
    avgBidsPerRfq: number;
    medianDecisionDays: number | null;
    cadenceDays: number | null;
  };
  opticsPlaybook: OpticsPlaybook;
  marketRead: {
    supplierPosture: MarketPowerProfile["supplierPosture"] | null;
    responsePressureLevel: MarketPowerProfile["responsePressure"]["level"] | null;
    scarcityIndex: number | null;
  };
  lastRefreshed: string;
};

/**
 * Example shape:
 * {
 *   rfqId: "rfq_123",
 *   customerId: "cust_123",
 *   posture: "expansion",
 *   storyline: "Invite one more fast-turn supplier while anchoring confidence on two vetted options.",
 *   anchorSignals: {
 *     bidCount: 2,
 *     supplierCompetitiveness: 0.68,
 *     responsePressure: "high",
 *     scarcityIndex: 1.4
 *   },
 *   prescribedMoves: [
 *     { move: "expand_shortlist", rationale: "Scarcity-driven", target: "Add 2 speed shops" }
 *   ],
 *   supplierShortlist: [
 *     { supplierId: "sup_1", supplierLabel: "Northwind", role: "pace-setter", action: "Hold line" }
 *   ],
 *   optics: {
 *     message: "We're giving you optionality without noise.",
 *     confidence: "medium",
 *     reminders: ["Highlight curated aspect", "Underscore fast follow-ups"]
 *   }
 * }
 */
export type SupplierStrategyRecommendation = {
  rfqId: string;
  customerId: string | null;
  posture: "expansion" | "precision" | "hold";
  storyline: string;
  anchorSignals: {
    bidCount: number;
    supplierCompetitiveness: number | null;
    responsePressure: MarketPowerProfile["responsePressure"]["level"] | null;
    scarcityIndex: number | null;
  };
  prescribedMoves: Array<{
    move: "expand_shortlist" | "tighten_band" | "activate_backstop";
    rationale: string;
    target: string;
  }>;
  supplierShortlist: Array<{
    supplierId: string;
    supplierLabel: string | null;
    role: "pace-setter" | "value_guard" | "risk_buffer";
    action: string;
    bidId?: string;
  }>;
  optics: {
    message: string;
    confidence: "high" | "medium" | "low";
    reminders: string[];
  };
};

/**
 * Example shape:
 * {
 *   rfqId: "rfq_123",
 *   customerId: "cust_123",
 *   urgencyLevel: "accelerated",
 *   framing: {
 *     headline: "Decision-ready in 72 hours",
 *     promise: "We'll keep optionality live while holding suppliers warm."
 *   },
 *   checkpoints: [
 *     { label: "Shortlist sync", windowHours: 24, focus: "Commit to two bids", guidance: "Position as controlled acceleration." }
 *   ],
 *   fallbackOptions: ["Pause + reframe as prototype run"],
 *   metricsUsed: {
 *     daysToTarget: 11,
 *     responsePressure: "high",
 *     bidCoverage: 0.4
 *   }
 * }
 */
export type TimelineStrategyRecommendation = {
  rfqId: string;
  customerId: string | null;
  urgencyLevel: "calm" | "guided" | "accelerated";
  framing: {
    headline: string;
    promise: string;
  };
  checkpoints: Array<{
    label: string;
    windowHours: number;
    focus: string;
    guidance: string;
  }>;
  fallbackOptions: string[];
  metricsUsed: {
    daysToTarget: number | null;
    responsePressure: MarketPowerProfile["responsePressure"]["level"] | null;
    bidCoverage: number | null;
  };
};

const MAX_RFQ_HISTORY = 50;
const DECISIONAL_STATUSES = new Set<MarketplaceRfq["status"]>([
  "awarded",
  "closed",
  "cancelled",
]);

export async function computeCustomerPowerProfile(
  customerId: string,
): Promise<CustomerPowerProfile> {
  if (!customerId) {
    return buildEmptyCustomerProfile(null);
  }

  const rfqs = await fetchRecentCustomerRfqs(customerId);
  if (rfqs.length === 0) {
    return buildEmptyCustomerProfile(customerId);
  }

  const bidInsights = await summarizeCustomerBids(rfqs.map((rfq) => rfq.id));
  const anchorRfq = selectAnchorRfq(rfqs);
  const marketProfile = anchorRfq
    ? await marketplacePowerProfile(anchorRfq, { logEvent: false })
    : null;

  const summary = summarizeRfqHistory(rfqs);
  const leverageScore = computeLeverageScore({
    avgPriority: summary.avgPriority,
    winRate: summary.winRate,
    avgBids: bidInsights.avgBidsPerRfq,
    cadenceDays: summary.cadenceDays,
  });
  const influenceTier = determineInfluenceTier(leverageScore, summary.winRate);

  const profile: CustomerPowerProfile = {
    customerId,
    anchorRfqId: anchorRfq?.id ?? null,
    leverageScore,
    influenceTier,
    engagementSignals: {
      activeRfqs: summary.activeRfqs,
      awardedRfqs: summary.awardedRfqs,
      winRate: summary.winRate,
      avgBidsPerRfq: bidInsights.avgBidsPerRfq,
      medianDecisionDays: summary.medianDecisionDays,
      cadenceDays: summary.cadenceDays,
    },
    opticsPlaybook: buildOpticsPlaybook(influenceTier, summary, bidInsights),
    marketRead: {
      supplierPosture: marketProfile?.supplierPosture ?? null,
      responsePressureLevel: marketProfile?.responsePressure.level ?? null,
      scarcityIndex: marketProfile?.diagnostics.scarcityIndex ?? null,
    },
    lastRefreshed: new Date().toISOString(),
  };

  return profile;
}

export async function recommendSupplierStrategy(
  rfqId: string,
  customerId?: string,
): Promise<SupplierStrategyRecommendation> {
  const rfq = await loadRfqById(rfqId);
  if (!rfq) {
    return {
      rfqId,
      customerId: customerId ?? null,
      posture: "hold",
      storyline: "RFQ context unavailable. Hold messaging until data refresh completes.",
      anchorSignals: {
        bidCount: 0,
        supplierCompetitiveness: null,
        responsePressure: null,
        scarcityIndex: null,
      },
      prescribedMoves: [],
      supplierShortlist: [],
      optics: {
        message: "We are verifying the opportunity before nudging suppliers.",
        confidence: "low",
        reminders: ["Confirm RFQ state", "Re-run strategy once RFQ loads"],
      },
    };
  }

  const { bids } = await listBidsForRfq(rfqId);
  const normalizedBids = bids.map(({ supplier: _supplier, ...rest }) => rest);
  const marketProfile = await marketplacePowerProfile(rfq, {
    bids: normalizedBids,
    logEvent: false,
  });

  const scarcityIndex = marketProfile.diagnostics.scarcityIndex;
  const bidCount = normalizedBids.filter((bid) => bid.status !== "withdrawn").length;
  const coverage =
    marketProfile.diagnostics.estimatedQualifiedSuppliers > 0
      ? bidCount /
        Math.max(marketProfile.diagnostics.estimatedQualifiedSuppliers, 1)
      : 0;

  const posture: SupplierStrategyRecommendation["posture"] =
    bidCount < 3 || scarcityIndex > 1.1 ? "expansion" : coverage >= 0.65 ? "precision" : "hold";

  const storyline =
    posture === "expansion"
      ? "Invite one more fast-turn supplier while anchoring confidence on vetted partners."
      : posture === "precision"
        ? "Lean on current bids and sharpen signal-to-noise by narrating their distinct roles."
        : "Hold steady, reinforce the sense that we are curating quietly while suppliers stay warm.";

  const prescribedMoves = buildSupplierMoves(posture, scarcityIndex, coverage);
  const shortlist = buildSupplierShortlist(bids);
  const confidence =
    posture === "hold" && bidCount >= 3
      ? "high"
      : posture === "precision"
        ? "medium"
        : "medium";

  const recommendation: SupplierStrategyRecommendation = {
    rfqId,
    customerId: rfq.customer_id ?? customerId ?? null,
    posture,
    storyline,
    anchorSignals: {
      bidCount,
      supplierCompetitiveness: marketProfile.supplierCompetitiveness,
      responsePressure: marketProfile.responsePressure.level,
      scarcityIndex,
    },
    prescribedMoves,
    supplierShortlist: shortlist,
    optics: {
      message:
        posture === "expansion"
          ? "Position the outreach as optionality-building without diluting standards."
          : posture === "precision"
            ? "Narrate how each bid plays a role so the customer feels in command."
            : "Reassure them that holding pattern equals leverage, not drift.",
      confidence,
      reminders:
        posture === "expansion"
          ? ["Highlight concierge outreach", "Name two target capabilities"]
          : posture === "precision"
            ? ["Summarize gaps closed", "Pre-wire any concessions"]
            : ["Mention silent monitoring", "Reconfirm supplier readiness"],
    },
  };

  await logMarketplaceEvent({
    rfqId,
    customerId: recommendation.customerId,
    type: "customer_strategy_recommended",
    payload: {
      strategy: "supplier",
      posture,
      bid_count: bidCount,
      response_pressure: marketProfile.responsePressure.level,
      scarcity_index: scarcityIndex,
    },
  });

  return recommendation;
}

export async function recommendTimelineStrategy(
  rfqId: string,
  customerId?: string,
): Promise<TimelineStrategyRecommendation> {
  const rfq = await loadRfqById(rfqId);
  if (!rfq) {
    return {
      rfqId,
      customerId: customerId ?? null,
      urgencyLevel: "guided",
      framing: {
        headline: "Timeline pending RFQ refresh",
        promise: "We will re-frame once the opportunity is accessible.",
      },
      checkpoints: [],
      fallbackOptions: [],
      metricsUsed: {
        daysToTarget: null,
        responsePressure: null,
        bidCoverage: null,
      },
    };
  }

  const { bids } = await listBidsForRfq(rfqId);
  const normalizedBids = bids.map(({ supplier: _supplier, ...rest }) => rest);
  const marketProfile = await marketplacePowerProfile(rfq, {
    bids: normalizedBids,
    logEvent: false,
  });
  const priority = await customerPriorityProfile(rfq);

  const bidCoverage =
    marketProfile.diagnostics.estimatedQualifiedSuppliers > 0
      ? Math.min(
          marketProfile.diagnostics.uniqueBiddingSuppliers /
            marketProfile.diagnostics.estimatedQualifiedSuppliers,
          1,
        )
      : 0;

  const daysToTarget = computeDaysToTarget(rfq.target_date);
  const urgencyIndex = Math.max(
    marketProfile.responsePressure.index,
    priority.drivers.urgency,
  );

  const urgencyLevel: TimelineStrategyRecommendation["urgencyLevel"] =
    urgencyIndex >= 0.65
      ? "accelerated"
      : urgencyIndex >= 0.4
        ? "guided"
        : "calm";

  const framing =
    urgencyLevel === "accelerated"
      ? {
          headline: "Decision-ready inside 72 hours",
          promise: "We compress the window without forcing concessions.",
        }
      : urgencyLevel === "guided"
        ? {
            headline: "Deliberate pace, always briefed",
            promise: "Expect crisp checkpoints without noise.",
          }
        : {
            headline: "Slack built in, leverage preserved",
            promise: "We maintain tempo but keep optionality wide.",
          };

  const checkpoints = buildTimelineCheckpoints({
    urgencyLevel,
    bidCoverage,
    daysToTarget,
    responsePressure: marketProfile.responsePressure.level,
  });

  const fallbackOptions =
    urgencyLevel === "accelerated"
      ? [
          "Pull forward a bridge order with the fastest lead-time bid.",
          "Escalate to preferred-supplier queue if bids slip.",
        ]
      : ["Convert to sample run", "Pause and reopen with refreshed specs"];

  const recommendation: TimelineStrategyRecommendation = {
    rfqId,
    customerId: rfq.customer_id ?? customerId ?? null,
    urgencyLevel,
    framing,
    checkpoints,
    fallbackOptions,
    metricsUsed: {
      daysToTarget,
      responsePressure: marketProfile.responsePressure.level,
      bidCoverage,
    },
  };

  await logMarketplaceEvent({
    rfqId,
    customerId: recommendation.customerId,
    type: "customer_strategy_recommended",
    payload: {
      strategy: "timeline",
      urgency_level: urgencyLevel,
      days_to_target: daysToTarget,
      response_pressure: marketProfile.responsePressure.level,
      bid_coverage: Number.isFinite(bidCoverage) ? Number(bidCoverage.toFixed(2)) : null,
    },
  });

  return recommendation;
}

async function fetchRecentCustomerRfqs(customerId: string): Promise<MarketplaceRfq[]> {
  try {
    const { data, error } = await supabaseServer
      .from("rfqs")
      .select(
        "id,customer_id,status,title,description,quantity,process_requirements,material_requirements,certification_requirements,target_date,created_at,updated_at,priority,files,upload_id",
      )
      .eq("customer_id", customerId)
      .order("created_at", { ascending: false })
      .limit(MAX_RFQ_HISTORY);

    if (error) {
      console.error("customer-intel: rfq history query failed", { customerId, error });
      return [];
    }

    return (data as MarketplaceRfq[]) ?? [];
  } catch (error) {
    console.error("customer-intel: rfq history unexpected error", { customerId, error });
    return [];
  }
}

async function summarizeCustomerBids(rfqIds: string[]) {
  if (rfqIds.length === 0) {
    return {
      avgBidsPerRfq: 0,
      medianLeadTime: null,
      typicalPrice: null,
      spread: null,
      perRfq: {},
    };
  }

  try {
    const { data, error } = await supabaseServer
      .from("rfq_bids")
      .select("rfq_id,price_total,lead_time_days,status")
      .in("rfq_id", rfqIds);

    if (error) {
      console.error("customer-intel: bid summary query failed", { rfqIds, error });
      return {
        avgBidsPerRfq: 0,
        medianLeadTime: null,
        typicalPrice: null,
        spread: null,
        perRfq: {},
      };
    }

    const rows =
      (data as Array<Pick<RfqBidRecord, "rfq_id" | "price_total" | "lead_time_days" | "status">>) ??
      [];

    const perRfq = rfqIds.reduce<Record<string, { live: number; withdrawn: number; prices: number[] }>>(
      (map, id) => {
        map[id] = { live: 0, withdrawn: 0, prices: [] };
        return map;
      },
      {},
    );

    const leadTimes: number[] = [];
    const prices: number[] = [];

    rows.forEach((row) => {
      const holder = perRfq[row.rfq_id] ?? { live: 0, withdrawn: 0, prices: [] };
      const price =
        typeof row.price_total === "string"
          ? Number.parseFloat(row.price_total)
          : row.price_total;
      const lead = typeof row.lead_time_days === "string"
        ? Number.parseInt(row.lead_time_days, 10)
        : row.lead_time_days;

      if (row.status === "withdrawn") {
        holder.withdrawn += 1;
      } else {
        holder.live += 1;
      }
      if (Number.isFinite(price ?? NaN)) {
        holder.prices.push(price as number);
        prices.push(price as number);
      }
      if (Number.isFinite(lead ?? NaN)) {
        leadTimes.push(lead as number);
      }
      perRfq[row.rfq_id] = holder;
    });

    const avgBidsPerRfq =
      Object.values(perRfq).reduce((sum, entry) => sum + entry.live, 0) / rfqIds.length || 0;

    const typicalPrice = computeMedian(prices);
    const spread =
      prices.length >= 2
        ? Math.max(...prices) - Math.min(...prices)
        : null;

    const medianLeadTime = computeMedian(leadTimes);

    return {
      avgBidsPerRfq: Number.isFinite(avgBidsPerRfq) ? Number(avgBidsPerRfq.toFixed(2)) : 0,
      medianLeadTime,
      typicalPrice,
      spread,
      perRfq,
    };
  } catch (error) {
    console.error("customer-intel: bid summary unexpected error", { rfqIds, error });
    return {
      avgBidsPerRfq: 0,
      medianLeadTime: null,
      typicalPrice: null,
      spread: null,
      perRfq: {},
    };
  }
}

function selectAnchorRfq(rfqs: MarketplaceRfq[]): MarketplaceRfq | null {
  if (rfqs.length === 0) {
    return null;
  }
  const open = rfqs.find((rfq) => OPEN_RFQ_STATUSES.includes(rfq.status));
  return open ?? rfqs[0] ?? null;
}

function summarizeRfqHistory(rfqs: MarketplaceRfq[]) {
  if (rfqs.length === 0) {
    return {
      activeRfqs: 0,
      awardedRfqs: 0,
      winRate: 0,
      medianDecisionDays: null,
      cadenceDays: null,
      avgPriority: 0.3,
    };
  }

  const activeRfqs = rfqs.filter((rfq) => OPEN_RFQ_STATUSES.includes(rfq.status)).length;
  const awardedRfqs = rfqs.filter((rfq) => rfq.status === "awarded").length;
  const completed = rfqs.filter((rfq) => DECISIONAL_STATUSES.has(rfq.status));
  const winRate =
    completed.length > 0 ? Number((awardedRfqs / completed.length).toFixed(2)) : 0;

  const decisionDurations = completed
    .map((rfq) => {
      const end = rfq.updated_at ?? rfq.created_at;
      const duration =
        Date.parse(end ?? "") - Date.parse(rfq.created_at ?? "");
      return Number.isFinite(duration) && duration > 0
        ? duration / (1000 * 60 * 60 * 24)
        : null;
    })
    .filter((value): value is number => Number.isFinite(value ?? NaN));

  const medianDecisionDays = computeMedian(decisionDurations);

  const cadenceDays = computeCadence(rfqs);

  const priorities = rfqs
    .map((rfq) => (typeof rfq.priority === "number" ? rfq.priority : null))
    .filter((value): value is number => Number.isFinite(value));
  const avgPriority =
    priorities.length > 0
      ? priorities.reduce((sum, value) => sum + normalizePriority(value), 0) / priorities.length
      : 0.3;

  return {
    activeRfqs,
    awardedRfqs,
    winRate,
    medianDecisionDays,
    cadenceDays,
    avgPriority,
  };
}

function computeCadence(rfqs: MarketplaceRfq[]): number | null {
  if (rfqs.length < 2) {
    return null;
  }
  const sorted = [...rfqs]
    .filter((rfq) => Boolean(rfq.created_at))
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));

  const intervals: number[] = [];
  for (let i = 1; i < sorted.length; i += 1) {
    const prev = Date.parse(sorted[i - 1].created_at ?? "");
    const current = Date.parse(sorted[i].created_at ?? "");
    if (Number.isFinite(prev) && Number.isFinite(current)) {
      const days = (current - prev) / (1000 * 60 * 60 * 24);
      if (Number.isFinite(days) && days >= 0) {
        intervals.push(days);
      }
    }
  }

  return computeMedian(intervals);
}

function computeLeverageScore(args: {
  avgPriority: number;
  winRate: number;
  avgBids: number;
  cadenceDays: number | null;
}) {
  const cadenceScore = args.cadenceDays
    ? clamp(1 - args.cadenceDays / 45, 0, 1)
    : 0.4;
  const bidAttraction = clamp(args.avgBids / 5, 0, 1);

  const score =
    args.avgPriority * 0.35 + args.winRate * 0.25 + bidAttraction * 0.25 + cadenceScore * 0.15;

  return Number(clamp(score, 0, 1).toFixed(2));
}

function determineInfluenceTier(score: number, winRate: number) {
  if (score >= 0.8 || winRate >= 0.7) {
    return "flagship";
  }
  if (score >= 0.6) {
    return "growth";
  }
  if (score >= 0.4) {
    return "builder";
  }
  return "emerging";
}

function buildOpticsPlaybook(
  tier: CustomerPowerProfile["influenceTier"],
  summary: ReturnType<typeof summarizeRfqHistory>,
  bids: Awaited<ReturnType<typeof summarizeCustomerBids>>,
): OpticsPlaybook {
  const rawTone = tier === "flagship" ? "executive" : tier === "growth" ? "partner" : "guide";
  const tone = normalizeTone(rawTone);

  const proofPoints: string[] = [];
  if (summary.winRate >= 0.5) {
    proofPoints.push("Conversion momentum stays high");
  }
  if ((bids.avgBidsPerRfq ?? 0) >= 3) {
    proofPoints.push("Suppliers keep showing up");
  }
  if ((summary.cadenceDays ?? 0) <= 21) {
    proofPoints.push("Runs frequent iterations");
  }
  if (proofPoints.length === 0) {
    proofPoints.push("We steward each opportunity end-to-end");
  }

  const supportLevers =
    tier === "flagship"
      ? ["paired_concierge", "preferred_lane_ready"]
      : tier === "growth"
        ? ["spotlight_suppliers", "nudge_bidder_pool"]
        : ["guided_templates", "pre_briefed_suppliers"];

  return {
    tone,
    proofPoints,
    supportLevers,
  };
}

function buildSupplierMoves(
  posture: SupplierStrategyRecommendation["posture"],
  scarcityIndex: number,
  coverage: number,
): SupplierStrategyRecommendation["prescribedMoves"] {
  if (posture === "expansion") {
    return [
      {
        move: "expand_shortlist",
        rationale:
          scarcityIndex > 1.2
            ? "Scarcity is biting; one more shortlisted supplier protects leverage."
            : "Optionality boost keeps posture confident.",
        target: scarcityIndex > 1.2 ? "Add two speed-focused shops" : "Invite 1 premium + 1 fast",
      },
      {
        move: "activate_backstop",
        rationale: "Keep a trusted standby aware without broadcasting urgency.",
        target: "Prep preferred supplier in silent mode",
      },
    ];
  }

  if (posture === "precision") {
    return [
      {
        move: "tighten_band",
        rationale: "Signal decisiveness by narrating where each bid sits.",
        target: coverage >= 0.8 ? "Lock pricing guardrails" : "Define target deltas in-channel",
      },
    ];
  }

  return [
    {
      move: "activate_backstop",
      rationale: "Hold quiet leverage; only escalate if coverage dips.",
      target: "Shadow brief preferred partner",
    },
  ];
}

function buildSupplierShortlist(
  bids: Awaited<ReturnType<typeof listBidsForRfq>>["bids"],
): SupplierStrategyRecommendation["supplierShortlist"] {
  if (!Array.isArray(bids) || bids.length === 0) {
    return [];
  }

  const priceValues = bids
    .map((bid) => {
      const value =
        typeof bid.price_total === "string"
          ? Number.parseFloat(bid.price_total)
          : bid.price_total;
      return Number.isFinite(value ?? NaN) ? (value as number) : null;
    })
    .filter((value): value is number => Number.isFinite(value));

  const leadValues = bids
    .map((bid) => {
      const value =
        typeof bid.lead_time_days === "string"
          ? Number.parseInt(bid.lead_time_days, 10)
          : bid.lead_time_days;
      return Number.isFinite(value ?? NaN) ? (value as number) : null;
    })
    .filter((value): value is number => Number.isFinite(value));

  const minPrice = priceValues.length > 0 ? Math.min(...priceValues) : null;
  const minLead = leadValues.length > 0 ? Math.min(...leadValues) : null;

  type SupplierRole = SupplierStrategyRecommendation["supplierShortlist"][number]["role"];
  type ParsedBid = {
    bidId: string;
    supplierId: string;
    supplierLabel: string;
    price: number | null;
    leadTime: number | null;
    role: SupplierRole;
  };

  const parsed: ParsedBid[] = bids
    .map((bid) => {
      const price =
        typeof bid.price_total === "string"
          ? Number.parseFloat(bid.price_total)
          : bid.price_total;
      const leadTime =
        typeof bid.lead_time_days === "string"
          ? Number.parseInt(bid.lead_time_days, 10)
          : bid.lead_time_days ?? null;

      const role: SupplierRole =
        minLead !== null && Number.isFinite(leadTime ?? NaN) && (leadTime as number) <= minLead * 1.1
          ? "pace-setter"
          : minPrice !== null &&
              Number.isFinite(price ?? NaN) &&
              (price as number) <= minPrice * 1.08
            ? "value_guard"
            : "risk_buffer";

      return {
        bidId: bid.id,
        supplierId: bid.supplier_id,
        supplierLabel: bid.supplier?.company_name ?? "Supplier",
        price: Number.isFinite(price ?? NaN) ? (price as number) : null,
        leadTime,
        role,
      };
    })
    .sort((a, b) => {
      if (a.role === b.role) {
        return (a.price ?? Infinity) - (b.price ?? Infinity);
      }
      const ordering = ["pace-setter", "value_guard", "risk_buffer"] as const;
      return (
        ordering.indexOf(a.role as (typeof ordering)[number]) -
        ordering.indexOf(b.role as (typeof ordering)[number])
      );
    })
    .slice(0, 4);

  return parsed.map((entry) => ({
    supplierId: entry.supplierId,
    supplierLabel: entry.supplierLabel,
    role: entry.role,
    action:
      entry.role === "pace-setter"
        ? "Hold ready for rapid commit"
        : entry.role === "value_guard"
          ? "Use as pricing signal"
          : "Keep as fallback buffer",
    bidId: entry.bidId,
  }));
}

function buildTimelineCheckpoints(args: {
  urgencyLevel: TimelineStrategyRecommendation["urgencyLevel"];
  bidCoverage: number;
  daysToTarget: number | null;
  responsePressure: MarketPowerProfile["responsePressure"]["level"];
}): TimelineStrategyRecommendation["checkpoints"] {
  const checkpoints: TimelineStrategyRecommendation["checkpoints"] = [];

  const baseWindow =
    args.urgencyLevel === "accelerated" ? 24 : args.urgencyLevel === "guided" ? 48 : 72;

  checkpoints.push({
    label: "Shortlist sync",
    windowHours: baseWindow,
    focus:
      args.bidCoverage >= 0.6 ? "Confirm finalists" : "Review outreach plan",
    guidance:
      args.urgencyLevel === "accelerated"
        ? "Frame as decisive but calm. We curate while you approve."
        : "Keep it light-touch; reassure that we're on top of supplier momentum.",
  });

  checkpoints.push({
    label: "Decision gate",
    windowHours: baseWindow * 2,
    focus: "Align on price + lead guardrails",
    guidance:
      args.responsePressure === "high"
        ? "Call out scarcity so the customer feels informed, not pressured."
        : "Highlight how we keep leverage via measured pacing.",
  });

  if ((args.daysToTarget ?? 0) > 0) {
    checkpoints.push({
      label: "Buffer review",
      windowHours: Math.max(baseWindow * 3, 72),
      focus: "Reconfirm backup plan before target date",
      guidance: "Quietly prep supplier warm handoffs in case timing slips.",
    });
  }

  return checkpoints;
}

function computeDaysToTarget(targetDate?: string | null): number | null {
  if (!targetDate) {
    return null;
  }
  const target = Date.parse(targetDate);
  if (!Number.isFinite(target)) {
    return null;
  }
  const days = Math.round((target - Date.now()) / (1000 * 60 * 60 * 24));
  return days;
}

function normalizePriority(value: number) {
  if (value > 1) {
    return clamp(value / 100, 0, 1);
  }
  return clamp(value, 0, 1);
}

function computeMedian(values: number[]): number | null {
  if (!Array.isArray(values) || values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return Number(((sorted[mid - 1] + sorted[mid]) / 2).toFixed(2));
  }
  return Number(sorted[mid].toFixed(2));
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function normalizeTone(rawTone: string): OpticsTone {
  const lower = rawTone.toLowerCase();
  if (lower.includes("exec")) {
    return "executive";
  }
  if (lower.includes("partner")) {
    return "partner";
  }
  return "guide";
}

function buildEmptyCustomerProfile(customerId: string | null): CustomerPowerProfile {
  return {
    customerId,
    anchorRfqId: null,
    leverageScore: 0,
    influenceTier: "emerging",
    engagementSignals: {
      activeRfqs: 0,
      awardedRfqs: 0,
      winRate: 0,
      avgBidsPerRfq: 0,
      medianDecisionDays: null,
      cadenceDays: null,
    },
    opticsPlaybook: {
      tone: "guide",
      proofPoints: ["We are collecting activity to shape a signal."],
      supportLevers: ["guided_templates"],
    },
    marketRead: {
      supplierPosture: null,
      responsePressureLevel: null,
      scarcityIndex: null,
    },
    lastRefreshed: new Date().toISOString(),
  };
}
