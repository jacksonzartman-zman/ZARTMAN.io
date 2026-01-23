import { supabaseServer } from "@/lib/supabaseServer";
import { serializeSupabaseError, isMissingTableOrColumnError } from "@/server/admin/logging";
import { hasColumns, schemaGate } from "@/server/db/schemaContract";
import { hasMatchingProcess, normalizeProcess } from "@/server/suppliers/matching";

export type CoverageConfidenceLevel = "strong" | "moderate" | "limited";

export type CoverageConfidenceSummary = {
  level: CoverageConfidenceLevel;
  label: "Strong coverage" | "Moderate coverage" | "Limited coverage";
  helper: string;
  /**
   * Intended for internal debugging / telemetry only. Avoid showing counts to customers.
   */
  debug?: {
    process: string;
    material: string | null;
    matchingProvidersByProcess: number;
    matchingProvidersByProcessAndMaterial: number | null;
    materialsSignalAvailable: boolean;
  };
};

type ProviderCoverageRow = {
  id: string;
  processes?: string[] | null;
  materials?: string[] | null;
  show_in_directory?: boolean | null;
};

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeList(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return values
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter((value) => value.length > 0);
}

function extractMaterialText(uploadMeta: unknown): string | null {
  if (!uploadMeta || typeof uploadMeta !== "object") return null;
  const record = uploadMeta as Record<string, unknown>;
  const keys = ["material", "material_type", "material_name", "materialType", "materialName"];
  for (const key of keys) {
    const value = normalizeText(record[key]);
    if (value) return value;
  }
  return null;
}

function buildProviderProcessSet(row: ProviderCoverageRow): Set<string> {
  const set = new Set<string>();
  for (const process of normalizeList(row.processes)) {
    const normalized = normalizeProcess(process);
    if (normalized) set.add(normalized);
  }
  return set;
}

function hasMaterialMatch(args: {
  providerMaterials: string[];
  materialText: string;
}): boolean {
  const haystack = args.materialText.trim().toLowerCase();
  if (!haystack) return false;
  for (const token of normalizeList(args.providerMaterials)) {
    const normalized = token.trim().toLowerCase();
    if (!normalized) continue;
    if (haystack.includes(normalized)) return true;
  }
  return false;
}

export async function computeCustomerCoverageConfidence(args: {
  uploadMeta: unknown;
}): Promise<CoverageConfidenceSummary | null> {
  const process = normalizeProcess(normalizeText((args.uploadMeta as any)?.manufacturing_process) ?? null);
  if (!process) {
    // "Selected process/material" is required to compute coverage confidence.
    return null;
  }

  const materialText = extractMaterialText(args.uploadMeta);
  const materialSpecified = Boolean(materialText);

  const supported = await schemaGate({
    enabled: true,
    relation: "providers",
    requiredColumns: ["id", "is_active", "verification_status"],
    warnPrefix: "[coverage confidence]",
    warnKey: "coverage_confidence:providers_base",
  });
  if (!supported) return null;

  const [supportsProcesses, supportsMaterials, supportsShowInDirectory] = await Promise.all([
    hasColumns("providers", ["processes"]),
    hasColumns("providers", ["materials"]),
    hasColumns("providers", ["show_in_directory"]),
  ]);
  if (!supportsProcesses) {
    // Can't compute if we don't have any process tags in the directory.
    return null;
  }

  const selectColumns = [
    "id",
    "processes",
    ...(supportsMaterials ? ["materials"] : []),
    ...(supportsShowInDirectory ? ["show_in_directory"] : []),
  ].join(",");

  let rows: ProviderCoverageRow[] = [];
  try {
    const { data, error } = await supabaseServer()
      .from("providers")
      .select(selectColumns)
      .eq("is_active", true)
      .eq("verification_status", "verified")
      .limit(5000)
      .returns<ProviderCoverageRow[]>();

    if (error) {
      if (isMissingTableOrColumnError(error)) return null;
      console.warn("[coverage confidence] providers query failed", {
        error: serializeSupabaseError(error) ?? error,
      });
      return null;
    }
    rows = Array.isArray(data) ? data : [];
  } catch (error) {
    if (isMissingTableOrColumnError(error)) return null;
    console.warn("[coverage confidence] providers query crashed", {
      error: serializeSupabaseError(error) ?? error,
    });
    return null;
  }

  const materialNeedle = materialText?.trim().toLowerCase() ?? "";
  const materialsSignalAvailable = supportsMaterials;

  let matchingByProcess = 0;
  let matchingByProcessAndMaterial = 0;

  for (const row of rows) {
    if (supportsShowInDirectory && row.show_in_directory === false) {
      continue;
    }

    const providerProcesses = buildProviderProcessSet(row);
    if (!hasMatchingProcess(process, providerProcesses)) {
      continue;
    }

    matchingByProcess += 1;

    if (!materialSpecified) {
      continue;
    }

    if (!supportsMaterials) {
      continue;
    }

    const providerMaterials = Array.isArray(row.materials) ? row.materials : [];
    if (providerMaterials.length === 0) {
      continue;
    }

    if (hasMaterialMatch({ providerMaterials, materialText: materialNeedle })) {
      matchingByProcessAndMaterial += 1;
    }
  }

  const processStrong = matchingByProcess >= 12;
  const processModerate = matchingByProcess >= 5;

  let level: CoverageConfidenceLevel = processStrong ? "strong" : processModerate ? "moderate" : "limited";

  // If the customer specified a material and we *can* evaluate it, require at least
  // some overlap to avoid overstating coverage.
  if (materialSpecified && supportsMaterials) {
    if (matchingByProcessAndMaterial <= 0) {
      level = "limited";
    } else if (level === "strong" && matchingByProcessAndMaterial < 6) {
      level = "moderate";
    } else if (level === "moderate" && matchingByProcessAndMaterial < 2) {
      level = "limited";
    }
  }

  // If the customer specified a material but we *can't* evaluate material coverage,
  // be conservative by capping to "moderate".
  if (materialSpecified && !supportsMaterials && level === "strong") {
    level = "moderate";
  }

  const label =
    level === "strong"
      ? ("Strong coverage" as const)
      : level === "moderate"
        ? ("Moderate coverage" as const)
        : ("Limited coverage" as const);

  const helper =
    level === "strong"
      ? "Many verified suppliers match your request."
      : level === "moderate"
        ? "Some verified suppliers match your request."
        : "Fewer verified suppliers match your request; offers may take longer.";

  return {
    level,
    label,
    helper,
    debug: {
      process,
      material: materialText ?? null,
      matchingProvidersByProcess: matchingByProcess,
      matchingProvidersByProcessAndMaterial: materialSpecified && supportsMaterials ? matchingByProcessAndMaterial : null,
      materialsSignalAvailable,
    },
  };
}

