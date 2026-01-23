import { supabaseServer } from "@/lib/supabaseServer";
import {
  listSupplierCapabilities,
  listSupplierDocuments,
  loadSupplierById,
} from "@/server/suppliers/profile";
import type {
  SupplierCapabilityRow,
  SupplierDocumentRow,
  SupplierRow,
} from "@/server/suppliers/types";
import type {
  MarketplaceRfq,
  SupplierEligibilityResult,
  SupplierPerformanceStats,
  SupplierScoreBreakdown,
  SupplierScoreEvaluation,
} from "./types";

const SCORE_WEIGHTS = {
  process: 40,
  material: 25,
  certifications: 15,
  winRate: 10,
  recency: 10,
} as const;

export const MIN_MATCH_SCORE = 50;

const MAX_SCORE = Object.values(SCORE_WEIGHTS).reduce((sum, weight) => sum + weight, 0);
const MAX_RECENCY_DAYS = 90;

type SupplierMatchContext = {
  supplier: SupplierRow;
  capabilities: SupplierCapabilityRow[];
  documents: SupplierDocumentRow[];
  stats: SupplierPerformanceStats;
};

const supplierContextCache = new Map<string, Promise<SupplierMatchContext>>();

export async function scoreSupplierForRfq(
  rfq: MarketplaceRfq,
  supplier: SupplierRow,
): Promise<number> {
  const evaluation = await evaluateSupplierMatch(rfq, supplier);
  return Math.round(evaluation.total);
}

export async function explainScore(
  rfq: MarketplaceRfq,
  supplier: SupplierRow,
): Promise<SupplierScoreBreakdown> {
  const evaluation = await evaluateSupplierMatch(rfq, supplier);
  return toScoreBreakdown(evaluation);
}

export async function ensureSupplierEligibleForRfq(
  rfq: MarketplaceRfq,
  supplierId: string,
): Promise<SupplierEligibilityResult> {
  const supplier = await loadSupplierById(supplierId);
  if (!supplier) {
    return {
      eligible: false,
      score: 0,
      explanation: buildEmptyBreakdown("Supplier not found"),
    };
  }

  const evaluation = await evaluateSupplierMatch(rfq, supplier);
  return {
    eligible: evaluation.total >= MIN_MATCH_SCORE,
    score: Math.round(evaluation.total),
    explanation: toScoreBreakdown(evaluation),
  };
}

async function evaluateSupplierMatch(
  rfq: MarketplaceRfq,
  supplier: SupplierRow,
): Promise<SupplierScoreEvaluation> {
  const context = await loadSupplierContext(supplier);
  const rfqProcesses = normalizeArray(rfq.process_requirements);
  const rfqMaterials = normalizeArray(rfq.material_requirements);
  const rfqCerts = normalizeArray(rfq.certification_requirements);

  const capabilityProcesses = context.capabilities
    .map((capability) => normalizeValue(capability.process))
    .filter((value): value is string => Boolean(value));

  const capabilityMaterials = context.capabilities.flatMap((capability) =>
    normalizeArray(capability.materials ?? undefined),
  );

  const capabilityCerts = context.capabilities.flatMap((capability) =>
    normalizeArray(capability.certifications ?? undefined),
  );

  const documentCerts = context.documents
    .map((doc) => normalizeValue(doc.doc_type))
    .filter((value): value is string => Boolean(value));

  const processFactor = computeRequirementFactor({
    label: "Process match",
    weight: SCORE_WEIGHTS.process,
    required: rfqProcesses,
    available: capabilityProcesses,
    emptyReason: "RFQ did not specify process requirements",
  });

  const materialFactor = computeRequirementFactor({
    label: "Material match",
    weight: SCORE_WEIGHTS.material,
    required: rfqMaterials,
    available: capabilityMaterials,
    emptyReason: "RFQ did not include material requirements",
  });

  const certificationFactor = computeRequirementFactor({
    label: "Certifications",
    weight: SCORE_WEIGHTS.certifications,
    required: rfqCerts,
    available: [...capabilityCerts, ...documentCerts],
    emptyReason: "No certifications required",
    allowDocumentEvidence: documentCerts,
  });

  const winRateFactor = computeWinRateFactor(context.stats);
  const recencyFallback = supplier.created_at ?? null;
  const recencyFactor = computeRecencyFactor(
    context.stats.lastActivityAt ?? recencyFallback,
  );

  const total =
    processFactor.awarded +
    materialFactor.awarded +
    certificationFactor.awarded +
    winRateFactor.awarded +
    recencyFactor.awarded;

  return {
    supplier,
    rfqId: rfq.id,
    total: clamp(total, 0, MAX_SCORE),
    max: MAX_SCORE,
    factors: {
      process: processFactor,
      material: materialFactor,
      certifications: certificationFactor,
      winRate: winRateFactor,
      recency: recencyFactor,
    },
  };
}

export function toScoreBreakdown(
  evaluation: SupplierScoreEvaluation,
): SupplierScoreBreakdown {
  return {
    total: evaluation.total,
    max: evaluation.max,
    factors: evaluation.factors,
  };
}

async function loadSupplierContext(supplier: SupplierRow): Promise<SupplierMatchContext> {
  const cacheKey = supplier.id;
  const cached = supplierContextCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const contextPromise = (async () => {
    const [capabilities, documents, stats] = await Promise.all([
      listSupplierCapabilities(supplier.id),
      listSupplierDocuments(supplier.id),
      fetchSupplierPerformanceStats(supplier.id),
    ]);

    return {
      supplier,
      capabilities,
      documents,
      stats,
    };
  })().finally(() => {
    supplierContextCache.delete(cacheKey);
  });

  supplierContextCache.set(cacheKey, contextPromise);
  return contextPromise;
}

