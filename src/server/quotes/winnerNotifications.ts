import { serializeActionError } from "@/lib/forms";
import { getCustomerByEmail } from "@/server/customers";
import {
  loadQuoteWinningContext,
  loadWinningBidNotificationContext,
} from "@/server/quotes/notificationContext";
import type { QuoteWinningContext } from "@/server/quotes/notificationTypes";
import { notifyOnWinningBidSelected } from "@/server/quotes/notifications";

export type WinnerNotificationCaller = "admin" | "customer";

const CALLER_LOG_PREFIX: Record<WinnerNotificationCaller, string> = {
  admin: "[admin bids]",
  customer: "[customer award]",
};

type DispatchInput = {
  quoteId: string;
  bidId: string;
  caller: WinnerNotificationCaller;
  actorUserId: string;
};

export async function dispatchWinnerNotification({
  quoteId,
  bidId,
  caller,
  actorUserId,
}: DispatchInput) {
  const prefix = CALLER_LOG_PREFIX[caller] ?? "[winner notifications]";
  const normalizedActorUserId = normalizeId(actorUserId);
  if (!normalizedActorUserId) {
    console.warn(`${prefix} winner notification missing actor`, {
      quoteId,
      bidId,
      caller,
      reason: "missing-actor",
    });
  }

  try {
    const [quoteContext, winnerContext] = await Promise.all([
      loadQuoteWinningContext(quoteId),
      loadWinningBidNotificationContext(bidId),
    ]);

    if (!quoteContext || !winnerContext) {
      console.warn(`${prefix} winner notification skipped`, {
        quoteId,
        bidId,
        reason: !quoteContext
          ? "missing-quote-context"
          : "missing-bid-context",
      });
      return;
    }

    const customer = await loadCustomerForQuoteCustomer(quoteContext);

    await notifyOnWinningBidSelected({
      quote: quoteContext,
      winningBid: winnerContext.winningBid,
      supplier: winnerContext.supplier,
      customer,
      actor: {
        role: caller,
        userId: normalizedActorUserId || null,
      },
    });
  } catch (error) {
    console.error(`${prefix} winner notification failed`, {
      quoteId,
      bidId,
      error: serializeActionError(error),
    });
  }
}

async function loadCustomerForQuoteCustomer(
  quote: QuoteWinningContext,
) {
  const email = normalizeEmail(quote.customer_email);
  if (!email) {
    console.log("[quote notifications] customer enrichment skipped", {
      quoteId: quote.id,
      reason: "missing-email",
    });
    return null;
  }

  const customer = await getCustomerByEmail(email);
  if (!customer) {
    console.log("[quote notifications] customer enrichment skipped", {
      quoteId: quote.id,
      email,
      reason: "not-found",
    });
  }
  return customer;
}

function normalizeEmail(value?: string | null): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function normalizeId(value?: string | null): string {
  return typeof value === "string" ? value.trim() : "";
}
