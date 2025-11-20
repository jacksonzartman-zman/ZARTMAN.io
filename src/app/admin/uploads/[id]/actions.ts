"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabaseServer";

export async function updateUpload(formData: FormData) {
  const id = formData.get("id");
  const status = formData.get("status");
  const adminNotes = formData.get("admin_notes");

  if (typeof id !== "string" || !id) {
    console.error("updateUpload: missing or invalid id", id);
    return;
  }

  const supabase = supabaseServer;

  // 1) Update uploads
  const { error: uploadError } = await supabase
    .from("uploads")
    .update({
      status:
        typeof status === "string" && status.length > 0 ? status : null,
      admin_notes:
        typeof adminNotes === "string" && adminNotes.length > 0
          ? adminNotes
          : null,
    })
    .eq("id", id);

  if (uploadError) {
    console.error("updateUpload: error updating uploads", uploadError);
    return;
  }

  // 2) Sync quotes table for this upload
  // --- ADJUST THESE COLUMN NAMES to match your quotes table ---
  // Example assumed schema:
  //   quotes: id (uuid), upload_id (uuid), status (text), notes (text)
  const uploadIdColumn = "upload_id"; // change if needed
  const quoteStatusColumn = "status"; // change if needed
  const quoteNotesColumn = "notes";   // change if needed

  // Check if a quote already exists for this upload
  const { data: existingQuote, error: fetchQuoteError } = await supabase
    .from("quotes")
    .select("id")
    .eq(uploadIdColumn, id)
    .maybeSingle();

  if (fetchQuoteError) {
    console.error("updateUpload: error fetching quote", fetchQuoteError);
  } else if (existingQuote?.id) {
    // Update existing quote
    const { error: quoteUpdateError } = await supabase
      .from("quotes")
      .update({
        [quoteStatusColumn]:
          typeof status === "string" && status.length > 0 ? status : null,
        [quoteNotesColumn]:
          typeof adminNotes === "string" && adminNotes.length > 0
            ? adminNotes
            : null,
      })
      .eq("id", existingQuote.id);

    if (quoteUpdateError) {
      console.error("updateUpload: error updating quote", quoteUpdateError);
    }
  } else {
    // Insert new quote
    const { error: quoteInsertError } = await supabase.from("quotes").insert({
      [uploadIdColumn]: id,
      [quoteStatusColumn]:
        typeof status === "string" && status.length > 0 ? status : null,
      [quoteNotesColumn]:
        typeof adminNotes === "string" && adminNotes.length > 0
          ? adminNotes
          : null,
    });

    if (quoteInsertError) {
      console.error("updateUpload: error inserting quote", quoteInsertError);
    }
  }

  // 3) Revalidate + redirect
  revalidatePath("/admin");
  revalidatePath(`/admin/uploads/${id}`);
  redirect(`/admin/uploads/${id}`);
}