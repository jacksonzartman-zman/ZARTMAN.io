export type DiscoveryCompletenessMissing = "name" | "contact" | "process";

export type DiscoveryCompletenessInput = {
  name?: string | null;
  email?: string | null;
  website?: string | null;
  processes?: string[] | null;
};

export type DiscoveryCompletenessAssessment = {
  complete: boolean;
  missing: DiscoveryCompletenessMissing[];
};

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeOptionalText(value: unknown): string | null {
  const normalized = normalizeText(value);
  return normalized.length > 0 ? normalized : null;
}

function normalizeTagList(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const normalized = values
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter((value) => value.length > 0);
  return Array.from(new Set(normalized));
}

export function assessDiscoveryCompleteness(
  input: DiscoveryCompletenessInput,
): DiscoveryCompletenessAssessment {
  const name = normalizeOptionalText(input.name);
  const email = normalizeOptionalText(input.email);
  const website = normalizeOptionalText(input.website);
  const processes = normalizeTagList(input.processes);

  const missing: DiscoveryCompletenessMissing[] = [];
  if (!name) {
    missing.push("name");
  }
  if (!email && !website) {
    missing.push("contact");
  }
  if (processes.length === 0) {
    missing.push("process");
  }

  return {
    complete: missing.length === 0,
    missing,
  };
}

