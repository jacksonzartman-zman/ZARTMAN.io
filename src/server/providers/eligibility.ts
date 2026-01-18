import { supabaseServer } from "@/lib/supabaseServer";
import { isMissingTableOrColumnError, serializeSupabaseError } from "@/server/admin/logging";
import { hasColumns, schemaGate } from "@/server/db/schemaContract";
import {
  listProvidersWithContact,
  type ProviderContactRow,
  type ProviderEmailColumn,
} from "@/server/providers";
import { hasMatchingProcess, normalizeProcess } from "@/server/suppliers/matching";

export type ProviderEligibilityReason =
  | "process_match"
  | "geo_match"
  | "known_contact"
  | "verified_active";

export type ProviderEligibilityCriteria = {
  process?: string | null;
  shipToState?: string | null;
  shipToCountry?: string | null;
  quantity?: number | null;
};

export type ProviderEligibilityMatch = {
  providerId: string;
  reasons: ProviderEligibilityReason[];
  eligible: boolean;
  score: number;
};

export type EligibleProvidersForQuoteResult = {
  criteria: ProviderEligibilityCriteria;
  rankedProviders: ProviderEligibilityMatch[];
  rankedProviderIds: string[];
  eligibleProviderIds: string[];
};

export type ProviderEligibilityInputs = {
  process?: string | null;
  quantity?: string | number | null;
  shipTo?: string | null;
  shippingPostalCode?: string | null;
};

type QuoteEligibilityRow = {
  id: string | null;
  upload_id?: string | null;
  ship_to?: string | null;
};

type UploadEligibilityRow = {
  manufacturing_process?: string | null;
  quantity?: string | null;
  shipping_postal_code?: string | null;
};

type RankedProvider = ProviderEligibilityMatch & {
  name: string;
};

const PROVIDER_REASON_WEIGHTS: Record<ProviderEligibilityReason, number> = {
  process_match: 4,
  geo_match: 3,
  known_contact: 2,
  verified_active: 1,
};

const US_STATE_CODES = new Set([
  "AL",
  "AK",
  "AZ",
  "AR",
  "CA",
  "CO",
  "CT",
  "DE",
  "FL",
  "GA",
  "HI",
  "ID",
  "IL",
  "IN",
  "IA",
  "KS",
  "KY",
  "LA",
  "ME",
  "MD",
  "MA",
  "MI",
  "MN",
  "MS",
  "MO",
  "MT",
  "NE",
  "NV",
  "NH",
  "NJ",
  "NM",
  "NY",
  "NC",
  "ND",
  "OH",
  "OK",
  "OR",
  "PA",
  "RI",
  "SC",
  "SD",
  "TN",
  "TX",
  "UT",
  "VT",
  "VA",
  "WA",
  "WV",
  "WI",
  "WY",
  "DC",
]);

const US_STATE_NAME_TO_CODE: Record<string, string> = {
  ALABAMA: "AL",
  ALASKA: "AK",
  ARIZONA: "AZ",
  ARKANSAS: "AR",
  CALIFORNIA: "CA",
  COLORADO: "CO",
  CONNECTICUT: "CT",
  DELAWARE: "DE",
  FLORIDA: "FL",
  GEORGIA: "GA",
  HAWAII: "HI",
  IDAHO: "ID",
  ILLINOIS: "IL",
  INDIANA: "IN",
  IOWA: "IA",
  KANSAS: "KS",
  KENTUCKY: "KY",
  LOUISIANA: "LA",
  MAINE: "ME",
  MARYLAND: "MD",
  MASSACHUSETTS: "MA",
  MICHIGAN: "MI",
  MINNESOTA: "MN",
  MISSISSIPPI: "MS",
  MISSOURI: "MO",
  MONTANA: "MT",
  NEBRASKA: "NE",
  NEVADA: "NV",
  "NEW HAMPSHIRE": "NH",
  "NEW JERSEY": "NJ",
  "NEW MEXICO": "NM",
  "NEW YORK": "NY",
  "NORTH CAROLINA": "NC",
  "NORTH DAKOTA": "ND",
  OHIO: "OH",
  OKLAHOMA: "OK",
  OREGON: "OR",
  PENNSYLVANIA: "PA",
  RHODE_ISLAND: "RI",
  "RHODE ISLAND": "RI",
  "SOUTH CAROLINA": "SC",
  "SOUTH DAKOTA": "SD",
  TENNESSEE: "TN",
  TEXAS: "TX",
  UTAH: "UT",
  VERMONT: "VT",
  VIRGINIA: "VA",
  WASHINGTON: "WA",
  "WEST VIRGINIA": "WV",
  WISCONSIN: "WI",
  WYOMING: "WY",
  "DISTRICT OF COLUMBIA": "DC",
};

const COUNTRY_ALIASES: Record<string, string> = {
  US: "US",
  USA: "US",
  "U S": "US",
  "U.S.": "US",
  "U.S.A.": "US",
  "UNITED STATES": "US",
  "UNITED STATES OF AMERICA": "US",
  CA: "CA",
  CANADA: "CA",
  MX: "MX",
  MEXICO: "MX",
};

