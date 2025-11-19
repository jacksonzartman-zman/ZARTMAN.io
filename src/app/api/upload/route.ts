import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();

    const file = formData.get("file") as File | null;
    const name = (formData.get("name") ?? "") as string;
    const email = (formData.get("email") ?? "") as string;
    const company = (formData.get("company") ?? "") as string;
    const notes = (formData.get("notes") ?? "") as string;

    if (!file) {
      return NextResponse.json(
        { error: "Missing file in request" },
        { status: 400 }
      );
    }

// --- Backend file-type validation (security + consistency) ---
const allowedExts = [
  "step",
  "stp",
  "iges",
  "igs",
  "stl",
  "sldprt",
  "sldasm",
  "zip",
  "prt",
  "sat",
  "x_t",
  "x_b",
  "ipt",
];

const lowerName = file.name.toLowerCase();
const parts = lowerName.split(".");
const ext = parts.length > 1 ? parts.pop()! : "";

// Reject non-CAD files BEFORE uploading to Supabase
if (!allowedExts.includes(ext)) {
  return NextResponse.json(
    {
      message:
        "Unsupported file type. Please upload STEP, IGES, STL, SolidWorks, or zipped CAD files.",
    },
    { status: 400 }
  );
}
// --------------------------------------------------------------

    if (!name || !email) {
      return NextResponse.json(
        { error: "Name and email are required" },
        { status: 400 }
      );
    }

    // ❗ FIXED: supabaseServer is NOT a function — it's already a client
    const supabase = supabaseServer;

    // Create a unique-ish path
    const timestamp = Date.now();
    const safeName = file.name.replace(/\s+/g, "-");
    const filePath = `uploads/${timestamp}-${safeName}`;

    // Upload file to storage
    const { error: uploadError } = await supabase.storage
      .from("cad-uploads")
      .upload(filePath, file, {
        cacheControl: "3600",
        upsert: false,
      });

    if (uploadError) {
      console.error("Supabase storage upload error:", uploadError);
      return NextResponse.json(
        { error: "Failed to upload file to storage" },
        { status: 500 }
      );
    }

    // Save metadata
    const { error: insertError } = await supabase.from("uploads").insert({
      file_name: file.name,
      file_path: filePath,
      file_type: file.type,
      contact_name: name,
      contact_email: email,
      company,
      notes,
    });

    if (insertError) {
      console.error("Supabase insert error:", insertError);
      return NextResponse.json(
        { error: "Failed to save upload metadata" },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        success: true,
        message: "Upload successful",
      },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("Unexpected upload error:", err);
    return NextResponse.json(
      { error: "Unexpected error during upload" },
      { status: 500 }
    );
  }
}