import { normalizeEmailInput } from "@/app/(portals)/quotes/pageUtils";
import { supabaseServer } from "@/lib/supabaseServer";
import {
  logSupplierActivityQueryFailure,
  resolveSupplierActivityQuery,
  toSupplierActivityQueryError,
} from "@/server/suppliers/activityLogging";
import {
  approvalsEnabled,
  isMissingSupplierAssignmentsColumnError,
  isSupplierAssignmentsEnabled,
} from "@/server/suppliers/flags";
import {
  SAFE_QUOTE_WITH_UPLOADS_FIELDS,
  type SupplierActivityIdentity,
  type SupplierActivityResult,
  type SupplierQuoteRow,
} from "@/server/suppliers/types";
import {
  getSupplierApprovalStatus,
  isSupplierApproved,
  loadSupplierById,
  loadSupplierByPrimaryEmail,
} from "@/server/suppliers/profile";
import {
  getQuoteStatusLabel,
  normalizeQuoteStatus,
  type QuoteStatus,
} from "@/server/quotes/status";
import type { ActivityItem } from "@/types/activity";
import { getCustomerById } from "@/server/customers";

type ActivityContext = "customer" | "supplier";

type QuoteSummaryRow = SupplierQuoteRow;

type BidSummaryRow = {
  id: string;
  quote_id: string;
  supplier_id: string | null;
  unit_price: number | string | null;
  currency: string | null;
  status: string | null;
  lead_time_days: number | null;
  created_at: string | null;
  updated_at: string | null;
};

type SupplierSummary = {
  id: string;
  company_name: string | null;
  primary_email: string | null;
};

type BidWithSupplier = BidSummaryRow & {
  supplier?: SupplierSummary | null;
};

const DEFAULT_ACTIVITY_LIMIT = 10;
const SUPPLIER_ACTIVITY_LABEL = "supplier activity";

type ActivityQueryContext = SupplierActivityIdentity & {
  label: string;
  loader?: string;
};
const QUOTE_FIELDS = SAFE_QUOTE_WITH_UPLOADS_FIELDS;
const QUOTE_ACTIVITY_TITLES: Record<QuoteStatus, string> = {
  submitted: "RFQ submitted",
  in_review: "RFQ under review",
  quoted: "Quote prepared",
  won: "Quote won",
  lost: "Quote closed as lost",
  cancelled: "RFQ cancelled",
};

export async function loadCustomerActivityFeed(args: {
  customerId?: string | null;
  email?: string | null;
  domain?: string | null;
  limit?: number;
}): Promise<ActivityItem[]> {
  const limit = args.limit ?? DEFAULT_ACTIVITY_LIMIT;
  const quotes = await fetchCustomerQuotes({
    customerId: args.customerId ?? null,
    email: args.email ?? null,
    domain: args.domain ?? null,
    limit: Math.max(limit * 2, 20),
  });

  if (quotes.length === 0) {
    return [];
  }

  const quoteIds = quotes.map((quote) => quote.id);
  const bids = await fetchBids(
    { quoteIds },
    limit * 3,
    true, // include supplier names so customers know who responded
  );

  const items = [
    ...quotes.map((quote) => buildQuoteActivityItem(quote, "customer")),
    ...quotes
      .map((quote) => buildStatusActivityItem(quote, "customer"))
      .filter((item): item is ActivityItem => Boolean(item)),
    ...bids.map((bid) => buildBidActivityItem(bid, "customer")),
  ];

  const finalized = finalizeActivity(items, limit);
  console.log("[customer activity] feed result", {
    customerId: args.customerId ?? null,
    email: args.email ?? null,
    domain: args.domain ?? null,
    count: finalized.length,
  });
  return finalized;
}

