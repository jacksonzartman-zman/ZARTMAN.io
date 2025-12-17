import { NextResponse } from "next/server";
import { createAuthClient } from "@/server/auth";
import { markQuoteMessagesRead } from "@/server/quotes/messageReads";

export async function POST(req: Request) {
  try {
    const payload = (await req.json()) as { quoteId?: unknown } | null;
    const quoteId = typeof payload?.quoteId === "string" ? payload.quoteId.trim() : "";
    if (!quoteId) {
      return NextResponse.json({ ok: false, error: "quoteId required" }, { status: 400 });
    }

    const supabase = createAuthClient();
    const { data, error } = await supabase.auth.getUser();
    if (error || !data?.user) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }

    const result = await markQuoteMessagesRead({
      quoteId,
      userId: data.user.id,
      supabase,
    });

    // Failure-safe: this endpoint should never block UX.
    return NextResponse.json({ ok: result.ok });
  } catch {
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}

