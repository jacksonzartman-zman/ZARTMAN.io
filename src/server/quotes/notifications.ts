import { formatCurrency } from "@/lib/formatCurrency";
import { supabaseServer } from "@/lib/supabaseServer";
import type { CustomerRow } from "@/server/customers";
import { dispatchEmailNotification } from "@/server/notifications/dispatcher";
import {
  customerAllowsNotification,
  supplierAllowsNotification,
} from "@/server/notifications/preferences";
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
  "id" | "company_name" | "primary_email"
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
  const recipient = resolveMessageRecipient(message.sender_role, quote);
  if (!recipient) {
    console.log("[quote notifications] message skipped", {
      quoteId: quote.id,
      authorType: message.sender_role,
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

  await dispatchEmailNotification({
    eventType: "quote_message_posted",
    quoteId: quote.id,
    recipientEmail: recipient.email,
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
    previewText: `${recipient.label} received a new message on quote ${quote.id}`,
    html: buildMessageHtml(message, quote, recipient.label),
  });
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

  const sends: Promise<boolean>[] = [];
  let supplierNotified = false;
  let customerNotified = false;

  if (supplierAllowsNotification(params.supplier, "winner_supplier")) {
    if (supplierEmail) {
      sends.push(
        dispatchEmailNotification({
          eventType: "bid_won",
          quoteId: params.quote.id,
          recipientEmail: supplierEmail,
          audience: "supplier",
          payload: {
            bidId: params.winningBid.id,
            supplierId: params.supplier.id,
          },
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
        dispatchEmailNotification({
          eventType: "quote_won",
          quoteId: params.quote.id,
          recipientEmail: customerEmail,
          audience: "customer",
          payload: {
            bidId: params.winningBid.id,
            supplierId: params.supplier.id,
          },
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
      .select("id,company_name,primary_email")
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

function resolveMessageRecipient(
  authorType: QuoteMessageRecord["sender_role"],
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
  message: QuoteMessageRecord,
  quote: QuoteContactInfo,
  recipientLabel: string,
) {
  const href = buildPortalLink(
    message.sender_role === "customer"
      ? `/admin/quotes/${quote.id}`
      : `/customer/quotes/${quote.id}`,
  );
  return `
    <p>${recipientLabel},</p>
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

  if (!context?.quote?.email) {
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
    recipientEmail: context.quote.email,
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

    if (quoteRow.email) {
      notifications.push(
        dispatchEmailNotification({
          eventType,
          quoteId: args.quoteId,
          recipientEmail: quoteRow.email,
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
        "id,file_name,company,customer_name,email,assigned_supplier_email,assigned_supplier_name",
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
