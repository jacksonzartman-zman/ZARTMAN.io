import { formatCurrency } from "@/lib/formatCurrency";
import type { QuoteMessageRow } from "@/server/quotes/messages";
import type { QuoteWithUploadsRow } from "@/server/quotes/types";
import { sendNotificationEmail } from "@/server/notifications/email";
import type {
  SupplierBidRow,
  SupplierRow,
} from "@/server/suppliers/types";

export type QuoteContactInfo = Pick<
  QuoteWithUploadsRow,
  "id" | "file_name" | "company" | "customer_name" | "email"
>;

export type QuoteWinningContext = QuoteContactInfo &
  Pick<QuoteWithUploadsRow, "status" | "price" | "currency">;

type WinningBidParams = {
  quote: QuoteWinningContext;
  winningBid: SupplierBidRow;
  supplier: SupplierRow;
  customerEmail: string | null;
};

const ADMIN_NOTIFICATION_EMAIL =
  process.env.NOTIFICATIONS_ADMIN_EMAIL ?? "admin@zartman.io";
const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

export async function notifyOnNewQuoteMessage(
  message: QuoteMessageRow,
  quote: QuoteContactInfo,
): Promise<void> {
  const recipient = resolveMessageRecipient(message.author_type, quote);
  if (!recipient) {
    console.log("[quote notifications] message skipped", {
      quoteId: quote.id,
      authorType: message.author_type,
      reason: "recipient-unavailable",
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

  const supplierSend =
    supplierEmail &&
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
    });

  const customerSend =
    params.customerEmail &&
    sendNotificationEmail({
      to: params.customerEmail,
      subject: `Winning supplier selected for your RFQ`,
      previewText: `We marked a winning supplier for ${quoteTitle}.`,
      html: `
        <p>You selected <strong>${params.supplier.company_name ?? "a supplier"}</strong> for <strong>${quoteTitle}</strong>.</p>
        <p><strong>Winning bid:</strong> ${formattedPrice} (${leadTimeLabel})</p>
        <p><a href="${customerLink}">View the quote workspace</a> to keep the project moving.</p>
      `,
    });

  try {
    await Promise.all([supplierSend, customerSend].filter(Boolean) as Promise<void>[]);
    console.log("[quote notifications] winning bid emails dispatched", {
      quoteId: params.quote.id,
      bidId: params.winningBid.id,
      supplierId: params.supplier.id,
      supplierNotified: Boolean(supplierSend),
      customerNotified: Boolean(customerSend),
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
) {
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
