import { listBidsForRfq } from "./bids";
import { logMarketplaceEvent } from "./events";
import { loadRfqById } from "./rfqs";
import { supplierLeverageProfile } from "./strategy";
import type { RfqBidRecord } from "./types";

/**
 * Example:
 * {
 *   rfqId: "rfq_123",
 *   headline: "Three credible choices, each with a distinct edge.",
 *   summary: { spread: 1800, fastestLeadTime: 9, bidCount: 3, coverage: "light" },
 *   options: [
 *     {
 *       bidId: "bid_1",
 *       supplierLabel: "Northwind",
 *       price: 12000,
 *       pricePosition: "anchor",
 *       leadTimeDays: 11,
 *       speedPosition: "standard",
 *       tradeoffs: ["Better documentation", "Mid-pack speed"],
 *       storyline: "Use as reference point—balanced price and compliance."
 *     }
 *   ],
 *   framing: {
 *     customerMessage: "You stay in command while we keep suppliers warm.",
 *     internalNotes: ["Call out curated shortlist", "Quantify savings delta"]
 *   }
 * }
 */
export type BidComparisonView = {
  rfqId: string;
  customerId: string | null;
  headline: string;
  summary: {
    spread: number | null;
    fastestLeadTime: number | null;
    bidCount: number;
    coverage: "light" | "healthy" | "rich";
  };
  options: Array<{
    bidId: string;
    supplierId: string;
    supplierLabel: string | null;
    price: number | null;
    pricePosition: "anchor" | "value" | "premium";
    leadTimeDays: number | null;
    speedPosition: "fast" | "standard" | "deliberate";
    tradeoffs: string[];
    storyline: string;
  }>;
  framing: {
    customerMessage: string;
    internalNotes: string[];
  };
};

/**
 * Example:
 * {
 *   rfqId: "rfq_123",
 *   narratives: [
 *     {
 *       supplierId: "sup_1",
 *       supplierLabel: "Northwind",
 *       headline: "Northwind = confident pace-setter",
 *       stance: "speed",
 *       leverageScore: 0.71,
 *       posture: "price_setter",
 *       talkingPoints: ["Fastest lead", "Trusted history"],
 *       guardrails: ["Watch for premium pricing"]
 *     }
 *   ],
 *   notes: ["Mix of speed + assurance. Remind customer we curate."]
 * }
 */
export type SupplierNarrativeDeck = {
  rfqId: string;
  customerId: string | null;
  narratives: Array<{
    supplierId: string;
    supplierLabel: string | null;
    headline: string;
    stance: "speed" | "value" | "assurance";
    leverageScore: number;
    posture: "price_setter" | "balanced" | "price_taker";
    talkingPoints: string[];
    guardrails: string[];
    bidId?: string;
  }>;
  notes: string[];
};

/**
 * Example:
 * {
 *   rfqId: "rfq_123",
 *   axes: {
 *     price: { low: 11000, high: 14250, anchor: 12500 },
 *     speed: { fast: 9, slow: 21, anchor: 14 },
 *     assurance: { minScore: 0.35, maxScore: 0.78, notes: ["Docs attached"] }
 *   },
 *   zones: [
 *     {
 *       label: "Value win",
 *       narrative: "Save ~12% if timeline can slip 3 days.",
 *       whenToUse: "Customer optimizes for budget.",
 *       supportingBids: ["bid_2"]
 *     }
 *   ],
 *   prompts: ["Ask if speed premium worth $1.8k.", "Highlight assurance gap."]
 * }
 */
export type TradeoffMatrix = {
  rfqId: string;
  customerId: string | null;
  axes: {
    price: {
      low: number | null;
      high: number | null;
      anchor: number | null;
    };
    speed: {
      fast: number | null;
      slow: number | null;
      anchor: number | null;
    };
    assurance: {
      minScore: number | null;
      maxScore: number | null;
      notes: string[];
    };
  };
  zones: Array<{
    label: string;
    narrative: string;
    whenToUse: string;
    supportingBids: string[];
  }>;
  prompts: string[];
};

