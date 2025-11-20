// src/app/admin/quotes/actions.ts

"use server";

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