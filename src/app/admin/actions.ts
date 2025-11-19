"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabaseServer";
import { ADMIN_COOKIE_NAME, ADMIN_PASSWORD } from "./constants";

/**
 * Simple password check for the admin area.
 * Used as the <form action={authenticate}> handler on /admin.
 */
export async function authenticate(formData: FormData): Promise<void> {
  const password = formData.get("password") as string | null;

  // For now we just bounce back to /admin on wrong password.
  if (password !== ADMIN_PASSWORD) {
    redirect("/admin");
  }

  const cookieStore = await cookies();

  cookieStore.set(ADMIN_COOKIE_NAME, "ok", {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });

  redirect("/admin");
}

/**
 * Create a new quote row tied to an upload, then go to the quote detail page.
 * Used as the <form action={createQuoteFromUpload}> handler in AdminTable.
 */
export async function createQuoteFromUpload(
  formData: FormData
): Promise<void> {
  const uploadId = formData.get("upload_id") as string | null;

  if (!uploadId) {
    console.error("Missing upload id when creating quote");
    redirect("/admin");
  }

  const supabase = supabaseServer as any;

  const { data, error } = await supabase
    .from("quotes")
    .insert({
      upload_id: uploadId,
      status: "New",
    })
    .select("id")
    .single();

  if (error || !data) {
    console.error("Error creating quote", error);
    redirect("/admin");
  }

  redirect(`/admin/quotes/${data.id}`);
}

/**
 * Update an existing quote (status / price / dates).
 * Used as the <form action={updateQuote}> handler on /admin/quotes/[id].
 */
export async function updateQuote(formData: FormData): Promise<void> {
  const quoteId = formData.get("quote_id") as string | null;

  if (!quoteId) {
    console.error("Missing quote id in updateQuote");
    redirect("/admin/quotes");
  }

  const status = formData.get("status") as string | null;
  const price = formData.get("price") as string | null;
  const currency = formData.get("currency") as string | null;
  const targetDate = formData.get("target_date") as string | null;

  const supabase = supabaseServer as any;

  const { error } = await supabase
    .from("quotes")
    .update({
      status,
      price: price ? Number(price) : null,
      currency,
      target_date: targetDate || null,
    })
    .eq("id", quoteId);

  if (error) {
    console.error("Error updating quote", error);
  }

  redirect(`/admin/quotes/${quoteId}`);
}