export async function buildBidComparison(
  rfqId: string,
  customerId?: string,
): Promise<BidComparisonView> {
  const rfq = await loadRfqById(rfqId);
  const fallback = buildEmptyBidView(rfqId, rfq?.customer_id ?? customerId ?? null);
  if (!rfq) {
    return fallback;
  }

  const { bids, error } = await listBidsForRfq(rfqId);
  if (error) {
    console.error("decision-framing: bid comparison failed", { rfqId, error });
    return fallback;
  }

  const stats = computeBidStats(bids);
  const options = bids.map((bid) =>
    toComparisonOption(bid, stats.minPrice, stats.maxPrice, stats.fastestLead),
  );

  const coverage =
    stats.bidCount === 0
      ? "light"
      : stats.bidCount >= 4
        ? "rich"
        : stats.bidCount >= 3
          ? "healthy"
          : "light";

  const view: BidComparisonView = {
    rfqId,
    customerId: rfq.customer_id ?? customerId ?? null,
    headline:
      stats.bidCount >= 2
        ? "Three credible choices, each with a distinct edge."
        : "Signal is forming—here’s how we frame early bids.",
    summary: {
      spread: stats.spread,
      fastestLeadTime: stats.fastestLead,
      bidCount: stats.bidCount,
      coverage,
    },
    options,
    framing: {
      customerMessage:
        stats.bidCount === 0
          ? "We’re warming suppliers quietly so you stay in control."
          : "You stay in command; we surface the tradeoffs plainly.",
      internalNotes: [
        stats.spread
          ? `Call out ~$${Math.round(stats.spread)} swing between bids.`
          : "Anchor on qualitative differences until more bids arrive.",
        coverage === "light"
          ? "Mention that outreach is still curated, not stalled."
          : "Reinforce that shortlist is intentional.",
      ],
    },
  };

  await logMarketplaceEvent({
    rfqId,
    customerId: view.customerId,
    type: "customer_view_transformed",
    payload: {
      view: "bid_comparison",
      bid_count: stats.bidCount,
      coverage,
    },
  });

  return view;
}

export async function buildSupplierNarratives(
  rfqId: string,
  customerId?: string,
): Promise<SupplierNarrativeDeck> {
  const rfq = await loadRfqById(rfqId);
  const fallback: SupplierNarrativeDeck = {
    rfqId,
    customerId: rfq?.customer_id ?? customerId ?? null,
    narratives: [],
    notes: ["Awaiting RFQ context before shaping narratives."],
  };

  if (!rfq) {
    return fallback;
  }

  const { bids, error } = await listBidsForRfq(rfqId);
  if (error) {
    console.error("decision-framing: narrative bids failed", { rfqId, error });
    return fallback;
  }

  if (bids.length === 0) {
    return {
      ...fallback,
      notes: ["No bids yet. Emphasize proactive sourcing underway."],
    };
  }

  const normalizedBidRecords: RfqBidRecord[] = bids.map(({ supplier: _supplier, ...rest }) => rest);
  const narratives = await Promise.all(
    bids.slice(0, 4).map(async (bid) => {
      const leverage = await supplierLeverageProfile(rfq, bid.supplier_id, {
        bids: normalizedBidRecords,
        logEvent: false,
      });
      const stance = deriveStance(bid, leverage);
      return {
        supplierId: bid.supplier_id,
        supplierLabel: bid.supplier?.company_name ?? "Supplier",
        headline: buildNarrativeHeadline(stance, bid.supplier?.company_name),
        stance,
        leverageScore: Number(leverage.leverageScore.toFixed(2)),
        posture: leverage.posture,
        talkingPoints: buildTalkingPoints(stance, bid, leverage),
        guardrails: buildGuardrails(stance, bid),
        bidId: bid.id,
      };
    }),
  );

  const deck: SupplierNarrativeDeck = {
    rfqId,
    customerId: rfq.customer_id ?? customerId ?? null,
    narratives,
    notes: [
      narratives.length >= 3
        ? "Triangulate around speed/value/assurance to help decision-making."
        : "Call out that we’re still shaping the roster.",
    ],
  };

  await logMarketplaceEvent({
    rfqId,
    customerId: deck.customerId,
    type: "customer_view_transformed",
    payload: {
      view: "supplier_narratives",
      narrative_count: narratives.length,
    },
  });

  return deck;
}

