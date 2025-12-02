import { supabaseServer } from "@/lib/supabaseServer";
import { requireAdminUser } from "@/server/auth";

type AwardResult = {
  ok: boolean;
  error: string | null;
};

function normalizeId(value?: string | null): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function awardBidForQuoteAction(
  quoteIdRaw: string,
  bidIdRaw: string,
): Promise<AwardResult> {
  const admin = await requireAdminUser();

  const quoteId = normalizeId(quoteIdRaw);
  const bidId = normalizeId(bidIdRaw);

  if (!quoteId || !bidId) {
    return { ok: false, error: "Invalid quote or bid id." };
  }

  console.info("[admin award] start", {
    quoteId,
    bidId,
    adminId: admin.id,
    adminEmail: admin.email ?? null,
  });

  const { error } = await supabaseServer.rpc("award_bid_for_quote", {
    p_quote_id: quoteId,
    p_bid_id: bidId,
  });

  if (error) {
    console.error("[admin award] failed", {
      quoteId,
      bidId,
      error,
    });
    return {
      ok: false,
      error: "We couldn't update the award state. Please retry.",
    };
  }

  console.info("[admin award] success", {
    quoteId,
    bidId,
  });

  return { ok: true, error: null };
}
