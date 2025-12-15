import { supabaseServer } from "@/lib/supabaseServer";
import {
  isMissingTableOrColumnError,
  serializeSupabaseError,
} from "@/server/admin/logging";

export type SupplierCapacityLevel = "low" | "medium" | "high" | "overloaded";

export type SupplierCapacitySnapshot = {
  capability: string;
  capacityLevel: SupplierCapacityLevel;
  notes: string | null;
};

export type UpsertSupplierCapacitySnapshotInput = {
  supplierId: string;
  weekStartDate: string; // YYYY-MM-DD
  capability: string;
  capacityLevel: SupplierCapacityLevel;
  notes?: string | null;
  actorUserId: string;
};

export type UpsertSupplierCapacitySnapshotResult =
  | { ok: true }
  | { ok: false; error: string; reason?: "invalid_input" | "schema_missing" | "write_failed" };

const SNAPSHOTS_TABLE = "supplier_capacity_snapshots";

function normalizeId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeText(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : "";
}

function normalizeWeekStartDate(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  // Keep it strict: server actions should submit YYYY-MM-DD.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return "";
  return trimmed;
}

function isCapacityLevel(value: unknown): value is SupplierCapacityLevel {
  return value === "low" || value === "medium" || value === "high" || value === "overloaded";
}

export async function loadSupplierCapacitySnapshotsForWeek(args: {
  supplierId: string;
  weekStartDate: string; // YYYY-MM-DD
}): Promise<
  | { ok: true; snapshots: SupplierCapacitySnapshot[] }
  | { ok: false; error: string; reason?: "invalid_input" | "schema_missing" | "read_failed" }
> {
  const supplierId = normalizeId(args?.supplierId);
  const weekStartDate = normalizeWeekStartDate(args?.weekStartDate);

  if (!supplierId || !weekStartDate) {
    return { ok: false, error: "invalid_input", reason: "invalid_input" };
  }

  try {
    const result = await supabaseServer
      .from(SNAPSHOTS_TABLE)
      .select("capability, capacity_level, notes")
      .eq("supplier_id", supplierId)
      .eq("week_start_date", weekStartDate)
      .limit(50)
      .returns<{ capability: string; capacity_level: SupplierCapacityLevel; notes: string | null }[]>();

    if (result.error) {
      if (isMissingTableOrColumnError(result.error)) {
        // Failure-only logging, per spec.
        console.warn("[supplier capacity] read skipped (missing schema)", {
          supplierId,
          weekStartDate,
          pgCode: (result.error as { code?: string | null })?.code ?? null,
          message: (result.error as { message?: string | null })?.message ?? null,
        });
        return { ok: false, error: "schema_missing", reason: "schema_missing" };
      }

      console.error("[supplier capacity] read failed", {
        supplierId,
        weekStartDate,
        error: serializeSupabaseError(result.error),
      });
      return { ok: false, error: "read_failed", reason: "read_failed" };
    }

    const rows = Array.isArray(result.data) ? result.data : [];
    const snapshots: SupplierCapacitySnapshot[] = rows
      .map((row) => ({
        capability: normalizeText(row.capability).toLowerCase(),
        capacityLevel: row.capacity_level,
        notes: typeof row.notes === "string" ? row.notes : null,
      }))
      .filter((row) => Boolean(row.capability) && isCapacityLevel(row.capacityLevel));

    return { ok: true, snapshots };
  } catch (error) {
    if (isMissingTableOrColumnError(error)) {
      console.warn("[supplier capacity] read crashed (missing schema)", {
        supplierId,
        weekStartDate,
        error: serializeSupabaseError(error),
      });
      return { ok: false, error: "schema_missing", reason: "schema_missing" };
    }

    console.error("[supplier capacity] read crashed", {
      supplierId,
      weekStartDate,
      error: serializeSupabaseError(error) ?? error,
    });
    return { ok: false, error: "read_failed", reason: "read_failed" };
  }
}

