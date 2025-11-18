import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { randomUUID } from "crypto";

export const runtime = "nodejs"; // make sure this is here at top-level

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();

    const file = formData.get("file") as File | null;
    if (!file || typeof file === "string") {
      return NextResponse.json(
        { ok: false, error: "No file provided" },
        { status: 400 }
      );
    }

    // New: grab contact details from the form
    const contactName = (formData.get("contact_name") ?? "") as string;
    const contactEmail = (formData.get("contact_email") ?? "") as string;
    const company = (formData.get("company") ?? "") as string;
    const notes = (formData.get("notes") ?? "") as string;

    const supabase = supabaseServer;

    // 1) Upload file to storage bucket
    const fileExt = file.name.split(".").pop();
    const filePath = `uploads/${Date.now()}-${file.name}`;

    const { error: uploadError } = await supabase.storage
      .from("cad-uploads")
      .upload(filePath, file);

    if (uploadError) {
      console.error("Storage upload error", uploadError);
      return NextResponse.json(
        { ok: false, error: "Failed to upload file" },
        { status: 500 }
      );
    }

    // 2) Insert metadata row into public.uploads
    const { error: insertError } = await supabase
      .from("uploads")
      .insert({
        file_path: filePath,
        file_name: file.name,
        contact_name: contactName || null,
        contact_email: contactEmail || null,
        company: company || null,
        notes: notes || null,
        // created_at will default to now()
      });

    if (insertError) {
      console.error("Insert error", insertError);
      // We still return ok: true-ish but flag metadata failure
      return NextResponse.json(
        {
          ok: true,
          warning: "File stored, but metadata insert failed.",
        },
        { status: 200 }
      );
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    console.error("Upload handler error", err);
    return NextResponse.json(
      { ok: false, error: "Unexpected error" },
      { status: 500 }
    );
  }
}