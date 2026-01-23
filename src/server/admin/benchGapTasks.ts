import { supabaseServer } from "@/lib/supabaseServer";
import { requireAdminUser } from "@/server/auth";
import { schemaGate } from "@/server/db/schemaContract";
import {
  isMissingTableOrColumnError,
  serializeSupabaseError,
  warnOnce,
} from "@/server/admin/logging";

export type BenchGapTaskStatus = "open" | "in_progress" | "closed";
export type BenchGapTaskDimension = "process" | "material" | "location";

export type BenchGapTaskRecord = {
  id: string;
  dimension: BenchGapTaskDimension;
  key: string;
  window: string;
  status: BenchGapTaskStatus;
  owner: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

type BenchGapTaskRow = {
  id: string | null;
  dimension: string | null;
  gap_key: string | null;
  window: string | null;
  status: string | null;
  owner: string | null;
  notes: string | null;
  created_at: string | null;
  updated_at: string | null;
};

const RELATION = "bench_gap_tasks";
const WARN_PREFIX = "[bench gap tasks]";

function normalizeId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeDimension(value: unknown): BenchGapTaskDimension | null {
  const v = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (v === "process" || v === "material" || v === "location") return v;
  return null;
}

function normalizeStatus(value: unknown): BenchGapTaskStatus | null {
  const v = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (v === "open" || v === "in_progress" || v === "closed") return v;
  return null;
}

function normalizeWindow(value: unknown): string | null {
  const v = typeof value === "string" ? value.trim() : "";
  return v ? v : null;
}

function normalizeRow(row: BenchGapTaskRow): BenchGapTaskRecord | null {
  const id = normalizeId(row?.id);
  const dimension = normalizeDimension(row?.dimension);
  const key = normalizeText(row?.gap_key);
  const window = normalizeWindow(row?.window);
  const status = normalizeStatus(row?.status) ?? "open";
  if (!id || !dimension || !key || !window) return null;

  return {
    id,
    dimension,
    key,
    window,
    status,
    owner: normalizeText(row?.owner),
    notes: normalizeText(row?.notes),
    created_at: row?.created_at ?? new Date().toISOString(),
    updated_at: row?.updated_at ?? new Date().toISOString(),
  };
}

export async function benchGapTasksSupported(): Promise<boolean> {
  return await schemaGate({
    enabled: true,
    relation: RELATION,
    requiredColumns: ["dimension", "gap_key", "window", "status", "created_at", "updated_at"],
    warnPrefix: WARN_PREFIX,
    warnKey: "bench_gap_tasks:schema_gate",
  });
}

export async function getBenchGapTask(args: {
  dimension: BenchGapTaskDimension;
  key: string;
  window: string;
}): Promise<BenchGapTaskRecord | null> {
  await requireAdminUser();

  const supported = await benchGapTasksSupported();
  if (!supported) return null;

  const dimension = normalizeDimension(args.dimension);
  const key = normalizeText(args.key);
  const window = normalizeWindow(args.window);
  if (!dimension || !key || !window) return null;

  try {
    const { data, error } = await supabaseServer()
      .from(RELATION)
      .select("id,dimension,gap_key,window,status,owner,notes,created_at,updated_at")
      .eq("dimension", dimension)
      .eq("gap_key", key)
      .eq("window", window)
      .maybeSingle<BenchGapTaskRow>();

    if (error) {
      if (isMissingTableOrColumnError(error)) {
        return null;
      }
      console.warn("[bench gap tasks] get failed", {
        dimension,
        key,
        window,
        error: serializeSupabaseError(error) ?? error,
      });
      return null;
    }

    return data ? normalizeRow(data) : null;
  } catch (error) {
    if (isMissingTableOrColumnError(error)) {
      return null;
    }
    console.warn("[bench gap tasks] get crashed", {
      dimension,
      key,
      window,
      error: serializeSupabaseError(error) ?? error,
    });
    return null;
  }
}

export async function listBenchGapTasks(args?: {
  dimension?: BenchGapTaskDimension | "all" | null;
  status?: BenchGapTaskStatus | "all" | null;
  window?: string | "all" | null;
  q?: string | null;
  limit?: number;
}): Promise<{ supported: boolean; tasks: BenchGapTaskRecord[] }> {
  await requireAdminUser();

  const supported = await benchGapTasksSupported();
  if (!supported) {
    return { supported: false, tasks: [] };
  }

  const dimension = args?.dimension && args.dimension !== "all" ? args.dimension : null;
  const status = args?.status && args.status !== "all" ? args.status : null;
  const window = args?.window && args.window !== "all" ? normalizeWindow(args.window) : null;
  const q = normalizeText(args?.q) ?? null;
  const limit = typeof args?.limit === "number" && Number.isFinite(args.limit) ? args.limit : 200;
  const safeLimit = Math.max(1, Math.min(500, Math.floor(limit)));

  try {
    let query = supabaseServer()
      .from(RELATION)
      .select("id,dimension,gap_key,window,status,owner,notes,created_at,updated_at")
      .order("updated_at", { ascending: false })
      .limit(safeLimit);

    if (dimension) query = query.eq("dimension", dimension);
    if (status) query = query.eq("status", status);
    if (window) query = query.eq("window", window);
    if (q) query = query.ilike("gap_key", `%${q}%`);

    const { data, error } = await query.returns<BenchGapTaskRow[]>();

    if (error) {
      if (isMissingTableOrColumnError(error)) {
        return { supported: false, tasks: [] };
      }
      console.warn("[bench gap tasks] list failed", {
        error: serializeSupabaseError(error) ?? error,
      });
      return { supported: true, tasks: [] };
    }

    const tasks = (Array.isArray(data) ? data : [])
      .map((row) => normalizeRow(row))
      .filter((row): row is BenchGapTaskRecord => Boolean(row));

    return { supported: true, tasks };
  } catch (error) {
    if (isMissingTableOrColumnError(error)) {
      return { supported: false, tasks: [] };
    }
    console.warn("[bench gap tasks] list crashed", {
      error: serializeSupabaseError(error) ?? error,
    });
    return { supported: true, tasks: [] };
  }
}

export async function listBenchGapTasksByKeys(args: {
  dimension: BenchGapTaskDimension;
  keys: string[];
  windows: string[];
}): Promise<{ supported: boolean; byCompositeKey: Map<string, BenchGapTaskRecord> }> {
  await requireAdminUser();

  const supported = await benchGapTasksSupported();
  const byCompositeKey = new Map<string, BenchGapTaskRecord>();
  if (!supported) return { supported: false, byCompositeKey };

  const dimension = normalizeDimension(args.dimension);
  const keys = Array.from(new Set((args.keys ?? []).map((v) => normalizeText(v)).filter(Boolean)));
  const windows = Array.from(
    new Set((args.windows ?? []).map((v) => normalizeWindow(v)).filter(Boolean)),
  );
  if (!dimension || keys.length === 0 || windows.length === 0) {
    return { supported: true, byCompositeKey };
  }

  try {
    const { data, error } = await supabaseServer()
      .from(RELATION)
      .select("id,dimension,gap_key,window,status,owner,notes,created_at,updated_at")
      .eq("dimension", dimension)
      .in("gap_key", keys)
      .in("window", windows)
      .limit(Math.min(500, keys.length * windows.length))
      .returns<BenchGapTaskRow[]>();

    if (error) {
      if (isMissingTableOrColumnError(error)) {
        return { supported: false, byCompositeKey };
      }
      console.warn("[bench gap tasks] list keys failed", {
        dimension,
        keysCount: keys.length,
        windows,
        error: serializeSupabaseError(error) ?? error,
      });
      return { supported: true, byCompositeKey };
    }

    for (const row of Array.isArray(data) ? data : []) {
      const normalized = normalizeRow(row);
      if (!normalized) continue;
      byCompositeKey.set(compositeKey(normalized), normalized);
    }

    return { supported: true, byCompositeKey };
  } catch (error) {
    if (isMissingTableOrColumnError(error)) {
      return { supported: false, byCompositeKey };
    }
    console.warn("[bench gap tasks] list keys crashed", {
      dimension,
      error: serializeSupabaseError(error) ?? error,
    });
    return { supported: true, byCompositeKey };
  }
}

export function compositeKey(args: {
  dimension: BenchGapTaskDimension;
  key: string;
  window: string;
}): string {
  return `${args.dimension}:${args.window}:${args.key}`;
}

export async function createBenchGapTask(args: {
  dimension: BenchGapTaskDimension;
  key: string;
  window: string;
  owner?: string | null;
  notes?: string | null;
}): Promise<{ ok: true; task: BenchGapTaskRecord } | { ok: false; error: string }> {
  await requireAdminUser();

  const supported = await benchGapTasksSupported();
  if (!supported) {
    return { ok: false, error: "bench_gap_tasks unsupported" };
  }

  const dimension = normalizeDimension(args.dimension);
  const key = normalizeText(args.key);
  const window = normalizeWindow(args.window);
  if (!dimension || !key || !window) {
    return { ok: false, error: "invalid input" };
  }

  const owner = normalizeText(args.owner);
  const notes = normalizeText(args.notes);

  try {
    const { data, error } = await supabaseServer()
      .from(RELATION)
      .upsert(
        {
          dimension,
          gap_key: key,
          window,
          status: "open",
          owner,
          notes,
        },
        { onConflict: "dimension,gap_key,window" },
      )
      .select("id,dimension,gap_key,window,status,owner,notes,created_at,updated_at")
      .maybeSingle<BenchGapTaskRow>();

    if (error) {
      if (isMissingTableOrColumnError(error)) {
        return { ok: false, error: "bench_gap_tasks missing" };
      }
      console.error("[bench gap tasks] create failed", {
        dimension,
        key,
        window,
        error: serializeSupabaseError(error) ?? error,
      });
      return { ok: false, error: "Unable to create task" };
    }

    const normalized = data ? normalizeRow(data) : null;
    if (!normalized) {
      return { ok: false, error: "Unable to create task" };
    }

    return { ok: true, task: normalized };
  } catch (error) {
    if (isMissingTableOrColumnError(error)) {
      return { ok: false, error: "bench_gap_tasks missing" };
    }
    console.error("[bench gap tasks] create crashed", {
      dimension,
      key,
      window,
      error: serializeSupabaseError(error) ?? error,
    });
    return { ok: false, error: "Unable to create task" };
  }
}

export async function updateBenchGapTaskStatus(args: {
  id: string;
  status: BenchGapTaskStatus;
}): Promise<{ ok: true; task: BenchGapTaskRecord } | { ok: false; error: string }> {
  await requireAdminUser();

  const supported = await benchGapTasksSupported();
  if (!supported) {
    return { ok: false, error: "bench_gap_tasks unsupported" };
  }

  const id = normalizeId(args.id);
  const status = normalizeStatus(args.status);
  if (!id || !status) return { ok: false, error: "invalid input" };

  try {
    const { data, error } = await supabaseServer()
      .from(RELATION)
      .update({ status })
      .eq("id", id)
      .select("id,dimension,gap_key,window,status,owner,notes,created_at,updated_at")
      .maybeSingle<BenchGapTaskRow>();

    if (error) {
      if (isMissingTableOrColumnError(error)) {
        return { ok: false, error: "bench_gap_tasks missing" };
      }
      console.error("[bench gap tasks] status update failed", {
        id,
        status,
        error: serializeSupabaseError(error) ?? error,
      });
      return { ok: false, error: "Unable to update task" };
    }

    const normalized = data ? normalizeRow(data) : null;
    if (!normalized) {
      return { ok: false, error: "Unable to update task" };
    }

    return { ok: true, task: normalized };
  } catch (error) {
    if (isMissingTableOrColumnError(error)) {
      return { ok: false, error: "bench_gap_tasks missing" };
    }
    console.error("[bench gap tasks] status update crashed", {
      id,
      status,
      error: serializeSupabaseError(error) ?? error,
    });
    return { ok: false, error: "Unable to update task" };
  }
}

export async function bestEffortWarnIfUnsupported(): Promise<void> {
  const supported = await benchGapTasksSupported();
  if (supported) return;
  warnOnce("bench_gap_tasks:unsupported", "[bench gap tasks] unsupported; skipping", {});
}

