export type ProviderProfileCompletenessOptions = {
  /**
   * Some verification flows require at least one of materials/certifications
   * to be present before moving to "ready to verify".
   */
  requireMaterialsOrCertifications?: boolean;
};

export type ProviderProfileCompleteness = {
  score: number; // 0-100
  missing: string[];
  requiredSatisfied: boolean;
  readyToVerify: boolean;
  threshold: number;
};

type ProviderProfileCompletenessInputs = {
  companyName?: string | null;
  email?: string | null;
  website?: string | null;
  processes?: unknown;
  country?: string | null;
  states?: unknown;
  materials?: unknown;
  certifications?: unknown;
};

const COMPLETENESS_WEIGHTS = {
  companyName: 20,
  contact: 20,
  process: 20,
  location: 20,
  materialsOrCertifications: 20,
} as const;

export function scoreProviderProfileCompleteness(
  inputs: ProviderProfileCompletenessInputs,
  options: ProviderProfileCompletenessOptions = {},
): ProviderProfileCompleteness {
  const requireMaterialsOrCertifications = Boolean(options.requireMaterialsOrCertifications);

  const hasCompanyName = Boolean(normalizeOptionalText(inputs.companyName));
  const hasContact = Boolean(normalizeOptionalText(inputs.website) || normalizeOptionalText(inputs.email));
  const hasProcess = normalizeStringList(inputs.processes).length > 0;

  const hasCountry = Boolean(normalizeOptionalText(inputs.country));
  const hasState = normalizeStringList(inputs.states).length > 0;
  const hasLocation = hasCountry || hasState;

  const hasMaterials = normalizeStringList(inputs.materials).length > 0;
  const hasCerts = normalizeStringList(inputs.certifications).length > 0;
  const hasMaterialsOrCertifications = hasMaterials || hasCerts;

  const threshold = requireMaterialsOrCertifications ? 100 : 80;

  const missing: string[] = [];
  if (!hasCompanyName) missing.push("Missing company name");
  if (!hasContact) missing.push("Missing website or email");
  if (!hasProcess) missing.push("Missing processes");
  if (!hasLocation) missing.push("Missing location (country/state)");
  if (!hasMaterialsOrCertifications) {
    missing.push(
      requireMaterialsOrCertifications
        ? "Missing materials or certifications"
        : "Missing materials or certifications (optional)",
    );
  }

  const score = clampScore(
    (hasCompanyName ? COMPLETENESS_WEIGHTS.companyName : 0) +
      (hasContact ? COMPLETENESS_WEIGHTS.contact : 0) +
      (hasProcess ? COMPLETENESS_WEIGHTS.process : 0) +
      (hasLocation ? COMPLETENESS_WEIGHTS.location : 0) +
      (hasMaterialsOrCertifications ? COMPLETENESS_WEIGHTS.materialsOrCertifications : 0),
  );

  const requiredSatisfied =
    hasCompanyName &&
    hasContact &&
    hasProcess &&
    hasLocation &&
    (!requireMaterialsOrCertifications || hasMaterialsOrCertifications);

  // Deterministic gate: allow via score threshold or direct required-field satisfaction.
  const readyToVerify = requiredSatisfied || score >= threshold;

  return {
    score,
    missing,
    requiredSatisfied,
    readyToVerify,
    threshold,
  };
}

function normalizeOptionalText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeStringList(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const normalized = values
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter((value) => value.length > 0);
  return Array.from(new Set(normalized));
}

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

