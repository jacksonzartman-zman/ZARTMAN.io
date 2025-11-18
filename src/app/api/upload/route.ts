import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();

    const file = formData.get("file");
    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { success: false, error: "No file uploaded." },
        { status: 400 }
      );
    }

    // 💬 Text fields from the form
    const contactName = (formData.get("contact_name") ?? "") as string;
    const contactEmail = (formData.get("contact_email") ?? "") as string;
    const company = (formData.get("company") ?? "") as string;
    const notes = (formData.get("notes") ?? "") as string;

    const originalName = file.name;
    const ext = originalName.split(".").pop() ?? "";
    const safeExt = ext.toLowerCase();

    // Unique path in the cad-uploads bucket
    const filePath = `uploads/${Date.now()}-${originalName}`;

    const supabase = supabaseServer;

    // 1) Upload to Storage
    const { error: storageError } = await supabase.storage
      .from("cad-uploads")
      .upload(filePath, file, {
        contentType: file.type || "application/octet-stream",
        upsert: false,
      });

    if (storageError) {
      console.error("Supabase storage error:", storageError);
      return NextResponse.json(
        { success: false, error: `Storage error: ${storageError.message}` },
        { status: 500 }
      );
    }

    // 2) Insert metadata into uploads table
    const { error: dbError } = await supabase.from("uploads").insert({
      file_path: filePath,
      file_name: originalName,
      file_size: file.size,
      file_type: file.type || safeExt || null,
      contact_name: contactName || null,
      contact_email: contactEmail || null,
      company: company || null,
      notes: notes || null,
    });

    if (dbError) {
      console.error("Supabase insert error:", dbError);
      return NextResponse.json(
        {
          success: false,
          error: `DB error: ${dbError.message}`,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err: any) {
    console.error("Unexpected upload error:", err);
    return NextResponse.json(
      {
        success: false,
        error: err?.message ?? "Unexpected error while uploading.",
      },
      { status: 500 }
    );
  }
}