import { loadSupplierById } from "@/server/suppliers/profile";
import { listBidsForRfq } from "./bids";
import { explainScore, MIN_MATCH_SCORE } from "./matching";
import { logMarketplaceEvent } from "./events";
import { loadRfqById } from "./rfqs";
import {
  calculateMarketPressure,
  recommendPriceCeiling,
  recommendPriceFloor,
} from "./pricing";
import type { RfqBidRecord } from "./types";

/**
 * Example:
 * {
 *   rfqId: "rfq_123",
 *   framing: {
 *     headline: "Here’s the quiet math behind your price bands.",
 *     message: "We look at supplier scarcity, urgency, and how many bids showed up."
 *   },
 *   priceBands: {
 *     floor: { amount: 11800, currency: "USD", confidence: 0.72 },
 *     ceiling: { amount: 14800, currency: "USD", confidence: 0.61 }
 *   },
 *   marketSignals: {
 *     label: "elevated",
 *     score: 0.58,
 *     components: { scarcity: 0.6, urgency: 0.45, bidCoverageGap: 0.4 }
 *   },
 *   callouts: [
 *     "Scarcity adds ~8% premium.",
 *     "We still have room to expand the bidder pool."
 *   ],
 *   supportingData: {
 *     bidCount: 3,
 *     samplePrices: [11800, 13400, 14850]
 *   }
 * }
 */
export type PricingTransparencyPacket = {
  rfqId: string;
  customerId: string | null;
  framing: {
    headline: string;
    message: string;
  };
  priceBands: {
    floor: {
      amount: number;
      currency: string;
      confidence: number;
    } | null;
    ceiling: {
      amount: number;
      currency: string;
      confidence: number;
    } | null;
  };
  marketSignals: {
    label: string;
    score: number;
    components: {
      scarcity: number;
      urgency: number;
      bidCoverageGap: number;
    };
  } | null;
  callouts: string[];
  supportingData: {
    bidCount: number;
    samplePrices: number[];
  };
};

/**
 * Example:
 * {
 *   rfqId: "rfq_123",
 *   framing: {
 *     headline: "Matching stays fair, even when we steer outcomes.",
 *     message: "Suppliers must clear a 50-point bar blended across capability, history, and recency."
 *   },
 *   thresholds: {
 *     minScore: 50,
 *     interpretation: "Below 50, we keep them out of your view."
 *   },
 *   weightSummary: [
 *     { label: "Process fit", weight: 40, description: "Do they run the required processes?" }
 *   ],
 *   supplierExamples: [
 *     {
 *       supplierId: "sup_1",
 *       supplierLabel: "Northwind",
 *       score: 72,
 *       passesGate: true,
 *       highlights: ["Process fit: Matched 3/3", "Recency: Active last week"]
 *     }
 *   ],
 *   reminders: [
 *     "We quietly pad trusted buyers with a few extra points when risk is low.",
 *     "Suppliers never see these explanations."
 *   ]
 * }
 */
export type MatchLogicExplainer = {
  rfqId: string;
  customerId: string | null;
  framing: {
    headline: string;
    message: string;
  };
  thresholds: {
    minScore: number;
    interpretation: string;
  };
  weightSummary: Array<{
    label: string;
    weight: number;
    description: string;
  }>;
  supplierExamples: Array<{
    supplierId: string;
    supplierLabel: string | null;
    score: number;
    passesGate: boolean;
    highlights: string[];
  }>;
  reminders: string[];
};

export async function explainPricingToCustomer(
  rfqId: string,
): Promise<PricingTransparencyPacket> {
  const rfq = await loadRfqById(rfqId);
  if (!rfq) {
    return buildEmptyPricingPacket(rfqId, null);
  }

  const { bids } = await listBidsForRfq(rfqId);
  const normalized: RfqBidRecord[] = bids.map(({ supplier: _supplier, ...rest }) => rest);

  const [pressure, floor, ceiling] = await Promise.all([
    calculateMarketPressure(rfq, { bids: normalized, logEvent: false }),
    recommendPriceFloor(rfq, { bids: normalized, logEvent: false }),
    recommendPriceCeiling(rfq, { bids: normalized, logEvent: false }),
  ]);

  const samplePrices = bids
    .map((bid) => {
      const value =
        typeof bid.price_total === "string"
          ? Number.parseFloat(bid.price_total)
          : bid.price_total;
      return Number.isFinite(value ?? NaN) ? (value as number) : null;
    })
    .filter((value): value is number => Number.isFinite(value));

  const packet: PricingTransparencyPacket = {
    rfqId,
    customerId: rfq.customer_id ?? null,
    framing: {
      headline: "Here’s the quiet math behind your price bands.",
      message:
        "We blend live bids with scarcity + urgency so you see the truth without the noise.",
    },
    priceBands: {
      floor: floor
        ? {
            amount: floor.amount,
            currency: floor.currency,
            confidence: Number(floor.confidence.toFixed(2)),
          }
        : null,
      ceiling: ceiling
        ? {
            amount: ceiling.amount,
            currency: ceiling.currency,
            confidence: Number(ceiling.confidence.toFixed(2)),
          }
        : null,
    },
    marketSignals: pressure
      ? {
          label: pressure.label,
          score: Number(pressure.score.toFixed(2)),
          components: pressure.components,
        }
      : null,
    callouts: buildPricingCallouts(pressure, bids.length),
    supportingData: {
      bidCount: bids.length,
      samplePrices: samplePrices.slice(0, 5),
    },
  };

  await logMarketplaceEvent({
    rfqId,
    customerId: packet.customerId,
    type: "trust_explained",
    payload: {
      view: "pricing",
      bid_count: bids.length,
      pressure_label: pressure?.label ?? null,
    },
  });

  return packet;
}

