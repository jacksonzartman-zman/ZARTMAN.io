import type { QuotePartWithFiles } from "@/app/(portals)/quotes/workspaceData";

export type PartCoverage = {
  partId: string;
  partLabel: string;
  partNumber: string | null;
  cadCount: number;
  drawingCount: number;
  otherCount: number;
  hasCad: boolean;
  hasDrawing: boolean;
};

export type PartsCoverageSummary = {
  totalParts: number;
  fullyCoveredParts: number; // hasCad && hasDrawing
  partsNeedingCad: number; // !hasCad
  partsNeedingDrawing: number; // !hasDrawing
  allCovered: boolean;
  anyParts: boolean;
};

export type PartsCoverageHealth = "none" | "good" | "needs_attention";

export function summarizePartsCoverageHealth(
  summary: PartsCoverageSummary,
): PartsCoverageHealth {
  if (summary.totalParts === 0) return "none";
  const hasGaps = summary.partsNeedingCad > 0 || summary.partsNeedingDrawing > 0;
  return hasGaps ? "needs_attention" : "good";
}

export function computePartsCoverage(
  parts: QuotePartWithFiles[],
): { perPart: PartCoverage[]; summary: PartsCoverageSummary } {
  const source = Array.isArray(parts) ? parts : [];

  let totalParts = 0;
  let fullyCoveredParts = 0;
  let partsNeedingCad = 0;
  let partsNeedingDrawing = 0;

  const perPart: PartCoverage[] = source.map((part) => {
    totalParts += 1;

    let cadCount = 0;
    let drawingCount = 0;
    let otherCount = 0;

    const files = Array.isArray(part.files) ? part.files : [];
    for (const file of files) {
      if (file?.role === "cad") {
        cadCount += 1;
      } else if (file?.role === "drawing") {
        drawingCount += 1;
      } else {
        otherCount += 1;
      }
    }

    const hasCad = cadCount > 0;
    const hasDrawing = drawingCount > 0;
    if (hasCad && hasDrawing) fullyCoveredParts += 1;
    if (!hasCad) partsNeedingCad += 1;
    if (!hasDrawing) partsNeedingDrawing += 1;

    return {
      partId: part.id,
      partLabel: part.partLabel,
      partNumber: part.partNumber ?? null,
      cadCount,
      drawingCount,
      otherCount,
      hasCad,
      hasDrawing,
    };
  });

  const anyParts = totalParts > 0;
  const allCovered = anyParts && fullyCoveredParts === totalParts;

  return {
    perPart,
    summary: {
      totalParts,
      fullyCoveredParts,
      partsNeedingCad,
      partsNeedingDrawing,
      allCovered,
      anyParts,
    },
  };
}

