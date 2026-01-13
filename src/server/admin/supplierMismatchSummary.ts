import { supabaseServer } from "@/lib/supabaseServer";
import { requireAdminUser } from "@/server/auth";
import { schemaGate } from "@/server/db/schemaContract";
import {
  handleMissingSupabaseSchema,
  isSupabaseRelationMarkedMissing,
} from "@/server/admin/logging";

export type SupplierMismatchSummary = {
  mismatchCount: number;
  lastMismatchAt: string | null;
};

type MismatchLogRow = {
  supplier_id: string | null;
  created_at: string | null;
};

export function isSupplierMismatchLogsEnabled(): boolean {
  const raw = process.env.SUPPLIER_MISMATCH_LOGS_ENABLED;
  if (!raw) return false;
  const normalized = raw.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function normalizeId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Best-effort mismatch summary for admin UI.
 *
 * If no dedicated mismatch log relation exists, this returns an empty map and performs no queries.
 */
export async function loadSupplierMismatchSummary(
  supplierIds: readonly (string | null | undefined)[],
): Promise<Record<string, SupplierMismatchSummary>> {
  // Default-off: when disabled, make ZERO Supabase requests (no schema probe, no relation query).
  if (!isSupplierMismatchLogsEnabled()) {
    return {};
  }

  await requireAdminUser();

  const ids = Array.from(
    new Set((supplierIds ?? []).map((id) => normalizeId(id)).filter(Boolean)),
  );
  if (ids.length === 0) {
    return {};
  }

  // Roadmap-dependent table: only query if present.
  const RELATION = "supplier_capability_mismatch_logs";

  // If we've already detected the relation is missing in this process, skip entirely (no probe, no query).
  if (isSupabaseRelationMarkedMissing(RELATION)) {
    return {};
  }

  const enabled = await schemaGate({
    enabled: true,
    relation: RELATION,
    requiredColumns: ["supplier_id", "created_at"],
    warnPrefix: "[admin suppliers]",
    warnKey: "admin_suppliers:mismatch_logs",
  });
  if (!enabled) {
    return {};
  }

  try {
    const { data, error } = await supabaseServer
      .from(RELATION)
      .select("supplier_id,created_at")
      .in("supplier_id", ids)
      .order("created_at", { ascending: false })
      // Safety valve: enough rows to summarize for a directory page without scanning endlessly.
      .limit(5000)
      .returns<MismatchLogRow[]>();

    if (error) {
      if (
        handleMissingSupabaseSchema({
          relation: RELATION,
          error,
          warnPrefix: "[supplier_mismatch]",
        })
      ) {
        return {};
      }
      return {};
    }

    const output: Record<string, SupplierMismatchSummary> = {};

    for (const row of data ?? []) {
      const supplierId = normalizeId(row?.supplier_id);
      if (!supplierId) continue;

      const createdAt = typeof row?.created_at === "string" ? row.created_at : null;
      const existing = output[supplierId];
      if (!existing) {
        output[supplierId] = { mismatchCount: 1, lastMismatchAt: createdAt };
        continue;
      }

      existing.mismatchCount += 1;
      if (!existing.lastMismatchAt && createdAt) {
        existing.lastMismatchAt = createdAt;
      }
    }

    return output;
  } catch (error) {
    if (
      handleMissingSupabaseSchema({
        relation: RELATION,
        error,
        warnPrefix: "[supplier_mismatch]",
      })
    ) {
      return {};
    }
    return {};
  }
}

