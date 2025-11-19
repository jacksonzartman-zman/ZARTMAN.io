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

    // 3 NEW: ensure there is a customer record for this upload
    let customerId: string | null = null;

    const { data: customer, error: customerError } = await supabase
      .from("customers")
      .upsert(
      {
        name,
        email,
        company,
      },
      {
        onConflict: "email", // relies on UNIQUE(email)
      },
      )
      .select("id, email")
      .single();

  console.log("UPSERT CUSTOMER RESULT", { customer, customerError });

    if (customerError) {
  // Don't block the upload, but log so we can debug in Vercel/dev logs
  console.error("Customer upsert failed", customerError);
  } else if (customer) {
      customerId = customer.id as string;
  }

// 4 Insert the upload row, linking to the customer if we have one
  const { data: uploadRow, error: uploadError } = await supabase
    .from("uploads")
    .insert({
      file_name: file.name,
      file_path: filePath,
      mime_type: file.type,
      name,
      email,
      company,
      notes,
      customer_id: customerId, // can be null if upsert failed
    })
    .select("id, customer_id")
  .single();

  console.log("UPLOAD INSERT RESULT", { uploadRow, uploadError });

    if (uploadError) {
  console.error("Upload row insert failed", uploadError);
    return NextResponse.json(
    {
      success: false,
      // TEMP: bubble the actual DB error so we can see what's wrong
      message: `Failed to save upload metadata: ${uploadError.message}`,
    },
    { status: 500 },
   );
    }

      console.log("UPLOAD INSERT RESULT", { uploadRow, uploadError });

    if (uploadError) {
      console.error("Upload row insert failed", uploadError);
      return NextResponse.json(
      {
        success: false,
        // Keep it simple for the client; details are in the server logs
        message: "Failed to save upload metadata",
      },
      { status: 500 },
    );
  }

  // Success — respond OK
  return NextResponse.json({
    success: true,
    message: "Upload complete",
    uploadId: uploadRow.id,
  });
  } catch (err: any) {
    console.error('Upload handler error', err);
    return NextResponse.json(
      { success: false, message: err?.message ?? String(err) },
      { status: 500 }
    );
  }
}