export async function upsertSupplierCapacitySnapshot(
  input: UpsertSupplierCapacitySnapshotInput,
): Promise<UpsertSupplierCapacitySnapshotResult> {
  const supplierId = normalizeId(input?.supplierId);
  const actorUserId = normalizeId(input?.actorUserId);
  const weekStartDate = normalizeWeekStartDate(input?.weekStartDate);
  const capability = normalizeText(input?.capability).toLowerCase();
  const capacityLevel = input?.capacityLevel;
  const notes =
    typeof input?.notes === "string" && input.notes.trim().length > 0
      ? input.notes.trim().slice(0, 2000)
      : null;

  if (!supplierId || !actorUserId || !weekStartDate || !capability || !isCapacityLevel(capacityLevel)) {
    return { ok: false, error: "invalid_input", reason: "invalid_input" };
  }

  try {
    const { error } = await supabaseServer
      .from(SNAPSHOTS_TABLE)
      .upsert(
        {
          supplier_id: supplierId,
          week_start_date: weekStartDate,
          capability,
          capacity_level: capacityLevel,
          notes,
        },
        { onConflict: "supplier_id,week_start_date,capability" },
      );

    if (error) {
      if (isMissingTableOrColumnError(error)) {
        // Failure-only logging, per spec.
        console.warn("[supplier capacity] write skipped (missing schema)", {
          supplierId,
          weekStartDate,
          capability,
          capacityLevel,
          pgCode: (error as { code?: string | null })?.code ?? null,
          message: (error as { message?: string | null })?.message ?? null,
        });
        return { ok: false, error: "schema_missing", reason: "schema_missing" };
      }
      console.error("[supplier capacity] upsert failed", {
        supplierId,
        weekStartDate,
        capability,
        capacityLevel,
        error: serializeSupabaseError(error),
      });
      return { ok: false, error: "write_failed", reason: "write_failed" };
    }

    // Best-effort: attach a capacity_updated event to all relevant quotes so admins
    // see capacity changes on existing quote timelines.
    void emitCapacityUpdatedEventsForSupplierQuotes({
      supplierId,
      actorUserId,
      weekStartDate,
      capability,
      capacityLevel,
    });

    return { ok: true };
  } catch (error) {
    if (isMissingTableOrColumnError(error)) {
      console.warn("[supplier capacity] write crashed (missing schema)", {
        supplierId,
        weekStartDate,
        capability,
        capacityLevel,
        error: serializeSupabaseError(error),
      });
      return { ok: false, error: "schema_missing", reason: "schema_missing" };
    }
    console.error("[supplier capacity] upsert crashed", {
      supplierId,
      weekStartDate,
      capability,
      capacityLevel,
      error: serializeSupabaseError(error) ?? error,
    });
    return { ok: false, error: "write_failed", reason: "write_failed" };
  }
}

type CapacityEventArgs = {
  supplierId: string;
  actorUserId: string;
  weekStartDate: string;
  capability: string;
  capacityLevel: SupplierCapacityLevel;
};

async function emitCapacityUpdatedEventsForSupplierQuotes(args: CapacityEventArgs) {
  try {
    const quoteIds = await listQuoteIdsForSupplier(args.supplierId);
    if (quoteIds.length === 0) return;

    const rows = quoteIds.slice(0, 75).map((quoteId) => ({
      quote_id: quoteId,
      event_type: "capacity_updated",
      actor_role: "supplier" as const,
      actor_user_id: args.actorUserId,
      actor_supplier_id: args.supplierId,
      metadata: {
        weekStartDate: args.weekStartDate,
        capability: args.capability,
        capacityLevel: args.capacityLevel,
      },
    }));

    const { error } = await supabaseServer.from("quote_events").insert(rows);
    if (error && !isMissingTableOrColumnError(error)) {
      console.error("[supplier capacity] timeline event insert failed", {
        supplierId: args.supplierId,
        quoteCount: quoteIds.length,
        error: serializeSupabaseError(error),
      });
    }
  } catch (error) {
    if (!isMissingTableOrColumnError(error)) {
      console.error("[supplier capacity] timeline event insert crashed", {
        supplierId: args.supplierId,
        error: serializeSupabaseError(error) ?? error,
      });
    }
  }
}

async function listQuoteIdsForSupplier(supplierId: string): Promise<string[]> {
  const normalizedSupplierId = normalizeId(supplierId);
  if (!normalizedSupplierId) return [];

  const ids = new Set<string>();

  const safeAdd = (value: unknown) => {
    const id = normalizeId(value);
    if (id) ids.add(id);
  };

  try {
    const [invites, bids, awards] = await Promise.all([
      supabaseServer
        .from("quote_suppliers")
        .select("quote_id")
        .eq("supplier_id", normalizedSupplierId)
        .limit(250)
        .returns<{ quote_id: string }[]>(),
      supabaseServer
        .from("supplier_bids")
        .select("quote_id")
        .eq("supplier_id", normalizedSupplierId)
        .limit(250)
        .returns<{ quote_id: string }[]>(),
      supabaseServer
        .from("quotes")
        .select("id")
        .eq("awarded_supplier_id", normalizedSupplierId)
        .limit(250)
        .returns<{ id: string }[]>(),
    ]);

    if (!invites.error) {
      for (const row of invites.data ?? []) safeAdd(row.quote_id);
    }
    if (!bids.error) {
      for (const row of bids.data ?? []) safeAdd(row.quote_id);
    }
    if (!awards.error) {
      for (const row of awards.data ?? []) safeAdd(row.id);
    }

    return Array.from(ids);
  } catch {
    return Array.from(ids);
  }
}

