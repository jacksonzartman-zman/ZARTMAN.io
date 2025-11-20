"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabaseServer";

export async function updateUpload(formData: FormData) {
  // Read fields from the form
  const id = formData.get("id");
  const status = formData.get("status");
  const adminNotes = formData.get("admin_notes");

  if (typeof id !== "string" || !id) {
    console.error("updateUpload: missing or invalid id", id);
    return;
  }

  const supabase = supabaseServer;

  // 1) Update the uploads row
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

  // 2) OPTIONAL: also create / upsert a quote row
  // ⚠️ You MUST adapt the column names to your actual `quotes` schema.
  // Example if your quotes table has: id (uuid), upload_id, status, notes
  /*
  const { error: quoteError } = await supabase
    .from("quotes")
    .insert({
      upload_id: id,
      status:
        typeof status === "string" && status.length > 0 ? status : null,
      notes:
        typeof adminNotes === "string" && adminNotes.length > 0
          ? adminNotes
          : null,
    });

  if (quoteError) {
    console.error("updateUpload: error inserting quote", quoteError);
  }
  */

  // Make sure the dashboard + detail page show the latest data
  revalidatePath("/admin");
  revalidatePath(`/admin/uploads/${id}`);

  // Simple UX: send you back to the same page
  redirect(`/admin/uploads/${id}`);
}