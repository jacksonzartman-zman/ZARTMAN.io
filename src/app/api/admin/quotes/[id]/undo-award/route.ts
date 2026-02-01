import { NextResponse } from "next/server";
import { revalidateQuoteAwardPaths } from "@/server/quotes/award";
import { supabaseServer } from "@/lib/supabaseServer";
import { requireAdminUser, UnauthorizedError } from "@/server/auth";

const WIN_STATUS_VALUES = ["won", "winner", "accepted", "approved"];
const RESETTABLE_STATUS_VALUES = [...WIN_STATUS_VALUES, "lost"];

export async function POST(
  _req: Request,
  context: { params: Promise<{ id?: string }> },
) {
  const params = await context.params;
  const quoteId = typeof params?.id === "string" ? params.id.trim() : "";

  try {
    await requireAdminUser();

    if (!isUuidLike(quoteId)) {
      return NextResponse.json(
        { ok: false, error: "invalid_quote_id" },
        { status: 400 },
      );
    }

    const { data: quote, error: quoteError } = await supabaseServer()
      .from("quotes")
      .select(
        "id,status,awarded_bid_id,awarded_supplier_id,awarded_at,awarded_by_user_id,awarded_by_role,awarded_provider_id,awarded_offer_id",
      )
      .eq("id", quoteId)
      .maybeSingle<{
        id: string;
        status: string | null;
        awarded_bid_id: string | null;
        awarded_supplier_id: string | null;
        awarded_at: string | null;
        awarded_by_user_id: string | null;
        awarded_by_role: string | null;
        awarded_provider_id?: string | null;
        awarded_offer_id?: string | null;
      }>();

    if (quoteError) {
      return NextResponse.json(
        { ok: false, error: "quote_lookup_failed" },
        { status: 500 },
      );
    }

    if (!quote?.id) {
      return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
    }

    const hasAward =
      Boolean((quote.awarded_bid_id ?? "").trim()) ||
      Boolean((quote.awarded_supplier_id ?? "").trim()) ||
      Boolean((quote.awarded_at ?? "").trim()) ||
      Boolean(((quote as any).awarded_provider_id ?? "").trim?.()) ||
      Boolean(((quote as any).awarded_offer_id ?? "").trim?.());

    // Idempotent: if there's nothing to undo, succeed.
    if (!hasAward) {
      revalidateQuoteAwardPaths(quoteId);
      return NextResponse.json({ ok: true, quoteId, undone: false });
    }

    // Restore quote status to a non-terminal state when possible.
    // Keep this conservative: if the quote wasn't "won", don't override its status.
    const statusWasWon = (quote.status ?? "").trim().toLowerCase() === "won";
    const { data: anyBidRow } = await supabaseServer()
      .from("supplier_bids")
      .select("id")
      .eq("quote_id", quoteId)
      .limit(1)
      .maybeSingle<{ id: string }>();
    const hasAnyBids = Boolean(anyBidRow?.id);
    const nextStatus = statusWasWon ? (hasAnyBids ? "quoted" : "in_review") : null;

    const now = new Date().toISOString();

    // 1) Clear quote-level award fields.
    // Keep this robust to schema variants; unknown columns are ignored by PostgREST if not present.
    const quoteUpdatePayload: Record<string, unknown> = {
      awarded_bid_id: null,
      awarded_supplier_id: null,
      awarded_at: null,
      awarded_by_user_id: null,
      awarded_by_role: null,
      awarded_provider_id: null,
      awarded_offer_id: null,
      award_notes: null,
      updated_at: now,
    };
    if (nextStatus) quoteUpdatePayload.status = nextStatus;

    const { error: updateError } = await supabaseServer()
      .from("quotes")
      .update(quoteUpdatePayload)
      .eq("id", quoteId);

    if (updateError) {
      return NextResponse.json(
        { ok: false, error: "write_failed" },
        { status: 500 },
      );
    }

    // 2) Reset bid statuses that were likely set by the award flow so the quote can be re-awarded.
    // We only touch known "award" states and "lost"; we keep "declined/withdrawn" intact.
    await supabaseServer()
      .from("supplier_bids")
      .update({ status: "submitted" })
      .eq("quote_id", quoteId)
      .in("status", RESETTABLE_STATUS_VALUES);

    revalidateQuoteAwardPaths(quoteId);
    return NextResponse.json({ ok: true, quoteId, undone: true });
  } catch (err: unknown) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json(
        { ok: false, error: "unauthorized" },
        { status: 401 },
      );
    }
    return NextResponse.json({ ok: false, error: "unknown" }, { status: 500 });
  }
}

function isUuidLike(value: string): boolean {
  const v = typeof value === "string" ? value.trim() : "";
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

