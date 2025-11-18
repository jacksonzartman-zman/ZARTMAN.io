// src/app/api/upload/route.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs"; // important for file uploads

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();

    const file = formData.get("file") as File | null;

    const contactName = (formData.get("contact_name") ?? "").toString();
    const contactEmail = (formData.get("contact_email") ?? "").toString();
    const company = (formData.get("company") ?? "").toString();
    const notes = (formData.get("notes") ?? "").toString();

    if (!file || typeof file === "string") {
      return NextResponse.json(
        { success: false, error: "No file uploaded" },
        { status: 400 }
      );
    }

    // Build a storage path – you can tweak this later if you want
    const fileName = file.name;
    const timestamp = Date.now();
    const storagePath = `uploads/${timestamp}-${fileName}`;

    // Upload to Supabase Storage
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const storage = supabaseServer.storage.from("cad-uploads");
    const { error: uploadError } = await storage.upload(storagePath, buffer, {
      contentType: file.type || "application/octet-stream",
    });

    if (uploadError) {
      console.error("Storage upload error:", uploadError);
      return NextResponse.json(
        { success: false, error: "Failed to upload file to storage." },
        { status: 500 }
      );
    }

    // Insert metadata into uploads table
    const { error: insertError } = await supabaseServer
      .from("uploads")
      .insert({
        file_path: storagePath,
        file_name: fileName,
        file_size: file.size,
        file_type: file.type,
        contact_name: contactName || null,
        contact_email: contactEmail || null,
        company: company || null,
        notes: notes || null,
      });

    if (insertError) {
      console.error("DB insert error:", insertError);
      return NextResponse.json(
        { success: false, error: "Failed to save upload metadata." },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Unexpected upload error:", err);
    return NextResponse.json(
      { success: false, error: "Unexpected server error." },
      { status: 500 }
    );
  }
}