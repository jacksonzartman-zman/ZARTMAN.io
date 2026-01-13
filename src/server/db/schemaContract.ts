import { supabaseServer } from "@/lib/supabaseServer";
import {
  isMissingColumnError,
  isMissingSupabaseRelationError,
  isMissingTableOrColumnError,
  markSupabaseRelationMissing,
  warnOnce,
} from "@/server/db/schemaErrors";

export type RelationName = string;
export type ColumnName = string;

export type RelationProbeResult =
  | { ok: true; relation: string; columns?: string[] }
  | {
      ok: false;
      relation: string;
      reason: "missing_relation" | "missing_column" | "unknown";
      missing?: string[];
    };

type ProbeFailReason = "missing_relation" | "missing_column" | "unknown";

type RequireSchemaOpts = {
  relation: RelationName;
  requiredColumns?: ColumnName[];
  warnPrefix: string; // stable prefix for callers, ex: "[schema_contract]" or "[message_reads]"
  warnKey?: string; // optional stable dedupe key override
};

const PROBE_CACHE = new Map<string, RelationProbeResult>();
const IN_FLIGHT = new Map<string, Promise<RelationProbeResult>>();

function normalizeRelation(relation: unknown): string {
  return typeof relation === "string" ? relation.trim() : "";
}

function normalizeColumns(cols: unknown): string[] {
  const raw = Array.isArray(cols) ? cols : [];
  const normalized = raw
    .map((c) => (typeof c === "string" ? c.trim() : ""))
    .filter(Boolean);
  // Stable signature regardless of caller ordering.
  return Array.from(new Set(normalized)).sort((a, b) => a.localeCompare(b));
}

function signatureKey(relation: string, requiredColumns: string[]): string {
  return `${relation}::${requiredColumns.join(",")}`;
}

async function probeViaInformationSchema(args: {
  relation: string;
  requiredColumns: string[];
}): Promise<
  | { ok: true; columns: string[] }
  | { ok: false; reason: "no_rows" | "query_failed"; error?: unknown }
> {
  try {
    // Prefer information_schema for a schema-stable column list.
    // NOTE: In some Supabase/PostgREST configurations, information_schema may not be exposed;
    // if this fails for any reason, we fall back to the PostgREST head-select probe.
    const { data, error } = await supabaseServer
      .from("information_schema.columns" as any)
      .select("column_name")
      .eq("table_schema", "public")
      .eq("table_name", args.relation)
      .limit(500);

    if (error) {
      return { ok: false, reason: "query_failed", error };
    }

    const rows = Array.isArray(data) ? (data as Array<{ column_name?: unknown }>) : [];
    if (rows.length === 0) {
      return { ok: false, reason: "no_rows" };
    }

    const columns = rows
      .map((r) => (typeof r?.column_name === "string" ? r.column_name.trim() : ""))
      .filter(Boolean);
    return { ok: true, columns };
  } catch (error) {
    return { ok: false, reason: "query_failed", error };
  }
}

async function probeViaPostgrestHead(args: {
  relation: string;
  requiredColumns: string[];
}): Promise<{ ok: true } | { ok: false; reason: ProbeFailReason; missing?: string[] }> {
  try {
    const select =
      args.requiredColumns.length > 0 ? args.requiredColumns.join(",") : "*";

    const { error } = await supabaseServer
      .from(args.relation)
      // head-select: 0 rows, but validates relation + select string.
      .select(select as any, { head: true, count: "exact" })
      .limit(1);

    if (!error) {
      return { ok: true };
    }

    if (isMissingSupabaseRelationError(error)) {
      return { ok: false, reason: "missing_relation" };
    }

    if (args.requiredColumns.length > 0) {
      const missing = args.requiredColumns.filter((col) => isMissingColumnError(error, col));
      if (missing.length > 0) {
        return { ok: false, reason: "missing_column", missing };
      }
    }

    if (isMissingTableOrColumnError(error)) {
      // Drift, but we couldn't confidently classify which column.
      return { ok: false, reason: "unknown" };
    }

    return { ok: false, reason: "unknown" };
  } catch (error) {
    if (isMissingSupabaseRelationError(error)) {
      return { ok: false, reason: "missing_relation" };
    }
    if (args.requiredColumns.length > 0) {
      const missing = args.requiredColumns.filter((col) => isMissingColumnError(error, col));
      if (missing.length > 0) {
        return { ok: false, reason: "missing_column", missing };
      }
    }
    if (isMissingTableOrColumnError(error)) {
      return { ok: false, reason: "unknown" };
    }
    return { ok: false, reason: "unknown" };
  }
}

