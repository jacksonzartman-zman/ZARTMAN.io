"use server";

import { revalidatePath } from "next/cache";
import {
  submitSupplierBidImpl,
  postSupplierMessageImpl,
  completeKickoffTaskImpl,
  type SupplierBidFormState,
  type SupplierKickoffFormState,
  type ToggleSupplierKickoffTaskInput,
} from "@/server/quotes/supplierQuoteServer";
import type { QuoteMessageFormState } from "@/app/(portals)/components/QuoteMessagesThread.types";
import { createAuthClient, getServerAuthUser } from "@/server/auth";
import { loadSupplierProfileByUserId } from "@/server/suppliers";
import { assertSupplierQuoteAccess } from "@/server/quotes/access";
import type { SupplierFeedbackCategory } from "@/server/quotes/rfqQualitySignals";
import {
  isMissingTableOrColumnError,
  serializeSupabaseError,
} from "@/server/admin/logging";

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

export type SupplierDeclineFeedbackFormState =
  | { ok: true; message: string }
  | { ok: false; error: string };

const SUPPLIER_FEEDBACK_CATEGORIES = new Set<SupplierFeedbackCategory>([
  "scope_unclear",
  "missing_drawings",
  "missing_cad",
  "timeline_unrealistic",
  "materials_unclear",
  "pricing_risk",
  "outside_capability",
  "other",
]);

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function supplierDeclineRfqWithFeedbackAction(
  quoteId: string,
  _prevState: SupplierDeclineFeedbackFormState,
  formData: FormData,
): Promise<SupplierDeclineFeedbackFormState> {
  const normalizedQuoteId = normalizeText(quoteId);
  if (!normalizedQuoteId) {
    return { ok: false, error: "Missing quote ID." };
  }

  const { user } = await getServerAuthUser();
  if (!user?.id) {
    return { ok: false, error: "You must be signed in to submit feedback." };
  }

  const profile = await loadSupplierProfileByUserId(user.id);
  const supplierId = profile?.supplier?.id ?? null;
  if (!supplierId) {
    return { ok: false, error: "Supplier profile not found." };
  }

  const access = await assertSupplierQuoteAccess({
    quoteId: normalizedQuoteId,
    supplierId,
    supplierUserEmail: user.email ?? null,
  });
  if (!access.ok) {
    return { ok: false, error: "Not invited to this RFQ." };
  }

  const rawCategories = formData.getAll("categories");
  const categories = Array.from(
    new Set(
      rawCategories
        .map((value) => normalizeText(value))
        .filter((value): value is SupplierFeedbackCategory =>
          SUPPLIER_FEEDBACK_CATEGORIES.has(value as SupplierFeedbackCategory),
        ),
    ),
  );
  const noteRaw = normalizeText(formData.get("note"));
  const note = noteRaw ? noteRaw.slice(0, 1000) : "";

  console.log("[rfq feedback] supplier declined with", {
    quoteId: normalizedQuoteId,
    supplierId,
    supplierUserId: user.id,
    categories,
    note,
  });

  try {
    const supabase = createAuthClient();
    const { error } = await supabase.from("quote_rfq_feedback").insert({
      quote_id: normalizedQuoteId,
      supplier_id: supplierId,
      categories,
      note: note || null,
    });

    if (error) {
      if (isMissingTableOrColumnError(error)) {
        console.warn("[rfq feedback] schema missing; skipping persist", {
          quoteId: normalizedQuoteId,
          supplierId,
          error: serializeSupabaseError(error) ?? error,
        });
      } else {
        console.error("[rfq feedback] insert failed", {
          quoteId: normalizedQuoteId,
          supplierId,
          error: serializeSupabaseError(error) ?? error,
        });
      }
    }
  } catch (error) {
    if (isMissingTableOrColumnError(error)) {
      console.warn("[rfq feedback] schema missing; skipping persist", {
        quoteId: normalizedQuoteId,
        supplierId,
        error: serializeSupabaseError(error) ?? error,
      });
    } else {
      console.error("[rfq feedback] insert crashed", {
        quoteId: normalizedQuoteId,
        supplierId,
        error: serializeSupabaseError(error) ?? error,
      });
    }
  }

  revalidatePath("/supplier/rfqs");
  revalidatePath("/supplier/quotes");

  return { ok: true, message: "Thanks — feedback sent." };
}