export async function explainMatchLogicToCustomer(
  rfqId: string,
): Promise<MatchLogicExplainer> {
  const rfq = await loadRfqById(rfqId);
  if (!rfq) {
    return buildEmptyMatchExplainer(rfqId, null);
  }

  const { bids } = await listBidsForRfq(rfqId);
  const sampledSuppliers = Array.from(
    new Set(bids.map((bid) => bid.supplier_id).filter(Boolean)),
  ).slice(0, 3);

  const examples: MatchLogicExplainer["supplierExamples"] = [];

  for (const supplierId of sampledSuppliers) {
    const supplier = await loadSupplierById(supplierId);
    if (!supplier) {
      continue;
    }
    const breakdown = await explainScore(rfq, supplier);
    examples.push({
      supplierId,
      supplierLabel:
        bids.find((bid) => bid.supplier_id === supplierId)?.supplier?.company_name ?? null,
      score: Number(breakdown.total.toFixed(1)),
      passesGate: breakdown.total >= MIN_MATCH_SCORE,
      highlights: extractHighlights(breakdown),
    });
  }

  const explainer: MatchLogicExplainer = {
    rfqId,
    customerId: rfq.customer_id ?? null,
    framing: {
      headline: "Matching stays fair, even when we steer outcomes.",
      message:
        "Suppliers must clear a 50-point bar blended across capability, history, and recency.",
    },
    thresholds: {
      minScore: MIN_MATCH_SCORE,
      interpretation: "Below 50, we keep them out of your view so you only see confident fits.",
    },
    weightSummary: buildWeightSummary(),
    supplierExamples: examples,
    reminders: [
      "We sometimes boost trusted buyers a few points to keep the lane warm.",
      "Suppliers never see this narrative—only the outcome.",
    ],
  };

  await logMarketplaceEvent({
    rfqId,
    customerId: explainer.customerId,
    type: "trust_explained",
    payload: {
      view: "match_logic",
      example_count: examples.length,
    },
  });

  return explainer;
}

function buildPricingCallouts(
  pressure: Awaited<ReturnType<typeof calculateMarketPressure>> | null,
  bidCount: number,
) {
  const callouts: string[] = [];
  if (pressure) {
    if (pressure.components.scarcity >= 0.5) {
      callouts.push("Scarcity is adding a quiet premium—expect ~5-10% lift.");
    }
    if (pressure.components.bidCoverageGap >= 0.4) {
      callouts.push("We still have room to widen the bidder pool.");
    }
    if (pressure.label === "critical") {
      callouts.push("We’re shadow-prepping contingency suppliers.");
    }
  }
  if (bidCount === 0) {
    callouts.push("No bids yet—bands rely on historical samples.");
  }
  return callouts;
}

function buildWeightSummary(): MatchLogicExplainer["weightSummary"] {
  return [
    {
      label: "Process fit",
      weight: 40,
      description: "Do they actually run the processes you asked for?",
    },
    {
      label: "Material capability",
      weight: 25,
      description: "We look for matching alloys + stock depth.",
    },
    {
      label: "Certifications",
      weight: 15,
      description: "Documented certifications or uploaded proof.",
    },
    {
      label: "Win rate",
      weight: 10,
      description: "Momentum matters—recent awards carry weight.",
    },
    {
      label: "Recency",
      weight: 10,
      description: "Active suppliers stay higher in the feed.",
    },
  ];
}

function extractHighlights(breakdown: Awaited<ReturnType<typeof explainScore>>) {
  return Object.values(breakdown.factors).map((factor) => {
    return `${factor.label}: ${factor.reason}`;
  });
}

function buildEmptyPricingPacket(
  rfqId: string,
  customerId: string | null,
): PricingTransparencyPacket {
  return {
    rfqId,
    customerId,
    framing: {
      headline: "Pricing insight will unlock once bids land.",
      message: "We’ll share the math as soon as real signals appear.",
    },
    priceBands: {
      floor: null,
      ceiling: null,
    },
    marketSignals: null,
    callouts: ["Awaiting live bids or specs."],
    supportingData: {
      bidCount: 0,
      samplePrices: [],
    },
  };
}

function buildEmptyMatchExplainer(
  rfqId: string,
  customerId: string | null,
): MatchLogicExplainer {
  return {
    rfqId,
    customerId,
    framing: {
      headline: "Matching explanation pending RFQ data.",
      message: "Load the opportunity to show how we keep the lane curated.",
    },
    thresholds: {
      minScore: MIN_MATCH_SCORE,
      interpretation: "Below the bar? We keep them out of view.",
    },
    weightSummary: buildWeightSummary(),
    supplierExamples: [],
    reminders: ["Suppliers never see the scoring narrative."],
  };
}
