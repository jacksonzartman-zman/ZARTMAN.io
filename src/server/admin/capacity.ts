import { supabaseServer } from "@/lib/supabaseServer";
import { requireAdminUser } from "@/server/auth";
import {
  isMissingTableOrColumnError,
  serializeSupabaseError,
} from "@/server/admin/logging";
import type { AdminLoaderResult } from "@/server/admin/types";

const SNAPSHOTS_TABLE = "supplier_capacity_snapshots" as const;
const SUPPLIERS_TABLE = "suppliers" as const;

export type AdminCapacityLevel = "low" | "medium" | "high" | "overloaded";

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

