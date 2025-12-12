import { supabaseServer } from "@/lib/supabaseServer";
import { getCustomerById } from "@/server/customers";
import { normalizeEmailInput } from "@/app/(portals)/quotes/pageUtils";
import {
  getQuoteStatusLabel,
  normalizeQuoteStatus,
} from "@/server/quotes/status";
import type { QuoteActivityEvent } from "@/types/activity";
import type { QuoteMessageRecord } from "@/server/quotes/messages";
import type { SupplierBidRow } from "@/server/suppliers/types";
import { formatCurrency } from "@/lib/formatCurrency";

const EVENT_LIMIT = 10;
const QUOTE_COLUMNS =
  "id,file_name,company,customer_name,email,status,created_at,updated_at,price,currency,file_names,upload_file_names,file_count,upload_file_count";

type CustomerQuoteRow = {
  id: string;
  file_name: string | null;
  company: string | null;
  customer_name: string | null;
  email: string | null;
  status: string | null;
  created_at: string | null;
  updated_at: string | null;
  price: number | string | null;
  currency: string | null;
  file_names?: string[] | null;
  upload_file_names?: string[] | null;
  file_count?: number | null;
  upload_file_count?: number | null;
  // Optional fields available in some environments but not prod yet.
  project_label?: string | null;
  upload_name?: string | null;
};

type CustomerActivityOptions = {
  emailOverride?: string | null;
};

export type CustomerQuotesTableSortKey = "recently_updated" | "newest";

export async function loadRecentCustomerActivity(
  customerId: string,
  options?: CustomerActivityOptions,
): Promise<QuoteActivityEvent[]> {
  console.info("[customer activity] load start", {
    customerId,
    emailOverride: options?.emailOverride ?? null,
  });
  const overrideEmail = normalizeEmailInput(options?.emailOverride ?? null);
  if (!customerId && !overrideEmail) {
    return [];
  }

  let quotes: CustomerQuoteRow[] = [];

  if (overrideEmail) {
    quotes = await fetchQuotesByEmail(overrideEmail, {
      customerId,
      scope: "override",
    });
  } else {
    const customer = await getCustomerById(customerId);
    if (!customer) {
      return [];
    }
    const customerEmail = normalizeEmailInput(customer.email ?? null);
    if (!customerEmail) {
      return [];
    }
    quotes = await fetchQuotesByEmail(customerEmail, {
      customerId: customer.id,
      scope: "customer",
    });
  }

  console.info("[customer activity] quotes resolved", {
    customerId,
    quoteCount: quotes.length,
  });
  if (quotes.length === 0) {
    return [];
  }

  const quoteMap = new Map(quotes.map((quote) => [quote.id, quote]));
  const quoteIds = Array.from(quoteMap.keys());
  const [messages, bids] = await Promise.all([
    fetchQuoteMessages(quoteIds),
    fetchQuoteBids(quoteIds),
  ]);
  const winningBids = buildWinningBidMap(bids);

  const events: QuoteActivityEvent[] = [];

  for (const quote of quotes) {
    events.push(buildQuoteSubmittedEvent(quote));
    const statusEvent = buildStatusEvent(quote);
    if (statusEvent) {
      events.push(statusEvent);
    }
    const winnerEvent = buildWinnerEvent(quote, winningBids.get(quote.id));
    if (winnerEvent) {
      events.push(winnerEvent);
    }
  }

  for (const message of messages) {
    const quote = quoteMap.get(message.quote_id);
    if (!quote) {
      continue;
    }
    if ((message.sender_role ?? "").toLowerCase() === "customer") {
      continue;
    }
    events.push(buildMessageEvent(message, quote));
  }

  for (const bid of bids) {
    const quote = quoteMap.get(bid.quote_id);
    if (!quote) {
      continue;
    }
    events.push(buildBidEvent(bid, quote));
  }

  const finalized = finalizeEvents(events);
  console.info("[customer activity] events built", {
    customerId,
    eventCount: finalized.length,
  });
  return finalized;
}

