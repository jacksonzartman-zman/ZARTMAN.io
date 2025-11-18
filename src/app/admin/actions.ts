"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { ADMIN_COOKIE_NAME } from "./constants";
import { supabaseServer } from "@/lib/supabaseServer";

/**
 * Simple password-based admin auth.
 */
export async function authenticate(formData: FormData) {
  const password = formData.get("password");
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (!adminPassword) {
    console.error("ADMIN_PASSWORD env var is not set");
    return { ok: false };
  }

  if (password !== adminPassword) {
    return { ok: false };
  }

  const cookieStore = await cookies();
  cookieStore.set(ADMIN_COOKIE_NAME, "ok", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 7, // 7 days
  });

  redirect("/admin");
}

/**
 * Create a quote row from an existing upload.
 */
export async function createQuoteFromUpload(formData: FormData) {
  const uploadId = formData.get("upload_id");

  if (typeof uploadId !== "string" || !uploadId) {
    console.error("createQuoteFromUpload: missing upload_id");
    return { ok: false };
  }

  const supabase = supabaseServer();

  const { error } = await supabase.from("quotes").insert({
    upload_id: uploadId,
    status: "new",
    price: null,
    currency: "USD",
    target_date: null,
  });

  if (error) {
    console.error("Error creating quote:", error);
    return { ok: false };
  }

  revalidatePath("/admin");
  revalidatePath("/admin/quotes");

  return { ok: true };
}

/**
 * Update status / price / currency / target_date for a quote.
 * This is the first step toward suppliers entering pricing.
 */
export async function updateQuote(formData: FormData) {
  const id = formData.get("quote_id");
  const status = formData.get("status");
  const priceRaw = formData.get("price");
  const currency = formData.get("currency");
  const targetDateRaw = formData.get("target_date");

  if (typeof id !== "string" || !id) {
    console.error("updateQuote: missing quote_id");
    return { ok: false };
  }

  const updates: any = {};

  if (typeof status === "string" && status.trim() !== "") {
    updates.status = status.trim();
  }

  if (typeof currency === "string" && currency.trim() !== "") {
    updates.currency = currency.trim();
  }

  if (typeof priceRaw === "string" && priceRaw.trim() !== "") {
    const n = Number(priceRaw);
    updates.price = Number.isNaN(n) ? null : n;
  } else {
    updates.price = null;
  }

  if (typeof targetDateRaw === "string" && targetDateRaw.trim() !== "") {
    // Supabase will parse this as a date
    updates.target_date = targetDateRaw;
  } else {
    updates.target_date = null;
  }

  const supabase = supabaseServer();
  const { error } = await supabase.from("quotes").update(updates).eq("id", id);

  if (error) {
    console.error("Error updating quote:", error);
    return { ok: false };
  }

  revalidatePath("/admin/quotes");
  revalidatePath(`/admin/quotes/${id}`);

  return { ok: true };
}