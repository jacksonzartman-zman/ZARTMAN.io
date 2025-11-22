"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabaseServer";
import { DEFAULT_UPLOAD_STATUS, parseUploadStatusInput } from "../../constants";

export async function updateUpload(formData: FormData) {
  const id = formData.get("id");
  const status = formData.get("status");
  const adminNotes = formData.get("admin_notes");

  if (typeof id !== "string" || !id) {
    console.error("updateUpload: missing or invalid id", id);
    return;
  }

  const supabase = supabaseServer;
  const normalizedStatus =
    typeof status === "string" && status.length > 0
      ? (parseUploadStatusInput(status) ?? DEFAULT_UPLOAD_STATUS)
      : DEFAULT_UPLOAD_STATUS;

  // 1) Update the uploads table
  const { error: uploadError } = await supabase
    .from("uploads")
    .update({
      status: normalizedStatus,
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

  // 2) Ensure there's a quote record for this upload

  // Check for an existing quote row tied to this upload
  const { data: existingQuote, error: fetchQuoteError } = await supabase
    .from("quotes")
    .select("id")
    .eq("upload_id", id)
    .maybeSingle();

  if (fetchQuoteError) {
    console.error("updateUpload: error fetching quote", fetchQuoteError);
  }

    const quoteStatus = normalizedStatus ?? DEFAULT_UPLOAD_STATUS;
    const quoteInternalNotes =
      typeof adminNotes === "string" && adminNotes.length > 0 ? adminNotes : null;

    if (existingQuote?.id) {
      // Update existing quote
      const { error: quoteUpdateError } = await supabase
        .from("quotes")
        .update({
          status: quoteStatus,
          internal_notes: quoteInternalNotes,
        })
        .eq("id", existingQuote.id);

      if (quoteUpdateError) {
        console.error("updateUpload: error updating quote", quoteUpdateError);
      } else {
        const { error: linkError } = await supabase
          .from("uploads")
          .update({
            quote_id: existingQuote.id,
          })
          .eq("id", id);

        if (linkError) {
          console.error(
            "updateUpload: error linking existing quote to upload",
            linkError,
          );
        }
      }
    } else {
      // Insert a new quote row
      const { data: newQuote, error: quoteInsertError } = await supabase
        .from("quotes")
        .insert({
          upload_id: id,
          status: quoteStatus,
          internal_notes: quoteInternalNotes,
          // price, currency, target_date, customer_note can stay NULL / defaults
        })
        .select("id")
        .single<{ id: string }>();

      if (quoteInsertError) {
        console.error("updateUpload: error inserting quote", quoteInsertError);
      } else if (newQuote?.id) {
        const { error: linkError } = await supabase
          .from("uploads")
          .update({
            quote_id: newQuote.id,
          })
          .eq("id", id);

        if (linkError) {
          console.error(
            "updateUpload: error linking new quote to upload",
            linkError,
          );
        }
      }
    }

  // 3) Revalidate and redirect back to this upload
  revalidatePath("/admin");
  revalidatePath(`/admin/uploads/${id}`);
  redirect(`/admin/uploads/${id}?updated=1`);
}