export async function fetchQuotesByEmail(
  email: string,
  context?: {
    customerId?: string;
    scope?: "override" | "customer";
    limit?: number;
  },
): Promise<CustomerQuoteRow[]> {
  const normalizedEmail = normalizeEmailInput(email ?? null);
  if (!normalizedEmail) {
    return [];
  }

  const limit = context?.limit ?? EVENT_LIMIT * 3;
  const { data, error } = await supabaseServer
    .from("quotes_with_uploads")
    .select(QUOTE_COLUMNS)
    .order("updated_at", { ascending: false })
    .limit(limit)
    .ilike("email", normalizedEmail);
  if (error) {
    const message =
      context?.scope === "override"
        ? "[customer activity] override query failed"
        : "[customer activity] quote query failed";
    console.error(message, {
      customerId: context?.customerId ?? null,
      email: normalizedEmail,
      error,
    });
    return [];
  }
  return (data ?? []) as CustomerQuoteRow[];
}

export async function loadCustomerQuotesTable(
  customerId: string,
  options?: { emailOverride?: string | null; limit?: number },
): Promise<CustomerQuoteRow[]> {
  console.info("[customer quotes] load start", {
    customerId,
    hasOverride: Boolean(options?.emailOverride),
  });

  const overrideEmail = normalizeEmailInput(options?.emailOverride ?? null);
  const limit = options?.limit ?? 100;

  let emailToUse = overrideEmail;

  if (!emailToUse) {
    const customer = await getCustomerById(customerId);
    if (!customer) {
      console.warn("[customer quotes] no customer found for id", { customerId });
      return [];
    }

    const normalized = normalizeEmailInput(customer.email ?? null);
    if (!normalized) {
      console.warn("[customer quotes] customer email missing/invalid", {
        customerId,
        rawEmail: customer.email ?? null,
      });
      return [];
    }

    emailToUse = normalized;
  }

  const quotes = await fetchQuotesByEmail(emailToUse, {
    customerId,
    scope: overrideEmail ? "override" : "customer",
    limit,
  });

  console.info("[customer quotes] load result", {
    customerId,
    email: emailToUse,
    quoteCount: quotes.length,
  });

  return quotes;
}

export async function loadCustomerQuotesTablePage(
  customerId: string,
  options: {
    page: number;
    pageSize: number;
    sort: CustomerQuotesTableSortKey;
    q?: string;
    emailOverride?: string | null;
  },
): Promise<{ rows: CustomerQuoteRow[]; count: number | null; hasMore: boolean }> {
  const page = Math.max(1, Math.floor(options.page));
  const pageSize = Math.max(1, Math.floor(options.pageSize));
  const sort = options.sort;

  const overrideEmail = normalizeEmailInput(options.emailOverride ?? null);
  const q = typeof options.q === "string" ? options.q.trim() : "";

  let emailToUse = overrideEmail;
  if (!emailToUse) {
    const customer = await getCustomerById(customerId);
    if (!customer) {
      console.warn("[customer quotes] no customer found for id", { customerId });
      return { rows: [], count: 0, hasMore: false };
    }

    const normalized = normalizeEmailInput(customer.email ?? null);
    if (!normalized) {
      console.warn("[customer quotes] customer email missing/invalid", {
        customerId,
        rawEmail: customer.email ?? null,
      });
      return { rows: [], count: 0, hasMore: false };
    }
    emailToUse = normalized;
  }

  const offset = (page - 1) * pageSize;
  const endInclusive = offset + pageSize; // fetch 1 extra row to detect hasMore

  let query = supabaseServer
    .from("quotes_with_uploads")
    .select(QUOTE_COLUMNS, { count: "exact" })
    .ilike("email", emailToUse);

  const orFilter = buildCustomerQuotesSearchOr(q);
  if (orFilter) {
    query = query.or(orFilter);
  }

  if (sort === "newest") {
    query = query.order("created_at", { ascending: false });
  } else {
    // recently_updated (default)
    query = query.order("updated_at", { ascending: false });
  }

  const { data, error, count } = await query.range(offset, endInclusive);
  if (error) {
    console.error("[customer quotes] paged query failed", {
      customerId,
      email: emailToUse,
      page,
      pageSize,
      sort,
      q,
      error,
    });
    return { rows: [], count: 0, hasMore: false };
  }

  const rows = (data ?? []) as CustomerQuoteRow[];
  const pageRows = rows.slice(0, pageSize);

  const resolvedCount =
    typeof count === "number" && Number.isFinite(count) ? count : null;

  const hasMore =
    typeof resolvedCount === "number"
      ? offset + pageRows.length < resolvedCount
      : rows.length > pageSize;

  return { rows: pageRows, count: resolvedCount, hasMore };
}

