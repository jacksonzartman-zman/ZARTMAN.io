import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "edge"; // Cloudflare Pages runs on edge
export const preferredRegion = "auto";

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("file") as File | null;
    if (!file)
      return NextResponse.json({ ok: false, error: "No file" }, { status: 400 });

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY!; // server-only

    // In Cloudflare Workers, pass global fetch explicitly
    const supabase = createClient(url, key, { global: { fetch } as any });

    const objectKey = `${Date.now()}-${file.name}`;
    const { data, error } = await supabase.storage.from("cad").upload(objectKey, file, {
      upsert: false,
      cacheControl: "3600",
    });

    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });

    const pub = supabase.storage.from("cad").getPublicUrl(objectKey).data.publicUrl;
    return NextResponse.json({ ok: true, key: objectKey, publicUrl: pub });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}
