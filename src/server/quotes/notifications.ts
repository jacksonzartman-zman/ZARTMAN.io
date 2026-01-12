import { formatCurrency } from "@/lib/formatCurrency";
import { supabaseServer } from "@/lib/supabaseServer";
import { formatShortId } from "@/lib/awards";
import { getCustomerByEmail } from "@/server/customers";
import type { CustomerRow } from "@/server/customers";
import { dispatchEmailNotification, dispatchNotification } from "@/server/notifications/dispatcher";
import { sendNotificationEmail } from "@/server/notifications/email";
import { shouldSendNotification } from "@/server/notifications/preferences";
import {
  loadQuoteNotificationContext,
  type QuoteNotificationContext,
} from "@/server/quotes/notificationContext";
import type { QuoteMessageRecord } from "@/server/quotes/messages";
import type {
  QuoteContactInfo,
  QuoteWinningContext,
} from "@/server/quotes/notificationTypes";
import { buildQuoteFilesFromRow } from "@/server/quotes/files";
import { getQuoteStatusLabel, type QuoteStatus } from "@/server/quotes/status";
import {
  loadSupplierById,
  loadSupplierByPrimaryEmail,
} from "@/server/suppliers/profile";
import type { SupplierBidRow, SupplierRow } from "@/server/suppliers/types";

type WinningBidParams = {
  quote: QuoteWinningContext;
  winningBid: SupplierBidRow;
  supplier: SupplierRow;
  customer: CustomerRow | null;
  actor: {
    role: "admin" | "customer" | "system";
    userId: string | null;
  };
};

