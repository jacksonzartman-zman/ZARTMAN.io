import { supabaseServer } from "@/lib/supabaseServer";
import type { SupplierBidRow, SupplierRow } from "@/server/suppliers/types";
import { loadSupplierById } from "@/server/suppliers/profile";
import type {
  QuoteContactInfo,
  QuoteWinningContext,
} from "@/server/quotes/notifications";

type QuoteContactRow = QuoteContactInfo & {
  status?: string | null;
  price?: number | string | null;
  currency?: string | null;
};

const QUOTE_NOTIFICATION_COLUMNS =
  "id,file_name,company,customer_name,email,status,price,currency";

export async function loadQuoteContactInfo(
  quoteId: string,
): Promise<QuoteContactInfo | null> {
  const row = await selectQuoteRow(quoteId);
  if (!row) {
    return null;
  }
  const { status, price, currency, ...contact } = row;
  return contact;
}

export async function loadQuoteWinningContext(
  quoteId: string,
): Promise<QuoteWinningContext | null> {
  const row = await selectQuoteRow(quoteId);
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    file_name: row.file_name ?? null,
    company: row.company ?? null,
    customer_name: row.customer_name ?? null,
    email: row.email ?? null,
    status: row.status ?? null,
    price: row.price ?? null,
    currency: row.currency ?? null,
  };
}

export async function loadBidRowById(
  bidId: string,
): Promise<SupplierBidRow | null> {
  if (!bidId) {
    return null;
  }
  try {
    const { data, error } = await supabaseServer
      .from("supplier_bids")
      .select("*")
      .eq("id", bidId)
      .maybeSingle<SupplierBidRow>();
    if (error) {
      console.error("[quote notifications] bid lookup failed", {
        bidId,
        error,
      });
      return null;
    }
    return data ?? null;
  } catch (error) {
    console.error("[quote notifications] bid lookup crashed", {
      bidId,
      error,
    });
    return null;
  }
}

export async function loadWinningBidNotificationContext(
  bidId: string,
): Promise<{ winningBid: SupplierBidRow; supplier: SupplierRow } | null> {
  const winningBid = await loadBidRowById(bidId);
  if (!winningBid) {
    console.warn("[quote notifications] winner context missing bid", {
      bidId,
    });
    return null;
  }

  if (!winningBid.supplier_id) {
    console.warn("[quote notifications] winner context missing supplier id", {
      bidId,
      quoteId: winningBid.quote_id,
    });
    return null;
  }

  const supplier = await loadSupplierById(winningBid.supplier_id);
  if (!supplier) {
    console.warn("[quote notifications] winner context missing supplier record", {
      bidId,
      supplierId: winningBid.supplier_id,
    });
    return null;
  }

  return { winningBid, supplier };
}

async function selectQuoteRow(
  quoteId: string,
): Promise<QuoteContactRow | null> {
  if (!quoteId) {
    return null;
  }
  try {
    const { data, error } = await supabaseServer
      .from("quotes_with_uploads")
      .select(QUOTE_NOTIFICATION_COLUMNS)
      .eq("id", quoteId)
      .maybeSingle<QuoteContactRow>();
    if (error) {
      console.error("[quote notifications] quote lookup failed", {
        quoteId,
        error,
      });
      return null;
    }
    return data ?? null;
  } catch (error) {
    console.error("[quote notifications] quote lookup crashed", {
      quoteId,
      error,
    });
    return null;
  }
}
