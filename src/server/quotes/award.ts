import { supabaseServer } from "@/lib/supabaseServer";
import { serializeActionError } from "@/lib/forms";

export type AwardCaller = "admin" | "customer" | "system";

export type AwardResult = {
  ok: boolean;
  error: string | null;
};

type PerformAwardInput = {
  quoteId: string;
  bidId: string;
  caller: AwardCaller;
};

function normalizeId(value?: string | null): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function performAwardBidForQuote(
  params: PerformAwardInput,
): Promise<AwardResult> {
  const quoteId = normalizeId(params?.quoteId);
  const bidId = normalizeId(params?.bidId);
  const caller = params?.caller ?? "system";
  const logContext = {
    quoteId: quoteId || null,
    bidId: bidId || null,
    caller,
  };

  if (!quoteId || !bidId) {
    console.warn("[award] failed", {
      ...logContext,
      reason: "invalid-identifiers",
    });
    return { ok: false, error: "Invalid quote or bid id." };
  }

  console.info("[award] start", logContext);

  const { error } = await supabaseServer.rpc("award_bid_for_quote", {
    p_quote_id: quoteId,
    p_bid_id: bidId,
  });

  if (error) {
    console.error("[award] failed", {
      ...logContext,
      error: serializeActionError(error),
    });
    return {
      ok: false,
      error: "We couldn't update the award state. Please retry.",
    };
  }

  console.info("[award] success", logContext);
  return { ok: true, error: null };
}
