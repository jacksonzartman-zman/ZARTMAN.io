"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/server/auth";
import { loadSupplierProfileByUserId } from "@/server/suppliers/profile";
import {
  upsertSupplierCapacitySnapshot,
  type SupplierCapacityLevel,
} from "@/server/suppliers/capacity";

export type SupplierCapacitySettingsFormState =
  | { ok: true; message: string }
  | { ok: false; error: string };

const CAPACITY_CAPABILITIES = ["cnc_mill", "cnc_lathe", "mjp", "sla"] as const;

function normalizeText(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : "";
}

function normalizeWeekStartDate(value: unknown): string {
  const trimmed = normalizeText(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : "";
}

function normalizeCapacityLevel(value: unknown): SupplierCapacityLevel | null {
  const trimmed = normalizeText(value).toLowerCase();
  if (trimmed === "low" || trimmed === "medium" || trimmed === "high" || trimmed === "overloaded") {
    return trimmed;
  }
  return null;
}

function normalizeNotes(value: unknown): string | null {
  const trimmed = normalizeText(value);
  return trimmed.length > 0 ? trimmed.slice(0, 2000) : null;
}

export async function submitSupplierCapacitySettings(
  _prevState: SupplierCapacitySettingsFormState,
  formData: FormData,
): Promise<SupplierCapacitySettingsFormState> {
  try {
    const user = await requireUser({ redirectTo: "/supplier/settings/capacity" });
    const profile = await loadSupplierProfileByUserId(user.id);
    const supplierId = profile?.supplier?.id ?? null;
    if (!supplierId) {
      return { ok: false, error: "Complete supplier onboarding before updating capacity." };
    }

    const weekStartDate = normalizeWeekStartDate(formData.get("weekStartDate"));
    if (!weekStartDate) {
      return { ok: false, error: "Missing week start date." };
    }

    const parsed = CAPACITY_CAPABILITIES.map((capability) => {
      const level = normalizeCapacityLevel(formData.get(`capacity_${capability}`));
      const notes = normalizeNotes(formData.get(`notes_${capability}`));
      return { capability, level, notes };
    });

    const updates = parsed.filter((row) => Boolean(row.level));
    if (updates.length === 0) {
      return {
        ok: false,
        error: "Choose a capacity level for at least one capability before saving.",
      };
    }

    const results = await Promise.all(
      updates.map(async (row) => {
        const result = await upsertSupplierCapacitySnapshot({
          supplierId,
          weekStartDate,
          capability: row.capability,
          capacityLevel: row.level as SupplierCapacityLevel,
          notes: row.notes,
          actorUserId: user.id,
        });
        return result.ok
          ? { ok: true as const, capability: row.capability }
          : { ok: false as const, capability: row.capability, reason: result.reason ?? "write_failed" };
      }),
    );

    if (results.some((r) => !r.ok)) {
      // Failure-only logging, per spec.
      console.error("[supplier capacity] settings submit failed", {
        supplierId,
        weekStartDate,
        failures: results.filter((r) => !r.ok),
      });
      return { ok: false, error: "We couldn’t save capacity right now. Please try again." };
    }

    revalidatePath("/supplier/settings/capacity");
    revalidatePath("/supplier/settings");
    revalidatePath("/supplier/quotes");
    revalidatePath("/supplier");

    return { ok: true, message: "Capacity saved." };
  } catch (error) {
    console.error("[supplier capacity] settings submit crashed", {
      error,
    });
    return { ok: false, error: "We couldn’t save capacity right now. Please try again." };
  }
}