async function fetchQuoteMessages(
  quoteIds: string[],
): Promise<QuoteMessageRecord[]> {
  if (quoteIds.length === 0) {
    return [];
  }
  const { data, error } = await supabaseServer
    .from("quote_messages")
    .select("id,quote_id,sender_role,sender_name,sender_email,body,created_at")
    .in("quote_id", quoteIds)
    .order("created_at", { ascending: false })
    .limit(EVENT_LIMIT * 4);
  if (error) {
    console.error("[customer activity] message query failed", { error });
    return [];
  }
  return (data ?? []) as QuoteMessageRecord[];
}

async function fetchQuoteBids(quoteIds: string[]): Promise<SupplierBidRow[]> {
  if (quoteIds.length === 0) {
    return [];
  }
  const { data, error } = await supabaseServer
    .from("supplier_bids")
    .select(
      "id,quote_id,unit_price,currency,lead_time_days,status,created_at,updated_at",
    )
    .in("quote_id", quoteIds)
    .order("updated_at", { ascending: false })
    .limit(EVENT_LIMIT * 3);
  if (error) {
    console.error("[customer activity] bid query failed", { error });
    return [];
  }
  return (data ?? []) as SupplierBidRow[];
}

function buildQuoteSubmittedEvent(quote: CustomerQuoteRow): QuoteActivityEvent {
  return {
    id: `quote:${quote.id}:submitted`,
    quoteId: quote.id,
    type: "rfq_submitted",
    title: `${getQuoteTitle(quote)} submitted`,
    description: quote.company
      ? `Uploaded by ${quote.company}`
      : "New RFQ synced to your workspace.",
    timestamp: safeTimestamp(quote.created_at ?? quote.updated_at),
    href: `/customer/quotes/${quote.id}`,
  };
}

function buildStatusEvent(
  quote: CustomerQuoteRow,
): QuoteActivityEvent | null {
  if (!quote.updated_at || quote.updated_at === quote.created_at) {
    return null;
  }
  const status = normalizeQuoteStatus(quote.status ?? undefined);
  const label = getQuoteStatusLabel(status);
  return {
    id: `quote:${quote.id}:status:${quote.updated_at}`,
    quoteId: quote.id,
    type: "status_changed",
    title: `${getQuoteTitle(quote)} marked ${label}`,
    description: "We updated this RFQ status so your team stays aligned.",
    timestamp: safeTimestamp(quote.updated_at),
    href: `/customer/quotes/${quote.id}`,
  };
}

function buildMessageEvent(
  message: QuoteMessageRecord,
  quote: CustomerQuoteRow,
): QuoteActivityEvent {
  const senderRole =
    typeof message.sender_role === "string"
      ? message.sender_role.toLowerCase()
      : "admin";
  const roleLabel =
    senderRole === "customer"
      ? "Customer"
      : senderRole === "supplier"
        ? "Supplier"
        : "Zartman admin";
  const displayName =
    message.sender_name?.trim() ||
    message.sender_email?.trim() ||
    roleLabel;
  return {
    id: `message:${message.id}`,
    quoteId: quote.id,
    type: "message_posted",
    title: `${displayName} replied on ${getQuoteTitle(quote)}`,
    description: truncate(message.body, 180),
    actor: displayName,
    timestamp: safeTimestamp(message.created_at),
    href: `/customer/quotes/${quote.id}`,
  };
}

