"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { ADMIN_COOKIE_NAME } from "./constants";
import { supabaseServer } from "@/lib/supabaseServer";

// 1) Simple admin password auth
export async function authenticate(formData: FormData): Promise<void> {
  const password = (formData.get("password") ?? "").toString();
  const expected = process.env.ADMIN_PASSWORD ?? "";

  // If env var isn't set, treat as config error
  if (!expected) {
    console.error("ADMIN_PASSWORD is not set in the environment.");
    redirect("/admin?error=config");
  }

  if (password !== expected) {
    // Wrong password → bounce back with error flag
    redirect("/admin?error=invalid");
  }

  // Correct password → set cookie and go to admin dashboard
  const cookieStore = await cookies(); // 🔑 note the await
  cookieStore.set(ADMIN_COOKIE_NAME, "ok", {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 6, // 6 hours
  });

  redirect("/admin");
}

// 2) Create a quote row from an upload (called from the main admin uploads table)
export async function createQuoteFromUpload(formData: FormData): Promise<void> {
  const uploadId = (formData.get("upload_id") ?? "").toString();
  if (!uploadId) {
    throw new Error("Missing upload id.");
  }

  // supabaseServer is already a client, don't call it
  const supabase = supabaseServer as any;

  // Optional: sanity check the upload exists
  const { data: upload, error: uploadError } = await supabase
    .from("uploads")
    .select("id")
    .eq("id", uploadId)
    .maybeSingle();

  if (uploadError) {
    console.error("Error checking upload before creating quote:", uploadError);
    throw new Error("Failed to verify upload.");
  }

  if (!upload) {
    throw new Error("Upload not found.");
  }

  const { error } = await supabase.from("quotes").insert({
    upload_id: uploadId,
    status: "new",
  });

  if (error) {
    console.error("Error creating quote:", error);
    throw new Error("Failed to create quote.");
  }

  // Refresh admin pages that show quotes
  revalidatePath("/admin");
  revalidatePath("/admin/quotes");
}

// 3) Update pricing / status on a quote (used on /admin/quotes/[id])
export async function updateQuote(formData: FormData): Promise<void> {
  const quoteId = (formData.get("quote_id") ?? "").toString();
  if (!quoteId) {
    throw new Error("Missing quote id.");
  }

  const status = (formData.get("status") ?? "").toString() || "new";
  const priceRaw = (formData.get("price") ?? "").toString();
  const currency = (formData.get("currency") ?? "").toString() || "USD";
  const targetDate = (formData.get("target_date") ?? "").toString();

  const price =
    priceRaw.trim().length > 0 && !Number.isNaN(Number(priceRaw))
      ? Number(priceRaw)
      : null;

  const supabase = supabaseServer as any;

  const { error } = await supabase
    .from("quotes")
    .update({
      status,
      price,
      currency,
      target_date: targetDate || null,
    })
    .eq("id", quoteId);

  if (error) {
    console.error("Error updating quote:", error);
    throw new Error("Failed to update quote.");
  }

  revalidatePath("/admin/quotes");
  revalidatePath(`/admin/quotes/${quoteId}`);
}