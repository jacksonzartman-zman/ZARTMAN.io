// src/app/admin/quotes/actions.ts

"use server";

import { isRedirectError } from "next/dist/client/components/redirect-error";
import { supabaseServer } from "@/lib/supabaseServer";
import { redirect } from "next/navigation";

export async function updateQuote(formData: FormData) {
  const supabase = supabaseServer;

  const id = formData.get("id") as string;

  const status = formData.get("status") as string;
  const priceRaw = formData.get("price") as string;
  const currency = formData.get("currency") as string;
  const targetDate = formData.get("target_date") as string;
  const internalNotes = formData.get("internal_notes") as string;

  const price =
    priceRaw && priceRaw.length > 0 ? parseFloat(priceRaw) : null;

  const { error } = await supabase
    .from("quotes")
    .update({
      status,
      price,
      currency,
      target_date: targetDate || null,
      internal_notes: internalNotes || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) {
    console.error("Quote update error", error);
    throw new Error("Failed to update quote.");
  }

  return redirect(`/admin/quotes/${id}?updated=1`);
}

export type QuoteFormState = {
  error?: string;
};

export async function handleQuoteFormSubmit(
  _prevState: QuoteFormState,
  formData: FormData,
): Promise<QuoteFormState> {
  try {
    await updateQuote(formData);
    return {};
  } catch (error) {
    if (isRedirectError(error)) {
      throw error;
    }

    console.error("handleQuoteFormSubmit error", error);
    return { error: "Failed to save changes. Please try again." };
  }
}