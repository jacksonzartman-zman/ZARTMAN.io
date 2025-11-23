"use server";

import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabaseServer";
import {
  createQuoteMessage,
  type QuoteMessage,
} from "@/server/quotes/messages";
import { normalizeEmailInput } from "@/app/(portals)/quotes/pageUtils";
import type { QuoteWithUploadsRow } from "@/server/quotes/types";
import {
  getSupplierDisplayName,
  loadSupplierAssignments,
  supplierHasAccess,
} from "./supplierAccess";

export type PostSupplierQuoteMessageState = {
  success: boolean;
  error: string | null;
  messageId?: string;
};

const GENERIC_ERROR =
  "Unable to send your message right now. Please try again.";

type QuoteAssignmentRow = Pick<
  QuoteWithUploadsRow,
  "id" | "assigned_supplier_email" | "assigned_supplier_name"
>;

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
    const { data: quote, error: quoteError } = await supabaseServer
      .from("quotes_with_uploads")
      .select("id,assigned_supplier_email,assigned_supplier_name")
      .eq("id", quoteId)
      .maybeSingle<QuoteAssignmentRow>();

    if (quoteError) {
      console.error("Supplier post action: quote lookup failed", quoteError);
    }

    if (!quote) {
      return { success: false, error: "Quote not found." };
    }

    const assignments = await loadSupplierAssignments(quoteId);
    if (!supplierHasAccess(identityEmail, quote, assignments)) {
      return {
        success: false,
        error: "You do not have access to this quote.",
      };
    }

    const supplierName = getSupplierDisplayName(
      identityEmail,
      quote,
      assignments,
    );

    const { data, error } = await createQuoteMessage({
      quoteId,
      body,
      authorType: "supplier",
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
    return { success: true, error: null, messageId: (data as QuoteMessage).id };
  } catch (error) {
    console.error("Supplier post action: unexpected error", error);
    return { success: false, error: GENERIC_ERROR };
  }
}