export async function loadSupplierActivityFeed(
  args: SupplierActivityIdentity & {
    limit?: number;
  },
): Promise<SupplierActivityResult<ActivityItem[]>> {
  const limit = args.limit ?? DEFAULT_ACTIVITY_LIMIT;
  const supplierId = args.supplierId ?? null;
  const supplierEmail = normalizeEmail(args.supplierEmail);
  const logContext: ActivityQueryContext = {
    label: SUPPLIER_ACTIVITY_LABEL,
    supplierId,
    supplierEmail,
    loader: "activity",
  };
  const loggingPayload = {
    supplierId,
    supplierEmail,
    loader: "activity",
  };
  const assignmentsEnabled = isSupplierAssignmentsEnabled();

  if (!supplierId && !supplierEmail) {
    console.warn("[supplier activity] loading skipped", {
      ...loggingPayload,
      error: "Missing supplier identity",
    });
    return {
      ok: false,
      data: [],
      error: "Missing supplier identity",
    };
  }

  console.log("[supplier activity] loading", loggingPayload);

  const approvalsOn = approvalsEnabled();
  if (approvalsOn) {
    const supplierRecord = supplierId
      ? await loadSupplierById(supplierId)
      : supplierEmail
        ? await loadSupplierByPrimaryEmail(supplierEmail)
        : null;
    const approvalStatus = getSupplierApprovalStatus(supplierRecord ?? undefined);
    const approved = isSupplierApproved(supplierRecord ?? undefined);
    if (!approved) {
      console.log("[supplier activity] approvals gate active", {
        ...loggingPayload,
        approvalStatus,
      });
      return {
        ok: true,
        data: [],
        approvalGate: {
          enabled: true,
          status: approvalStatus,
        },
      };
    }
  }

  if (!assignmentsEnabled) {
    console.log("[supplier activity] assignments disabled: skipping activity feed", {
      ...loggingPayload,
    });
    return {
      ok: true,
      data: [],
    };
  }

  try {
    const assignmentQuoteIds = supplierEmail
      ? await selectSupplierQuoteIds(supplierEmail, logContext)
      : [];
    const bids = await fetchBids(
      { supplierId },
      limit * 3,
      false,
      logContext,
    );
    const bidQuoteIds = bids.map((bid) => bid.quote_id);

    const quotes = await fetchSupplierQuotes(
      {
        quoteIds: Array.from(new Set([...assignmentQuoteIds, ...bidQuoteIds])),
        supplierEmail,
        limit: Math.max(limit * 2, 20),
      },
      logContext,
      assignmentsEnabled,
    );

    const items = [
      ...quotes.map((quote) => buildQuoteActivityItem(quote, "supplier")),
      ...quotes
        .map((quote) => buildStatusActivityItem(quote, "supplier"))
        .filter((item): item is ActivityItem => Boolean(item)),
      ...bids.map((bid) => buildBidActivityItem(bid, "supplier")),
    ];

    const finalized = finalizeActivity(items, limit);

    console.log("[supplier activity] quote query result", {
      ...loggingPayload,
      count: finalized.length,
    });

    return {
      ok: true,
      data: finalized,
    };
  } catch (error) {
    logSupplierActivityQueryFailure({
      loader: logContext.loader,
      supplierId: logContext.supplierId,
      supplierEmail: logContext.supplierEmail,
      query: resolveSupplierActivityQuery(error, "supplier_activity_feed"),
      error,
      stage: "loader",
    });
    return {
      ok: false,
      data: [],
      error: "Unable to load activity right now",
    };
  }
}

async function fetchCustomerQuotes(args: {
  customerId?: string | null;
  email?: string | null;
  domain?: string | null;
  limit: number;
}): Promise<QuoteSummaryRow[]> {
  const { customerId, email, domain, limit } = args;
  const filters: Array<() => Promise<QuoteSummaryRow[]>> = [];

  if (customerId) {
    filters.push(() => selectQuotesByCustomerId(customerId, limit));
  }

  const normalizedEmail = normalizeEmail(email);
  if (normalizedEmail) {
    filters.push(() =>
      selectQuotesByFilter((query) =>
        query.ilike("email", normalizedEmail).limit(limit),
      ),
    );
  }

  const normalizedDomain = normalizeDomain(domain);
  if (normalizedDomain) {
    filters.push(() =>
      selectQuotesByFilter((query) =>
        query.ilike("email", `%@${normalizedDomain}`).limit(limit),
      ),
    );
  }

  for (const loader of filters) {
    const quotes = await loader();
    if (quotes.length > 0) {
      return quotes;
    }
  }

  return [];
}