export async function generateTradeoffMatrix(
  rfqId: string,
  customerId?: string,
): Promise<TradeoffMatrix> {
  const rfq = await loadRfqById(rfqId);
  const fallback = buildEmptyMatrix(rfqId, rfq?.customer_id ?? customerId ?? null);
  if (!rfq) {
    return fallback;
  }

  const { bids, error } = await listBidsForRfq(rfqId);
  if (error) {
    console.error("decision-framing: tradeoff bids failed", { rfqId, error });
    return fallback;
  }

  if (bids.length === 0) {
    return fallback;
  }

  const stats = computeBidStats(bids);
  const assuranceScores = bids.map((bid) => ({
    bidId: bid.id,
    score: computeAssuranceScore(bid),
  }));

  const matrix: TradeoffMatrix = {
    rfqId,
    customerId: rfq.customer_id ?? customerId ?? null,
    axes: {
      price: {
        low: stats.minPrice,
        high: stats.maxPrice,
        anchor: stats.medianPrice,
      },
      speed: {
        fast: stats.fastestLead,
        slow: stats.slowestLead,
        anchor: stats.medianLead,
      },
      assurance: {
        minScore:
          assuranceScores.length > 0
            ? Math.min(...assuranceScores.map((entry) => entry.score))
            : null,
        maxScore:
          assuranceScores.length > 0
            ? Math.max(...assuranceScores.map((entry) => entry.score))
            : null,
        notes: [
          "Assurance considers supplier notes + activity recency.",
          "Use it to frame confidence without exposing raw scoring math.",
        ],
      },
    },
    zones: buildTradeoffZones(bids, stats, assuranceScores),
    prompts: [
      "Invite the customer to choose which axis matters most today.",
      stats.fastestLead && stats.maxPrice
        ? `Quantify the $${Math.round(
            (stats.maxPrice - (stats.minPrice ?? 0)) || 0,
          )} premium for speed.`
        : "Explain how we keep options open while bids land.",
    ].filter((prompt): prompt is string => Boolean(prompt)),
  };

  await logMarketplaceEvent({
    rfqId,
    customerId: matrix.customerId,
    type: "customer_view_transformed",
    payload: {
      view: "tradeoff_matrix",
      bid_count: stats.bidCount,
    },
  });

  return matrix;
}

function buildEmptyBidView(rfqId: string, customerId: string | null): BidComparisonView {
  return {
    rfqId,
    customerId,
    headline: "Signal pending—no bids yet.",
    summary: {
      spread: null,
      fastestLeadTime: null,
      bidCount: 0,
      coverage: "light",
    },
    options: [],
    framing: {
      customerMessage: "We’re warming the right suppliers quietly.",
      internalNotes: ["Reassure that sourcing is underway."],
    },
  };
}

function computeBidStats(bids: Awaited<ReturnType<typeof listBidsForRfq>>["bids"]) {
  const prices = bids
    .map((bid) => {
      const value =
        typeof bid.price_total === "string"
          ? Number.parseFloat(bid.price_total)
          : bid.price_total;
      return Number.isFinite(value ?? NaN) ? (value as number) : null;
    })
    .filter((value): value is number => Number.isFinite(value));

  const leads = bids
    .map((bid) => {
      const value =
        typeof bid.lead_time_days === "string"
          ? Number.parseInt(bid.lead_time_days, 10)
          : bid.lead_time_days;
      return Number.isFinite(value ?? NaN) ? (value as number) : null;
    })
    .filter((value): value is number => Number.isFinite(value));

  const sortedPrices = [...prices].sort((a, b) => a - b);
  const sortedLeads = [...leads].sort((a, b) => a - b);

  return {
    bidCount: bids.length,
    minPrice: sortedPrices[0] ?? null,
    maxPrice: sortedPrices[sortedPrices.length - 1] ?? null,
    spread:
      sortedPrices.length >= 2
        ? sortedPrices[sortedPrices.length - 1] - sortedPrices[0]
        : null,
    medianPrice: sortedPrices.length
      ? sortedPrices[Math.floor(sortedPrices.length / 2)]
      : null,
    fastestLead: sortedLeads[0] ?? null,
    slowestLead: sortedLeads[sortedLeads.length - 1] ?? null,
    medianLead: sortedLeads.length
      ? sortedLeads[Math.floor(sortedLeads.length / 2)]
      : null,
  };
}

