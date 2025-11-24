type FairnessInput = {
  assignmentCount: number;
  recentBidOutcomes: Array<{ status?: string | null; updated_at?: string | null }>;
  supplierCreatedAt?: string | null;
};

export type FairnessScore = {
  modifier: number;
  reasons: string[];
};

const NEW_SUPPLIER_WINDOW_DAYS = 45;
const RECENT_MATCH_WINDOW_DAYS = 30;

export function computeFairnessBoost(input: FairnessInput): FairnessScore {
  let modifier = 0;
  const reasons: string[] = [];

  if (input.assignmentCount <= 2) {
    modifier += 1;
    reasons.push("Boosted because this supplier hasn’t been overexposed yet.");
  } else if (input.assignmentCount >= 8) {
    modifier -= 0.5;
    reasons.push("Slight penalty to avoid routing everything to the same shop.");
  }

  const recentUnselected = input.recentBidOutcomes.filter((bid) => {
    if (!bid.status || bid.status === "accepted") {
      return false;
    }
    const updatedMs = Date.parse(bid.updated_at ?? "");
    if (Number.isNaN(updatedMs)) {
      return false;
    }
    const daysDiff = (Date.now() - updatedMs) / (1000 * 60 * 60 * 24);
    return daysDiff <= RECENT_MATCH_WINDOW_DAYS;
  }).length;

  if (recentUnselected > 0) {
    const boost = Math.min(1.2, recentUnselected * 0.3);
    modifier += boost;
    reasons.push(
      "Extra weight because they’ve been responding recently without being selected.",
    );
  }

  if (input.recentBidOutcomes.length === 0) {
    modifier += 0.4;
    reasons.push("New to bidding — giving them a gentle nudge into rotation.");
  }

  if (isNewSupplier(input.supplierCreatedAt)) {
    modifier += 0.8;
    reasons.push("Recently onboarded supplier gets a temporary boost.");
  }

  return { modifier, reasons };
}

function isNewSupplier(createdAt?: string | null): boolean {
  if (!createdAt) {
    return false;
  }
  const createdMs = Date.parse(createdAt);
  if (Number.isNaN(createdMs)) {
    return false;
  }
  const days = (Date.now() - createdMs) / (1000 * 60 * 60 * 24);
  return days <= NEW_SUPPLIER_WINDOW_DAYS;
}
