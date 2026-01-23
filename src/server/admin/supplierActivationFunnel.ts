import { supabaseServer } from "@/lib/supabaseServer";
import { requireAdminUser } from "@/server/auth";
import type { AdminLoaderResult } from "@/server/admin/types";
import { handleMissingSupabaseSchema, serializeSupabaseError } from "@/server/admin/logging";
import { hasColumns, schemaGate } from "@/server/db/schemaContract";

export type SupplierActivationWindow = "7d" | "30d";

export type SupplierActivationFunnel = {
  from: string;
  to: string;
  discovered_created: number;
  contacted: number;
  verified: number;
  active: number;
  directory_visible: number;
};

export type SupplierActivationSnapshot = {
  window: SupplierActivationWindow;
  funnel: SupplierActivationFunnel;
};

export type SupplierActivationSummary = {
  windows: Record<SupplierActivationWindow, SupplierActivationSnapshot>;
};

type ProviderRow = {
  id: string | null;
  created_at: string | null;
  source?: string | null;
  contacted_at?: string | null;
  verification_status?: string | null;
  is_active?: boolean | null;
  show_in_directory?: boolean | null;
};

type OpsEventRow = {
  event_type: string | null;
  created_at: string | null;
  payload: unknown;
};

type WindowSpec = {
  key: SupplierActivationWindow;
  days: number;
  from: string;
  to: string;
};

const DEFAULT_ERROR = "Unable to load supplier activation funnel.";

export async function loadAdminSupplierActivationFunnel(): Promise<
  AdminLoaderResult<SupplierActivationSummary>
> {
  await requireAdminUser();

  const nowMs = Date.now();
  const window30 = buildWindow("30d", 30, nowMs);
  const window7 = buildWindow("7d", 7, nowMs);

  const emptySummary: SupplierActivationSummary = {
    windows: {
      "7d": buildEmptySnapshot(window7),
      "30d": buildEmptySnapshot(window30),
    },
  };

  const providersSupported = await schemaGate({
    enabled: true,
    relation: "providers",
    requiredColumns: ["id", "created_at", "source", "verification_status", "is_active"],
    warnPrefix: "[supplier activation funnel]",
    warnKey: "supplier_activation:providers",
  });
  if (!providersSupported) {
    return { ok: false, data: emptySummary, error: DEFAULT_ERROR };
  }

  const [supportsContactedAt, supportsShowInDirectory] = await Promise.all([
    hasColumns("providers", ["contacted_at"]),
    hasColumns("providers", ["show_in_directory"]),
  ]);

  const selectColumns = [
    "id",
    "created_at",
    "source",
    "verification_status",
    "is_active",
    supportsContactedAt ? "contacted_at" : null,
    supportsShowInDirectory ? "show_in_directory" : null,
  ]
    .filter(Boolean)
    .join(",");

  let providers: ProviderRow[] = [];
  try {
    const { data, error } = await supabaseServer()
      .from("providers")
      .select(selectColumns)
      .eq("source", "discovered")
      .gte("created_at", window30.from)
      .lte("created_at", window30.to)
      .returns<ProviderRow[]>();

    if (error) {
      if (
        handleMissingSupabaseSchema({
          relation: "providers",
          error,
          warnPrefix: "[supplier activation funnel]",
          warnKey: "supplier_activation:providers_missing_schema",
        })
      ) {
        return { ok: false, data: emptySummary, error: DEFAULT_ERROR };
      }
      console.error("[supplier activation funnel] providers query failed", {
        error: serializeSupabaseError(error),
      });
      return { ok: false, data: emptySummary, error: DEFAULT_ERROR };
    }

    providers = Array.isArray(data) ? data : [];
  } catch (error) {
    if (
      handleMissingSupabaseSchema({
        relation: "providers",
        error,
        warnPrefix: "[supplier activation funnel]",
        warnKey: "supplier_activation:providers_missing_schema_crash",
      })
    ) {
      return { ok: false, data: emptySummary, error: DEFAULT_ERROR };
    }
    console.error("[supplier activation funnel] providers query crashed", {
      error: serializeSupabaseError(error) ?? error,
    });
    return { ok: false, data: emptySummary, error: DEFAULT_ERROR };
  }

  const providers7 = providers.filter((row) => isInWindow(row.created_at, window7.from));
  const providers30 = providers;

  const contactedByEvents = supportsContactedAt
    ? null
    : await loadContactedProviderIdsFromOpsEvents(window30.from);

  return {
    ok: true,
    data: {
      windows: {
        "7d": {
          window: "7d",
          funnel: computeFunnel(providers7, {
            supportsContactedAt,
            supportsShowInDirectory,
            contactedByEvents,
          }),
        },
        "30d": {
          window: "30d",
          funnel: computeFunnel(providers30, {
            supportsContactedAt,
            supportsShowInDirectory,
            contactedByEvents,
          }),
        },
      },
    },
    error: null,
  };
}

