type EstimateConfidence = "low" | "medium" | "high";

export type PricingEstimateInput = {
  manufacturing_process: string | null;
  quantity: number | null;
  need_by_days?: number | null;
  need_by_date?: string | null;
  shipping_postal_code?: string | null;
  num_files?: number | null;
};

export type PricingEstimateOutput = {
  lowUsd: number;
  midUsd: number;
  highUsd: number;
  confidence: EstimateConfidence;
  explanationBullets: string[];
};

export type PricingEstimateTelemetry = {
  process: string | null;
  quantityBucket: string;
  urgencyBucket: string;
  confidence: EstimateConfidence;
};

type ProcessProfile = {
  key: string;
  label: string;
  baseMid: number;
  isKnown: boolean;
};

const PROCESS_BASELINES: Array<{
  key: string;
  label: string;
  baseMid: number;
  keywords: string[];
}> = [
  {
    key: "cnc",
    label: "CNC machining",
    baseMid: 1800,
    keywords: ["cnc", "machining", "mill", "milling", "turn", "turning", "lathe", "5 axis", "5-axis"],
  },
  {
    key: "sheet",
    label: "Sheet metal",
    baseMid: 1200,
    keywords: ["sheet", "laser", "waterjet", "water jet", "plasma", "bending", "brake", "punch", "stamping"],
  },
  {
    key: "3dp",
    label: "3D printing",
    baseMid: 900,
    keywords: ["3d", "3dp", "3d print", "additive", "sls", "sla", "fdm", "mjp", "polyjet"],
  },
  {
    key: "casting",
    label: "Casting",
    baseMid: 2200,
    keywords: ["cast", "casting", "investment"],
  },
  {
    key: "injection",
    label: "Injection molding",
    baseMid: 7500,
    keywords: ["injection", "mold", "mould"],
  },
  {
    key: "fabrication",
    label: "Fabrication & welding",
    baseMid: 2000,
    keywords: ["fabrication", "fab", "weld", "welding", "assembly"],
  },
];

const FALLBACK_PROCESS: ProcessProfile = {
  key: "general",
  label: "General fabrication",
  baseMid: 1500,
  isKnown: false,
};

const URGENCY_MULTIPLIERS = [
  { maxDays: 7, multiplier: 1.35, label: "Rush" },
  { maxDays: 14, multiplier: 1.2, label: "Short" },
  { maxDays: 30, multiplier: 1.1, label: "Standard" },
];

export function buildPricingEstimate(input: PricingEstimateInput): PricingEstimateOutput | null {
  const processRaw = normalizeText(input.manufacturing_process);
  const quantity = normalizeQuantity(input.quantity);

  if (!processRaw || quantity === null) {
    return null;
  }

  const processProfile = resolveProcessProfile(processRaw);
  const needByDays = resolveNeedByDays(input.need_by_days ?? null, input.need_by_date ?? null);
  const numFiles = normalizeCount(input.num_files);

  const quantityFactor = computeQuantityFactor(quantity);
  const urgencyFactor = computeUrgencyFactor(needByDays);
  const fileFactor = computeFileFactor(numFiles);

  const midEstimate = processProfile.baseMid * quantityFactor * urgencyFactor * fileFactor;
  const midUsd = roundUsd(midEstimate);
  const lowUsd = roundUsd(midEstimate * 0.8);
  const highUsd = roundUsd(midEstimate * 1.35);

  const confidence = deriveConfidence({
    processKnown: processProfile.isKnown,
    quantityPresent: quantity !== null,
    needByPresent: needByDays !== null,
    filesPresent: numFiles !== null,
  });

  const explanationBullets = buildExplanationBullets({
    processProfile,
    quantity,
    needByDays,
    numFiles,
  });

  return {
    lowUsd: Math.min(lowUsd, midUsd),
    midUsd,
    highUsd: Math.max(highUsd, midUsd),
    confidence,
    explanationBullets,
  };
}

export function buildPricingEstimateTelemetry(
  input: PricingEstimateInput,
  estimate: PricingEstimateOutput,
): PricingEstimateTelemetry {
  const processRaw = normalizeText(input.manufacturing_process);
  const processProfile = processRaw ? resolveProcessProfile(processRaw) : null;
  const quantity = normalizeQuantity(input.quantity);
  const needByDays = resolveNeedByDays(input.need_by_days ?? null, input.need_by_date ?? null);

  return {
    process: processProfile?.key ?? null,
    quantityBucket: bucketQuantity(quantity),
    urgencyBucket: bucketUrgency(needByDays),
    confidence: estimate.confidence,
  };
}