function buildBidEvent(
  bid: SupplierBidRow,
  quote: CustomerQuoteRow,
): QuoteActivityEvent {
  return {
    id: `bid:${bid.id}`,
    quoteId: quote.id,
    type: "bid_received",
    title: `Supplier bid updated on ${getQuoteTitle(quote)}`,
    description: formatBidSummary(bid),
    timestamp: safeTimestamp(bid.updated_at ?? bid.created_at),
    href: `/customer/quotes/${quote.id}`,
  };
}

function buildWinnerEvent(
  quote: CustomerQuoteRow,
  winningBid: SupplierBidRow | undefined,
): QuoteActivityEvent | null {
  if (!winningBid) {
    if ((quote.status ?? "").toLowerCase() !== "won") {
      return null;
    }
  }
  const price = winningBid?.unit_price ?? quote.price;
  const currency = winningBid?.currency ?? quote.currency;
  const priceLabel =
    typeof price === "number" || typeof price === "string"
      ? formatCurrency(
          typeof price === "string" ? Number(price) : (price as number) ?? null,
          currency,
        )
      : "Price pending";
  return {
    id: `winner:${quote.id}:${quote.updated_at ?? quote.created_at ?? "latest"}`,
    quoteId: quote.id,
    type: "winner_selected",
    title: `Winning supplier selected for ${getQuoteTitle(quote)}`,
    description: `${priceLabel} • Quote marked as won`,
    timestamp: safeTimestamp(quote.updated_at ?? new Date().toISOString()),
    href: `/customer/quotes/${quote.id}`,
  };
}

function buildWinningBidMap(bids: SupplierBidRow[]) {
  const map = new Map<string, SupplierBidRow>();
  for (const bid of bids) {
    if (typeof bid.status === "string" && bid.status.toLowerCase() === "won") {
      map.set(bid.quote_id, bid);
    }
  }
  return map;
}

function finalizeEvents(events: QuoteActivityEvent[]): QuoteActivityEvent[] {
  const deduped = new Map<string, QuoteActivityEvent>();
  for (const event of events) {
    if (!deduped.has(event.id)) {
      deduped.set(event.id, event);
    }
  }
  return Array.from(deduped.values())
    .sort((a, b) => {
      const aTime = Date.parse(a.timestamp) || 0;
      const bTime = Date.parse(b.timestamp) || 0;
      return bTime - aTime;
    })
    .slice(0, EVENT_LIMIT);
}

function getQuoteTitle(quote: CustomerQuoteRow) {
  return quote.file_name ?? quote.company ?? `Quote ${quote.id.slice(0, 6)}`;
}

function safeTimestamp(value?: string | null) {
  if (value && !Number.isNaN(Date.parse(value))) {
    return value;
  }
  return new Date().toISOString();
}

function truncate(value: string, length: number) {
  if (!value) {
    return "";
  }
  if (value.length <= length) {
    return value;
  }
  return `${value.slice(0, length - 1)}…`;
}

function formatBidSummary(bid: SupplierBidRow) {
  const numeric =
    typeof bid.unit_price === "string"
      ? Number(bid.unit_price)
      : bid.unit_price ?? null;
  const priceLabel = formatCurrency(
    typeof numeric === "number" ? numeric : null,
    bid.currency ?? "USD",
  );
  const leadTime =
    typeof bid.lead_time_days === "number"
      ? `${bid.lead_time_days} day${bid.lead_time_days === 1 ? "" : "s"}`
      : "Lead time pending";
  return `${priceLabel} • ${leadTime}`;
}

function buildCustomerQuotesSearchOr(rawNeedle: string): string | null {
  const needle = sanitizePostgrestOrNeedle(rawNeedle);
  if (!needle) return null;

  const wildcard = `*${needle}*`;
  return [
    `file_name.ilike.${wildcard}`,
    `company.ilike.${wildcard}`,
    `customer_name.ilike.${wildcard}`,
    `status.ilike.${wildcard}`,
  ].join(",");
}

function sanitizePostgrestOrNeedle(value: string): string {
  // Keep PostgREST `.or()` strings stable and prevent delimiter injection.
  // We also strip `*` since it's the wildcard token in `.or()` filters.
  return (value ?? "")
    .trim()
    .replace(/[*(),]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