function normalizeOptionalText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeCountry(value: unknown): string | null {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return null;
  const upper = raw.toUpperCase();
  const cleaned = upper.replace(/[.\s]+/g, " ").trim();
  if (!cleaned) return null;
  return COUNTRY_ALIASES[cleaned] ?? COUNTRY_ALIASES[upper] ?? cleaned;
}

function normalizeState(value: unknown): string | null {
  const raw = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (!raw) return null;
  if (US_STATE_CODES.has(raw)) return raw;
  const cleaned = raw.replace(/[^A-Z]/g, " ").trim().replace(/\s+/g, " ");
  if (!cleaned) return null;
  const code = US_STATE_NAME_TO_CODE[cleaned];
  return code ?? null;
}

function normalizeQuantity(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.floor(value));
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/[\d,.]+/);
  if (!match) return null;
  const numeric = Number(match[0].replace(/,/g, ""));
  return Number.isFinite(numeric) ? Math.max(0, Math.floor(numeric)) : null;
}

function normalizeList(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return values
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter((value) => value.length > 0);
}

function normalizeProcesses(values: unknown): Set<string> {
  const processes = new Set<string>();
  normalizeList(values).forEach((value) => {
    const normalized = normalizeProcess(value);
    if (normalized) processes.add(normalized);
  });
  return processes;
}

function normalizeStates(values: unknown): Set<string> {
  const states = new Set<string>();
  normalizeList(values).forEach((value) => {
    const normalized = normalizeState(value);
    if (normalized) states.add(normalized);
  });
  return states;
}

function normalizeReasonScore(reasons: ProviderEligibilityReason[]): number {
  return reasons.reduce((total, reason) => total + PROVIDER_REASON_WEIGHTS[reason], 0);
}

function parseShipToLocation(args: {
  shipTo?: string | null;
  shippingPostalCode?: string | null;
}): { state: string | null; country: string | null } {
  const shipTo = normalizeOptionalText(args.shipTo);
  const postalCode = normalizeOptionalText(args.shippingPostalCode);
  const upper = shipTo ? shipTo.toUpperCase() : "";
  let country = shipTo ? normalizeCountry(shipTo) : null;
  let state: string | null = null;

  if (upper) {
    const tokens = upper.split(/[,/|]/g).flatMap((part) => part.trim().split(/\s+/g));
    for (const token of tokens) {
      const normalizedState = normalizeState(token);
      if (normalizedState) {
        state = normalizedState;
      }
      const normalizedCountry = normalizeCountry(token);
      if (normalizedCountry) {
        country = normalizedCountry;
      }
    }
  }

  if (!state && postalCode) {
    const normalizedPostal = normalizeState(postalCode);
    if (normalizedPostal && (!country || country === "US")) {
      state = normalizedPostal;
    }
  }

  return { state, country };
}

function buildKnownContactStatus(args: {
  provider: ProviderContactRow;
  emailColumn: ProviderEmailColumn | null;
}): boolean {
  const contactedAt =
    typeof args.provider.contacted_at === "string" && args.provider.contacted_at.trim().length > 0;
  if (contactedAt) return true;
  if (!args.emailColumn) return false;
  const email = args.provider[args.emailColumn];
  return typeof email === "string" && email.trim().length > 0;
}

function normalizeCriteria(criteria: ProviderEligibilityCriteria): ProviderEligibilityCriteria {
  return {
    process: normalizeProcess(criteria.process ?? null),
    shipToState: normalizeState(criteria.shipToState),
    shipToCountry: normalizeCountry(criteria.shipToCountry),
    quantity: normalizeQuantity(criteria.quantity ?? null),
  };
}

function isProviderEligible(args: {
  criteriaHasSignals: boolean;
  processMatch: boolean;
  geoMatch: boolean;
}): boolean {
  if (!args.criteriaHasSignals) return true;
  return args.processMatch || args.geoMatch;
}

export function buildProviderEligibilityCriteria(
  inputs: ProviderEligibilityInputs,
): ProviderEligibilityCriteria {
  const process = normalizeProcess(inputs.process ?? null);
  const quantity = normalizeQuantity(inputs.quantity ?? null);
  const { state, country } = parseShipToLocation({
    shipTo: inputs.shipTo ?? null,
    shippingPostalCode: inputs.shippingPostalCode ?? null,
  });

  return {
    process,
    shipToState: state,
    shipToCountry: country,
    quantity,
  };
}

