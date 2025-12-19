import type { QuotePartWithFiles } from "@/app/(portals)/quotes/workspaceData";

function clampInt(value: number, min: number, max: number): number {
  const rounded = Math.round(value);
  return Math.max(min, Math.min(max, rounded));
}

function countRole(part: QuotePartWithFiles, role: "cad" | "drawing"): number {
  return (part.files ?? []).filter((f) => f.role === role).length;
}

function guessProcessMultiplier(part: QuotePartWithFiles): number {
  // Static heuristic based on file extensions.
  const exts = new Set(
    (part.files ?? [])
      .map((f) => (typeof f.extension === "string" ? f.extension.trim().toLowerCase() : ""))
      .filter(Boolean),
  );

  // STL tends to be additive; STEP/IGES tends to be machined; DWG/DXF often sheet.
  if (exts.has("stl")) return 0.9; // additive often lower unit cost at low complexity
  if (exts.has("dwg") || exts.has("dxf")) return 1.05; // sheet-metal-ish drawings
  if (exts.has("step") || exts.has("stp") || exts.has("iges") || exts.has("igs")) return 1.15; // CNC-ish
  return 1.0;
}

function guessMaterialMultiplier(part: QuotePartWithFiles): number {
  const text = `${part.partLabel ?? ""} ${part.partNumber ?? ""} ${part.notes ?? ""}`
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

  if (!text) return 1.0;

  // Very rough cost multipliers.
  if (text.includes("titanium") || text.includes("ti-6") || text.includes("inconel")) {
    return 1.8;
  }
  if (text.includes("stainless") || text.includes("17-4") || text.includes("316")) {
    return 1.35;
  }
  if (text.includes("steel") || text.includes("4140") || text.includes("1018")) {
    return 1.2;
  }
  if (text.includes("aluminum") || text.includes("aluminium") || text.includes("6061") || text.includes("7075")) {
    return 1.05;
  }
  if (text.includes("delrin") || text.includes("acetal") || text.includes("abs") || text.includes("nylon")) {
    return 0.95;
  }

  return 1.0;
}

function guessComplexCadFactor(part: QuotePartWithFiles): number {
  // “Complex CAD” heuristic (best-effort): multiple CAD files, assemblies, or many attached files.
  const cadCount = countRole(part, "cad");
  const fileCount = (part.files ?? []).length;
  const hasAssemblies = (part.files ?? []).some((f) => {
    const ext = typeof f.extension === "string" ? f.extension.trim().toLowerCase() : "";
    return ext === "sldasm" || ext === "asm";
  });

  if (hasAssemblies || cadCount >= 2 || fileCount >= 6) {
    // +20–40%
    return 1.3;
  }
  return 1.0;
}

export function suggestLeadTimeDays(part: QuotePartWithFiles): number {
  const drawingCount = countRole(part, "drawing");
  const hasDrawing = drawingCount > 0;

  const base = hasDrawing ? 7 : 9; // midpoints of 5–10 vs 7–12
  const complexFactor = guessComplexCadFactor(part);

  const suggested = base * (complexFactor === 1.0 ? 1.0 : 1.25);

  // Keep it practical.
  return clampInt(suggested, hasDrawing ? 5 : 7, hasDrawing ? 16 : 18);
}

export function suggestUnitPriceRange(
  part: QuotePartWithFiles,
): {
  low: number;
  high: number;
} {
  // Start at $40–$120.
  let low = 40;
  let high = 120;

  const fileCount = (part.files ?? []).length;
  const cadCount = countRole(part, "cad");
  const drawingCount = countRole(part, "drawing");

  const materialMult = guessMaterialMultiplier(part);
  const processMult = guessProcessMultiplier(part);
  const complexityMult = guessComplexCadFactor(part);

  // File-count multiplier (documentation and review overhead).
  const fileMult = 1 + Math.min(0.4, Math.max(0, (fileCount - 2) * 0.05));

  // Missing drawings adds uncertainty.
  const drawingMult = drawingCount > 0 ? 1.0 : 1.15;

  // CAD-only (no drawing) tends to need more clarification.
  const cadMult = cadCount > 0 ? 1.0 : 1.1;

  const mult = materialMult * processMult * complexityMult * fileMult * drawingMult * cadMult;

  low = Math.round(low * mult);
  high = Math.round(high * mult);

  // Guardrails.
  if (high < low) high = low;
  low = Math.max(10, low);
  high = Math.max(low + 5, high);

  return { low, high };
}
