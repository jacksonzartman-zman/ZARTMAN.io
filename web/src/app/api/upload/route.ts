import { NextResponse } from "next/server";
export const runtime = "edge";
export async function POST() {
  return NextResponse.json(
    { ok: false, error: "Deprecated endpoint. Use /app/api/upload handler." },
    { status: 404, headers: { "cache-control": "no-store" } }
  );
}
