// src/app/admin/uploads/[id]/actions.ts
"use server";

import { supabaseServer } from "@/lib/supabaseServer";

export async function updateUpload(formData: FormData) {
  const id = formData.get("id") as string;
  const status = (formData.get("status") as string | null) || null;
  const adminNotes = (formData.get("admin_notes") as string | null) || null;

  if (!id) {
    console.error("updateUpload: missing id");
    return;
  }

  const supabase = supabaseServer;

  const { error } = await supabase
    .from("uploads")
    .update({
      status,
      admin_notes: adminNotes,
    })
    .eq("id", id);

  if (error) {
    console.error("updateUpload error", error);
  }
}