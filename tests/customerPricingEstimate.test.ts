import assert from "node:assert/strict";
import { computeCustomerPricingEstimateFromPriors } from "../src/server/customer/pricingEstimate";

type Prior = {
  technology: string;
  material_canon: string | null;
  parts_bucket: string | null;
  n: number;
  p10: number;
  p50: number;
  p90: number;
};

function closeTo(actual: number, expected: number, eps = 1e-9) {
  assert.ok(
    Math.abs(actual - expected) <= eps,
    `Expected ${actual} to be within ${eps} of ${expected}`,
  );
}

// Fallback ladder order:
// tech+mat+parts -> tech+mat -> tech+parts -> tech -> global
{
  const priors: Prior[] = [
    // global
    { technology: "__global__", material_canon: null, parts_bucket: null, n: 1000, p10: 1, p50: 2, p90: 3 },
    // tech only
    { technology: "CNC", material_canon: null, parts_bucket: null, n: 500, p10: 10, p50: 20, p90: 30 },
    // tech+parts (bucket)
    { technology: "CNC", material_canon: null, parts_bucket: "2-3", n: 120, p10: 11, p50: 22, p90: 33 },
    // tech+mat
    { technology: "CNC", material_canon: "Aluminum 6061", parts_bucket: null, n: 80, p10: 12, p50: 24, p90: 36 },
    // tech+mat+parts (exact)
    { technology: "CNC", material_canon: "Aluminum 6061", parts_bucket: "2-3", n: 60, p10: 13, p50: 26, p90: 39 },
  ];

  const est = computeCustomerPricingEstimateFromPriors({
    technology: "CNC",
    materialCanon: "Aluminum 6061",
    partsCount: 2,
    priors,
  });

  assert(est, "Expected estimate to be non-null");
  assert.strictEqual(est.source, "tech+mat+parts", "Expected most-specific prior to win");
  assert.strictEqual(est.confidence, "moderate", "n=60 should be moderate");
}

// Fallback behavior: missing exact -> use tech+mat (before tech+parts).
{
  const priors: Prior[] = [
    { technology: "__global__", material_canon: null, parts_bucket: null, n: 1000, p10: 1, p50: 2, p90: 3 },
    { technology: "CNC", material_canon: null, parts_bucket: null, n: 500, p10: 10, p50: 20, p90: 30 },
    { technology: "CNC", material_canon: null, parts_bucket: "2-3", n: 120, p10: 11, p50: 22, p90: 33 },
    { technology: "CNC", material_canon: "Aluminum 6061", parts_bucket: null, n: 80, p10: 12, p50: 24, p90: 36 },
  ];

  const est = computeCustomerPricingEstimateFromPriors({
    technology: "CNC",
    materialCanon: "Aluminum 6061",
    partsCount: 2,
    priors,
  });

  assert(est, "Expected estimate to be non-null");
  assert.strictEqual(est.source, "tech+mat", "Expected tech+mat fallback before tech+parts");
  assert.strictEqual(est.confidence, "moderate", "n=80 should be moderate");
}

// Shrinkage: blend child toward parent with w = n/(n+k), k=50.
{
  const childN = 10;
  const w = childN / (childN + 50);

  const priors: Prior[] = [
    { technology: "__global__", material_canon: null, parts_bucket: null, n: 1000, p10: 0, p50: 0, p90: 0 },
    // parent (tech+mat)
    { technology: "CNC", material_canon: "Aluminum 6061", parts_bucket: null, n: 999, p10: 100, p50: 200, p90: 300 },
    // child (tech+mat+parts)
    { technology: "CNC", material_canon: "Aluminum 6061", parts_bucket: "2-3", n: childN, p10: 10, p50: 20, p90: 30 },
  ];

  const est = computeCustomerPricingEstimateFromPriors({
    technology: "CNC",
    materialCanon: "Aluminum 6061",
    partsCount: 2,
    priors,
  });

  assert(est, "Expected estimate to be non-null");
  assert.strictEqual(est.source, "tech+mat+parts", "Source should reflect selected child group");
  assert.strictEqual(est.confidence, "limited", "n=10 should be limited");

  closeTo(est.p10, w * 10 + (1 - w) * 100);
  closeTo(est.p50, w * 20 + (1 - w) * 200);
  closeTo(est.p90, w * 30 + (1 - w) * 300);
}

// Shrinkage parent traversal: if immediate parent missing, walk up (tech -> global).
{
  const childN = 10;
  const w = childN / (childN + 50);

  const priors: Prior[] = [
    // global only parent available
    { technology: "__global__", material_canon: null, parts_bucket: null, n: 1000, p10: 1000, p50: 2000, p90: 3000 },
    // child (tech)
    { technology: "CNC", material_canon: null, parts_bucket: null, n: childN, p10: 10, p50: 20, p90: 30 },
  ];

  const est = computeCustomerPricingEstimateFromPriors({
    technology: "CNC",
    materialCanon: null,
    partsCount: null,
    priors,
  });

  assert(est, "Expected estimate to be non-null");
  assert.strictEqual(est.source, "tech", "Expected tech prior to win when present");
  closeTo(est.p50, w * 20 + (1 - w) * 2000);
}

console.log("customerPricingEstimate tests passed");

