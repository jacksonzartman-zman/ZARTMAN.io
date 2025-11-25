"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/server/auth";
import { loadSupplierByUserId } from "@/server/suppliers/profile";
import { submitBidForRfq } from "@/server/marketplace/bids";

export type SubmitMarketplaceBidState = {
  error: string | null;
  success: boolean;
  rfqId?: string;
};

export const INITIAL_SUPPLIER_BID_STATE: SubmitMarketplaceBidState = {
  error: null,
  success: false,
  rfqId: undefined,
};

const GENERIC_ERROR = "Unable to submit your bid right now. Please try again.";

export async function submitMarketplaceBidAction(
  _prev: SubmitMarketplaceBidState,
  formData: FormData,
): Promise<SubmitMarketplaceBidState> {
  try {
    const session = await requireSession({ redirectTo: "/supplier/marketplace" });
    const supplier = await loadSupplierByUserId(session.user.id);

    if (!supplier) {
      return {
        error: "Finish supplier onboarding before bidding.",
        success: false,
      };
    }

    const rfqId = getText(formData, "rfq_id");
    const priceTotal = getText(formData, "price_total");
    const leadTimeDays = getText(formData, "lead_time_days");
    const notes = getText(formData, "notes");

    if (!rfqId) {
      return { error: "RFQ required.", success: false };
    }

    const submission = await submitBidForRfq(rfqId, supplier.id, {
      priceTotal: priceTotal ?? null,
      leadTimeDays: leadTimeDays ?? null,
      notes,
    });

    if (submission.error) {
      return {
        error: submission.error ?? GENERIC_ERROR,
        success: false,
        rfqId,
      };
    }

    revalidatePath("/supplier/marketplace");
    return { error: null, success: true, rfqId };
  } catch (error) {
    console.error("submitMarketplaceBidAction: unexpected error", error);
    return { error: GENERIC_ERROR, success: false };
  }
}

function getText(formData: FormData, key: string): string | null {
  const raw = formData.get(key);
  if (typeof raw !== "string") {
    return null;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}
