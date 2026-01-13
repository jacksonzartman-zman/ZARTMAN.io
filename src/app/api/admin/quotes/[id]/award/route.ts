import { NextResponse } from "next/server";

import { supabaseServer } from "@/lib/supabaseServer";
import { requireAdminUser, UnauthorizedError } from "@/server/auth";
import { createQuoteMessage } from "@/server/quotes/messages";
import { performAwardFlow } from "@/server/quotes/award";

export async function POST(
  req: Request,
  context: { params: Promise<{ id?: string }> },
) {
  const params = await context.params;
  const quoteId = typeof params?.id === "string" ? params.id.trim() : "";

  try {
    const admin = await requireAdminUser();

    const body = (await req.json().catch(() => null)) as
      | { bidId?: unknown }
      | null;
    const bidId = typeof body?.bidId === "string" ? body.bidId.trim() : "";

    console.log("[award] start", { quoteId, bidId });

    if (!isUuidLike(quoteId)) {
      return NextResponse.json(
        { ok: false, error: "invalid_quote_id" },
        { status: 400 },
      );
    }

    if (!isUuidLike(bidId)) {
      return NextResponse.json(
        { ok: false, error: "invalid_bid_id" },
        { status: 400 },
      );
    }

    const { data: quote, error: quoteError } = await supabaseServer
      .from("quotes")
      .select("id,awarded_bid_id")
      .eq("id", quoteId)
      .maybeSingle<{ id: string; awarded_bid_id: string | null }>();

    if (quoteError) {
      console.error("[award] failed", {
        quoteId,
        bidId,
        code: (quoteError as { code?: string | null })?.code ?? null,
        message: (quoteError as { message?: string | null })?.message ?? null,
      });
      return NextResponse.json(
        { ok: false, error: "quote_lookup_failed" },
        { status: 500 },
      );
    }

    if (!quote?.id) {
      return NextResponse.json(
        { ok: false, error: "not_found" },
        { status: 404 },
      );
    }

    const { data: bid, error: bidError } = await supabaseServer
      .from("supplier_bids")
      .select("id,quote_id,supplier_id")
      .eq("id", bidId)
      .maybeSingle<{ id: string; quote_id: string; supplier_id: string | null }>();

    if (bidError) {
      console.error("[award] failed", {
        quoteId,
        bidId,
        code: (bidError as { code?: string | null })?.code ?? null,
        message: (bidError as { message?: string | null })?.message ?? null,
      });
      return NextResponse.json(
        { ok: false, error: "bid_lookup_failed" },
        { status: 500 },
      );
    }

    if (!bid?.id || !bid?.quote_id) {
      return NextResponse.json(
        { ok: false, error: "not_found" },
        { status: 404 },
      );
    }

    if (bid.quote_id !== quoteId) {
      return NextResponse.json(
        { ok: false, error: "not_found" },
        { status: 404 },
      );
    }

    const awardedBidId =
      typeof quote.awarded_bid_id === "string" ? quote.awarded_bid_id.trim() : "";
    if (awardedBidId) {
      if (awardedBidId === bidId) {
        console.log("[award] blocked already awarded", {
          quoteId,
          awardedBidId,
        });
        return NextResponse.json({
          ok: true,
          alreadyAwarded: true,
          quoteId,
          bidId,
          supplierId: bid.supplier_id,
        });
      }

      console.log("[award] blocked already awarded", {
        quoteId,
        awardedBidId,
      });
      return NextResponse.json(
        { ok: false, error: "quote_already_awarded" },
        { status: 409 },
      );
    }

    const awardResult = await performAwardFlow({
      quoteId,
      bidId,
      actorRole: "admin",
      actorUserId: admin.id,
      actorEmail: admin.email ?? null,
    });

    if (!awardResult.ok) {
      const reason = awardResult.reason ?? "unknown";
      const message = awardResult.error ?? "Award failed.";

      console.error("[award] failed", {
        quoteId,
        bidId,
        code: reason,
        message,
      });

      if (reason === "invalid_input") {
        return NextResponse.json(
          { ok: false, error: "invalid_input" },
          { status: 400 },
        );
      }

      if (reason === "quote_not_found" || reason === "bid_not_found") {
        return NextResponse.json(
          { ok: false, error: "not_found" },
          { status: 404 },
        );
      }

      if (reason === "winner_exists") {
        return NextResponse.json(
          { ok: false, error: "quote_already_awarded" },
          { status: 409 },
        );
      }

      return NextResponse.json(
        { ok: false, error: "write_failed" },
        { status: 500 },
      );
    }

    const supplierId = awardResult.awardedSupplierId ?? bid.supplier_id ?? null;

    // Optional, best-effort system message (do not fail the award if this write fails).
    try {
      await createQuoteMessage({
        quoteId,
        senderId: admin.id,
        senderRole: "system",
        senderName: "Zartman.io",
        senderEmail: admin.email ?? "admin@zartman.io",
        body: "Awarded supplier. Next: Kickoff.",
      });
    } catch (error) {
      console.warn("[award] system message insert failed", {
        quoteId,
        bidId,
        code: (error as { code?: string | null })?.code ?? null,
        message: (error as { message?: string | null })?.message ?? null,
      });
    }

    console.log("[award] success", {
      quoteId,
      bidId,
      supplierId,
    });

    return NextResponse.json({
      ok: true,
      quoteId,
      bidId,
      supplierId,
    });
  } catch (err: unknown) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json(
        { ok: false, error: "unauthorized" },
        { status: 401 },
      );
    }

    console.error("[award] failed", {
      quoteId,
      code: (err as { code?: string | null })?.code ?? null,
      message: (err as { message?: string | null })?.message ?? null,
    });
    return NextResponse.json({ ok: false, error: "unknown" }, { status: 500 });
  }
}

function isUuidLike(value: string): boolean {
  const v = typeof value === "string" ? value.trim() : "";
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