type ProjectKickoffDetails = {
  id: string;
  quote_id: string;
  po_number: string | null;
  target_ship_date: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

type ProjectQuoteRow = QuoteContactInfo & {
  assigned_supplier_email: string | null;
  assigned_supplier_name: string | null;
};

type SupplierContactRow = Pick<
  SupplierRow,
  "id" | "company_name" | "primary_email" | "user_id"
>;

type LosingSupplierNotifyArgs = {
  quote: QuoteWinningContext;
  winningBidId: string;
  winningSupplierName: string | null;
};

type QuoteSubmissionNotificationArgs = {
  quoteId: string;
  contactName: string;
  contactEmail: string;
  company?: string | null;
  fileName?: string | null;
};

type BidSubmissionNotificationArgs = {
  quoteId: string;
  bidId: string | null;
  supplierId: string;
  supplierName: string | null;
  supplierEmail: string | null;
  amount: number | null;
  currency: string | null;
  leadTimeDays: number | null;
  quoteTitle: string;
};

type QuoteStatusNotificationArgs = {
  quoteId: string;
  status: QuoteStatus;
  context?: QuoteNotificationContext | null;
};

type ProjectKickoffNotificationArgs = {
  quoteId: string;
  project: ProjectKickoffDetails;
  created: boolean;
};

type MessageRecipient =
  | {
      type: "admin";
      email: string;
      label: string;
      userId?: string | null;
    }
  | {
    type: "customer";
    email: string;
    label: string;
      userId?: string | null;
  }
  | {
      type: "supplier";
      email: string;
      label: string;
      supplier?: SupplierRow | null;
      userId?: string | null;
    };

const ADMIN_NOTIFICATION_EMAIL =
  process.env.NOTIFICATIONS_ADMIN_EMAIL ?? "admin@zartman.io";
const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

type ChangeRequestNotificationStatus = "sent" | "skipped" | "failed";

export type ChangeRequestSubmittedNotificationArgs = {
  quoteId: string;
  changeRequestId: string;
  changeType: string;
  notes: string;
  requesterEmail: string | null;
  requesterUserId: string | null;
};

export type ChangeRequestSubmittedNotificationResult = {
  admin: Exclude<ChangeRequestNotificationStatus, "skipped">;
  customer: ChangeRequestNotificationStatus;
  customerSkipReason:
    | "non_production"
    | "missing_recipient"
    | "compliance_mode"
    | "preference_disabled"
    | "self_recipient"
    | null;
};

export async function notifyOnChangeRequestSubmitted(
  args: ChangeRequestSubmittedNotificationArgs,
): Promise<ChangeRequestSubmittedNotificationResult> {
  const quoteId = typeof args.quoteId === "string" ? args.quoteId.trim() : "";
  const changeRequestId =
    typeof args.changeRequestId === "string" ? args.changeRequestId.trim() : "";
  const changeType = typeof args.changeType === "string" ? args.changeType.trim() : "";
  const notes = typeof args.notes === "string" ? args.notes.trim() : "";
  const requesterEmail =
    typeof args.requesterEmail === "string" ? args.requesterEmail.trim().toLowerCase() : null;
  const requesterUserId =
    typeof args.requesterUserId === "string" ? args.requesterUserId.trim() : null;

  const typeLabel = formatChangeRequestTypeLabel(changeType) ?? "Change request";
  const notesExcerpt = truncateCopy(notes, 200);
  const safeNotesExcerpt = sanitizeCopy(notesExcerpt) ?? "Not provided";

  const adminQuoteHref = buildPortalLink(`/admin/quotes/${quoteId}`);
  const customerQuoteHref = buildPortalLink(`/customer/quotes/${quoteId}`);
  const customerMessagesHref = buildPortalLink(`/customer/quotes/${quoteId}#messages`);

  const payload = {
    quoteId,
    changeRequestId,
    changeType,
    notesExcerpt,
    requesterEmail,
    links: {
      adminQuote: adminQuoteHref,
      customerQuote: customerQuoteHref,
      customerMessages: customerMessagesHref,
    },
  };

  const adminSubject = `Change request submitted — ${typeLabel} — Quote ${formatShortId(
    quoteId,
  )}`;
  const adminPreviewText = `${requesterEmail ?? "A customer"} submitted a ${typeLabel} change request.`;
  const adminHtml = buildAdminChangeRequestSubmittedHtml({
    typeLabel,
    requesterEmail,
    notesExcerpt: safeNotesExcerpt,
    adminQuoteHref,
    customerMessagesHref,
    customerQuoteHref,
  });

  const adminSent = await dispatchNotification(
    {
      eventType: "change_request_submitted",
      quoteId,
      recipientEmail: ADMIN_NOTIFICATION_EMAIL,
      recipientRole: "admin",
      audience: "admin",
      payload,
    },
    () =>
      sendNotificationEmail({
        to: ADMIN_NOTIFICATION_EMAIL,
        subject: adminSubject,
        previewText: adminPreviewText,
        html: adminHtml,
      }),
  );

  const adminStatus: ChangeRequestSubmittedNotificationResult["admin"] = adminSent
    ? "sent"
    : "failed";

  const customerEmail =
    typeof requesterEmail === "string" && requesterEmail.trim() ? requesterEmail : null;

  if (!customerEmail) {
    return {
      admin: adminStatus,
      customer: "skipped",
      customerSkipReason: "missing_recipient",
    };
  }

  if (!isProductionNotificationEmail()) {
    return {
      admin: adminStatus,
      customer: "skipped",
      customerSkipReason: "non_production",
    };
  }

  const gate = await shouldSendNotification({
    eventType: "change_request_submitted",
    quoteId,
    channel: "email",
    recipientRole: "customer",
    recipientUserId: requesterUserId,
    actorUserId: null,
  });

  if (!gate.allow) {
    return {
      admin: adminStatus,
      customer: "skipped",
      customerSkipReason: gate.reason,
    };
  }

  const customerSubject = `Change request received — ${typeLabel}`;
  const customerPreviewText = `We received your ${typeLabel} change request.`;
  const customerHtml = buildCustomerChangeRequestReceivedHtml({
    typeLabel,
    notesExcerpt: safeNotesExcerpt,
    customerMessagesHref,
    customerQuoteHref,
  });

  const customerSent = await dispatchNotification(
    {
      eventType: "change_request_submitted",
      quoteId,
      recipientEmail: customerEmail,
      recipientUserId: requesterUserId,
      recipientRole: "customer",
      actorRole: "system",
      actorUserId: null,
      audience: "customer",
      payload,
    },
    () =>
      sendNotificationEmail({
        to: customerEmail,
        subject: customerSubject,
        previewText: customerPreviewText,
        html: customerHtml,
      }),
  );

  return {
    admin: adminStatus,
    customer: customerSent ? "sent" : "failed",
    customerSkipReason: null,
  };
}

export async function notifyOnNewQuoteMessage(
  message: QuoteMessageRecord,
): Promise<void> {
  const context = await loadQuoteNotificationContext(message.quote_id);
  if (!context) {
    console.warn("[quote notifications] message skipped", {
      quoteId: message.quote_id,
      authorType: message.sender_role,
      reason: "missing-quote-context",
    });
    return;
  }

  const { quote, customer } = context;
  const recipients = await resolveMessageRecipients(message, quote);

  if (recipients.length === 0) {
    console.log("[quote notifications] message skipped", {
      quoteId: quote.id,
      authorType: message.sender_role,
      reason: "recipient-unavailable",
    });
    return;
  }

  await Promise.allSettled(
    recipients.map((recipient) => {
      const recipientUserId =
        recipient.type === "customer"
          ? customer?.user_id ?? null
          : recipient.type === "supplier"
            ? recipient.supplier?.user_id ?? null
            : recipient.userId ?? null;
      const recipientRole =
        recipient.type === "customer"
          ? "customer"
          : recipient.type === "supplier"
            ? "supplier"
            : "admin";

      return dispatchEmailNotification({
        eventType: "quote_message_posted",
        quoteId: quote.id,
        recipientEmail: recipient.email,
        recipientUserId,
        recipientRole,
        actorUserId: message.sender_id,
        audience:
          recipient.type === "customer"
            ? "customer"
            : recipient.type === "supplier"
              ? "supplier"
              : "admin",
        payload: {
          authorType: message.sender_role,
          recipientType: recipient.type,
          messageId: message.id,
        },
        subject: `New message on RFQ ${getQuoteTitle(quote)}`,
        previewText: `${recipient.label} received a new message on ${getQuoteTitle(quote)}`,
        html: buildMessageHtml(message, quote, recipient),
      });
    }),
  );
}

export async function notifyOnWinningBidSelected(
  params: WinningBidParams,
): Promise<void> {
  const supplierEmail = params.supplier.primary_email ?? null;
  const customerEmail =
    params.customer?.email ?? params.quote.customer_email ?? null;
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

  const sends: Promise<boolean>[] = [];
  let supplierNotified = false;
  let customerNotified = false;

  if (supplierEmail) {
    sends.push(
      dispatchEmailNotification({
        eventType: "bid_won",
        quoteId: params.quote.id,
        recipientEmail: supplierEmail,
        recipientUserId: params.supplier.user_id ?? null,
        recipientRole: "supplier",
        actorRole: params.actor.role,
        actorUserId: params.actor.userId,
        audience: "supplier",
        payload: {
          bidId: params.winningBid.id,
          supplierId: params.supplier.id,
          actorRole: params.actor.role,
          actorUserId: params.actor.userId,
        },
        subject: `Your bid won – RFQ ${quoteTitle}`,
        previewText: `We selected your proposal for ${quoteTitle}.`,
        html: `
          <p>Congrats! Your bid for <strong>${quoteTitle}</strong> was selected as the winner.</p>
          <p><strong>Price:</strong> ${formattedPrice}<br/>
          <strong>Lead time:</strong> ${leadTimeLabel}</p>
          <p><a href="${supplierLink}">Open the supplier workspace</a> to review next steps.</p>
        `,
      }).then((sent) => {
        supplierNotified = sent;
        return sent;
      }),
    );
  } else {
    console.warn("[quote notifications] winner email skipped (supplier missing email)", {
      quoteId: params.quote.id,
      bidId: params.winningBid.id,
      supplierId: params.supplier.id,
    });
  }

  if (customerEmail) {
    sends.push(
      dispatchEmailNotification({
        eventType: "quote_won",
        quoteId: params.quote.id,
        recipientEmail: customerEmail,
        recipientUserId: params.customer?.user_id ?? null,
        recipientRole: "customer",
        actorRole: params.actor.role,
        actorUserId: params.actor.userId,
        audience: "customer",
        payload: {
          bidId: params.winningBid.id,
          supplierId: params.supplier.id,
          actorRole: params.actor.role,
          actorUserId: params.actor.userId,
        },
        subject: `Winning supplier selected for your RFQ`,
        previewText: `We marked a winning supplier for ${quoteTitle}.`,
        html: `
          <p>You selected <strong>${params.supplier.company_name ?? "a supplier"}</strong> for <strong>${quoteTitle}</strong>.</p>
          <p><strong>Winning bid:</strong> ${formattedPrice} (${leadTimeLabel})</p>
          <p><a href="${customerLink}">View the quote workspace</a> to keep the project moving.</p>
        `,
      }).then((sent) => {
        customerNotified = sent;
        return sent;
      }),
    );
  } else {
    console.warn("[quote notifications] winner email skipped (customer missing email)", {
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
  } else {
    await Promise.allSettled(sends);
    console.log("[quote notifications] winning bid notifications dispatched", {
      quoteId: params.quote.id,
      bidId: params.winningBid.id,
      supplierId: params.supplier.id,
      supplierNotified,
      customerNotified,
    });
  }

  await notifyLosingSuppliers({
    quote: params.quote,
    winningBidId: params.winningBid.id,
    winningSupplierName:
      params.supplier.company_name ??
      params.supplier.primary_email ??
      "another supplier",
  });
}

async function notifyLosingSuppliers(
  args: LosingSupplierNotifyArgs,
): Promise<void> {
  try {
    const { data, error } = await supabaseServer
      .from("supplier_bids")
      .select(
        "id,supplier_id,status,unit_price,currency,lead_time_days,updated_at",
      )
      .eq("quote_id", args.quote.id)
      .neq("id", args.winningBidId);

    if (error) {
      console.error("[quote notifications] losing supplier lookup failed", {
        quoteId: args.quote.id,
        error,
      });
      return;
    }

    const losingBids = ((data ?? []) as SupplierBidRow[]).filter(
      (bid) => (bid.status ?? "").toLowerCase() === "lost",
    );

    if (losingBids.length === 0) {
      return;
    }

    const supplierIds = Array.from(
      new Set(
        losingBids
          .map((bid) => bid.supplier_id)
          .filter((value): value is string => Boolean(value)),
      ),
    );

    if (supplierIds.length === 0) {
      return;
    }

    const { data: supplierRows, error: supplierError } = await supabaseServer
      .from("suppliers")
      .select("id,company_name,primary_email,user_id")
      .in("id", supplierIds);

    if (supplierError) {
      console.error("[quote notifications] losing supplier context failed", {
        quoteId: args.quote.id,
        error: supplierError,
      });
      return;
    }

    const supplierMap = new Map(
      ((supplierRows ?? []) as SupplierContactRow[]).map((supplier) => [
        supplier.id,
        supplier,
      ]),
    );
    const quoteTitle = getQuoteTitle(args.quote);

    await Promise.all(
      losingBids.map((bid) => {
        const supplier = bid.supplier_id
          ? supplierMap.get(bid.supplier_id)
          : null;
        const recipientEmail = supplier?.primary_email ?? null;
        if (!recipientEmail) {
          console.warn("[quote notifications] losing supplier missing email", {
            quoteId: args.quote.id,
            bidId: bid.id,
            supplierId: bid.supplier_id,
          });
          return Promise.resolve(false);
        }

        return dispatchEmailNotification({
          eventType: "bid_lost",
          quoteId: args.quote.id,
          recipientEmail,
          recipientUserId: supplier?.user_id ?? null,
          recipientRole: "supplier",
          audience: "supplier",
          payload: {
            bidId: bid.id,
            supplierId: bid.supplier_id,
          },
          subject: `RFQ ${quoteTitle} closed`,
          previewText: `We selected another supplier for ${quoteTitle}.`,
          html: buildLosingBidHtml({
            quoteTitle,
            winningSupplierName: args.winningSupplierName,
            quoteId: args.quote.id,
          }),
        });
      }),
    );
  } catch (error) {
    console.error("[quote notifications] losing supplier notify failed", {
      quoteId: args.quote.id,
      error,
    });
  }
}

async function resolveMessageRecipients(
  message: QuoteMessageRecord,
  quote: QuoteContactInfo,
): Promise<MessageRecipient[]> {
  const authorType = (message.sender_role ?? "").toString().trim().toLowerCase();

  const recipients: MessageRecipient[] = [];

  // v0 behavior:
  // - Customer posts -> notify supplier (if known) + admin inbox
  // - Supplier posts -> notify customer (if known)
  // - Admin posts -> notify customer + supplier (if known)
  const wantsCustomer = authorType === "supplier" || authorType === "admin";
  const wantsSupplier = authorType === "customer" || authorType === "admin";

  if (wantsCustomer && quote.customer_email) {
    recipients.push({
      email: quote.customer_email,
      label: quote.customer_name ?? quote.company ?? "Customer",
      type: "customer" as const,
    });
  }

  if (wantsSupplier) {
    const supplierRecipient = await resolveSupplierRecipientForQuote(quote.id);
    if (supplierRecipient) {
      recipients.push(supplierRecipient);
    }
  }

  if (authorType === "customer") {
    recipients.push({
      email: ADMIN_NOTIFICATION_EMAIL,
      label: "Zartman admin",
      type: "admin" as const,
    });
  }

  const seen = new Set<string>();
  return recipients.filter((recipient) => {
    const email = (recipient.email ?? "").trim().toLowerCase();
    if (!email) return false;
    if (seen.has(email)) return false;
    seen.add(email);
    return true;
  });
}

async function resolveSupplierRecipientForQuote(
  quoteId: string,
): Promise<MessageRecipient | null> {
  const normalizedQuoteId = typeof quoteId === "string" ? quoteId.trim() : "";
  if (!normalizedQuoteId) return null;

  try {
    const { data, error } = await supabaseServer
      .from("quotes")
      .select("awarded_supplier_id,assigned_supplier_email")
      .eq("id", normalizedQuoteId)
      .maybeSingle<{
        awarded_supplier_id: string | null;
        assigned_supplier_email: string | null;
      }>();

    if (error) {
      console.error("[quote notifications] supplier recipient lookup failed", {
        quoteId: normalizedQuoteId,
        error,
      });
      return null;
    }

    const awardedSupplierId =
      typeof data?.awarded_supplier_id === "string"
        ? data.awarded_supplier_id.trim()
        : "";
    const assignedSupplierEmail =
      typeof data?.assigned_supplier_email === "string"
        ? data.assigned_supplier_email.trim().toLowerCase()
        : "";

    const supplier =
      awardedSupplierId.length > 0
        ? await loadSupplierById(awardedSupplierId)
        : assignedSupplierEmail.length > 0
          ? await loadSupplierByPrimaryEmail(assignedSupplierEmail)
          : null;

    const recipientEmail =
      supplier?.primary_email ??
      (assignedSupplierEmail.length > 0 ? assignedSupplierEmail : null);
    if (!recipientEmail) {
      return null;
    }

    return {
      type: "supplier" as const,
      email: recipientEmail,
      label: supplier?.company_name ?? recipientEmail,
      supplier: supplier ?? null,
      userId: supplier?.user_id ?? null,
    };
  } catch (error) {
    console.error("[quote notifications] supplier recipient lookup crashed", {
      quoteId: normalizedQuoteId,
      error,
    });
    return null;
  }
}

function buildMessageHtml(
  message: QuoteMessageRecord,
  quote: QuoteContactInfo,
  recipient: MessageRecipient,
) {
  const href = buildPortalLink(
    recipient.type === "supplier"
      ? `/supplier/quotes/${quote.id}`
      : recipient.type === "admin"
        ? `/admin/quotes/${quote.id}`
        : `/customer/quotes/${quote.id}`,
  );
  return `
    <p>${recipient.label},</p>
    <p><strong>${message.sender_name ?? "A teammate"}</strong> posted a new message on <strong>${getQuoteTitle(
      quote,
    )}</strong>.</p>
    <blockquote style="border-left:4px solid #94a3b8;padding:0.5rem 1rem;color:#0f172a;">${
      message.body
    }</blockquote>
    <p><a href="${href}">Open the workspace</a> to reply.</p>
  `;
}

function buildLosingBidHtml(args: {
  quoteTitle: string;
  winningSupplierName: string | null;
  quoteId: string;
}) {
  const supplierHref = buildPortalLink(`/supplier/quotes/${args.quoteId}`);
  return `
    <p>Thanks for submitting a proposal for <strong>${args.quoteTitle}</strong>.</p>
    <p>We selected ${
      args.winningSupplierName ?? "another supplier"
    } for this project. We'll keep you posted when future RFQs are a fit.</p>
    <p><a href="${supplierHref}">Open the supplier workspace</a> to review the RFQ details.</p>
  `;
}

function getQuoteTitle(quote: QuoteContactInfo) {
  const files = buildQuoteFilesFromRow(quote);
  return files[0]?.filename ?? quote.file_name ?? quote.company ?? `Quote ${quote.id.slice(0, 6)}`;
}

function buildPortalLink(path: string) {
  return `${SITE_URL}${path}`;
}

function isProductionNotificationEmail(): boolean {
  const nodeEnv = process.env.NODE_ENV ?? "development";
  const vercelEnv = process.env.VERCEL_ENV ?? null;
  if (nodeEnv !== "production") return false;
  if (vercelEnv && vercelEnv !== "production") return false;
  return true;
}

function truncateCopy(value: string, maxLen: number): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) return "";
  if (normalized.length <= maxLen) return normalized;
  if (maxLen <= 1) return normalized.slice(0, Math.max(0, maxLen));
  return `${normalized.slice(0, Math.max(0, maxLen - 1))}…`;
}

function formatChangeRequestTypeLabel(value: string | null): string | null {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!normalized) return null;
  if (normalized === "tolerance") return "Tolerance";
  if (normalized === "material_finish") return "Material / finish";
  if (normalized === "lead_time") return "Lead time";
  if (normalized === "shipping") return "Shipping";
  if (normalized === "revision") return "Revision";
  return normalized.replace(/[_-]+/g, " ").trim().replace(/^\w/, (c) => c.toUpperCase());
}