async function fetchSupplierQuotes(
  args: {
    quoteIds: string[];
    supplierEmail: string | null;
    limit: number;
  },
  context?: ActivityQueryContext,
  assignmentsEnabled?: boolean,
): Promise<QuoteSummaryRow[]> {
  const { quoteIds, supplierEmail, limit } = args;
  const assignmentsFeatureEnabled = assignmentsEnabled ?? true;

  if (quoteIds.length > 0) {
    return selectQuotesByFilter(
      (query) => query.in("id", quoteIds).limit(limit),
      context,
    );
  }

  if (!supplierEmail) {
    return [];
  }

  return selectQuotesByFilter(
    (query) =>
      query
        .or(
          [
            `email.ilike.${supplierEmail}`,
            ...(assignmentsFeatureEnabled
              ? [`assigned_supplier_email.ilike.${supplierEmail}`]
              : []),
          ].join(","),
        )
        .limit(limit),
    context,
  );
}

async function selectQuotesByFilter(
  build: (query: any) => any,
  context?: ActivityQueryContext,
): Promise<QuoteSummaryRow[]> {
  const shouldThrow = context?.label === SUPPLIER_ACTIVITY_LABEL;
  try {
    const baseQuery = supabaseServer
      .from("quotes_with_uploads")
      .select(QUOTE_FIELDS.join(","))
      .order("created_at", { ascending: false });
    const query = build(baseQuery);
    const { data, error } = await query;
    if (error) {
      if (shouldSkipAssignmentsColumnError(error, context)) {
        logAssignmentsColumnWarning(context, error);
        return [];
      }
      logQuoteError(error, context);
      if (shouldThrow) {
        throw toSupplierActivityQueryError("quotes_with_uploads", error);
      }
      return [];
    }
    return (data as QuoteSummaryRow[]) ?? [];
  } catch (error) {
    if (shouldSkipAssignmentsColumnError(error, context)) {
      logAssignmentsColumnWarning(context, error);
      return [];
    }
    logQuoteError(error, context);
    if (shouldThrow) {
      throw toSupplierActivityQueryError("quotes_with_uploads", error);
    }
    return [];
  }
}

function logQuoteError(
  rawError: unknown,
  context?: ActivityQueryContext,
) {
  const label = context?.label ?? "activity";
  if (label === SUPPLIER_ACTIVITY_LABEL) {
    logSupplierActivityQueryFailure({
      loader: context?.loader ?? null,
      supplierId: context?.supplierId ?? null,
      supplierEmail: context?.supplierEmail ?? null,
      query: "quotes_with_uploads",
      error: rawError,
      stage: context?.loader ?? null,
    });
    return;
  }
  console.error(`[${label}] quote query failed`, {
    loader: context?.loader ?? null,
    supplierId: context?.supplierId ?? null,
    supplierEmail: context?.supplierEmail ?? null,
    error:
      rawError instanceof Error
        ? rawError.message
        : typeof rawError === "object"
          ? JSON.stringify(rawError)
          : String(rawError),
  });
}

function logSupplierActivityError(
  message: string,
  rawError: unknown,
  context?: ActivityQueryContext,
  extra?: Record<string, unknown>,
) {
  const label = context?.label ?? "activity";
  console.error(`[${label}] ${message}`, {
    loader: context?.loader ?? null,
    supplierId: context?.supplierId ?? null,
    supplierEmail: context?.supplierEmail ?? null,
    error:
      rawError instanceof Error
        ? rawError.message
        : typeof rawError === "object"
          ? JSON.stringify(rawError)
          : String(rawError),
    ...extra,
  });
}

