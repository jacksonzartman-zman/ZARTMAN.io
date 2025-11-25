import type { MarketplaceRfq } from "./types";
import type {
  CustomerPriorityTier,
  MarketPowerProfile,
} from "./strategy";

export type MoatDecision = {
  control: string;
  applied: boolean;
  delta: number;
  reason: string;
  metadata?: Record<string, unknown>;
};

export type FastLaneDecision = {
  eligible: boolean;
  priorityScore: number;
  slotsRequested: number;
  reasons: string[];
};

export function preferredSupplierBias(args: {
  supplierId?: string | null;
  preferredSuppliers: string[];
  baseScore: number;
  maxBoost?: number;
}): MoatDecision {
  const isPreferred =
    Boolean(args.supplierId) &&
    args.preferredSuppliers.includes(args.supplierId as string);
  const maxBoost = args.maxBoost ?? 8;
  const delta = isPreferred ? Math.min(maxBoost, args.baseScore * 0.1) : 0;

  return {
    control: "preferred_supplier_bias",
    applied: isPreferred,
    delta,
    reason: isPreferred ? "preferred_supplier" : "not_listed",
    metadata: {
      supplierId: args.supplierId ?? null,
      preferredSuppliers: args.preferredSuppliers.length,
    },
  };
}

export function trustedBuyerBoost(args: {
  tier: CustomerPriorityTier;
  trustScore?: number;
  baseValue: number;
  maxBoost?: number;
}): MoatDecision {
  const trust = Math.max(args.trustScore ?? 0.5, 0);
  const tierWeight =
    args.tier === "critical"
      ? 1
      : args.tier === "expedited"
        ? 0.75
        : args.tier === "standard"
          ? 0.35
          : 0.1;
  const applied = trust > 0.3;
  const maxBoost = args.maxBoost ?? 12;
  const delta = applied ? Math.min(maxBoost, args.baseValue * tierWeight * trust) : 0;

  return {
    control: "trusted_buyer_boost",
    applied,
    delta,
    reason: applied ? "trusted_buyer_priority" : "insufficient_trust_signal",
    metadata: {
      trustScore: trust,
      tier: args.tier,
    },
  };
}

export function feeOptimizationLevers(args: {
  baseFeeRate: number;
  floorFeeRate?: number;
  ceilingFeeRate?: number;
  marketProfile?: MarketPowerProfile;
  loyaltyScore?: number;
}): {
  feeRate: number;
  adjustments: Record<string, number>;
} {
  const floor = args.floorFeeRate ?? 0.08;
  const ceiling = args.ceilingFeeRate ?? 0.16;
  const loyalty = Math.max(Math.min(args.loyaltyScore ?? 0, 1), 0);
  const scarcity =
    args.marketProfile?.diagnostics?.scarcityIndex
      ? Math.min(args.marketProfile.diagnostics.scarcityIndex / 2, 1)
      : 0;
  const pressure = args.marketProfile?.responsePressure.index ?? 0.3;

  const scarcityLift = scarcity * 0.02;
  const pressureDrag = pressure * 0.03;
  const loyaltyDrag = loyalty * 0.015;

  let feeRate = args.baseFeeRate + scarcityLift - pressureDrag - loyaltyDrag;
  feeRate = Math.min(Math.max(feeRate, floor), ceiling);

  return {
    feeRate,
    adjustments: {
      scarcityLift,
      pressureDrag,
      loyaltyDrag,
    },
  };
}

export function fastLanePlacementLogic(args: {
  rfq: MarketplaceRfq;
  marketProfile?: MarketPowerProfile;
  trustedBuyer?: boolean;
  preferredSupplierReady?: boolean;
  availableSlots?: number;
}): FastLaneDecision {
  const slotsRequested = args.availableSlots ?? 3;
  const priorityScore =
    (args.marketProfile?.customerPriorityScore ?? 0.3) * 0.4 +
    (args.marketProfile?.responsePressure.index ?? 0.2) * 0.4 +
    (args.preferredSupplierReady ? 0.15 : 0) +
    (args.trustedBuyer ? 0.15 : 0);

  const eligible =
    priorityScore >= 0.5 ||
    (args.marketProfile?.customerPriorityTier === "critical" &&
      (args.preferredSupplierReady || args.trustedBuyer));

  const reasons: string[] = [];
  if (args.marketProfile?.customerPriorityTier === "critical") {
    reasons.push("critical_customer");
  }
  if ((args.marketProfile?.responsePressure.level ?? "low") !== "low") {
    reasons.push("elevated_pressure");
  }
  if (args.preferredSupplierReady) {
    reasons.push("preferred_supplier_ready");
  }
  if (args.trustedBuyer) {
    reasons.push("trusted_buyer");
  }

  return {
    eligible,
    priorityScore: Math.min(Math.max(Number(priorityScore.toFixed(2)), 0), 1),
    slotsRequested,
    reasons,
  };
}

export function visibilityPenalties(args: {
  baseScore: number;
  penalties: {
    lateDeliveries?: number;
    documentationGaps?: number;
    complianceFlags?: number;
  };
  maxPenalty?: number;
}): MoatDecision {
  const latePenalty = Math.min(args.penalties.lateDeliveries ?? 0, 5) * 0.8;
  const documentationPenalty = Math.min(args.penalties.documentationGaps ?? 0, 3) * 1.2;
  const compliancePenalty = Math.min(args.penalties.complianceFlags ?? 0, 5) * 2;

  const rawPenalty = latePenalty + documentationPenalty + compliancePenalty;
  const maxPenalty = args.maxPenalty ?? args.baseScore * 0.5;
  const delta = -Math.min(rawPenalty, maxPenalty);

  return {
    control: "visibility_penalties",
    applied: rawPenalty > 0,
    delta,
    reason: rawPenalty > 0 ? "risk_controls_applied" : "clean_record",
    metadata: {
      latePenalty,
      documentationPenalty,
      compliancePenalty,
    },
  };
}
