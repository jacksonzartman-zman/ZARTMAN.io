import { formatCurrency } from "@/lib/formatCurrency";
import type { CustomerRow } from "@/server/customers";
import { sendNotificationEmail } from "@/server/notifications/email";
import {
  customerAllowsNotification,
  supplierAllowsNotification,
} from "@/server/notifications/preferences";
import { loadQuoteNotificationContext } from "@/server/quotes/notificationContext";
import type { QuoteMessageRow } from "@/server/quotes/messages";
import type {
  QuoteContactInfo,
  QuoteWinningContext,
} from "@/server/quotes/notificationTypes";
import type {
  SupplierBidRow,
  SupplierRow,
} from "@/server/suppliers/types";

type WinningBidParams = {
  quote: QuoteWinningContext;
  winningBid: SupplierBidRow;
  supplier: SupplierRow;
  customer: CustomerRow | null;
};

type MessageRecipient =
  | {
      type: "admin";
      email: string;
      label: string;
    }
  | {
    type: "customer";
    email: string;
    label: string;
  }
  | {
      type: "supplier";
      email: string;
      label: string;
      supplier?: SupplierRow | null;
    };

const ADMIN_NOTIFICATION_EMAIL =
  process.env.NOTIFICATIONS_ADMIN_EMAIL ?? "admin@zartman.io";
const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

export async function notifyOnNewQuoteMessage(
  message: QuoteMessageRow,
): Promise<void> {
  const context = await loadQuoteNotificationContext(message.quote_id);
  if (!context) {
    console.warn("[quote notifications] message skipped", {
      quoteId: message.quote_id,
      authorType: message.author_type,
      reason: "missing-quote-context",
    });
    return;
  }

  const { quote, customer } = context;
  const recipient = resolveMessageRecipient(message.author_type, quote);
  if (!recipient) {
    console.log("[quote notifications] message skipped", {
      quoteId: quote.id,
      authorType: message.author_type,
      reason: "recipient-unavailable",
    });
    return;
  }

  if (
    recipient.type === "customer" &&
    !customerAllowsNotification(customer, "quote_message_customer")
  ) {
    console.log("[quote notifications] message skipped due to preferences", {
      quoteId: quote.id,
      recipientType: "customer",
    });
    return;
  }

  if (
    recipient.type === "supplier" &&
    !supplierAllowsNotification(recipient.supplier ?? null, "quote_message_supplier")
  ) {
    console.log("[quote notifications] message skipped due to preferences", {
      quoteId: quote.id,
      recipientType: "supplier",
      supplierId: recipient.supplier?.id ?? null,
    });
    return;
  }

  try {
    await sendNotificationEmail({
      to: recipient.email,
      subject: `New message on RFQ ${getQuoteTitle(quote)}`,
      previewText: `${recipient.label} received a new message on quote ${quote.id}`,
      html: buildMessageHtml(message, quote, recipient.label),
    });
    console.log("[quote notifications] message dispatched", {
      quoteId: quote.id,
      authorType: message.author_type,
      recipientType: recipient.type,
    });
  } catch (error) {
    console.error("[quote notifications] message email failed", {
      quoteId: quote.id,
      authorType: message.author_type,
      recipientType: recipient.type,
      error,
    });
  }
}