function computeFunnel(
  providers: ProviderRow[],
  opts: {
    supportsContactedAt: boolean;
    supportsShowInDirectory: boolean;
    contactedByEvents: Set<string> | null;
  },
): SupplierActivationFunnel {
  const ids = providers
    .map((row) => normalizeId(row?.id))
    .filter((id): id is string => Boolean(id));

  const discovered_created = ids.length;
  const contacted = providers.filter((row) => {
    if (opts.supportsContactedAt) {
      return Boolean(normalizeId(row?.contacted_at));
    }
    const id = normalizeId(row?.id);
    return id ? Boolean(opts.contactedByEvents?.has(id)) : false;
  }).length;

  const verified = providers.filter((row) => normalizeText(row?.verification_status) === "verified")
    .length;

  const active = providers.filter((row) => row?.is_active === true).length;

  const directory_visible = providers.filter((row) => {
    if (opts.supportsShowInDirectory) {
      return row?.show_in_directory === true;
    }
    return normalizeText(row?.verification_status) === "verified";
  }).length;

  const from = providers
    .map((row) => normalizeText(row?.created_at))
    .filter(Boolean)
    .sort()[0];

  const to = new Date().toISOString();

  return {
    from: from || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    to,
    discovered_created,
    contacted,
    verified,
    active,
    directory_visible,
  };
}

async function loadContactedProviderIdsFromOpsEvents(fromIso: string): Promise<Set<string>> {
  const out = new Set<string>();
  const supported = await schemaGate({
    enabled: true,
    relation: "ops_events",
    requiredColumns: ["event_type", "created_at", "payload"],
    warnPrefix: "[supplier activation funnel]",
    warnKey: "supplier_activation:ops_events",
  });
  if (!supported) return out;

  try {
    const { data, error } = await supabaseServer()
      .from("ops_events")
      .select("event_type,created_at,payload")
      .eq("event_type", "provider_contacted")
      .gte("created_at", fromIso)
      .returns<OpsEventRow[]>();

    if (error) {
      if (
        handleMissingSupabaseSchema({
          relation: "ops_events",
          error,
          warnPrefix: "[supplier activation funnel]",
          warnKey: "supplier_activation:ops_events_missing_schema",
        })
      ) {
        return out;
      }
      console.warn("[supplier activation funnel] ops_events query failed", {
        error: serializeSupabaseError(error),
      });
      return out;
    }

    for (const row of data ?? []) {
      const payload = isRecord(row?.payload) ? row.payload : null;
      const providerId = normalizeId(payload?.provider_id);
      if (providerId) out.add(providerId);
    }
    return out;
  } catch (error) {
    if (
      handleMissingSupabaseSchema({
        relation: "ops_events",
        error,
        warnPrefix: "[supplier activation funnel]",
        warnKey: "supplier_activation:ops_events_missing_schema_crash",
      })
    ) {
      return out;
    }
    console.warn("[supplier activation funnel] ops_events query crashed", {
      error: serializeSupabaseError(error) ?? error,
    });
    return out;
  }
}

function buildWindow(key: SupplierActivationWindow, days: number, nowMs: number): WindowSpec {
  const toMs = nowMs;
  const fromMs = toMs - days * 24 * 60 * 60 * 1000;
  return {
    key,
    days,
    from: new Date(fromMs).toISOString(),
    to: new Date(toMs).toISOString(),
  };
}

function buildEmptySnapshot(window: WindowSpec): SupplierActivationSnapshot {
  return {
    window: window.key,
    funnel: {
      from: window.from,
      to: window.to,
      discovered_created: 0,
      contacted: 0,
      verified: 0,
      active: 0,
      directory_visible: 0,
    },
  };
}

function isInWindow(createdAt: string | null | undefined, fromIso: string): boolean {
  const ms = parseIsoMs(createdAt);
  const fromMs = parseIsoMs(fromIso);
  if (!ms || !fromMs) return false;
  return ms >= fromMs;
}

function parseIsoMs(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function normalizeId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

