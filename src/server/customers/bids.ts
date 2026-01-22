import { supabaseServer } from "@/lib/supabaseServer";
import { formatCurrency } from "@/lib/formatCurrency";
import { formatQuoteId, normalizeEmailInput } from "@/app/(portals)/quotes/pageUtils";
import {
  isMissingTableOrColumnError,
  serializeSupabaseError,
} from "@/server/admin/logging";

const CUSTOMER_BID_SELECT = [
  "id",
  "quote_id",
  "supplier_id",
  "unit_price",
  "currency",
  "lead_time_days",
  "notes",
  "status",
  "created_at",
  "supplier:suppliers(id,company_name)",
].join(",");

function formatQuoteReference(quoteId: string): string {
  const trimmed = typeof quoteId === "string" ? quoteId.trim() : "";
  if (!trimmed) return "";
  return ` (Quote ID ${formatQuoteId(trimmed)})`;
}

function customerBidError(quoteId: string): string {
  return `We couldn’t load offers for this search request${formatQuoteReference(quoteId)}. Refresh to try again, or contact support.`;
}

function customerBidAccessError(quoteId: string): string {
  return `We couldn’t verify access to this search request${formatQuoteReference(quoteId)}. Confirm you’re signed into the right account, then refresh. If this keeps happening, contact support.`;
}

function customerBidMissingQuoteError(quoteId: string): string {
  return `We couldn’t find that search request${formatQuoteReference(quoteId)}. Double-check the link, or return to your Quotes list.`;
}

export type CustomerQuoteBidSummary = {
  id: string;
  quoteId: string;
  supplierId: string;
  supplierName: string;
  priceDisplay: string | null;
  priceValue: number | null;
  currencyCode: string | null;
  leadTimeDisplay: string | null;
  leadTimeDays: number | null;
  notes: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  status: string | null;
};

export type LoadCustomerQuoteBidParams = {
  quoteId: string;
  customerEmail?: string | null;
  userEmail?: string | null;
  overrideEmail?: string | null;
};

export type LoadCustomerQuoteBidsResult =
  | {
      ok: true;
      bids: CustomerQuoteBidSummary[];
    }
  | {
      ok: false;
      bids: [];
      error: string;
      reason?:
        | "missing-quote"
        | "quote-not-found"
        | "access-denied"
        | "schema-missing"
        | "unexpected";
    };

type CustomerQuoteGuardRow = {
  id: string;
  customer_email: string | null;
};

type RawCustomerBidRow = {
  id: string;
  quote_id: string;
  supplier_id: string;
  unit_price: number | string | null;
  currency: string | null;
  lead_time_days: number | null;
  notes: string | null;
  status: string | null;
  created_at: string | null;
  updated_at: string | null;
  supplier:
    | null
    | {
        id: string;
        company_name: string | null;
      }
    | Array<{
        id: string;
        company_name: string | null;
      }>;
};