export function parseQuantity(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? Math.round(value) : null;
  }
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/,/g, " ");
  const match = cleaned.match(/(\d+(\.\d+)?)/);
  if (!match) return null;
  const parsed = Number(match[1]);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.round(parsed);
}

function resolveProcessProfile(process: string): ProcessProfile {
  const normalized = normalizeText(process).toLowerCase();
  if (!normalized) {
    return FALLBACK_PROCESS;
  }

  const matched = PROCESS_BASELINES.find((profile) =>
    profile.keywords.some((keyword) => normalized.includes(keyword)),
  );

  if (!matched) {
    return FALLBACK_PROCESS;
  }

  return {
    key: matched.key,
    label: matched.label,
    baseMid: matched.baseMid,
    isKnown: true,
  };
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeQuantity(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  if (value <= 0) return null;
  return Math.round(value);
}

function normalizeCount(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  if (value <= 0) return null;
  return Math.round(value);
}

function resolveNeedByDays(
  needByDays: number | null | undefined,
  needByDate: string | null | undefined,
): number | null {
  if (typeof needByDays === "number" && Number.isFinite(needByDays)) {
    return Math.max(0, Math.round(needByDays));
  }
  if (!needByDate) return null;
  const targetMs = Date.parse(needByDate);
  if (!Number.isFinite(targetMs)) return null;
  const nowMs = Date.now();
  const diffDays = Math.ceil((targetMs - nowMs) / (1000 * 60 * 60 * 24));
  return Math.max(0, diffDays);
}

function computeQuantityFactor(quantity: number): number {
  const capped = Math.min(Math.max(quantity, 1), 1000);
  return Math.pow(capped, 0.6);
}

function computeUrgencyFactor(needByDays: number | null): number {
  if (needByDays === null) return 1;
  for (const rule of URGENCY_MULTIPLIERS) {
    if (needByDays <= rule.maxDays) {
      return rule.multiplier;
    }
  }
  return 1;
}

function computeFileFactor(numFiles: number | null): number {
  if (!numFiles || numFiles <= 1) return 1;
  const extraFiles = Math.min(numFiles - 1, 6);
  return 1 + extraFiles * 0.05;
}

function roundUsd(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value));
}

function deriveConfidence(input: {
  processKnown: boolean;
  quantityPresent: boolean;
  needByPresent: boolean;
  filesPresent: boolean;
}): EstimateConfidence {
  if (input.processKnown && input.quantityPresent && input.needByPresent && input.filesPresent) {
    return "high";
  }
  if (input.processKnown && input.quantityPresent && (input.needByPresent || input.filesPresent)) {
    return "medium";
  }
  return "low";
}

function buildExplanationBullets(input: {
  processProfile: ProcessProfile;
  quantity: number;
  needByDays: number | null;
  numFiles: number | null;
}): string[] {
  const bullets: string[] = [];
  const qtyLabel = input.quantity === 1 ? "1 part" : `${input.quantity} parts`;
  const processBullet = input.processProfile.isKnown
    ? `Process baseline set for ${input.processProfile.label}.`
    : "Process baseline uses a general fabrication profile.";
  bullets.push(processBullet);
  bullets.push(`Quantity of ${qtyLabel} adjusts the total estimate.`);

  if (input.needByDays !== null) {
    if (input.needByDays <= 7) {
      bullets.push(`Rush timeline (${input.needByDays} days) increases pricing.`);
    } else if (input.needByDays <= 14) {
      bullets.push(`Short timeline (${input.needByDays} days) adds expediting.`);
    } else if (input.needByDays <= 30) {
      bullets.push(`Standard timeline (${input.needByDays} days) keeps pricing steady.`);
    } else {
      bullets.push(`Longer timeline (${input.needByDays} days) reduces urgency pressure.`);
    }
  }

  if (input.numFiles !== null && input.numFiles > 1) {
    bullets.push(`Multiple files (${input.numFiles}) increase complexity.`);
  }

  return bullets.slice(0, 4);
}

function bucketQuantity(quantity: number | null): string {
  if (quantity === null) return "unknown";
  if (quantity <= 1) return "1";
  if (quantity <= 5) return "2-5";
  if (quantity <= 10) return "6-10";
  if (quantity <= 25) return "11-25";
  if (quantity <= 50) return "26-50";
  if (quantity <= 100) return "51-100";
  if (quantity <= 250) return "101-250";
  return "250+";
}

function bucketUrgency(needByDays: number | null): string {
  if (needByDays === null) return "unknown";
  if (needByDays <= 7) return "rush";
  if (needByDays <= 14) return "soon";
  if (needByDays <= 30) return "standard";
  return "flexible";
}
