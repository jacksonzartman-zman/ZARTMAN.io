export type ProviderCapabilityMatchHealth = "match" | "partial" | "mismatch" | "unknown";

export type ProviderCapabilityMatchBreakdownItem = {
  key: "processes" | "materials" | "geo";
  label: string;
  /** Whether this signal can be evaluated in this environment (column exists). */
  available: boolean;
  /** Whether the provider has supplied usable data for this signal. */
  present: boolean;
  weight: number;
  earned: number;
  notes: string[];
};

export type ProviderCapabilityMatchAssessment = {
  health: ProviderCapabilityMatchHealth;
  /**
   * Strong matches (ready-to-route signals).
   * Examples: ["Processes: CNC machining, sheet metal"].
   */
  matches: string[];
  /**
   * Incomplete signals (present in schema but missing/empty on the provider record).
   */
  partialMatches: string[];
  /**
   * Deterministic mismatch reasons (hard blocks) when we can evaluate the signal.
   */
  mismatchReasons: string[];
  /**
   * Score in [0..100] for ADMIN diagnostics only.
   * Null when no capability columns exist (cannot evaluate).
   */
  score: number | null;
  breakdown: ProviderCapabilityMatchBreakdownItem[];
};

export type ProviderCapabilityMatchInput = {
  processes?: string[] | null;
  materials?: string[] | null;
  country?: string | null;
  states?: string[] | null;
};

const DEFAULT_WEIGHTS: Record<ProviderCapabilityMatchBreakdownItem["key"], number> = {
  processes: 60,
  materials: 20,
  geo: 20,
};

function normalizeList(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return values
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter((value) => value.length > 0);
}

function normalizeProcess(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function normalizeMaterial(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function titleCase(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  return trimmed
    .split(/\s+/g)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatShortList(values: string[], max = 3): string {
  const unique = Array.from(new Set(values.filter(Boolean)));
  const limited = unique.slice(0, Math.max(1, max));
  if (unique.length <= limited.length) return limited.join(", ");
  return `${limited.join(", ")} (+${unique.length - limited.length})`;
}

function normalizeCountry(value: string): string | null {
  const raw = value.trim();
  if (!raw) return null;
  const upper = raw.toUpperCase();
  const cleaned = upper.replace(/[.\s]+/g, " ").trim();
  if (!cleaned) return null;
  if (cleaned === "US" || cleaned === "USA" || cleaned === "UNITED STATES") return "US";
  if (cleaned === "CA" || cleaned === "CANADA") return "CA";
  if (cleaned === "MX" || cleaned === "MEXICO") return "MX";
  return upper;
}

function normalizeState(value: string): string | null {
  const raw = value.trim().toUpperCase();
  if (!raw) return null;
  // Keep it permissive; eligibility logic has a fuller mapping, but here we just want stability.
  if (/^[A-Z]{2}$/.test(raw)) return raw;
  return null;
}

export function assessProviderCapabilityMatch(
  input: ProviderCapabilityMatchInput,
  options?: { weights?: Partial<Record<ProviderCapabilityMatchBreakdownItem["key"], number>> },
): ProviderCapabilityMatchAssessment {
  const weights = { ...DEFAULT_WEIGHTS, ...(options?.weights ?? {}) };

  const processesAvailable = typeof input.processes !== "undefined";
  const materialsAvailable = typeof input.materials !== "undefined";
  const countryAvailable = typeof input.country !== "undefined";
  const statesAvailable = typeof input.states !== "undefined";
  const geoAvailable = countryAvailable || statesAvailable;

  const normalizedProcesses = Array.from(
    new Set(
      normalizeList(input.processes).map((value) => normalizeProcess(value)).filter(Boolean) as string[],
    ),
  );
  const normalizedMaterials = Array.from(
    new Set(
      normalizeList(input.materials).map((value) => normalizeMaterial(value)).filter(Boolean) as string[],
    ),
  );
  const normalizedCountry =
    typeof input.country === "string" ? normalizeCountry(input.country) : null;
  const normalizedStates = Array.from(
    new Set(
      normalizeList(input.states)
        .map((value) => normalizeState(value))
        .filter(Boolean) as string[],
    ),
  );

  const matches: string[] = [];
  const partialMatches: string[] = [];
  const mismatchReasons: string[] = [];

  // Processes: treat as routing-critical when available.
  if (processesAvailable) {
    if (normalizedProcesses.length > 0) {
      matches.push(`Processes: ${formatShortList(normalizedProcesses.map(titleCase))}`);
    } else {
      mismatchReasons.push("No processes recorded.");
    }
  }

  // Materials: useful but non-blocking.
  if (materialsAvailable) {
    if (normalizedMaterials.length > 0) {
      matches.push(`Materials: ${formatShortList(normalizedMaterials.map(titleCase))}`);
    } else {
      partialMatches.push("Materials missing.");
    }
  }

  // Geo: useful but non-blocking (many providers can ship broadly).
  if (geoAvailable) {
    const geoBits: string[] = [];
    if (normalizedCountry) geoBits.push(normalizedCountry);
    if (normalizedStates.length > 0) geoBits.push(`${normalizedStates.length} state${normalizedStates.length === 1 ? "" : "s"}`);
    if (geoBits.length > 0) {
      matches.push(`Geo: ${geoBits.join(" · ")}`);
    } else {
      partialMatches.push("Location coverage missing.");
    }
  }

  const breakdown: ProviderCapabilityMatchBreakdownItem[] = [
    {
      key: "processes",
      label: "Processes",
      available: processesAvailable,
      present: processesAvailable && normalizedProcesses.length > 0,
      weight: weights.processes,
      earned: 0,
      notes: processesAvailable
        ? normalizedProcesses.length > 0
          ? [`${normalizedProcesses.length} process${normalizedProcesses.length === 1 ? "" : "es"}`]
          : ["Empty processes list"]
        : ["Column unavailable"],
    },
    {
      key: "materials",
      label: "Materials",
      available: materialsAvailable,
      present: materialsAvailable && normalizedMaterials.length > 0,
      weight: weights.materials,
      earned: 0,
      notes: materialsAvailable
        ? normalizedMaterials.length > 0
          ? [`${normalizedMaterials.length} material${normalizedMaterials.length === 1 ? "" : "s"}`]
          : ["Empty materials list"]
        : ["Column unavailable"],
    },
    {
      key: "geo",
      label: "Geo coverage",
      available: geoAvailable,
      present: geoAvailable && Boolean(normalizedCountry || normalizedStates.length > 0),
      weight: weights.geo,
      earned: 0,
      notes: geoAvailable
        ? [
            normalizedCountry ? `Country: ${normalizedCountry}` : "Country missing",
            normalizedStates.length > 0
              ? `States: ${normalizedStates.join(", ")}`
              : "States missing",
          ]
        : ["Columns unavailable"],
    },
  ];

  let availableWeight = 0;
  let earnedWeight = 0;
  for (const item of breakdown) {
    if (!item.available) continue;
    availableWeight += item.weight;
    if (item.present) {
      item.earned = item.weight;
      earnedWeight += item.weight;
    }
  }

  const score = availableWeight > 0 ? Math.round((earnedWeight / availableWeight) * 100) : null;

  const health: ProviderCapabilityMatchHealth =
    score === null
      ? "unknown"
      : mismatchReasons.length > 0
        ? "mismatch"
        : partialMatches.length > 0
          ? "partial"
          : "match";

  return {
    health,
    matches,
    partialMatches,
    mismatchReasons,
    score,
    breakdown,
  };
}

