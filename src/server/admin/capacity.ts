import { supabaseServer } from "@/lib/supabaseServer";
import { requireAdminUser } from "@/server/auth";
import {
  isMissingTableOrColumnError,
  serializeSupabaseError,
} from "@/server/admin/logging";
import type { AdminLoaderResult } from "@/server/admin/types";

const SNAPSHOTS_TABLE = "supplier_capacity_snapshots" as const;
const SUPPLIERS_TABLE = "suppliers" as const;

export const CAPACITY_CAPABILITY_UNIVERSE = [
  "cnc_mill",
  "cnc_lathe",
  "mjp",
  "sla",
] as const;

export type CapacityCapability = (typeof CAPACITY_CAPABILITY_UNIVERSE)[number];

export type CapacityLevel =
  | "low"
  | "medium"
  | "high"
  | "unavailable"
  | "overloaded";

export type CapacitySnapshot = {
  supplier_id: string;
  capability: string;
  capacity_level: CapacityLevel | string;
  created_at: string;
};

export type CapacityBySupplierMap = Record<string, CapacitySnapshot[]>;

export type AdminCapacityLevel = CapacityLevel;

export type AdminCapacitySnapshotRow = {
  supplier_id: string;
  week_start_date: string; // YYYY-MM-DD
  capability: string;
  capacity_level: AdminCapacityLevel;
  created_at: string;
  supplier: { company_name: string | null } | null;
};

export type AdminCapacitySupplierRow = {
  id: string;
  company_name: string | null;
};

function normalizeDate(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : "";
}

function normalizeId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeIds(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const normalized = values
    .map((value) => normalizeId(value))
    .filter((value): value is string => Boolean(value));
  return Array.from(new Set(normalized));
}