export async function resolveProviderEligibilityCriteriaForQuote(
  quoteId: string,
): Promise<ProviderEligibilityCriteria> {
  const normalizedId = normalizeOptionalText(quoteId);
  if (!normalizedId) {
    return {};
  }

  const quoteSupported = await schemaGate({
    enabled: true,
    relation: "quotes",
    requiredColumns: ["id"],
    warnPrefix: "[provider eligibility]",
    warnKey: "provider_eligibility:quotes",
  });
  if (!quoteSupported) return {};

  const [supportsUploadId, supportsShipTo] = await Promise.all([
    hasColumns("quotes", ["upload_id"]),
    hasColumns("quotes", ["ship_to"]),
  ]);

  const quoteSelect = [
    "id",
    supportsUploadId ? "upload_id" : null,
    supportsShipTo ? "ship_to" : null,
  ]
    .filter(Boolean)
    .join(",");

  let quoteRow: QuoteEligibilityRow | null = null;
  try {
    const { data, error } = await supabaseServer
      .from("quotes")
      .select(quoteSelect)
      .eq("id", normalizedId)
      .maybeSingle<QuoteEligibilityRow>();
    if (error) {
      if (isMissingTableOrColumnError(error)) {
        return {};
      }
      console.warn("[provider eligibility] quote lookup failed", {
        quoteId: normalizedId,
        error: serializeSupabaseError(error) ?? error,
      });
      return {};
    }
    quoteRow = data ?? null;
  } catch (error) {
    if (isMissingTableOrColumnError(error)) {
      return {};
    }
    console.warn("[provider eligibility] quote lookup crashed", {
      quoteId: normalizedId,
      error: serializeSupabaseError(error) ?? error,
    });
    return {};
  }

  let uploadRow: UploadEligibilityRow | null = null;
  const uploadId = normalizeOptionalText(quoteRow?.upload_id ?? null);
  if (uploadId) {
    try {
      const { data, error } = await supabaseServer
        .from("uploads")
        .select("*")
        .eq("id", uploadId)
        .maybeSingle<UploadEligibilityRow>();
      if (!error && data) {
        uploadRow = data;
      }
    } catch (error) {
      if (!isMissingTableOrColumnError(error)) {
        console.warn("[provider eligibility] upload lookup crashed", {
          quoteId: normalizedId,
          uploadId,
          error: serializeSupabaseError(error) ?? error,
        });
      }
    }
  }

  return buildProviderEligibilityCriteria({
    process: uploadRow?.manufacturing_process ?? null,
    quantity: uploadRow?.quantity ?? null,
    shipTo: quoteRow?.ship_to ?? null,
    shippingPostalCode: uploadRow?.shipping_postal_code ?? null,
  });
}

export async function getEligibleProvidersForQuote(
  _quoteId: string,
  criteria: ProviderEligibilityCriteria,
  options?: {
    providers?: ProviderContactRow[];
    emailColumn?: ProviderEmailColumn | null;
  },
): Promise<EligibleProvidersForQuoteResult> {
  const normalizedCriteria = normalizeCriteria(criteria);
  const criteriaHasSignals = Boolean(
    normalizedCriteria.process ||
      normalizedCriteria.shipToState ||
      normalizedCriteria.shipToCountry,
  );

  let providers = options?.providers ?? [];
  let emailColumn = options?.emailColumn ?? null;

  if (!options?.providers) {
    const providerResult = await listProvidersWithContact();
    providers = providerResult.providers;
    emailColumn = providerResult.emailColumn;
  }

  const ranked: RankedProvider[] = providers.map((provider) => {
    const providerProcesses = normalizeProcesses(provider.processes);
    const providerCountry = normalizeCountry(provider.country);
    const providerStates = normalizeStates(provider.states);

    const processMatch = normalizedCriteria.process
      ? hasMatchingProcess(normalizedCriteria.process, providerProcesses)
      : false;
    const geoMatch =
      (normalizedCriteria.shipToCountry &&
        providerCountry &&
        normalizedCriteria.shipToCountry === providerCountry) ||
      (normalizedCriteria.shipToState && providerStates.has(normalizedCriteria.shipToState));
    const knownContact = buildKnownContactStatus({ provider, emailColumn });
    const verifiedActive = provider.is_active && provider.verification_status === "verified";

    const reasons: ProviderEligibilityReason[] = [];
    if (processMatch) reasons.push("process_match");
    if (geoMatch) reasons.push("geo_match");
    if (knownContact) reasons.push("known_contact");
    if (verifiedActive) reasons.push("verified_active");

    const eligible = isProviderEligible({
      criteriaHasSignals,
      processMatch,
      geoMatch,
    });

    return {
      providerId: provider.id,
      reasons,
      eligible,
      score: normalizeReasonScore(reasons),
      name: provider.name ?? "",
    };
  });

  ranked.sort((a, b) => {
    if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
    const scoreDiff = b.score - a.score;
    if (scoreDiff !== 0) return scoreDiff;
    const nameDiff = a.name.localeCompare(b.name);
    if (nameDiff !== 0) return nameDiff;
    return a.providerId.localeCompare(b.providerId);
  });

  const rankedProviders: ProviderEligibilityMatch[] = ranked.map(
    ({ providerId, reasons, eligible, score }) => ({
      providerId,
      reasons,
      eligible,
      score,
    }),
  );
  const eligibleProviderIds = rankedProviders
    .filter((match) => match.eligible)
    .map((match) => match.providerId);
  const rankedProviderIds = rankedProviders.map((match) => match.providerId);

  return {
    criteria: normalizedCriteria,
    rankedProviders,
    rankedProviderIds,
    eligibleProviderIds,
  };
}
