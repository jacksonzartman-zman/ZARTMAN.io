import type { SupplierCapabilityRow } from "@/server/suppliers/types";

export type MatchHealth = "excellent" | "good" | "limited" | "poor";

export type SupplierCapabilityProfile = {
  processes: Set<string>;
  materials: Set<string>;
};

export type SupplierMatchInsight = {
  health: MatchHealth;
  reasons: string[];
};

export type SupplierMatchInsightInput =
  | {
      profile: SupplierCapabilityProfile;
      quoteProcess?: string | null;
      materialMatches?: string[] | null;
      materialHints?: string[] | null;
      materialText?: string | null;
      quantityHint?: string | null;
    }
  | {
      capabilities: SupplierCapabilityRow[];
      quoteProcess?: string | null;
      materialMatches?: string[] | null;
      materialHints?: string[] | null;
      materialText?: string | null;
      quantityHint?: string | null;
    };

/**
 * Scores a supplier↔search request pairing using coarse capability signals.
 * Emphasizes process alignment, basic material overlap, and falls back to
 * "limited" when there is evidence of mismatch.
 */
export function deriveSupplierMatchInsight(
  input: SupplierMatchInsightInput,
): SupplierMatchInsight {
  const profile = "profile" in input ? input.profile : buildCapabilityProfile(input.capabilities);
  const quoteProcess = normalizeProcess(input.quoteProcess);
  const supplierHasProcessData = profile.processes.size > 0;
  const supplierHasMaterialData = profile.materials.size > 0;

  const materialOverlap = computeMaterialOverlap({
    supplierMaterials: profile.materials,
    materialMatches: input.materialMatches,
    materialHints: input.materialHints,
    materialText: input.materialText,
  });

  const reasons: string[] = [];

  if (!quoteProcess || !supplierHasProcessData) {
    reasons.push("Process details are incomplete.");
    if (materialOverlap > 0) {
      reasons.push("Materials still look compatible.");
      return {
        health: "good",
        reasons,
      };
    }
    return {
      health: "limited",
      reasons,
    };
  }

  const processMatches = hasMatchingProcess(quoteProcess, profile.processes);
  if (!processMatches) {
    reasons.push("Supplier processes don't cover this search request.");
    return {
      health: "poor",
      reasons,
    };
  }

  if (materialOverlap > 0) {
    reasons.push("Process and materials align.");
    if ((input.quantityHint ?? "").trim().length > 0) {
      reasons.push(`Quantity: ${input.quantityHint}`);
    }
    return {
      health: materialOverlap > 1 ? "excellent" : "good",
      reasons,
    };
  }

  const materialSignalPresent =
    (input.materialMatches?.length ?? 0) > 0 ||
    (input.materialHints?.length ?? 0) > 0 ||
    (typeof input.materialText === "string" &&
      input.materialText.trim().length > 0);

  if (!materialSignalPresent || !supplierHasMaterialData) {
    reasons.push("Process match, materials unspecified.");
    return {
      health: "good",
      reasons,
    };
  }

  reasons.push("Process matches, but materials look off.");
  return {
    health: "limited",
    reasons,
  };
}

export function buildCapabilityProfile(
  capabilities: SupplierCapabilityRow[] | SupplierCapabilityProfile,
): SupplierCapabilityProfile {
  if (isCapabilityProfile(capabilities)) {
    return capabilities;
  }

  const profile: SupplierCapabilityProfile = {
    processes: new Set<string>(),
    materials: new Set<string>(),
  };

  capabilities.forEach((capability) => {
    const normalizedProcess = normalizeProcess(capability.process);
    if (normalizedProcess) {
      profile.processes.add(normalizedProcess);
    }

    (capability.materials ?? []).forEach((material) => {
      const normalizedMaterial = normalizeMaterial(material);
      if (normalizedMaterial) {
        profile.materials.add(normalizedMaterial);
      }
    });
  });

  return profile;
}

function computeMaterialOverlap({
  supplierMaterials,
  materialMatches,
  materialHints,
  materialText,
}: {
  supplierMaterials: Set<string>;
  materialMatches?: string[] | null;
  materialHints?: string[] | null;
  materialText?: string | null;
}): number {
  const normalizedMatches = new Set<string>();

  (materialMatches ?? []).forEach((match) => {
    const normalized = normalizeMaterial(match);
    if (normalized && supplierMaterials.has(normalized)) {
      normalizedMatches.add(normalized);
    }
  });

  if (normalizedMatches.size > 0) {
    return normalizedMatches.size;
  }

  (materialHints ?? []).forEach((hint) => {
    const normalized = normalizeMaterial(hint);
    if (normalized && supplierMaterials.has(normalized)) {
      normalizedMatches.add(normalized);
    }
  });

  if (normalizedMatches.size > 0) {
    return normalizedMatches.size;
  }

  const searchableText =
    typeof materialText === "string" ? materialText.toLowerCase() : "";
  if (searchableText.length === 0) {
    return 0;
  }

  supplierMaterials.forEach((material) => {
    if (material.length === 0) {
      return;
    }
    if (searchableText.includes(material)) {
      normalizedMatches.add(material);
    }
  });

  return normalizedMatches.size;
}

function normalizeProcess(value?: string | null): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function normalizeMaterial(value?: string | null): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function hasMatchingProcess(
  quoteProcess: string,
  supplierProcesses: Set<string>,
): boolean {
  if (supplierProcesses.has(quoteProcess)) {
    return true;
  }

  for (const candidate of supplierProcesses) {
    if (quoteProcess.includes(candidate) || candidate.includes(quoteProcess)) {
      return true;
    }
  }

  return false;
}

function isCapabilityProfile(
  value: SupplierCapabilityRow[] | SupplierCapabilityProfile,
): value is SupplierCapabilityProfile {
  return value instanceof Object && "processes" in value && "materials" in value;
}