function shouldSkipAssignmentsColumnError(
  error: unknown,
  context?: ActivityQueryContext,
): boolean {
  if (context?.label !== SUPPLIER_ACTIVITY_LABEL) {
    return false;
  }
  return isMissingSupplierAssignmentsColumnError(extractSupabaseSource(error));
}

function logAssignmentsColumnWarning(
  context: ActivityQueryContext | undefined,
  rawError: unknown,
) {
  console.warn("[supplier activity] assignments disabled: missing column", {
    loader: context?.loader ?? null,
    supplierId: context?.supplierId ?? null,
    supplierEmail: context?.supplierEmail ?? null,
    stage: context?.loader ?? null,
    supabaseError: formatSupabaseError(extractSupabaseSource(rawError)),
  });
}

function extractSupabaseSource(error: unknown): unknown {
  if (
    error &&
    typeof error === "object" &&
    "supabaseError" in error &&
    (error as { supabaseError?: unknown }).supabaseError
  ) {
    return (error as { supabaseError?: unknown }).supabaseError;
  }
  return error;
}

function formatSupabaseError(error: unknown) {
  if (!error || typeof error !== "object") {
    return error ?? null;
  }
  const maybeError = error as {
    code?: unknown;
    message?: unknown;
    details?: unknown;
    hint?: unknown;
  };
  return {
    code: typeof maybeError.code === "string" ? maybeError.code : null,
    message: typeof maybeError.message === "string" ? maybeError.message : null,
    details: typeof maybeError.details === "string" ? maybeError.details : null,
    hint: typeof maybeError.hint === "string" ? maybeError.hint : null,
  };
}

async function fetchBids(
  filter: { quoteIds?: string[]; supplierId?: string | null },
  limit: number,
  includeSupplierContext: boolean,
  context?: ActivityQueryContext,
): Promise<BidWithSupplier[]> {
  if (
    (!filter.quoteIds || filter.quoteIds.length === 0) &&
    !filter.supplierId
  ) {
    return [];
  }

  try {
    let query = supabaseServer
      .from("supplier_bids")
      .select(
        "id,quote_id,supplier_id,unit_price,currency,status,lead_time_days,created_at,updated_at",
      )
      .order("updated_at", { ascending: false })
      .limit(limit);

    if (filter.quoteIds && filter.quoteIds.length > 0) {
      query = query.in("quote_id", filter.quoteIds);
    }

    if (filter.supplierId) {
      query = query.eq("supplier_id", filter.supplierId);
    }

    const { data, error } = await query;
    if (error) {
      logSupplierActivityError("bid query failed", error, context, filter);
      return [];
    }

    const bids = (data as BidSummaryRow[]) ?? [];

    if (!includeSupplierContext || bids.length === 0) {
      return bids;
    }

    const supplierIds = Array.from(
      new Set(
        bids
          .map((bid) => bid.supplier_id)
          .filter((value): value is string => Boolean(value)),
      ),
    );

    const suppliers = await fetchSuppliersByIds(supplierIds);
    const supplierMap = new Map(
      suppliers.map((supplier) => [supplier.id, supplier]),
    );

    return bids.map((bid) => ({
      ...bid,
      supplier: supplierMap.get(bid.supplier_id ?? "") ?? null,
    }));
  } catch (error) {
    logSupplierActivityError("bid query failed", error, context, filter);
    return [];
  }
}

async function fetchSuppliersByIds(
  supplierIds: string[],
): Promise<SupplierSummary[]> {
  if (supplierIds.length === 0) {
    return [];
  }

  try {
    const { data, error } = await supabaseServer
      .from("suppliers")
      .select("id,company_name,primary_email")
      .in("id", supplierIds);

    if (error) {
      console.error("activity: supplier query failed", { error, supplierIds });
      return [];
    }

    return (data as SupplierSummary[]) ?? [];
  } catch (error) {
    console.error("activity: supplier query error", { error, supplierIds });
    return [];
  }
}