export async function loadCustomerQuoteBidSummaries(
  params: LoadCustomerQuoteBidParams,
): Promise<LoadCustomerQuoteBidsResult> {
  const quoteId = typeof params?.quoteId === "string" ? params.quoteId.trim() : "";
  if (!quoteId) {
    return {
      ok: false,
      bids: [],
      error: "Missing search request reference.",
      reason: "missing-quote",
    };
  }

  const normalizedCustomerEmail = normalizeEmailInput(params.customerEmail ?? null);
  const normalizedUserEmail = normalizeEmailInput(params.userEmail ?? null);
  const normalizedOverrideEmail = normalizeEmailInput(params.overrideEmail ?? null);

  try {
    const { data: quoteRow, error: quoteError } = await supabaseServer
      .from("quotes_with_uploads")
      .select("id,customer_email")
      .eq("id", quoteId)
      .maybeSingle<CustomerQuoteGuardRow>();

    if (quoteError) {
      console.error("[customer bids] quote lookup failed", {
        quoteId,
        error: serializeSupabaseError(quoteError),
      });
      return {
        ok: false,
        bids: [],
        error: customerBidMissingQuoteError(quoteId),
        reason: "quote-not-found",
      };
    }

    if (!quoteRow) {
      console.warn("[customer bids] quote missing", { quoteId });
      return {
        ok: false,
        bids: [],
        error: customerBidMissingQuoteError(quoteId),
        reason: "quote-not-found",
      };
    }

    const normalizedQuoteEmail = normalizeEmailInput(quoteRow.customer_email ?? null);
    const allowedEmails = [
      normalizedCustomerEmail,
      normalizedUserEmail,
      normalizedOverrideEmail,
    ].filter((value): value is string => Boolean(value));

    const hasAccess =
      normalizedQuoteEmail !== null &&
      allowedEmails.some((value) => value === normalizedQuoteEmail);

    if (!hasAccess) {
      console.warn("[customer bids] access denied", {
        quoteId,
        customerEmail: normalizedCustomerEmail,
        userEmail: normalizedUserEmail,
        overrideEmail: normalizedOverrideEmail,
      });
      return {
        ok: false,
        bids: [],
        error: customerBidAccessError(quoteId),
        reason: "access-denied",
      };
    }

    const { data, error } = await supabaseServer
      .from("supplier_bids")
      .select(CUSTOMER_BID_SELECT)
      .eq("quote_id", quoteId)
      .order("created_at", { ascending: false });

    if (error) {
      const serialized = serializeSupabaseError(error);
      if (isMissingTableOrColumnError(error)) {
        console.warn("[customer bids] schema missing", { quoteId, error: serialized });
        return {
          ok: false,
          bids: [],
          error: customerBidError(quoteId),
          reason: "schema-missing",
        };
      }

      console.error("[customer bids] query failed", { quoteId, error: serialized });
      return {
        ok: false,
        bids: [],
        error: customerBidError(quoteId),
        reason: "unexpected",
      };
    }

    const rows = Array.isArray(data)
      ? (data as unknown as RawCustomerBidRow[])
      : [];
    const bids = rows
      .map((row) => normalizeBidSummary(row))
      .filter((bid): bid is CustomerQuoteBidSummary => Boolean(bid));

    return {
      ok: true,
      bids,
    };
  } catch (error) {
    console.error("[customer bids] load crashed", {
      quoteId,
      error: serializeSupabaseError(error),
    });
    return {
      ok: false,
      bids: [],
      error: customerBidError(quoteId),
      reason: "unexpected",
    };
  }
}

function normalizeBidSummary(row?: RawCustomerBidRow | null): CustomerQuoteBidSummary | null {
  if (!row || !row.id) {
    return null;
  }

  const priceValue = normalizeAmount(row.unit_price);
  const currencyCode = normalizeCurrency(row.currency);
  const priceDisplay =
    typeof priceValue === "number"
      ? formatCurrency(priceValue, currencyCode ?? undefined, {
          maximumFractionDigits: 2,
          minimumFractionDigits: 2,
        })
      : null;
  const leadTimeDays = normalizeLeadTime(row.lead_time_days);
  const leadTimeDisplay = formatLeadTime(leadTimeDays);

  return {
    id: row.id,
    quoteId: row.quote_id,
    supplierId: row.supplier_id,
    supplierName: resolveSupplierName(row.supplier),
    priceDisplay,
    priceValue,
    currencyCode,
    leadTimeDisplay,
    leadTimeDays,
    notes: normalizeNotes(row.notes),
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
    status: normalizeStatus(row.status),
  };
}

function resolveSupplierName(
  rawSupplier: RawCustomerBidRow["supplier"],
): string {
  if (!rawSupplier) {
    return "Supplier partner";
  }
  const supplierRecord = Array.isArray(rawSupplier)
    ? rawSupplier[0]
    : rawSupplier;
  const name =
    typeof supplierRecord?.company_name === "string"
      ? supplierRecord.company_name.trim()
      : "";
  if (name.length > 0) {
    return name;
  }
  return "Supplier partner";
}

function normalizeAmount(value: number | string | null | undefined): number | null {
  const numeric = typeof value === "string" ? Number(value) : value;
  if (typeof numeric === "number" && Number.isFinite(numeric)) {
    return numeric;
  }
  return null;
}

function normalizeCurrency(value: string | null): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim().toUpperCase();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeLeadTime(value: number | null | undefined): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return value;
  }
  return null;
}

function formatLeadTime(value: number | null): string | null {
  if (value === null) {
    return null;
  }
  if (value <= 7) {
    const suffix = value === 1 ? "day" : "days";
    return `${value} ${suffix}`;
  }
  const weeks = Math.max(1, Math.round(value / 7));
  const suffix = weeks === 1 ? "week" : "weeks";
  return `${weeks} ${suffix}`;
}

function normalizeNotes(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeStatus(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