function toComparisonOption(
  bid: Awaited<ReturnType<typeof listBidsForRfq>>["bids"][number],
  minPrice: number | null,
  maxPrice: number | null,
  fastestLead: number | null,
): BidComparisonView["options"][number] {
  const price =
    typeof bid.price_total === "string"
      ? Number.parseFloat(bid.price_total)
      : bid.price_total;
  const lead =
    typeof bid.lead_time_days === "string"
      ? Number.parseInt(bid.lead_time_days, 10)
      : bid.lead_time_days ?? null;

  const pricePosition =
    minPrice !== null && Number.isFinite(price ?? NaN) && price === minPrice
      ? "value"
      : maxPrice !== null && Number.isFinite(price ?? NaN) && price === maxPrice
        ? "premium"
        : "anchor";

  const speedPosition =
    fastestLead !== null && Number.isFinite(lead ?? NaN) && lead === fastestLead
      ? "fast"
      : lead !== null && fastestLead !== null && lead <= fastestLead * 1.25
        ? "standard"
        : "deliberate";

  return {
    bidId: bid.id,
    supplierId: bid.supplier_id,
    supplierLabel: bid.supplier?.company_name ?? "Supplier",
    price: Number.isFinite(price ?? NaN) ? (price as number) : null,
    pricePosition,
    leadTimeDays: lead,
    speedPosition,
    tradeoffs: [
      pricePosition === "premium"
        ? "Higher price but more assurances."
        : pricePosition === "value"
          ? "Lowest price; confirm scope alignment."
          : "Market-aligned anchor.",
      speedPosition === "fast"
        ? "Fastest turnaround; confirm capacity."
        : speedPosition === "deliberate"
          ? "Slower lead—works if schedule flexible."
          : "Standard lead-time.",
    ],
    storyline:
      pricePosition === "value"
        ? "Budget-friendly pick—use if cash efficiency matters most."
        : pricePosition === "premium"
          ? "Premium supplier—justify on assurance and readiness."
          : "Balanced partner that keeps leverage steady.",
  };
}

function deriveStance(
  bid: Awaited<ReturnType<typeof listBidsForRfq>>["bids"][number],
  leverage: Awaited<ReturnType<typeof supplierLeverageProfile>>,
): "speed" | "value" | "assurance" {
  const lead =
    typeof bid.lead_time_days === "string"
      ? Number.parseInt(bid.lead_time_days, 10)
      : bid.lead_time_days ?? null;
  const price =
    typeof bid.price_total === "string"
      ? Number.parseFloat(bid.price_total)
      : bid.price_total;

  if (lead !== null && lead <= (leverage.responsePressure.level === "high" ? 12 : 10)) {
    return "speed";
  }

  if (price !== null && price <= (leverage.supplierCompetitiveness ?? 0.5) * 10_000) {
    return "value";
  }

  return "assurance";
}

function buildNarrativeHeadline(
  stance: "speed" | "value" | "assurance",
  supplierLabel?: string | null,
) {
  const label = supplierLabel ?? "This supplier";
  if (stance === "speed") {
    return `${label} = confident pace-setter`;
  }
  if (stance === "value") {
    return `${label} keeps the budget grounded`;
  }
  return `${label} de-risks the award`;
}