async function selectSupplierQuoteIds(
  supplierEmail: string | null,
  context?: ActivityQueryContext,
): Promise<string[]> {
  if (!supplierEmail) {
    return [];
  }

  try {
    const { data, error } = await supabaseServer
      .from("quote_suppliers")
      .select("quote_id")
      .ilike("supplier_email", supplierEmail);

    if (error) {
      logSupplierActivityError(
        "assignment query failed",
        error,
        context,
        { supplierEmail },
      );
      return [];
    }

    return ((data ?? []) as { quote_id: string }[])
      .map((row) => row.quote_id)
      .filter((id): id is string => Boolean(id));
  } catch (error) {
    logSupplierActivityError(
      "assignment query failed",
      error,
      context,
      { supplierEmail },
    );
    return [];
  }
}

function buildQuoteActivityItem(
  quote: QuoteSummaryRow,
  context: ActivityContext,
): ActivityItem {
  const normalizedStatus = normalizeQuoteStatus(quote.status ?? undefined);
  const statusLabel =
    QUOTE_ACTIVITY_TITLES[normalizedStatus] ??
    getQuoteStatusLabel(quote.status ?? undefined);
  const hrefBase =
    context === "customer" ? "/customer/quotes" : "/supplier/quotes";

  return {
    id: `${context}:quote:${quote.id}`,
    type: "quote",
    title: `${getQuoteTitle(quote)}: ${statusLabel}`,
    description: buildQuoteDescription(quote, context),
    timestamp: safeTimestamp(quote.created_at ?? quote.updated_at),
    href: `${hrefBase}/${quote.id}`,
  };
}

function buildStatusActivityItem(
  quote: QuoteSummaryRow,
  context: ActivityContext,
): ActivityItem | null {
  if (!quote.updated_at || quote.updated_at === quote.created_at) {
    return null;
  }

  const normalizedStatus = normalizeQuoteStatus(quote.status ?? undefined);
  const statusLabel =
    QUOTE_ACTIVITY_TITLES[normalizedStatus] ??
    getQuoteStatusLabel(quote.status ?? undefined);
  const hrefBase =
    context === "customer" ? "/customer/quotes" : "/supplier/quotes";

  return {
    id: `${context}:status:${quote.id}:${quote.updated_at}`,
    type: "status",
    title: `${getQuoteTitle(quote)}: ${statusLabel}`,
    description:
      context === "customer"
        ? "We updated this RFQ status in your workspace."
        : "Keep an eye on this RFQ so you can respond quickly.",
    timestamp: safeTimestamp(quote.updated_at),
    href: `${hrefBase}/${quote.id}`,
  };
}

function buildBidActivityItem(
  bid: BidWithSupplier,
  context: ActivityContext,
): ActivityItem {
  const hrefBase =
    context === "customer" ? "/customer/quotes" : "/supplier/quotes";
  const statusLabel = formatBidStatus(bid.status);
  const priceLabel = formatCurrencyValue(bid.unit_price, bid.currency);
  const leadTimeLabel =
    typeof bid.lead_time_days === "number" && Number.isFinite(bid.lead_time_days)
      ? `${bid.lead_time_days} day${bid.lead_time_days === 1 ? "" : "s"}`
      : "Lead time pending";

  if (context === "customer") {
    const supplierName =
      bid.supplier?.company_name ??
      bid.supplier?.primary_email ??
      "Supplier partner";
    return {
      id: `customer:bid:${bid.id}`,
      type: "bid",
      title: `${supplierName} submitted a bid`,
      description: `${statusLabel} • ${priceLabel} • ${leadTimeLabel}`,
      timestamp: safeTimestamp(bid.updated_at ?? bid.created_at),
      href: `${hrefBase}/${bid.quote_id}`,
    };
  }

  return {
    id: `supplier:bid:${bid.id}`,
    type: "bid",
    title: `Bid ${statusLabel}`,
    description: `${priceLabel} • ${leadTimeLabel}`,
    timestamp: safeTimestamp(bid.updated_at ?? bid.created_at),
    href: `${hrefBase}/${bid.quote_id}`,
  };
}

