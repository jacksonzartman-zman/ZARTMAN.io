"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/server/auth";
import { loadSupplierProfileByUserId } from "@/server/suppliers/profile";
import { assertSupplierQuoteAccess } from "@/server/quotes/access";
import {
  upsertSupplierCapacitySnapshot,
  type SupplierCapacityLevel,
} from "@/server/suppliers/capacity";
import {
  submitSupplierBidImpl,
  postSupplierMessageImpl,
  completeKickoffTaskImpl,
  type SupplierBidFormState,
  type SupplierKickoffFormState,
  type ToggleSupplierKickoffTaskInput,
} from "@/server/quotes/supplierQuoteServer";
import type { QuoteMessageFormState } from "@/app/(portals)/components/QuoteMessagesThread.types";

export type {
  SupplierBidFormState,
  SupplierKickoffFormState,
};
export type { QuoteMessageFormState } from "@/app/(portals)/components/QuoteMessagesThread.types";

export async function submitSupplierBid(
  _prevState: SupplierBidFormState,
  formData: FormData,
): Promise<SupplierBidFormState> {
  return submitSupplierBidImpl(formData);
}

export async function postQuoteMessage(
  quoteId: string,
  _prevState: QuoteMessageFormState,
  formData: FormData,
): Promise<QuoteMessageFormState> {
  return postSupplierMessageImpl(quoteId, formData);
}

export async function completeKickoffTask(
  input: ToggleSupplierKickoffTaskInput,
): Promise<SupplierKickoffFormState> {
  return completeKickoffTaskImpl(input);
}

export type SupplierCapacityFormState =
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

export async function submitSupplierCapacityNextWeek(
  quoteId: string,
  _prevState: SupplierCapacityFormState,
  formData: FormData,
): Promise<SupplierCapacityFormState> {
  const normalizedQuoteId = normalizeText(quoteId);
  if (!normalizedQuoteId) {
    return { ok: false, error: "Missing quote ID." };
  }

  try {
    const user = await requireUser({ redirectTo: `/supplier/quotes/${normalizedQuoteId}` });
    const profile = await loadSupplierProfileByUserId(user.id);
    const supplierId = profile?.supplier?.id ?? null;
    if (!supplierId) {
      return { ok: false, error: "Complete supplier onboarding before updating capacity." };
    }

    const access = await assertSupplierQuoteAccess({
      quoteId: normalizedQuoteId,
      supplierId,
      supplierUserEmail: user.email ?? null,
    });
    if (!access.ok) {
      return { ok: false, error: "You don’t have access to this RFQ." };
    }

    const weekStartDate = normalizeWeekStartDate(formData.get("weekStartDate"));
    if (!weekStartDate) {
      return { ok: false, error: "Missing week start date." };
    }

    const results = await Promise.all(
      CAPACITY_CAPABILITIES.map(async (capability) => {
        const level = normalizeCapacityLevel(formData.get(`capacity_${capability}`));
        if (!level) {
          return { ok: false as const, capability, reason: "invalid_level" as const };
        }
        const result = await upsertSupplierCapacitySnapshot({
          supplierId,
          weekStartDate,
          capability,
          capacityLevel: level,
          notes: null,
          actorUserId: user.id,
        });
        return result.ok
          ? { ok: true as const, capability }
          : { ok: false as const, capability, reason: result.reason ?? "write_failed" };
      }),
    );

    if (results.some((r) => !r.ok)) {
      // Failure-only logging, per spec.
      console.error("[supplier capacity] submit failed", {
        quoteId: normalizedQuoteId,
        supplierId,
        weekStartDate,
        failures: results.filter((r) => !r.ok),
      });
      return { ok: false, error: "We couldn’t save capacity right now. Please try again." };
    }

    revalidatePath(`/supplier/quotes/${normalizedQuoteId}`);
    revalidatePath(`/admin/quotes/${normalizedQuoteId}`);
    revalidatePath(`/customer/quotes/${normalizedQuoteId}`);

    return { ok: true, message: "Capacity saved." };
  } catch (error) {
    console.error("[supplier capacity] submit crashed", {
      quoteId: normalizedQuoteId,
      error,
    });
    return { ok: false, error: "We couldn’t save capacity right now. Please try again." };
  }
}
