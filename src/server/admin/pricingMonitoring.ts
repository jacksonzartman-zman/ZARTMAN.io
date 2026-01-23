import { supabaseServer } from "@/lib/supabaseServer";
import { requireAdminUser } from "@/server/auth";
import type { AdminLoaderResult } from "@/server/admin/types";
import { handleMissingSupabaseSchema, serializeSupabaseError } from "@/server/admin/logging";
import { schemaGate } from "@/server/db/schemaContract";
import { hasPricingPriorsSchema } from "@/server/pricingPriors/schema";

export type PricingPriorsTechnologyCount = {
  technology: string;
  priorsCount: number;
};

export type PricingMissingCombo = {
  technology: string;
  material_canon: string;
  parts_bucket: string;
  count: number;
};

export type PricingMonitoringWindow = "7d" | "30d";

export type PricingMonitoringSummary = {
  priors: {
    supported: boolean;
    freshnessUpdatedAt: string | null;
    countsByTechnology: PricingPriorsTechnologyCount[];
    totalPriors: number;
  };
  missingCombinations: {
    supported: boolean;
    windows: Record<PricingMonitoringWindow, PricingMissingCombo[]>;
  };
};

const DEFAULT_ERROR = "Unable to load pricing monitoring.";
const MAX_MISSING_COMBOS = 12;
const MAX_OPS_EVENTS_SCAN = 5000;

type PricingPriorLite = {
  technology: string | null;
  material_canon: string | null;
  parts_bucket: string | null;
};

type PricingPriorFreshness = {
  updated_at: string | null;
};

type OpsEventRowLite = {
  payload: unknown;
  created_at: string | null;
};

type EstimateShownPayload = {
  process?: unknown;
  material_canon?: unknown;
  parts_bucket?: unknown;
};

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeNullableText(value: unknown): string | null {
  const s = normalizeText(value);
  return s.length > 0 ? s : null;
}

function isoDaysAgo(days: number): string {
  const nowMs = Date.now();
  const fromMs = nowMs - days * 24 * 60 * 60 * 1000;
  return new Date(fromMs).toISOString();
}

function keyString(key: { technology: string; material_canon: string; parts_bucket: string }): string {
  return `${key.technology}\u001f${key.material_canon}\u001f${key.parts_bucket}`;
}

function normalizeEstimateShownPayload(value: unknown): EstimateShownPayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as EstimateShownPayload;
}

function sortCountsByTechnology(rows: PricingPriorsTechnologyCount[]): PricingPriorsTechnologyCount[] {
  return [...rows].sort((a, b) => {
    if (b.priorsCount !== a.priorsCount) return b.priorsCount - a.priorsCount;
    return a.technology.localeCompare(b.technology);
  });
}

function sortMissingCombos(rows: PricingMissingCombo[]): PricingMissingCombo[] {
  return [...rows].sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    const ct = a.technology.localeCompare(b.technology);
    if (ct !== 0) return ct;
    const cm = a.material_canon.localeCompare(b.material_canon);
    if (cm !== 0) return cm;
    return a.parts_bucket.localeCompare(b.parts_bucket);
  });
}

