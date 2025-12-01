import { supabaseServer } from "@/lib/supabaseServer";
import { getCustomerById } from "@/server/customers";
import { normalizeEmailInput } from "@/app/(portals)/quotes/pageUtils";
import {
  getQuoteStatusLabel,
  normalizeQuoteStatus,
} from "@/server/quotes/status";
import type { QuoteActivityEvent } from "@/types/activity";
import type { QuoteMessageRow } from "@/server/quotes/messages";
import type { SupplierBidRow } from "@/server/suppliers/types";
import { formatCurrency } from "@/lib/formatCurrency";

const EVENT_LIMIT = 10;
const QUOTE_COLUMNS =
  "id,file_name,company,customer_name,email,status,created_at,updated_at,price,currency";

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
};

type CustomerActivityOptions = {
  emailOverride?: string | null;
};

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
    quotes = await fetchQuotesByEmail(overrideEmail);
  } else {
    const customer = await getCustomerById(customerId);
    if (!customer) {
      return [];
    }
    quotes = await fetchCustomerQuotes(customer);
  }

  if (quotes.length === 0) {
    return [];
  }
  console.info("[customer activity] quotes resolved", {
    customerId,
    quoteCount: quotes.length,
  });

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
    if (message.author_type === "customer") {
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

async function fetchCustomerQuotes(
  customer: NonNullable<Awaited<ReturnType<typeof getCustomerById>>>,
): Promise<CustomerQuoteRow[]> {
  const baseQuery = supabaseServer
    .from("quotes_with_uploads")
    .select(QUOTE_COLUMNS)
    .order("updated_at", { ascending: false })
    .limit(EVENT_LIMIT * 3)
    .eq("customer_id", customer.id);

  const { data, error } = await baseQuery;
  if (error) {
    console.error("[customer activity] quote query failed", {
      customerId: customer.id,
      error,
    });
    return [];
  }
  const rows = (data ?? []) as CustomerQuoteRow[];
  if (rows.length > 0) {
    return rows;
  }

  const normalizedEmail = normalizeEmailInput(customer.email ?? null);
  if (!normalizedEmail) {
    return [];
  }

  const { data: emailRows, error: emailError } = await supabaseServer
    .from("quotes_with_uploads")
    .select(QUOTE_COLUMNS)
    .order("updated_at", { ascending: false })
    .limit(EVENT_LIMIT * 3)
    .ilike("email", normalizedEmail);

  if (emailError) {
    console.error("[customer activity] quote email query failed", {
      customerId: customer.id,
      email: normalizedEmail,
      error: emailError,
    });
    return [];
  }

  return (emailRows ?? []) as CustomerQuoteRow[];
}

async function fetchQuotesByEmail(
  email: string,
): Promise<CustomerQuoteRow[]> {
  const { data, error } = await supabaseServer
    .from("quotes_with_uploads")
    .select(QUOTE_COLUMNS)
    .order("updated_at", { ascending: false })
    .limit(EVENT_LIMIT * 3)
    .ilike("email", email);
  if (error) {
    console.error("[customer activity] override query failed", {
      email,
      error,
    });
    return [];
  }
  return (data ?? []) as CustomerQuoteRow[];
}

async function fetchQuoteMessages(quoteIds: string[]): Promise<QuoteMessageRow[]> {
  if (quoteIds.length === 0) {
    return [];
  }
  const { data, error } = await supabaseServer
    .from("quote_messages")
    .select("id,quote_id,author_type,author_name,body,created_at")
    .in("quote_id", quoteIds)
    .order("created_at", { ascending: false })
    .limit(EVENT_LIMIT * 4);
  if (error) {
    console.error("[customer activity] message query failed", { error });
    return [];
  }
  return (data ?? []) as QuoteMessageRow[];
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
  message: QuoteMessageRow,
  quote: CustomerQuoteRow,
): QuoteActivityEvent {
  return {
    id: `message:${message.id}`,
    quoteId: quote.id,
    type: "message_posted",
    title: `${message.author_name ?? "A teammate"} replied on ${getQuoteTitle(quote)}`,
    description: truncate(message.body, 180),
    actor: message.author_name ?? message.author_type,
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