function finalizeActivity(
  items: ActivityItem[],
  limit: number,
): ActivityItem[] {
  const deduped = new Map<string, ActivityItem>();
  for (const item of items) {
    if (!deduped.has(item.id)) {
      deduped.set(item.id, item);
    }
  }

  return Array.from(deduped.values())
    .sort((a, b) => {
      const aTime = Date.parse(a.timestamp) || 0;
      const bTime = Date.parse(b.timestamp) || 0;
      return bTime - aTime;
    })
    .slice(0, limit);
}

function getQuoteTitle(quote: QuoteSummaryRow): string {
  if (quote.file_name) {
    return quote.file_name;
  }
  if (quote.company) {
    return quote.company;
  }
  return `Quote ${quote.id.slice(0, 6)}`;
}

function buildQuoteDescription(
  quote: QuoteSummaryRow,
  context: ActivityContext,
): string {
  const contact =
    quote.company ??
    quote.customer_name ??
    quote.email ??
    (context === "customer" ? "your team" : "customer");
  if (context === "customer") {
    return `Uploaded by ${contact}`;
  }
  return `RFQ from ${contact}`;
}

function normalizeEmail(value?: string | null): string | null {
  return normalizeEmailInput(value);
}

function normalizeDomain(value?: string | null): string | null {
  if (!value) {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized.replace(/^@/, "") : null;
}

function safeTimestamp(value?: string | null): string {
  if (value && !Number.isNaN(Date.parse(value))) {
    return value;
  }
  return new Date().toISOString();
}

function formatBidStatus(status: string | null | undefined): string {
  if (!status) {
    return "Pending";
  }
  const normalized = status.trim().toLowerCase();
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function formatCurrencyValue(
  value: number | string | null | undefined,
  currency: string | null | undefined,
): string {
  const numeric =
    typeof value === "string" ? Number(value) : value;
  if (typeof numeric !== "number" || Number.isNaN(numeric)) {
    return "Pricing pending";
  }
  const resolvedCurrency = (currency ?? "USD").toUpperCase();
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: resolvedCurrency,
      maximumFractionDigits: 0,
    }).format(numeric);
  } catch {
    return `${resolvedCurrency} ${numeric.toFixed(0)}`;
  }
}

async function selectQuotesByCustomerId(
  customerId?: string | null,
  limit?: number,
): Promise<QuoteSummaryRow[]> {
  if (!customerId) {
    return [];
  }

  const customer = await getCustomerById(customerId);
  if (!customer) {
    console.warn("selectQuotesByCustomerId: customer not found", {
      customerId,
    });
    return [];
  }

  const normalizedEmail = normalizeEmailInput(customer.email ?? null);
  if (!normalizedEmail) {
    console.warn("selectQuotesByCustomerId: customer missing email", {
      customerId,
    });
    return [];
  }

  console.log("selectQuotesByCustomerId: resolving via email", {
    customerId,
    email: normalizedEmail,
  });

  try {
    const { data, error } = await supabaseServer
      .from("quotes_with_uploads")
      .select(QUOTE_FIELDS.join(","))
      .ilike("email", normalizedEmail)
      .order("created_at", { ascending: false })
      .limit(limit ?? DEFAULT_ACTIVITY_LIMIT * 2);

    if (error) {
      console.error("selectQuotesByCustomerId: query failed", {
        customerId,
        email: normalizedEmail,
        error,
      });
      return [];
    }

    const rows = (data ?? []) as unknown as QuoteSummaryRow[];
    return rows;
  } catch (error) {
    console.error("selectQuotesByCustomerId: query failed", {
      customerId,
      email: normalizedEmail,
      error,
    });
    return [];
  }
}