export async function loadAdminPricingMonitoring(): Promise<AdminLoaderResult<PricingMonitoringSummary>> {
  await requireAdminUser();

  const empty: PricingMonitoringSummary = {
    priors: {
      supported: false,
      freshnessUpdatedAt: null,
      countsByTechnology: [],
      totalPriors: 0,
    },
    missingCombinations: {
      supported: false,
      windows: { "7d": [], "30d": [] },
    },
  };

  const priorsSupported = await hasPricingPriorsSchema();
  if (!priorsSupported) {
    return { ok: false, data: empty, error: DEFAULT_ERROR };
  }

  // ---------------------------------------------------------------------------
  // Priors: counts by technology + freshness timestamp (max updated_at).
  // ---------------------------------------------------------------------------
  let priorRows: PricingPriorLite[] = [];
  try {
    const { data, error } = await supabaseServer()
      .from("pricing_priors")
      .select("technology,material_canon,parts_bucket")
      .returns<PricingPriorLite[]>();

    if (error) {
      if (
        handleMissingSupabaseSchema({
          relation: "pricing_priors",
          error,
          warnPrefix: "[admin pricing]",
          warnKey: "admin_pricing:pricing_priors_missing_schema",
        })
      ) {
        return { ok: false, data: empty, error: DEFAULT_ERROR };
      }
      console.error("[admin pricing] pricing_priors query failed", {
        error: serializeSupabaseError(error),
      });
      return { ok: false, data: empty, error: DEFAULT_ERROR };
    }

    priorRows = Array.isArray(data) ? data : [];
  } catch (error) {
    if (
      handleMissingSupabaseSchema({
        relation: "pricing_priors",
        error,
        warnPrefix: "[admin pricing]",
        warnKey: "admin_pricing:pricing_priors_missing_schema_crash",
      })
    ) {
      return { ok: false, data: empty, error: DEFAULT_ERROR };
    }
    console.error("[admin pricing] pricing_priors query crashed", {
      error: serializeSupabaseError(error) ?? error,
    });
    return { ok: false, data: empty, error: DEFAULT_ERROR };
  }

  const countsByTech = new Map<string, number>();
  const priorKeySet = new Set<string>();
  let totalPriors = 0;
  for (const row of priorRows) {
    const technology = normalizeText(row?.technology);
    if (!technology) continue;
    totalPriors += 1;
    countsByTech.set(technology, (countsByTech.get(technology) ?? 0) + 1);

    const material = normalizeText(row?.material_canon);
    const bucket = normalizeText(row?.parts_bucket);
    priorKeySet.add(
      keyString({
        technology,
        material_canon: material,
        parts_bucket: bucket,
      }),
    );
  }

  const countsByTechnology: PricingPriorsTechnologyCount[] = sortCountsByTechnology(
    Array.from(countsByTech.entries()).map(([technology, priorsCount]) => ({
      technology,
      priorsCount,
    })),
  );

  let freshnessUpdatedAt: string | null = null;
  try {
    const { data, error } = await supabaseServer()
      .from("pricing_priors")
      .select("updated_at")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle<PricingPriorFreshness>();

    if (!error) {
      const candidate = normalizeNullableText(data?.updated_at);
      freshnessUpdatedAt = candidate;
    } else if (
      handleMissingSupabaseSchema({
        relation: "pricing_priors",
        error,
        warnPrefix: "[admin pricing]",
        warnKey: "admin_pricing:pricing_priors_freshness_missing_schema",
      })
    ) {
      // Leave null.
    } else {
      console.warn("[admin pricing] pricing_priors freshness query failed", {
        error: serializeSupabaseError(error),
      });
    }
  } catch (error) {
    if (
      handleMissingSupabaseSchema({
        relation: "pricing_priors",
        error,
        warnPrefix: "[admin pricing]",
        warnKey: "admin_pricing:pricing_priors_freshness_missing_schema_crash",
      })
    ) {
      // Leave null.
    } else {
      console.warn("[admin pricing] pricing_priors freshness query crashed", {
        error: serializeSupabaseError(error) ?? error,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Missing combinations: infer from ops_events (estimate_shown payload).
  // ---------------------------------------------------------------------------
  const opsEventsSupported = await schemaGate({
    enabled: true,
    relation: "ops_events",
    requiredColumns: ["event_type", "payload", "created_at"],
    warnPrefix: "[admin pricing]",
    warnKey: "admin_pricing:ops_events",
  });

  const missingWindows: Record<PricingMonitoringWindow, PricingMissingCombo[]> = {
    "7d": [],
    "30d": [],
  };

  if (!opsEventsSupported) {
    return {
      ok: true,
      data: {
        priors: {
          supported: true,
          freshnessUpdatedAt,
          countsByTechnology,
          totalPriors,
        },
        missingCombinations: {
          supported: false,
          windows: missingWindows,
        },
      },
      error: null,
    };
  }

  const loadMissingForWindow = async (window: PricingMonitoringWindow, days: number) => {
    const fromIso = isoDaysAgo(days);
    try {
      const { data, error } = await supabaseServer()
        .from("ops_events")
        .select("payload,created_at")
        .eq("event_type", "estimate_shown" as any)
        .gte("created_at", fromIso)
        .order("created_at", { ascending: false })
        .limit(MAX_OPS_EVENTS_SCAN)
        .returns<OpsEventRowLite[]>();

      if (error) {
        if (
          handleMissingSupabaseSchema({
            relation: "ops_events",
            error,
            warnPrefix: "[admin pricing]",
            warnKey: `admin_pricing:ops_events_missing_schema:${window}`,
          })
        ) {
          return [];
        }
        console.warn("[admin pricing] ops_events query failed", {
          window,
          error: serializeSupabaseError(error),
        });
        return [];
      }

      const missingCounts = new Map<string, PricingMissingCombo>();
      for (const row of data ?? []) {
        const payload = normalizeEstimateShownPayload(row?.payload);
        if (!payload) continue;

        const technology = normalizeNullableText(payload.process);
        const material = normalizeNullableText(payload.material_canon);
        const bucket = normalizeNullableText(payload.parts_bucket);
        if (!technology || !material || !bucket) continue;

        const key = keyString({ technology, material_canon: material, parts_bucket: bucket });
        if (priorKeySet.has(key)) continue;

        const existing = missingCounts.get(key);
        if (existing) {
          existing.count += 1;
        } else {
          missingCounts.set(key, { technology, material_canon: material, parts_bucket: bucket, count: 1 });
        }
      }

      return sortMissingCombos(Array.from(missingCounts.values())).slice(0, MAX_MISSING_COMBOS);
    } catch (error) {
      if (
        handleMissingSupabaseSchema({
          relation: "ops_events",
          error,
          warnPrefix: "[admin pricing]",
          warnKey: `admin_pricing:ops_events_missing_schema_crash:${window}`,
        })
      ) {
        return [];
      }
      console.warn("[admin pricing] ops_events query crashed", {
        window,
        error: serializeSupabaseError(error) ?? error,
      });
      return [];
    }
  };

  const [missing7, missing30] = await Promise.all([
    loadMissingForWindow("7d", 7),
    loadMissingForWindow("30d", 30),
  ]);
  missingWindows["7d"] = missing7;
  missingWindows["30d"] = missing30;

  return {
    ok: true,
    data: {
      priors: {
        supported: true,
        freshnessUpdatedAt,
        countsByTechnology,
        totalPriors,
      },
      missingCombinations: {
        supported: true,
        windows: missingWindows,
      },
    },
    error: null,
  };
}

