"use server";

import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabaseServer";

export async function updateUpload(formData: FormData) {
  const id = formData.get("id") as string;
  const status = (formData.get("status") as string | null) || null;
  const adminNotes = (formData.get("admin_notes") as string | null) || null;

  const supabase = supabaseServer;

  // Optional: debug log in Vercel
  console.log("updateUpload called with", { id, status, adminNotes });

  const { error } = await supabase
    .from("uploads")
    .update({
      status,
      admin_notes: adminNotes,
    })
    .eq("id", id);

  if (error) {
    console.error("Error updating upload", error);
    throw new Error("Failed to update upload");
  }

  // Refresh list + detail
  revalidatePath(`/admin/uploads/${id}`);
  revalidatePath("/admin");
}