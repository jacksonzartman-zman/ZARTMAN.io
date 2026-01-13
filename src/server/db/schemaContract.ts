import { supabaseServer } from "@/lib/supabaseServer";
import {
  isMissingSupabaseRelationError,
  isMissingTableOrColumnError,
  isRowLevelSecurityDeniedError,
  markSupabaseRelationMissing,
  serializeSupabaseError,
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

function schemaContractUseInfoSchema(): boolean {
  return String(process.env.SCHEMA_CONTRACT_USE_INFO_SCHEMA ?? "")
    .trim()
    .toLowerCase() === "true";
}

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

function normalizeErrorText(error: unknown): string {
  const serialized = serializeSupabaseError(error);
  const parts = [serialized.message, serialized.details, serialized.hint]
    .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    .map((v) => v.toLowerCase());
  return parts.join(" ");
}

function isMissingColumnSignal(error: unknown): boolean {
  const serialized = serializeSupabaseError(error);
  if (serialized.code === "42703") return true; // undefined_column

  // PostgREST can wrap undefined_column under PGRST205 schema cache errors.
  if (serialized.code === "PGRST205") {
    const text = normalizeErrorText(error);
    return text.includes("column") && (text.includes("not found") || text.includes("does not exist"));
  }

  const text = normalizeErrorText(error);
  return text.includes("undefined_column") || (text.includes("column") && text.includes("does not exist"));
}

async function probeRelationExists(args: {
  relation: string;
}): Promise<{ ok: true } | { ok: false; reason: ProbeFailReason }> {
  try {
    // Fast path: most tables have an `id` column.
    const { error: idError } = await supabaseServer
      .from(args.relation)
      .select("id" as any, { head: true, count: "exact" })
      .limit(1);

    if (!idError) return { ok: true };

    if (isMissingSupabaseRelationError(idError)) {
      return { ok: false, reason: "missing_relation" };
    }

    if (isRowLevelSecurityDeniedError(idError)) {
      // Relation exists, but RLS/privileges block probing. Do not mark missing.
      return { ok: true };
    }

    // If `id` isn't a column here, fall back to a minimal head-select.
    if (isMissingColumnSignal(idError)) {
      const { error: starError } = await supabaseServer
        .from(args.relation)
        .select("*" as any, { head: true, count: "exact" })
        .limit(1);

      if (!starError) return { ok: true };
      if (isMissingSupabaseRelationError(starError)) {
        return { ok: false, reason: "missing_relation" };
      }
      if (isRowLevelSecurityDeniedError(starError)) {
        return { ok: true };
      }
      return { ok: false, reason: "unknown" };
    }

    return { ok: false, reason: "unknown" };
  } catch (error) {
    if (isMissingSupabaseRelationError(error)) {
      return { ok: false, reason: "missing_relation" };
    }
    if (isRowLevelSecurityDeniedError(error)) {
      return { ok: true };
    }
    return { ok: false, reason: "unknown" };
  }
}

async function probeColumnsExist(args: {
  relation: string;
  requiredColumns: string[];
}): Promise<{ ok: true } | { ok: false; reason: ProbeFailReason; missing?: string[] }> {
  if (args.requiredColumns.length === 0) {
    return await probeRelationExists({ relation: args.relation });
  }

  const select = args.requiredColumns.join(",");

  const probeIndividually = async (): Promise<
    { ok: true } | { ok: false; reason: ProbeFailReason; missing?: string[] }
  > => {
    const missing: string[] = [];
    for (const col of args.requiredColumns) {
      try {
        const { error: colError } = await supabaseServer
          .from(args.relation)
          .select(col as any, { head: true, count: "exact" })
          .limit(1);

        if (!colError) continue;
        if (isMissingSupabaseRelationError(colError)) {
          return { ok: false, reason: "missing_relation" };
        }
        if (isRowLevelSecurityDeniedError(colError)) {
          // If RLS blocks the probe, treat as "exists" for schema gating.
          return { ok: true };
        }
        if (isMissingColumnSignal(colError)) {
          missing.push(col);
          continue;
        }
        // Unknown error for this column; don't mark missing.
        return { ok: false, reason: "unknown" };
      } catch (colError) {
        if (isMissingSupabaseRelationError(colError)) {
          return { ok: false, reason: "missing_relation" };
        }
        if (isRowLevelSecurityDeniedError(colError)) {
          return { ok: true };
        }
        return { ok: false, reason: "unknown" };
      }
    }

    if (missing.length > 0) {
      return { ok: false, reason: "missing_column", missing };
    }

    // We got a "missing column" signal, but couldn't repro any single-column drift.
    // Treat as unknown (likely select syntax / embedding / permissions edge case).
    return { ok: false, reason: "unknown" };
  };

  try {
    const { error } = await supabaseServer
      .from(args.relation)
      .select(select as any, { head: true, count: "exact" })
      .limit(1);

    if (!error) {
      return { ok: true };
    }

    if (isMissingSupabaseRelationError(error)) {
      return { ok: false, reason: "missing_relation" };
    }

    if (isRowLevelSecurityDeniedError(error)) {
      // Can't verify columns, but also shouldn't mark missing.
      return { ok: true };
    }

    // Deterministic missing-column classification: fall back to per-column probes
    // when we get a column-missing signal but can't reliably extract which one.
    if (isMissingColumnSignal(error) || isMissingTableOrColumnError(error)) {
      return await probeIndividually();
    }

    return { ok: false, reason: "unknown" };
  } catch (error) {
    if (isMissingSupabaseRelationError(error)) {
      return { ok: false, reason: "missing_relation" };
    }
    if (isRowLevelSecurityDeniedError(error)) {
      return { ok: true };
    }
    if (isMissingColumnSignal(error) || isMissingTableOrColumnError(error)) {
      return await probeIndividually();
    }
    return { ok: false, reason: "unknown" };
  }
}

/**
 * Manual verification checklist:
 * - Default: zero calls to /rest/v1/information_schema.*.
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
    // Default behavior: probe via PostgREST-native head selects only.
    // Optional: information_schema probe is gated behind SCHEMA_CONTRACT_USE_INFO_SCHEMA=true.
    if (schemaContractUseInfoSchema()) {
      try {
        const { data, error } = await supabaseServer
          .from("information_schema.columns" as any)
          .select("column_name")
          .eq("table_schema", "public")
          .eq("table_name", relation)
          .limit(500);

        if (!error && Array.isArray(data) && data.length > 0) {
          const columns = (data as Array<{ column_name?: unknown }>)
            .map((r) => (typeof r?.column_name === "string" ? r.column_name.trim() : ""))
            .filter(Boolean);

          const colSet = new Set(columns.map((c) => c.toLowerCase()));
          if (requiredColumns.length > 0) {
            const missing = requiredColumns.filter((c) => !colSet.has(c.toLowerCase()));
            if (missing.length > 0) {
              const result: RelationProbeResult = {
                ok: false,
                relation,
                reason: "missing_column",
                missing,
              };
              const warnKey = `${opts.warnKey ?? `schema_contract:${relation}`}:${result.reason}`;
              warnOnce(warnKey, `${opts.warnPrefix} missing schema`, {
                relation,
                reason: result.reason,
                missing: result.missing,
              });
              return result;
            }
          }

          return {
            ok: true,
            relation,
            columns: requiredColumns.length > 0 ? requiredColumns : undefined,
          };
        }
      } catch {
        // Ignore and fall through to PostgREST-native probes.
      }
    }

    const head = await probeColumnsExist({ relation, requiredColumns });
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

    const warnKey = `${opts.warnKey ?? `schema_contract:${relation}`}:${result.reason}`;
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