export async function notifyOnWinningBidSelected(
  params: WinningBidParams,
): Promise<void> {
  const supplierEmail = params.supplier.primary_email ?? null;
  const customerEmail = params.customer?.email ?? params.quote.email ?? null;
  const quoteTitle = getQuoteTitle(params.quote);
  const supplierLink = buildPortalLink(`/supplier/quotes/${params.quote.id}`);
  const customerLink = buildPortalLink(`/customer/quotes/${params.quote.id}`);
  const bidPrice = coerceNumber(params.winningBid.unit_price);
  const formattedPrice = formatCurrency(
    bidPrice,
    params.winningBid.currency ?? params.quote.currency ?? "USD",
  );
  const leadTimeLabel =
    typeof params.winningBid.lead_time_days === "number"
      ? `${params.winningBid.lead_time_days} day${
          params.winningBid.lead_time_days === 1 ? "" : "s"
        }`
      : "Lead time not provided";

  const sends: Promise<void>[] = [];
  let supplierNotified = false;
  let customerNotified = false;

  if (supplierAllowsNotification(params.supplier, "winner_supplier")) {
    if (supplierEmail) {
      sends.push(
        sendNotificationEmail({
          to: supplierEmail,
          subject: `Your bid won – RFQ ${quoteTitle}`,
          previewText: `We selected your proposal for ${quoteTitle}.`,
          html: `
            <p>Congrats! Your bid for <strong>${quoteTitle}</strong> was selected as the winner.</p>
            <p><strong>Price:</strong> ${formattedPrice}<br/>
            <strong>Lead time:</strong> ${leadTimeLabel}</p>
            <p><a href="${supplierLink}">Open the supplier workspace</a> to review next steps.</p>
          `,
        }),
      );
      supplierNotified = true;
    }
  } else {
    console.log("[quote notifications] winner email skipped (supplier prefs)", {
      quoteId: params.quote.id,
      bidId: params.winningBid.id,
      supplierId: params.supplier.id,
    });
  }

  if (customerAllowsNotification(params.customer, "winner_customer")) {
    if (customerEmail) {
      sends.push(
        sendNotificationEmail({
          to: customerEmail,
          subject: `Winning supplier selected for your RFQ`,
          previewText: `We marked a winning supplier for ${quoteTitle}.`,
          html: `
            <p>You selected <strong>${params.supplier.company_name ?? "a supplier"}</strong> for <strong>${quoteTitle}</strong>.</p>
            <p><strong>Winning bid:</strong> ${formattedPrice} (${leadTimeLabel})</p>
            <p><a href="${customerLink}">View the quote workspace</a> to keep the project moving.</p>
          `,
        }),
      );
      customerNotified = true;
    }
  } else {
    console.log("[quote notifications] winner email skipped (customer prefs)", {
      quoteId: params.quote.id,
      bidId: params.winningBid.id,
      customerId: params.customer?.id ?? null,
    });
  }

  if (sends.length === 0) {
    console.log("[quote notifications] winning bid emails skipped", {
      quoteId: params.quote.id,
      bidId: params.winningBid.id,
      supplierId: params.supplier.id,
      reason: "no-allowed-recipients",
    });
    return;
  }

  try {
    await Promise.all(sends);
    console.log("[quote notifications] winning bid emails dispatched", {
      quoteId: params.quote.id,
      bidId: params.winningBid.id,
      supplierId: params.supplier.id,
      supplierNotified,
      customerNotified,
    });
  } catch (error) {
    console.error("[quote notifications] winning bid email failed", {
      quoteId: params.quote.id,
      bidId: params.winningBid.id,
      supplierId: params.supplier.id,
      error,
    });
  }
}

function resolveMessageRecipient(
  authorType: QuoteMessageRow["author_type"],
  quote: QuoteContactInfo,
): MessageRecipient | null {
  if (authorType === "customer") {
    return {
      email: ADMIN_NOTIFICATION_EMAIL,
      label: "Zartman admin",
      type: "admin" as const,
    };
  }

  if (authorType === "admin" || authorType === "supplier") {
    if (!quote.email) {
      return null;
    }
    return {
      email: quote.email,
      label: quote.customer_name ?? quote.company ?? "Customer",
      type: "customer" as const,
    };
  }

  return null;
}

function buildMessageHtml(
  message: QuoteMessageRow,
  quote: QuoteContactInfo,
  recipientLabel: string,
) {
  const href = buildPortalLink(
    message.author_type === "customer"
      ? `/admin/quotes/${quote.id}`
      : `/customer/quotes/${quote.id}`,
  );
  return `
    <p>${recipientLabel},</p>
    <p><strong>${message.author_name ?? "A teammate"}</strong> posted a new message on <strong>${getQuoteTitle(
      quote,
    )}</strong>.</p>
    <blockquote style="border-left:4px solid #94a3b8;padding:0.5rem 1rem;color:#0f172a;">${
      message.body
    }</blockquote>
    <p><a href="${href}">Open the workspace</a> to reply.</p>
  `;
}

function getQuoteTitle(quote: QuoteContactInfo) {
  return quote.file_name ?? quote.company ?? `Quote ${quote.id.slice(0, 6)}`;
}

function buildPortalLink(path: string) {
  return `${SITE_URL}${path}`;
}

function coerceNumber(value: number | string | null) {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}
