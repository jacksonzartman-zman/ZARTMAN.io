"use server";

import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabaseServer";
import { createSupplierQuoteMessage } from "@/server/quotes/messages";
import { createOrUpdateBid, getSupplierBidForQuote } from "@/server/suppliers";
import { loadSupplierProfile } from "@/server/suppliers";
import { normalizeEmailInput } from "@/app/(portals)/quotes/pageUtils";
import type { QuoteWithUploadsRow } from "@/server/quotes/types";
import {
  getSupplierDisplayName,
  loadSupplierAssignments,
  matchesSupplierProcess,
  supplierHasAccess,
} from "./supplierAccess";

export type PostSupplierQuoteMessageState = {
  success: boolean;
  error: string | null;
  messageId?: string;
};

const GENERIC_ERROR =
  "Unable to send your message right now. Please try again.";

export type SupplierBidActionState = {
  success: boolean;
  error: string | null;
  status: string | null;
};

const BID_ERROR_MESSAGE =
  "Unable to save your bid right now. Please try again.";

type QuoteAssignmentRow = Pick<
  QuoteWithUploadsRow,
  "id" | "email" | "assigned_supplier_email" | "assigned_supplier_name"
>;

type QuoteAccessRow = QuoteAssignmentRow & {
  upload_id: string | null;
};

export async function postSupplierQuoteMessageAction(
  _prevState: PostSupplierQuoteMessageState,
  formData: FormData,
): Promise<PostSupplierQuoteMessageState> {
  const rawQuoteId = formData.get("quote_id");
  const rawBody = formData.get("body");
  const rawEmail = formData.get("identity_email");

  if (typeof rawQuoteId !== "string" || rawQuoteId.trim().length === 0) {
    return { success: false, error: "Missing quote reference." };
  }

  if (typeof rawBody !== "string") {
    return { success: false, error: "Enter a message before sending." };
  }

  if (typeof rawEmail !== "string") {
    return { success: false, error: "Provide your email to continue." };
  }

  const quoteId = rawQuoteId.trim();
  const body = rawBody.trim();
  const identityEmail = normalizeEmailInput(rawEmail);

  if (!identityEmail) {
    return {
      success: false,
      error: "Provide a valid email address to continue.",
    };
  }

  if (body.length === 0) {
    return {
      success: false,
      error: "Enter a message before sending.",
    };
  }

  if (body.length > 2000) {
    return {
      success: false,
      error: "Message is too long. Keep it under 2,000 characters.",
    };
  }

  try {
    const [quote, assignments, profile] = await Promise.all([
      loadQuoteAccessRow(quoteId),
      loadSupplierAssignments(quoteId),
      loadSupplierProfile(identityEmail),
    ]);

    if (!quote) {
      return { success: false, error: "Quote not found." };
    }

    if (!profile?.supplier) {
      console.error("Supplier post action: no supplier profile", {
        quoteId,
        identityEmail,
      });
      return {
        success: false,
        error: "Complete onboarding before posting messages.",
      };
    }

    const uploadProcess = await loadUploadProcessHint(quote.upload_id ?? null);
    const verifiedProcessMatch = matchesSupplierProcess(
      profile.capabilities ?? [],
      uploadProcess,
    );

    if (
      !supplierHasAccess(identityEmail, quote, assignments, {
        supplier: profile.supplier,
        verifiedProcessMatch,
      })
    ) {
      console.error("Supplier post action: access denied", {
        quoteId,
        identityEmail,
        quoteEmail: quote.email,
        assignmentCount: assignments.length,
        reason: "ACCESS_DENIED",
      });
      return {
        success: false,
        error: "You do not have access to this quote.",
      };
    }

    const existingBid = await getSupplierBidForQuote(
      quoteId,
      profile.supplier.id,
    );

    if (existingBid?.status !== "accepted") {
      console.warn("Supplier post action: chat locked for supplier", {
        quoteId,
        identityEmail,
        supplierId: profile.supplier.id,
        bidStatus: existingBid?.status ?? "none",
        reason: "CHAT_LOCKED_UNACCEPTED_BID",
      });
      return {
        success: false,
        error: "Chat unlocks after your bid is accepted by the customer.",
      };
    }

    const supplierName = getSupplierDisplayName(
      identityEmail,
      quote,
      assignments,
    );

    const { data, error } = await createSupplierQuoteMessage({
      quoteId,
      body,
      authorName: supplierName,
      authorEmail: identityEmail,
    });

    if (error || !data) {
      console.error("Supplier post action: failed to create message", {
        quoteId,
        error,
      });
      return { success: false, error: GENERIC_ERROR };
    }

    revalidatePath(`/supplier/quotes/${quoteId}`);
    return { success: true, error: null, messageId: data.id };
  } catch (error) {
    console.error("Supplier post action: unexpected error", error);
    return { success: false, error: GENERIC_ERROR };
  }
}