function buildAdminChangeRequestSubmittedHtml(args: {
  typeLabel: string;
  requesterEmail: string | null;
  notesExcerpt: string;
  adminQuoteHref: string;
  customerMessagesHref: string;
  customerQuoteHref: string;
}): string {
  const requester = sanitizeCopy(args.requesterEmail) ?? "Not provided";
  const typeLabel = sanitizeCopy(args.typeLabel) ?? "Change request";
  return `
    <p>A customer submitted a change request.</p>
    <p><strong>Type:</strong> ${typeLabel}<br/>
    <strong>Requester:</strong> ${requester}</p>
    <p><strong>Notes (excerpt):</strong></p>
    <blockquote style="border-left:4px solid #94a3b8;padding:0.5rem 1rem;color:#0f172a;">${args.notesExcerpt}</blockquote>
    <p><a href="${args.adminQuoteHref}">Open in admin</a></p>
    <p style="margin-top:12px;">
      <a href="${args.customerMessagesHref}">Open customer messages</a> ·
      <a href="${args.customerQuoteHref}">Open customer quote</a>
    </p>
  `;
}

function buildCustomerChangeRequestReceivedHtml(args: {
  typeLabel: string;
  notesExcerpt: string;
  customerMessagesHref: string;
  customerQuoteHref: string;
}): string {
  const typeLabel = sanitizeCopy(args.typeLabel) ?? "Change request";
  return `
    <p>We received your change request.</p>
    <p><strong>Type:</strong> ${typeLabel}</p>
    <p><strong>Notes (excerpt):</strong></p>
    <blockquote style="border-left:4px solid #94a3b8;padding:0.5rem 1rem;color:#0f172a;">${args.notesExcerpt}</blockquote>
    <p><a href="${args.customerMessagesHref}">Open Messages</a> to coordinate next steps.</p>
    <p style="margin-top:12px;"><a href="${args.customerQuoteHref}">View quote overview</a></p>
  `;
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

const STATUS_NOTIFICATION_CONFIG: Partial<
  Record<
    QuoteStatus,
    {
      eventType: string;
      subject: (title: string) => string;
      previewText: string;
      body: (args: {
        quoteTitle: string;
        quoteId: string;
        statusLabel: string;
      }) => string;
    }
  >
> = {
  quoted: {
    eventType: "quote_quoted",
    subject: (title) => `Quote ready for ${title}`,
    previewText: "Review pricing and DFM notes.",
    body: ({ quoteTitle, quoteId, statusLabel }) => {
      const link = buildPortalLink(`/customer/quotes/${quoteId}`);
      return `
        <p>We updated <strong>${quoteTitle}</strong> to <strong>${statusLabel}</strong>.</p>
        <p><a href="${link}">Open your workspace</a> to review the quote package.</p>
      `;
    },
  },
  approved: {
    eventType: "quote_approved",
    subject: (title) => `${title} approved for kickoff`,
    previewText: "We signed off on your RFQ.",
    body: ({ quoteTitle, quoteId, statusLabel }) => {
      const link = buildPortalLink(`/customer/quotes/${quoteId}`);
      return `
        <p>${quoteTitle} is now <strong>${statusLabel}</strong>. We're lining up the next steps.</p>
        <p><a href="${link}">View the RFQ</a> to share kickoff details.</p>
      `;
    },
  },
  won: {
    eventType: "quote_won",
    subject: (title) => `${title} marked as won`,
    previewText: "We selected a supplier for this RFQ.",
    body: ({ quoteTitle, quoteId, statusLabel }) => {
      const link = buildPortalLink(`/customer/quotes/${quoteId}`);
      return `
        <p>${quoteTitle} is <strong>${statusLabel}</strong>. We captured the winning proposal in your workspace.</p>
        <p><a href="${link}">Open the workspace</a> to coordinate kickoff.</p>
      `;
    },
  },
};

export async function notifyCustomerOnQuoteStatusChange(
  args: QuoteStatusNotificationArgs,
): Promise<void> {
  const config = STATUS_NOTIFICATION_CONFIG[args.status];
  if (!config) {
    return;
  }

  const context =
    args.context ?? (await loadQuoteNotificationContext(args.quoteId));

  if (!context?.quote?.customer_email) {
    console.warn("[quote notifications] status email skipped", {
      quoteId: args.quoteId,
      status: args.status,
      reason: "missing-recipient",
    });
    return;
  }

  const quoteTitle = getQuoteTitle(context.quote);
  const statusLabel = getQuoteStatusLabel(args.status);

  await dispatchEmailNotification({
    eventType: config.eventType,
    quoteId: args.quoteId,
    recipientEmail: context.quote.customer_email,
    recipientUserId: context.customer?.user_id ?? null,
    recipientRole: "customer",
    audience: "customer",
    payload: {
      status: args.status,
    },
    subject: config.subject(quoteTitle),
    previewText: config.previewText,
    html: config.body({
      quoteTitle,
      quoteId: args.quoteId,
      statusLabel,
    }),
  });
}

export async function notifyAdminOnQuoteSubmitted(
  args: QuoteSubmissionNotificationArgs,
): Promise<void> {
  await dispatchEmailNotification({
    eventType: "quote_submitted",
    quoteId: args.quoteId,
    recipientEmail: ADMIN_NOTIFICATION_EMAIL,
    recipientRole: "admin",
    audience: "admin",
    payload: {
      contactEmail: args.contactEmail,
      company: args.company ?? null,
    },
    subject: `New RFQ submitted by ${args.contactName || args.contactEmail}`,
    previewText: `${args.contactEmail} uploaded ${args.fileName ?? "an RFQ"}.`,
    html: buildAdminQuoteSubmittedHtml(args),
  });
}

export async function notifyAdminOnBidSubmitted(
  args: BidSubmissionNotificationArgs,
): Promise<void> {
  await dispatchEmailNotification({
    eventType: "bid_submitted",
    quoteId: args.quoteId,
    recipientEmail: ADMIN_NOTIFICATION_EMAIL,
    recipientRole: "admin",
    audience: "admin",
    payload: {
      bidId: args.bidId,
      supplierId: args.supplierId,
    },
    subject: `New bid from ${args.supplierName ?? "a supplier"} on ${
      args.quoteTitle
    }`,
    previewText: `${args.quoteTitle} just received a bid.`,
    html: buildAdminBidSubmittedHtml(args),
  });
}

export async function notifyOnProjectKickoffChange(
  args: ProjectKickoffNotificationArgs,
): Promise<void> {
  try {
    const quoteRow = await loadProjectQuoteContext(args.quoteId);
    if (!quoteRow) {
      console.warn("[quote notifications] project kickoff skipped", {
        quoteId: args.quoteId,
        reason: "missing-quote-context",
      });
      return;
    }

    const [customer, supplier] = await Promise.all([
      quoteRow.customer_email
        ? getCustomerByEmail(quoteRow.customer_email)
        : Promise.resolve<CustomerRow | null>(null),
      quoteRow.assigned_supplier_email
        ? loadSupplierByPrimaryEmail(quoteRow.assigned_supplier_email)
        : Promise.resolve<SupplierRow | null>(null),
    ]);

    const quoteTitle = getQuoteTitle(quoteRow);
    const summaryHtml = buildProjectKickoffSummary(args.project);
    const eventType = args.created
      ? "project_kickoff_created"
      : "project_kickoff_updated";
    const previewText =
      args.project.po_number ??
      args.project.target_ship_date ??
      (args.created ? "Kickoff created" : "Kickoff updated");
    const payload = {
      projectId: args.project.id,
      created: args.created,
    };

    const notifications: Promise<boolean>[] = [];

    if (quoteRow.customer_email) {
      notifications.push(
        dispatchEmailNotification({
          eventType,
          quoteId: args.quoteId,
          recipientEmail: quoteRow.customer_email,
          recipientUserId: customer?.user_id ?? null,
          recipientRole: "customer",
          audience: "customer",
          payload,
          subject: `${
            args.created ? "Project kickoff captured" : "Project kickoff updated"
          } for ${quoteTitle}`,
          previewText,
          html: buildProjectKickoffHtml({
            audience: "customer",
            quoteTitle,
            summaryHtml,
            link: buildPortalLink(`/customer/quotes/${args.quoteId}`),
            created: args.created,
          }),
        }),
      );
    }

    if (quoteRow.assigned_supplier_email) {
      notifications.push(
        dispatchEmailNotification({
          eventType,
          quoteId: args.quoteId,
          recipientEmail: quoteRow.assigned_supplier_email,
          recipientUserId: supplier?.user_id ?? null,
          recipientRole: "supplier",
          audience: "supplier",
          payload,
          subject: `Kickoff details for ${quoteTitle}`,
          previewText,
          html: buildProjectKickoffHtml({
            audience: "supplier",
            quoteTitle,
            summaryHtml,
            link: buildPortalLink(`/supplier/quotes/${args.quoteId}`),
            created: args.created,
          }),
        }),
      );
    }

    notifications.push(
      dispatchEmailNotification({
        eventType,
        quoteId: args.quoteId,
        recipientEmail: ADMIN_NOTIFICATION_EMAIL,
        recipientRole: "admin",
        audience: "admin",
        payload,
        subject: `[Admin] ${
          args.created ? "Project kickoff created" : "Project kickoff updated"
        } (${quoteTitle})`,
        previewText,
        html: buildProjectKickoffHtml({
          audience: "admin",
          quoteTitle,
          summaryHtml,
          link: buildPortalLink(`/admin/quotes/${args.quoteId}`),
          created: args.created,
        }),
      }),
    );

    await Promise.allSettled(notifications);
  } catch (error) {
    console.error("[quote notifications] project kickoff notify failed", {
      quoteId: args.quoteId,
      error,
    });
  }
}

function buildAdminQuoteSubmittedHtml(args: QuoteSubmissionNotificationArgs) {
  const adminLink = buildPortalLink(`/admin/quotes/${args.quoteId}`);
  const company = sanitizeCopy(args.company) ?? "Not provided";
  const contactName = sanitizeCopy(args.contactName) ?? args.contactEmail;
  const fileName = sanitizeCopy(args.fileName) ?? "Untitled RFQ";

  return `
    <p><strong>${contactName}</strong> just submitted a new RFQ.</p>
    <p>Email: ${args.contactEmail}<br/>
    Company: ${company}<br/>
    File: ${fileName}</p>
    <p><a href="${adminLink}">Review in the admin workspace</a></p>
  `;
}

function buildAdminBidSubmittedHtml(args: BidSubmissionNotificationArgs) {
  const amountLabel =
    typeof args.amount === "number"
      ? formatCurrency(args.amount, args.currency ?? "USD")
      : "Pricing pending";
  const leadTimeLabel =
    typeof args.leadTimeDays === "number" && Number.isFinite(args.leadTimeDays)
      ? `${args.leadTimeDays} day${args.leadTimeDays === 1 ? "" : "s"}`
      : "Lead time pending";
  const adminLink = buildPortalLink(`/admin/quotes/${args.quoteId}`);
  const supplierName = sanitizeCopy(args.supplierName) ?? "Supplier partner";
  const supplierEmail = sanitizeCopy(args.supplierEmail) ?? "Not provided";

  return `
    <p><strong>${supplierName}</strong> submitted a bid on <strong>${args.quoteTitle}</strong>.</p>
    <p>${amountLabel} • ${leadTimeLabel}<br/>Email: ${supplierEmail}</p>
    <p><a href="${adminLink}">Review the bid</a></p>
  `;
}

function buildProjectKickoffSummary(project: ProjectKickoffDetails): string {
  const items: string[] = [];
  const po = sanitizeCopy(project.po_number);
  if (po) {
    items.push(`<li><strong>PO #</strong>: ${po}</li>`);
  }
  const targetDate = sanitizeCopy(project.target_ship_date);
  if (targetDate) {
    items.push(`<li><strong>Target ship date</strong>: ${targetDate}</li>`);
  }
  const notes = renderMultiline(project.notes);
  if (notes) {
    items.push(`<li><strong>Notes</strong>: ${notes}</li>`);
  }

  if (items.length === 0) {
    return "<p>No kickoff details were provided.</p>";
  }

  return `<ul>${items.join("")}</ul>`;
}

function buildProjectKickoffHtml(args: {
  audience: "customer" | "supplier" | "admin";
  quoteTitle: string;
  summaryHtml: string;
  link: string;
  created: boolean;
}) {
  const intro =
    args.audience === "supplier"
      ? `The customer shared kickoff details for <strong>${args.quoteTitle}</strong>.`
      : args.audience === "customer"
        ? `We ${args.created ? "captured" : "updated"} kickoff info for <strong>${args.quoteTitle}</strong>.`
        : `Kickoff info for <strong>${args.quoteTitle}</strong> was ${
            args.created ? "created" : "updated"
          }.`;

  return `
    <p>${intro}</p>
    ${args.summaryHtml}
    <p><a href="${args.link}">Open the workspace</a> to review.</p>
  `;
}

async function loadProjectQuoteContext(
  quoteId: string,
): Promise<ProjectQuoteRow | null> {
  if (!quoteId) {
    return null;
  }
  try {
    const { data, error } = await supabaseServer
      .from("quotes_with_uploads")
      .select(
        "id,file_name,company,customer_name,customer_email,assigned_supplier_email,assigned_supplier_name",
      )
      .eq("id", quoteId)
      .maybeSingle<ProjectQuoteRow>();

    if (error) {
      console.error("[quote notifications] project quote lookup failed", {
        quoteId,
        error,
      });
      return null;
    }

    return data ?? null;
  } catch (error) {
    console.error("[quote notifications] project quote lookup crashed", {
      quoteId,
      error,
    });
    return null;
  }
}

function renderMultiline(value?: string | null): string | null {
  const sanitized = sanitizeCopy(value);
  if (!sanitized) {
    return null;
  }
  return sanitized.replace(/\r?\n/g, "<br/>");
}

function sanitizeCopy(value?: string | null): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
