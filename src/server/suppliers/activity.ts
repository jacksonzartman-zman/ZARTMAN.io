import { supabaseServer } from "@/lib/supabaseServer";
import { formatCurrency } from "@/lib/formatCurrency";
import {
  getQuoteStatusLabel,
  normalizeQuoteStatus,
} from "@/server/quotes/status";
import type { QuoteActivityEvent } from "@/types/activity";
import type { QuoteMessageRecord } from "@/server/quotes/messages";
import type { SupplierBidRow } from "@/server/suppliers/types";

const EVENT_LIMIT = 10;
const QUOTE_FIELDS = "id,file_name,company,status,created_at,updated_at";

type SupplierQuoteRow = {
  id: string;
  file_name: string | null;
  company: string | null;
  status: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type SupplierActivityOptions = {
  emailOverride?: string | null;
};

export async function loadRecentSupplierActivity(
  supplierId: string,
  options?: SupplierActivityOptions,
): Promise<QuoteActivityEvent[]> {
  console.info("[supplier activity] load start", {
    supplierId,
    supplierEmail: options?.emailOverride ?? null,
  });
  if (!supplierId) {
    return [];
  }

  const bids = await fetchSupplierBids(supplierId);
  if (bids.length === 0) {
    console.info("[supplier activity] quotes resolved", {
      supplierId,
      quoteCount: 0,
    });
    return [];
  }

  const quoteIds = Array.from(new Set(bids.map((bid) => bid.quote_id)));
  const [quotes, messages] = await Promise.all([
    fetchQuotesByIds(quoteIds),
    fetchExternalMessages(quoteIds),
  ]);
  const quoteMap = new Map(quotes.map((quote) => [quote.id, quote]));
  console.info("[supplier activity] quotes resolved", {
    supplierId,
    quoteCount: quotes.length,
  });

  const events: QuoteActivityEvent[] = [];

  for (const quote of quotes) {
    const statusEvent = buildStatusEvent(quote);
    if (statusEvent) {
      events.push(statusEvent);
    }
  }

  for (const bid of bids) {
    const quote = quoteMap.get(bid.quote_id);
    if (!quote) {
      continue;
    }
    events.push(buildSupplierBidEvent(bid, quote));
    if (typeof bid.status === "string" && bid.status.toLowerCase() === "won") {
      const winnerEvent = buildWinnerEvent(quote, bid);
      if (winnerEvent) {
        events.push(winnerEvent);
      }
    }
  }

  for (const message of messages) {
    const quote = quoteMap.get(message.quote_id);
    if (!quote) {
      continue;
    }
    events.push(buildSupplierMessageEvent(message, quote));
  }

  const finalized = finalizeEvents(events);
  console.info("[supplier activity] events built", {
    supplierId,
    eventCount: finalized.length,
  });
  return finalized;
}

async function fetchSupplierBids(
  supplierId: string,
): Promise<SupplierBidRow[]> {
  const { data, error } = await supabaseServer
    .from("supplier_bids")
    .select(
      "id,quote_id,unit_price,currency,lead_time_days,status,created_at,updated_at",
    )
    .eq("supplier_id", supplierId)
    .order("updated_at", { ascending: false })
    .limit(EVENT_LIMIT * 4);
  if (error) {
    console.error("[supplier activity] bid query failed", {
      supplierId,
      error,
    });
    return [];
  }
  return (data ?? []) as SupplierBidRow[];
}

async function fetchQuotesByIds(
  quoteIds: string[],
): Promise<SupplierQuoteRow[]> {
  if (quoteIds.length === 0) {
    return [];
  }
  const { data, error } = await supabaseServer
    .from("quotes_with_uploads")
    .select(QUOTE_FIELDS)
    .in("id", quoteIds);
  if (error) {
    console.error("[supplier activity] quote query failed", { error });
    return [];
  }
  return (data ?? []) as SupplierQuoteRow[];
}

async function fetchExternalMessages(
  quoteIds: string[],
): Promise<QuoteMessageRecord[]> {
  if (quoteIds.length === 0) {
    return [];
  }
  const { data, error } = await supabaseServer
    .from("quote_messages")
    .select("id,quote_id,sender_role,sender_name,sender_email,body,created_at")
    .in("quote_id", quoteIds)
    .in("sender_role", ["admin", "customer"])
    .order("created_at", { ascending: false })
    .limit(EVENT_LIMIT * 3);
  if (error) {
    console.error("[supplier activity] message query failed", { error });
    return [];
  }
  return (data ?? []) as QuoteMessageRecord[];
}

function buildSupplierBidEvent(
  bid: SupplierBidRow,
  quote: SupplierQuoteRow,
): QuoteActivityEvent {
  const status =
    typeof bid.status === "string"
      ? bid.status.charAt(0).toUpperCase() + bid.status.slice(1).toLowerCase()
      : "Updated";
  return {
    id: `supplier-bid:${bid.id}`,
    quoteId: quote.id,
    type: "bid_received",
    title: `${status} bid for ${getQuoteTitle(quote)}`,
    description: formatBidSummary(bid),
    timestamp: safeTimestamp(bid.updated_at ?? bid.created_at),
    href: `/supplier/quotes/${quote.id}`,
  };
}

function buildSupplierMessageEvent(
  message: QuoteMessageRecord,
  quote: SupplierQuoteRow,
): QuoteActivityEvent {
  const senderRole =
    typeof message.sender_role === "string"
      ? message.sender_role.toLowerCase()
      : "admin";
  const actor =
    senderRole === "customer" ? "Customer" : "Zartman admin";
  const displayName =
    message.sender_name?.trim() ||
    message.sender_email?.trim() ||
    actor;
  return {
    id: `supplier-message:${message.id}`,
    quoteId: quote.id,
    type: "message_posted",
    title: `${actor} replied on ${getQuoteTitle(quote)}`,
    description: truncate(message.body, 160),
    actor: displayName,
    timestamp: safeTimestamp(message.created_at),
    href: `/supplier/quotes/${quote.id}`,
  };
}

function buildStatusEvent(
  quote: SupplierQuoteRow,
): QuoteActivityEvent | null {
  if (!quote.updated_at || quote.updated_at === quote.created_at) {
    return null;
  }
  const status = normalizeQuoteStatus(quote.status ?? undefined);
  const label = getQuoteStatusLabel(status);
  return {
    id: `supplier-status:${quote.id}:${quote.updated_at}`,
    quoteId: quote.id,
    type: "status_changed",
    title: `${getQuoteTitle(quote)} marked ${label}`,
    description: "Keep an eye on this RFQ so you can respond quickly.",
    timestamp: safeTimestamp(quote.updated_at),
    href: `/supplier/quotes/${quote.id}`,
  };
}

function buildWinnerEvent(
  quote: SupplierQuoteRow,
  bid: SupplierBidRow,
): QuoteActivityEvent | null {
  if (typeof bid.status !== "string" || bid.status.toLowerCase() !== "won") {
    return null;
  }
  return {
    id: `supplier-winner:${bid.id}`,
    quoteId: quote.id,
    type: "winner_selected",
    title: `Your bid won ${getQuoteTitle(quote)}`,
    description: formatBidSummary(bid),
    timestamp: safeTimestamp(bid.updated_at ?? bid.created_at),
    href: `/supplier/quotes/${quote.id}`,
  };
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

function getQuoteTitle(quote: SupplierQuoteRow) {
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
