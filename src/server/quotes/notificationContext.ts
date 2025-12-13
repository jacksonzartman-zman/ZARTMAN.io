import { supabaseServer } from "@/lib/supabaseServer";
import { getCustomerByEmail } from "@/server/customers";
import type { CustomerRow } from "@/server/customers";
import type { SupplierBidRow, SupplierRow } from "@/server/suppliers/types";
import { loadSupplierById } from "@/server/suppliers/profile";
import type {
  QuoteContactInfo,
  QuoteWinningContext,
} from "@/server/quotes/notificationTypes";

type QuoteContactRow = QuoteContactInfo & {
  status?: string | null;
  price?: number | string | null;
  currency?: string | null;
};

const QUOTE_NOTIFICATION_COLUMNS =
  "id,file_name,company,customer_name,customer_email,status,price,currency,file_names,upload_file_names,file_count,upload_file_count";

export type QuoteNotificationContext = {
  quote: QuoteContactInfo;
  customer: CustomerRow | null;
};

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
    customer_email: row.customer_email ?? null,
    status: row.status ?? null,
    price: row.price ?? null,
    currency: row.currency ?? null,
  };
}

export async function loadQuoteNotificationContext(
  quoteId: string,
): Promise<QuoteNotificationContext | null> {
  const row = await selectQuoteRow(quoteId);
  if (!row) {
    return null;
  }

  const { status, price, currency, ...contact } = row;
  const customer = await loadCustomerForQuoteContact(contact);

  return {
    quote: contact,
    customer,
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

async function loadCustomerForQuoteContact(
  contact: QuoteContactInfo,
): Promise<CustomerRow | null> {
  if (!contact.customer_email) {
    return null;
  }
  try {
    const customer = await getCustomerByEmail(contact.customer_email);
    return customer ?? null;
  } catch (error) {
    console.warn("[quote notifications] customer enrichment skipped", {
      quoteId: contact.id,
      reason: "lookup-failed",
      error,
    });
    return null;
  }
}