/**
 * Manual verification checklist:
 * - With feature flag disabled: zero calls to the relation (no probe, no query).
 * - With flag enabled but relation missing: exactly one warning per process, then no further calls.
 * - With relation present: behavior unchanged (no logs on success).
 */
export async function requireSchema(opts: RequireSchemaOpts): Promise<RelationProbeResult> {
  const relation = normalizeRelation(opts.relation);
  const requiredColumns = normalizeColumns(opts.requiredColumns);

  if (!relation) {
    const result: RelationProbeResult = { ok: false, relation: "", reason: "unknown" };
    return result;
  }

  const key = signatureKey(relation, requiredColumns);
  const cached = PROBE_CACHE.get(key);
  if (cached) return cached;

  const existingInFlight = IN_FLIGHT.get(key);
  if (existingInFlight) return await existingInFlight;

  const promise = (async (): Promise<RelationProbeResult> => {
    // 1) Prefer information_schema for column introspection.
    const info = await probeViaInformationSchema({ relation, requiredColumns });
    if (info.ok) {
      const colSet = new Set(info.columns.map((c) => c.toLowerCase()));
      if (requiredColumns.length > 0) {
        const missing = requiredColumns.filter((c) => !colSet.has(c.toLowerCase()));
        if (missing.length > 0) {
          const result: RelationProbeResult = {
            ok: false,
            relation,
            reason: "missing_column",
            missing,
          };
          const warnKey = opts.warnKey ?? `schema_contract:${key}`;
          warnOnce(warnKey, `${opts.warnPrefix} missing schema`, {
            relation,
            reason: result.reason,
            missing: result.missing,
          });
          return result;
        }
      }

      const result: RelationProbeResult = {
        ok: true,
        relation,
        columns: requiredColumns.length > 0 ? requiredColumns : undefined,
      };
      return result;
    }

    if (info.reason === "no_rows") {
      const result: RelationProbeResult = { ok: false, relation, reason: "missing_relation" };
      // Align with legacy relation-missing caching to avoid future queries elsewhere.
      markSupabaseRelationMissing(relation);
      const warnKey = opts.warnKey ?? `schema_contract:${key}`;
      warnOnce(warnKey, `${opts.warnPrefix} missing schema`, {
        relation,
        reason: result.reason,
      });
      return result;
    }

    // 2) Fall back: PostgREST head-select to validate relation and requested columns.
    const head = await probeViaPostgrestHead({ relation, requiredColumns });
    if (head.ok) {
      return { ok: true, relation, columns: requiredColumns.length > 0 ? requiredColumns : undefined };
    }

    if (head.reason === "missing_relation") {
      markSupabaseRelationMissing(relation);
    }

    const result: RelationProbeResult = {
      ok: false,
      relation,
      reason: head.reason,
      missing: head.missing,
    };

    const warnKey = opts.warnKey ?? `schema_contract:${key}`;
    warnOnce(warnKey, `${opts.warnPrefix} missing schema`, {
      relation,
      reason: result.reason,
      missing: result.missing,
    });

    return result;
  })()
    .finally(() => {
      IN_FLIGHT.delete(key);
    });

  IN_FLIGHT.set(key, promise);
  const resolved = await promise;
  PROBE_CACHE.set(key, resolved);
  return resolved;
}

export async function hasRelation(relation: RelationName): Promise<boolean> {
  const result = await requireSchema({
    relation,
    warnPrefix: "[schema_contract]",
  });
  return result.ok;
}

export async function hasColumns(relation: RelationName, cols: ColumnName[]): Promise<boolean> {
  const requiredColumns = normalizeColumns(cols);
  const result = await requireSchema({
    relation,
    requiredColumns,
    warnPrefix: "[schema_contract]",
  });
  return result.ok;
}

export async function schemaGate(opts: {
  enabled: boolean;
  relation: RelationName;
  requiredColumns?: ColumnName[];
  warnPrefix: string;
  warnKey?: string;
}): Promise<boolean> {
  if (!opts.enabled) return false;
  const result = await requireSchema({
    relation: opts.relation,
    requiredColumns: opts.requiredColumns,
    warnPrefix: opts.warnPrefix,
    warnKey: opts.warnKey,
  });
  return result.ok;
}