function buildTalkingPoints(
  stance: "speed" | "value" | "assurance",
  bid: Awaited<ReturnType<typeof listBidsForRfq>>["bids"][number],
  leverage: Awaited<ReturnType<typeof supplierLeverageProfile>>,
) {
  const lead =
    typeof bid.lead_time_days === "string"
      ? Number.parseInt(bid.lead_time_days, 10)
      : bid.lead_time_days ?? null;
  const price =
    typeof bid.price_total === "string"
      ? Number.parseFloat(bid.price_total)
      : bid.price_total;

  if (stance === "speed") {
    return [
      lead !== null ? `Fastest lead at ~${lead} days.` : "Signals fastest response.",
      leverage.posture === "price_setter"
        ? "Carries confidence from recent wins."
        : "Hungry for momentum—can move quickly.",
    ];
  }

  if (stance === "value") {
    return [
      price !== null ? `~$${Math.round(price)} keeps spend tight.` : "Priced below peers.",
      "Willing to trade timeline for budget.",
    ];
  }

  return [
    "Documented capabilities & cleaner notes.",
    leverage.responsePressure.level !== "high"
      ? "Gives breathing room without losing leverage."
      : "Steadies the decision if we need assurance.",
  ];
}

function buildGuardrails(
  stance: "speed" | "value" | "assurance",
  bid: Awaited<ReturnType<typeof listBidsForRfq>>["bids"][number],
) {
  if (stance === "speed") {
    return ["Confirm capacity in writing.", "Watch for premium pricing creep."];
  }
  if (stance === "value") {
    return ["Validate scope fit.", "Ensure tooling assumptions align."];
  }
  return ["Ask for delivery checkpoints.", "Align on documentation expectations."];
}

function computeAssuranceScore(
  bid: Awaited<ReturnType<typeof listBidsForRfq>>["bids"][number],
) {
  const notesWeight = bid.notes ? Math.min(bid.notes.length / 120, 0.3) : 0;
  const statusWeight = bid.status === "submitted" ? 0.4 : 0.2;
  const leadWeight =
    typeof bid.lead_time_days === "number"
      ? Math.max(0, 0.3 - Math.min(bid.lead_time_days / 100, 0.3))
      : 0.15;
  return Number((notesWeight + statusWeight + leadWeight).toFixed(2));
}

function buildTradeoffZones(
  bids: Awaited<ReturnType<typeof listBidsForRfq>>["bids"],
  stats: ReturnType<typeof computeBidStats>,
  assuranceScores: Array<{ bidId: string; score: number }>,
): TradeoffMatrix["zones"] {
  if (bids.length === 0) {
    return [];
  }

  const assuranceMap = assuranceScores.reduce<Record<string, number>>((map, entry) => {
    map[entry.bidId] = entry.score;
    return map;
  }, {});

  const zones: TradeoffMatrix["zones"] = [];

  const valueBid = bids.find((bid) => {
    const price =
      typeof bid.price_total === "string"
        ? Number.parseFloat(bid.price_total)
        : bid.price_total;
    return price !== null && stats.minPrice !== null && price === stats.minPrice;
  });

  if (valueBid) {
    zones.push({
      label: "Value win",
      narrative: "Lock in savings if schedule allows a touch more time.",
      whenToUse: "Budget focus with moderate urgency.",
      supportingBids: [valueBid.id],
    });
  }

  const speedBid = bids.find((bid) => {
    const lead =
      typeof bid.lead_time_days === "string"
        ? Number.parseInt(bid.lead_time_days, 10)
        : bid.lead_time_days ?? null;
    return lead !== null && stats.fastestLead !== null && lead === stats.fastestLead;
  });

  if (speedBid) {
    zones.push({
      label: "Speed lane",
      narrative: "Pay a premium to ship faster.",
      whenToUse: "Target date under pressure.",
      supportingBids: [speedBid.id],
    });
  }

  const assuranceBid = assuranceScores.length
    ? assuranceScores.reduce((best, entry) => (entry.score > best.score ? entry : best))
    : null;

  if (assuranceBid) {
    zones.push({
      label: "Assurance play",
      narrative: "Choose the supplier with the cleanest documentation + intent.",
      whenToUse: "Critical parts / zero surprises tolerance.",
      supportingBids: [assuranceBid.bidId],
    });
  }

  return zones;
}

function buildEmptyMatrix(rfqId: string, customerId: string | null): TradeoffMatrix {
  return {
    rfqId,
    customerId,
    axes: {
      price: { low: null, high: null, anchor: null },
      speed: { fast: null, slow: null, anchor: null },
      assurance: { minScore: null, maxScore: null, notes: [] },
    },
    zones: [],
    prompts: ["Gather first bids to unlock the matrix view."],
  };
}
