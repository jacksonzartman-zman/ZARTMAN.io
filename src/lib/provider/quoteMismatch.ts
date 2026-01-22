export type ProviderQuoteMismatchReason =
  | "process_mismatch"
  | "provider_missing_processes"
  | "material_mismatch"
  | "provider_missing_materials";

export const PROVIDER_QUOTE_MISMATCH_REASON_LABEL: Record<
  ProviderQuoteMismatchReason,
  string
> = {
  process_mismatch: "Process mismatch",
  provider_missing_processes: "Provider has no processes recorded",
  material_mismatch: "Material mismatch",
  provider_missing_materials: "Provider has no materials recorded",
};

export type ProviderQuoteMismatchInput = {
  quoteProcess?: string | null;
  quoteMaterialRequirements?: string[] | null;
  providerProcesses?: string[] | null;
  providerMaterials?: string[] | null;
};

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function normalizeList(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const out: string[] = [];
  for (const value of values) {
    const normalized = normalizeText(value);
    if (normalized) out.push(normalized);
  }
  return Array.from(new Set(out));
}

function hasFuzzyMatch(needle: string, haystack: string[]): boolean {
  if (!needle) return false;
  return haystack.some((candidate) => candidate === needle || candidate.includes(needle) || needle.includes(candidate));
}

export function deriveProviderQuoteMismatch(input: ProviderQuoteMismatchInput): {
  isMismatch: boolean;
  mismatchReasons: ProviderQuoteMismatchReason[];
  mismatchReasonLabels: string[];
} {
  const quoteProcess = normalizeText(input.quoteProcess);
  const quoteMaterials = normalizeList(input.quoteMaterialRequirements);
  const providerProcesses = normalizeList(input.providerProcesses);
  const providerMaterials = normalizeList(input.providerMaterials);

  const mismatchReasons: ProviderQuoteMismatchReason[] = [];

  if (quoteProcess) {
    if (providerProcesses.length === 0) {
      mismatchReasons.push("provider_missing_processes");
    } else if (!hasFuzzyMatch(quoteProcess, providerProcesses)) {
      mismatchReasons.push("process_mismatch");
    }
  }

  if (quoteMaterials.length > 0) {
    if (providerMaterials.length === 0) {
      mismatchReasons.push("provider_missing_materials");
    } else {
      const anyMatch = quoteMaterials.some((required) => hasFuzzyMatch(required, providerMaterials));
      if (!anyMatch) {
        mismatchReasons.push("material_mismatch");
      }
    }
  }

  const unique = Array.from(new Set(mismatchReasons));
  const labels = unique.map((reason) => PROVIDER_QUOTE_MISMATCH_REASON_LABEL[reason]);

  return {
    isMismatch: unique.length > 0,
    mismatchReasons: unique,
    mismatchReasonLabels: labels,
  };
}

