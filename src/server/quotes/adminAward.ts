import { requireAdminUser } from "@/server/auth";
import {
  performAwardBidForQuote,
  type AwardResult,
} from "@/server/quotes/award";

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

  const logContext = {
    quoteId,
    bidId,
    adminId: admin.id,
    adminEmail: admin.email ?? null,
  };

  if (!quoteId || !bidId) {
    return performAwardBidForQuote({
      quoteId,
      bidId,
      caller: "admin",
    });
  }

  console.info("[admin award] start", logContext);

  const result = await performAwardBidForQuote({
    quoteId,
    bidId,
    caller: "admin",
  });

  if (!result.ok) {
    console.error("[admin award] failed", {
      ...logContext,
      error: result.error,
    });
    return result;
  }

  console.info("[admin award] success", {
    quoteId,
    bidId,
  });

  return result;
}
