import { serializeActionError } from "@/lib/forms";
import { getCustomerById } from "@/server/customers";
import {
  loadQuoteWinningContext,
  loadWinningBidNotificationContext,
} from "@/server/quotes/notificationContext";
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
};

export async function dispatchWinnerNotification({
  quoteId,
  bidId,
  caller,
}: DispatchInput) {
  const prefix = CALLER_LOG_PREFIX[caller] ?? "[winner notifications]";

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

    const customer =
      quoteContext.customer_id && quoteContext.customer_id.length > 0
        ? await getCustomerById(quoteContext.customer_id)
        : null;

    await notifyOnWinningBidSelected({
      quote: quoteContext,
      winningBid: winnerContext.winningBid,
      supplier: winnerContext.supplier,
      customer,
    });
  } catch (error) {
    console.error(`${prefix} winner notification failed`, {
      quoteId,
      bidId,
      error: serializeActionError(error),
    });
  }
}