function normalizeCapability(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

const CAPACITY_SNAPSHOT_SELECT = [
  "supplier_id",
  "week_start_date",
  "capability",
  "capacity_level",
  "created_at",
  "supplier:suppliers(company_name)",
].join(",");

const CAPACITY_SNAPSHOT_BATCH_SELECT = [
  "supplier_id",
  "capability",
  "capacity_level",
  "created_at",
].join(",");

export async function getCapacitySnapshots(args: {
  startDate: string; // YYYY-MM-DD (inclusive)
  endDate: string; // YYYY-MM-DD (inclusive)
  supplierId?: string | null;
  capability?: string | null;
}): Promise<AdminLoaderResult<{ snapshots: AdminCapacitySnapshotRow[] }>> {
  // Defense-in-depth: this loader uses the service role key.
  await requireAdminUser();

  const startDate = normalizeDate(args?.startDate);
  const endDate = normalizeDate(args?.endDate);
  const supplierId = normalizeId(args?.supplierId);
  const capability = normalizeCapability(args?.capability);

  if (!startDate || !endDate) {
    return {
      ok: false,
      data: { snapshots: [] },
      error: "Invalid date range.",
    };
  }

  try {
    let query = supabaseServer
      .from(SNAPSHOTS_TABLE)
      .select(CAPACITY_SNAPSHOT_SELECT)
      .gte("week_start_date", startDate)
      .lte("week_start_date", endDate)
      .order("supplier_id", { ascending: true })
      .order("week_start_date", { ascending: true })
      .order("capability", { ascending: true })
      .limit(2500);

    if (supplierId) {
      query = query.eq("supplier_id", supplierId);
    }

    if (capability) {
      query = query.eq("capability", capability);
    }

    const { data, error } = await query.returns<AdminCapacitySnapshotRow[]>();

    if (error) {
      if (isMissingTableOrColumnError(error)) {
        // Failure-only logging: schema mismatch is common in ephemeral envs.
        console.warn("[admin capacity] snapshots missing schema; returning empty", {
          table: SNAPSHOTS_TABLE,
          select: CAPACITY_SNAPSHOT_SELECT,
          supabaseError: serializeSupabaseError(error),
        });
        return { ok: true, data: { snapshots: [] }, error: null };
      }

      console.error("[admin capacity] snapshots query failed", {
        table: SNAPSHOTS_TABLE,
        select: CAPACITY_SNAPSHOT_SELECT,
        supabaseError: serializeSupabaseError(error),
      });
      return {
        ok: false,
        data: { snapshots: [] },
        error: "Unable to load capacity snapshots right now.",
      };
    }

    return {
      ok: true,
      data: { snapshots: Array.isArray(data) ? data : [] },
      error: null,
    };
  } catch (error) {
    if (isMissingTableOrColumnError(error)) {
      console.warn("[admin capacity] snapshots crashed (missing schema); returning empty", {
        table: SNAPSHOTS_TABLE,
        select: CAPACITY_SNAPSHOT_SELECT,
        supabaseError: serializeSupabaseError(error),
      });
      return { ok: true, data: { snapshots: [] }, error: null };
    }

    console.error("[admin capacity] snapshots crashed", {
      table: SNAPSHOTS_TABLE,
      select: CAPACITY_SNAPSHOT_SELECT,
      supabaseError: serializeSupabaseError(error) ?? error,
    });
    return {
      ok: false,
      data: { snapshots: [] },
      error: "Unable to load capacity snapshots right now.",
    };
  }
}

export async function getCapacitySnapshotsForSupplierWeek(args: {
  supplierId: string;
  weekStartDate: string; // YYYY-MM-DD (Monday)
}): Promise<AdminLoaderResult<{ snapshots: AdminCapacitySnapshotRow[] }>> {
  // Defense-in-depth: this loader uses the service role key.
  await requireAdminUser();

  const supplierId = normalizeId(args?.supplierId);
  const weekStartDate = normalizeDate(args?.weekStartDate);

  if (!supplierId || !weekStartDate) {
    return {
      ok: false,
      data: { snapshots: [] },
      error: "Invalid supplier or week start date.",
    };
  }

  try {
    const { data, error } = await supabaseServer
      .from(SNAPSHOTS_TABLE)
      .select(CAPACITY_SNAPSHOT_SELECT)
      .eq("supplier_id", supplierId)
      .eq("week_start_date", weekStartDate)
      .order("capability", { ascending: true })
      .order("created_at", { ascending: false })
      .limit(250)
      .returns<AdminCapacitySnapshotRow[]>();

    if (error) {
      if (isMissingTableOrColumnError(error)) {
        console.warn(
          "[admin capacity] supplier-week snapshots missing schema; returning empty",
          {
            table: SNAPSHOTS_TABLE,
            select: CAPACITY_SNAPSHOT_SELECT,
            supplierId,
            weekStartDate,
            supabaseError: serializeSupabaseError(error),
          },
        );
        return { ok: true, data: { snapshots: [] }, error: null };
      }

      console.error("[admin capacity] supplier-week snapshots query failed", {
        table: SNAPSHOTS_TABLE,
        select: CAPACITY_SNAPSHOT_SELECT,
        supplierId,
        weekStartDate,
        supabaseError: serializeSupabaseError(error),
      });
      return {
        ok: false,
        data: { snapshots: [] },
        error: "Unable to load capacity snapshots right now.",
      };
    }

    return {
      ok: true,
      data: { snapshots: Array.isArray(data) ? data : [] },
      error: null,
    };
  } catch (error) {
    if (isMissingTableOrColumnError(error)) {
      console.warn(
        "[admin capacity] supplier-week snapshots crashed (missing schema); returning empty",
        {
          table: SNAPSHOTS_TABLE,
          select: CAPACITY_SNAPSHOT_SELECT,
          supplierId,
          weekStartDate,
          supabaseError: serializeSupabaseError(error),
        },
      );
      return { ok: true, data: { snapshots: [] }, error: null };
    }

    console.error("[admin capacity] supplier-week snapshots crashed", {
      table: SNAPSHOTS_TABLE,
      select: CAPACITY_SNAPSHOT_SELECT,
      supplierId,
      weekStartDate,
      supabaseError: serializeSupabaseError(error) ?? error,
    });
    return {
      ok: false,
      data: { snapshots: [] },
      error: "Unable to load capacity snapshots right now.",
    };
  }
}

export async function getCapacitySnapshotsForSuppliersWeek(args: {
  supplierIds: string[];
  weekStartDate: string; // YYYY-MM-DD
}): Promise<CapacityBySupplierMap> {
  // Defense-in-depth: this loader uses the service role key.
  await requireAdminUser();

  const supplierIds = normalizeIds(args?.supplierIds);
  const weekStartDate = normalizeDate(args?.weekStartDate);

  if (supplierIds.length === 0 || !weekStartDate) {
    return {};
  }

  try {
    const { data, error } = await supabaseServer
      .from(SNAPSHOTS_TABLE)
      .select(CAPACITY_SNAPSHOT_BATCH_SELECT)
      .in("supplier_id", supplierIds)
      .eq("week_start_date", weekStartDate)
      .order("supplier_id", { ascending: true })
      .order("capability", { ascending: true })
      .order("created_at", { ascending: false })
      .limit(2500)
      .returns<CapacitySnapshot[]>();

    if (error) {
      if (isMissingTableOrColumnError(error)) {
        // Failure-only logging: schema mismatch is common in ephemeral envs.
        console.warn(
          "[admin capacity] supplier-week batch snapshots missing schema; returning empty",
          {
            table: SNAPSHOTS_TABLE,
            select: CAPACITY_SNAPSHOT_BATCH_SELECT,
            weekStartDate,
            supplierIdsCount: supplierIds.length,
            supabaseError: serializeSupabaseError(error),
          },
        );
        return {};
      }

      console.error("[admin capacity] supplier-week batch snapshots query failed", {
        table: SNAPSHOTS_TABLE,
        select: CAPACITY_SNAPSHOT_BATCH_SELECT,
        weekStartDate,
        supplierIdsCount: supplierIds.length,
        supabaseError: serializeSupabaseError(error),
      });
      return {};
    }

    const rows = Array.isArray(data) ? data : [];
    const bySupplier: CapacityBySupplierMap = {};
    for (const row of rows) {
      const supplierId = typeof row?.supplier_id === "string" ? row.supplier_id : "";
      if (!supplierId) continue;
      const list = bySupplier[supplierId] ?? [];
      list.push(row);
      bySupplier[supplierId] = list;
    }
    return bySupplier;
  } catch (error) {
    if (isMissingTableOrColumnError(error)) {
      console.warn(
        "[admin capacity] supplier-week batch snapshots crashed (missing schema); returning empty",
        {
          table: SNAPSHOTS_TABLE,
          select: CAPACITY_SNAPSHOT_BATCH_SELECT,
          weekStartDate,
          supplierIdsCount: supplierIds.length,
          supabaseError: serializeSupabaseError(error),
        },
      );
      return {};
    }

    console.error("[admin capacity] supplier-week batch snapshots crashed", {
      table: SNAPSHOTS_TABLE,
      select: CAPACITY_SNAPSHOT_BATCH_SELECT,
      weekStartDate,
      supplierIdsCount: supplierIds.length,
      supabaseError: serializeSupabaseError(error) ?? error,
    });
    return {};
  }
}

export async function listCapacitySuppliers(): Promise<
  AdminLoaderResult<{ suppliers: AdminCapacitySupplierRow[] }>
> {
  // Defense-in-depth: this loader uses the service role key.
  await requireAdminUser();

  try {
    const { data, error } = await supabaseServer
      .from(SUPPLIERS_TABLE)
      .select("id,company_name")
      .order("company_name", { ascending: true })
      .limit(750)
      .returns<AdminCapacitySupplierRow[]>();

    if (error) {
      if (isMissingTableOrColumnError(error)) {
        console.warn("[admin capacity] suppliers missing schema; returning empty", {
          table: SUPPLIERS_TABLE,
          supabaseError: serializeSupabaseError(error),
        });
        return { ok: true, data: { suppliers: [] }, error: null };
      }

      console.error("[admin capacity] suppliers query failed", {
        table: SUPPLIERS_TABLE,
        supabaseError: serializeSupabaseError(error),
      });
      return {
        ok: false,
        data: { suppliers: [] },
        error: "Unable to load suppliers right now.",
      };
    }

    return { ok: true, data: { suppliers: data ?? [] }, error: null };
  } catch (error) {
    if (isMissingTableOrColumnError(error)) {
      console.warn("[admin capacity] suppliers crashed (missing schema); returning empty", {
        table: SUPPLIERS_TABLE,
        supabaseError: serializeSupabaseError(error),
      });
      return { ok: true, data: { suppliers: [] }, error: null };
    }

    console.error("[admin capacity] suppliers crashed", {
      table: SUPPLIERS_TABLE,
      supabaseError: serializeSupabaseError(error) ?? error,
    });
    return {
      ok: false,
      data: { suppliers: [] },
      error: "Unable to load suppliers right now.",
    };
  }
}