export async function submitSupplierBidAction(
  _prevState: SupplierBidActionState,
  formData: FormData,
): Promise<SupplierBidActionState> {
  const rawQuoteId = formData.get("quote_id");
  const rawEmail = formData.get("supplier_email");
  const rawUnitPrice = formData.get("unit_price");
  const rawCurrency = formData.get("currency");
  const rawLeadTime = formData.get("lead_time_days");
  const rawNotes = formData.get("notes");

  if (typeof rawQuoteId !== "string" || rawQuoteId.trim().length === 0) {
    return { success: false, error: "Missing quote reference.", status: null };
  }

  if (typeof rawEmail !== "string") {
    return {
      success: false,
      error: "Provide your email to continue.",
      status: null,
    };
  }

  if (typeof rawUnitPrice !== "string" || rawUnitPrice.trim().length === 0) {
    return {
      success: false,
      error: "Enter a unit price.",
      status: null,
    };
  }

  const quoteId = rawQuoteId.trim();
  const supplierEmail = normalizeEmailInput(rawEmail);
  if (!supplierEmail) {
    return {
      success: false,
      error: "Provide a valid email address.",
      status: null,
    };
  }

  const unitPrice = Number(rawUnitPrice);
  if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
    return {
      success: false,
      error: "Enter a valid unit price greater than zero.",
      status: null,
    };
  }

  const leadTimeDays =
    typeof rawLeadTime === "string" && rawLeadTime.trim().length > 0
      ? Number(rawLeadTime)
      : null;

  if (leadTimeDays !== null && (!Number.isFinite(leadTimeDays) || leadTimeDays < 0)) {
    return {
      success: false,
      error: "Lead time must be a positive number of days.",
      status: null,
    };
  }

  const currency =
    typeof rawCurrency === "string" && rawCurrency.trim().length > 0
      ? rawCurrency.trim().toUpperCase()
      : "USD";
  const notes =
    typeof rawNotes === "string" && rawNotes.trim().length > 0
      ? rawNotes.trim()
      : null;

  try {
    const [quote, assignments, profile] = await Promise.all([
      loadQuoteAccessRow(quoteId),
      loadSupplierAssignments(quoteId),
      loadSupplierProfile(supplierEmail),
    ]);

    if (!quote) {
      return { success: false, error: "Quote not found.", status: null };
    }

    if (!profile?.supplier) {
      return {
        success: false,
        error: "Complete onboarding before submitting bids.",
        status: null,
      };
    }

    const uploadProcess = await loadUploadProcessHint(quote.upload_id ?? null);
    const verifiedProcessMatch = matchesSupplierProcess(
      profile.capabilities ?? [],
      uploadProcess,
    );

    if (
      !supplierHasAccess(supplierEmail, quote, assignments, {
        supplier: profile.supplier,
        verifiedProcessMatch,
      })
    ) {
      console.error("Supplier bid action: access denied", {
        quoteId,
        supplierEmail,
        reason: "ACCESS_DENIED",
      });
      return {
        success: false,
        error: "You do not have access to this quote.",
        status: null,
      };
    }

    const bid = await createOrUpdateBid({
      quoteId,
      supplierId: profile.supplier.id,
      unitPrice,
      currency,
      leadTimeDays,
      notes,
    });

    if (!bid) {
      return {
        success: false,
        error: BID_ERROR_MESSAGE,
        status: null,
      };
    }

    revalidatePath(`/supplier/quotes/${quoteId}`);
      revalidatePath(`/supplier`);
    revalidatePath(`/customer/quotes/${quoteId}`);
    return {
      success: true,
      error: null,
      status: bid.status,
    };
  } catch (error) {
    console.error("Supplier bid action: unexpected error", error);
    return { success: false, error: BID_ERROR_MESSAGE, status: null };
  }
}

async function loadQuoteAccessRow(quoteId: string): Promise<QuoteAccessRow | null> {
  const { data, error } = await supabaseServer
    .from("quotes_with_uploads")
    .select("id,email,assigned_supplier_email,assigned_supplier_name,upload_id")
    .eq("id", quoteId)
    .maybeSingle<QuoteAccessRow>();

  if (error) {
    console.error("Supplier bid action: quote lookup failed", error);
    return null;
  }

  return data ?? null;
}

async function loadUploadProcessHint(
  uploadId: string | null,
): Promise<string | null> {
  if (!uploadId) {
    return null;
  }
  const { data, error } = await supabaseServer
    .from("uploads")
    .select("manufacturing_process")
    .eq("id", uploadId)
    .maybeSingle<{ manufacturing_process: string | null }>();

  if (error) {
    console.error("Supplier bid action: upload lookup failed", error);
    return null;
  }

  return data?.manufacturing_process ?? null;
}