async function fetchSupplierPerformanceStats(
  supplierId: string,
): Promise<SupplierPerformanceStats> {
  try {
    const { data, error } = await supabaseServer()
      .from("rfq_bids")
      .select("status,updated_at,created_at")
      .eq("supplier_id", supplierId)
      .order("updated_at", { ascending: false })
      .limit(200);

    if (error) {
      console.error("matching: supplier stats query failed", { supplierId, error });
      return {
        totalBids: 0,
        awards: 0,
        winRate: 0,
        lastActivityAt: null,
      };
    }

    let totalBids = 0;
    let awards = 0;
    let lastActivityAt: string | null = null;

    const rows =
      (data ?? []) as Array<{
        status: string | null;
        updated_at: string | null;
        created_at: string | null;
      }>;

    rows.forEach((row) => {
      if (!row) {
        return;
      }
      totalBids += 1;
      if (row.status === "accepted") {
        awards += 1;
      }
      const timestamp = row.updated_at ?? row.created_at ?? null;
      if (timestamp && (!lastActivityAt || timestamp > lastActivityAt)) {
        lastActivityAt = timestamp;
      }
    });

    const winRate = totalBids > 0 ? awards / totalBids : 0;

    return {
      totalBids,
      awards,
      winRate,
      lastActivityAt,
    };
  } catch (error) {
    console.error("matching: supplier stats unexpected error", { supplierId, error });
    return {
      totalBids: 0,
      awards: 0,
      winRate: 0,
      lastActivityAt: null,
    };
  }
}

function computeRequirementFactor(args: {
  label: string;
  weight: number;
  required: string[];
  available: string[];
  emptyReason: string;
  allowDocumentEvidence?: string[];
}) {
  const { label, weight, required, available, emptyReason, allowDocumentEvidence } = args;

  if (required.length === 0) {
    return buildFactor({
      label,
      weight,
      ratio: 1,
      reason: emptyReason,
      evidence: [],
    });
  }

  const matches = required.filter((requirement) =>
    hasFuzzyMatch(requirement, available),
  );

  const ratio = matches.length / required.length;
  const evidence = matches.length > 0 ? matches : allowDocumentEvidence ?? [];

  const reason =
    matches.length > 0
      ? `Matched ${matches.length} of ${required.length} required`
      : `Missing ${required.length} required`;

  return buildFactor({
    label,
    weight,
    ratio,
    reason,
    evidence,
  });
}

function computeWinRateFactor(stats: SupplierPerformanceStats) {
  if (stats.totalBids === 0) {
    return buildFactor({
      label: "Historical win rate",
      weight: SCORE_WEIGHTS.winRate,
      ratio: 0,
      reason: "No bids submitted yet",
    });
  }

  const ratio = clamp(stats.winRate, 0, 1);
  return buildFactor({
    label: "Historical win rate",
    weight: SCORE_WEIGHTS.winRate,
    ratio,
    reason: `Won ${stats.awards} of ${stats.totalBids} bids`,
  });
}

function computeRecencyFactor(lastActivityAt: string | null | undefined) {
  if (!lastActivityAt) {
    return buildFactor({
      label: "Recency",
      weight: SCORE_WEIGHTS.recency,
      ratio: 0,
      reason: "No recent activity recorded",
    });
  }

  const days =
    (Date.now() - Date.parse(lastActivityAt)) / (1000 * 60 * 60 * 24);
  const ratio = clamp(1 - days / MAX_RECENCY_DAYS, 0, 1);
  const reason =
    days <= 1
      ? "Active in the last 24 hours"
      : days <= 7
        ? "Active within the past week"
        : `Last activity ${Math.round(days)} days ago`;

  return buildFactor({
    label: "Recency",
    weight: SCORE_WEIGHTS.recency,
    ratio,
    reason,
  });
}

function buildFactor({
  label,
  weight,
  ratio,
  reason,
  evidence,
}: {
  label: string;
  weight: number;
  ratio: number;
  reason: string;
  evidence?: string[];
}) {
  const awarded = clamp(weight * ratio, 0, weight);
  return {
    label,
    weight,
    awarded,
    max: weight,
    ratio: clamp(ratio, 0, 1),
    reason,
    evidence,
  };
}

function normalizeArray(values?: string[] | null): string[] {
  if (!Array.isArray(values)) {
    return [];
  }
  return values
    .map((value) => normalizeValue(value))
    .filter((value): value is string => Boolean(value));
}

function normalizeValue(value?: string | null): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function hasFuzzyMatch(value: string, candidates: string[]): boolean {
  return candidates.some(
    (candidate) =>
      candidate === value ||
      candidate.includes(value) ||
      value.includes(candidate),
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function buildEmptyBreakdown(reason: string): SupplierScoreBreakdown {
  const zeroFactor = () => ({
    label: reason,
    weight: 0,
    awarded: 0,
    max: 0,
    ratio: 0,
    reason,
  });
  return {
    total: 0,
    max: MAX_SCORE,
    factors: {
      process: zeroFactor(),
      material: zeroFactor(),
      certifications: zeroFactor(),
      winRate: zeroFactor(),
      recency: zeroFactor(),
    },
  };
}
