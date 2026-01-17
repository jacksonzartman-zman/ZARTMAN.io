import { DEFAULT_SLA_CONFIG, type SlaConfig } from "@/lib/ops/sla";
import { supabaseServer } from "@/lib/supabaseServer";
import {
  handleMissingSupabaseSchema,
  serializeSupabaseError,
} from "@/server/admin/logging";
import { schemaGate } from "@/server/db/schemaContract";

const OPS_SETTINGS_TABLE = "ops_settings";
const OPS_SETTINGS_SELECT = "id,queued_max_hours,sent_no_reply_max_hours,updated_at";
const OPS_SETTINGS_COLUMNS = [
  "id",
  "queued_max_hours",
  "sent_no_reply_max_hours",
  "updated_at",
];

type OpsSettingsRow = {
  id: string | null;
  queued_max_hours: number | null;
  sent_no_reply_max_hours: number | null;
  updated_at: string | null;
};

export type OpsSlaSettings = {
  config: SlaConfig;
  rowId: string | null;
  updatedAt: string | null;
  usingFallback: boolean;
};

const FALLBACK_SETTINGS: OpsSlaSettings = {
  config: DEFAULT_SLA_CONFIG,
  rowId: null,
  updatedAt: null,
  usingFallback: true,
};

export async function getOpsSlaConfig(): Promise<SlaConfig> {
  const settings = await getOpsSlaSettings();
  return settings.config;
}

export async function getOpsSlaSettings(): Promise<OpsSlaSettings> {
  const supported = await schemaGate({
    enabled: true,
    relation: OPS_SETTINGS_TABLE,
    requiredColumns: OPS_SETTINGS_COLUMNS,
    warnPrefix: "[ops settings]",
  });

  if (!supported) {
    return FALLBACK_SETTINGS;
  }

  try {
    const { data, error } = await supabaseServer
      .from(OPS_SETTINGS_TABLE)
      .select(OPS_SETTINGS_SELECT)
      .order("updated_at", { ascending: false })
      .limit(1)
      .returns<OpsSettingsRow[]>();

    if (error) {
      if (
        handleMissingSupabaseSchema({
          relation: OPS_SETTINGS_TABLE,
          error,
          warnPrefix: "[ops settings]",
          warnKey: "ops_settings:missing_schema",
        })
      ) {
        return FALLBACK_SETTINGS;
      }
      console.warn("[ops settings] query failed", {
        error: serializeSupabaseError(error),
      });
      return FALLBACK_SETTINGS;
    }

    const row = Array.isArray(data) ? data[0] ?? null : null;
    if (!row) {
      return {
        config: DEFAULT_SLA_CONFIG,
        rowId: null,
        updatedAt: null,
        usingFallback: false,
      };
    }

    const queuedMaxHours = normalizeHours(
      row.queued_max_hours,
      DEFAULT_SLA_CONFIG.queuedMaxHours,
    );
    const sentNoReplyMaxHours = normalizeHours(
      row.sent_no_reply_max_hours,
      DEFAULT_SLA_CONFIG.sentNoReplyMaxHours,
    );

    return {
      config: {
        queuedMaxHours,
        sentNoReplyMaxHours,
        errorAlwaysNeedsAction: DEFAULT_SLA_CONFIG.errorAlwaysNeedsAction,
      },
      rowId: normalizeId(row.id),
      updatedAt: normalizeOptionalString(row.updated_at),
      usingFallback: false,
    };
  } catch (error) {
    if (
      handleMissingSupabaseSchema({
        relation: OPS_SETTINGS_TABLE,
        error,
        warnPrefix: "[ops settings]",
        warnKey: "ops_settings:missing_schema",
      })
    ) {
      return FALLBACK_SETTINGS;
    }
    console.warn("[ops settings] query crashed", {
      error: serializeSupabaseError(error) ?? error,
    });
    return FALLBACK_SETTINGS;
  }
}

export type UpsertOpsSlaSettingsResult =
  | { ok: true }
  | { ok: false; error: string };

export async function upsertOpsSlaSettings(input: {
  queuedMaxHours: number;
  sentNoReplyMaxHours: number;
}): Promise<UpsertOpsSlaSettingsResult> {
  const supported = await schemaGate({
    enabled: true,
    relation: OPS_SETTINGS_TABLE,
    requiredColumns: OPS_SETTINGS_COLUMNS,
    warnPrefix: "[ops settings]",
  });

  if (!supported) {
    return { ok: false, error: "Ops settings table is unavailable." };
  }

  const payload = {
    queued_max_hours: Math.round(input.queuedMaxHours),
    sent_no_reply_max_hours: Math.round(input.sentNoReplyMaxHours),
    updated_at: new Date().toISOString(),
  };

  try {
    const { data, error } = await supabaseServer
      .from(OPS_SETTINGS_TABLE)
      .select("id,updated_at")
      .order("updated_at", { ascending: false })
      .limit(1)
      .returns<Array<{ id: string | null }>>();

    if (error) {
      if (
        handleMissingSupabaseSchema({
          relation: OPS_SETTINGS_TABLE,
          error,
          warnPrefix: "[ops settings]",
          warnKey: "ops_settings:missing_schema",
        })
      ) {
        return { ok: false, error: "Ops settings table is unavailable." };
      }
      console.warn("[ops settings] load failed", {
        error: serializeSupabaseError(error),
      });
      return { ok: false, error: "Unable to load ops settings." };
    }

    const existingId = normalizeId(Array.isArray(data) ? data[0]?.id : null);
    if (existingId) {
      const { error: updateError } = await supabaseServer
        .from(OPS_SETTINGS_TABLE)
        .update(payload)
        .eq("id", existingId);
      if (updateError) {
        if (
          handleMissingSupabaseSchema({
            relation: OPS_SETTINGS_TABLE,
            error: updateError,
            warnPrefix: "[ops settings]",
            warnKey: "ops_settings:missing_schema",
          })
        ) {
          return { ok: false, error: "Ops settings table is unavailable." };
        }
        console.warn("[ops settings] update failed", {
          error: serializeSupabaseError(updateError),
        });
        return { ok: false, error: "Unable to update ops settings." };
      }
    } else {
      const { error: insertError } = await supabaseServer
        .from(OPS_SETTINGS_TABLE)
        .insert(payload);
      if (insertError) {
        if (
          handleMissingSupabaseSchema({
            relation: OPS_SETTINGS_TABLE,
            error: insertError,
            warnPrefix: "[ops settings]",
            warnKey: "ops_settings:missing_schema",
          })
        ) {
          return { ok: false, error: "Ops settings table is unavailable." };
        }
        console.warn("[ops settings] insert failed", {
          error: serializeSupabaseError(insertError),
        });
        return { ok: false, error: "Unable to update ops settings." };
      }
    }

    return { ok: true };
  } catch (error) {
    if (
      handleMissingSupabaseSchema({
        relation: OPS_SETTINGS_TABLE,
        error,
        warnPrefix: "[ops settings]",
        warnKey: "ops_settings:missing_schema",
      })
    ) {
      return { ok: false, error: "Ops settings table is unavailable." };
    }
    console.warn("[ops settings] save crashed", {
      error: serializeSupabaseError(error) ?? error,
    });
    return { ok: false, error: "Unable to update ops settings." };
  }
}

function normalizeId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeHours(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.round(value);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return fallback;
    const parsed = Number(trimmed);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return Math.round(parsed);
    }
  }
  return fallback;
}
