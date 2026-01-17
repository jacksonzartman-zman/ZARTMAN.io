import { supabaseServer } from "@/lib/supabaseServer";
import { computeDestinationNeedsAction, computeQuoteNeedsAction, type SlaReason } from "@/lib/ops/sla";
import {
  handleMissingSupabaseSchema,
  serializeSupabaseError,
  warnOnce,
} from "@/server/admin/logging";
import { requireAdminUser } from "@/server/auth";
import { hasColumns, schemaGate } from "@/server/db/schemaContract";

export type AdminOpsInboxFilters = {
  status?: string | null;
  needsActionOnly?: boolean | null;
  providerId?: string | null;
  destinationStatus?: string | null;
  selectedOnly?: boolean | null;
};

export type AdminOpsInboxQuote = {
  id: string;
  title: string | null;
  created_at: string | null;
  status: string | null;
  selected_offer_id: string | null;
  selected_provider_id: string | null;
};

export type AdminOpsInboxCustomer = {
  name: string | null;
  email: string | null;
  company: string | null;
};

export type AdminOpsInboxDestination = {
  id: string;
  provider_id: string;
  provider_name: string | null;
  provider_type: string | null;
  quoting_mode: string | null;
  status: string | null;
  created_at: string | null;
  last_status_at: string | null;
  sent_at: string | null;
  error_message: string | null;
};

export type AdminOpsInboxOffer = {
  provider_id: string;
};

export type AdminOpsInboxSummary = {
  counts: {
    queued: number;
    sent: number;
    viewed: number;
    quoted: number;
    declined: number;
    error: number;
  };
  needsActionCount: number;
  needsReplyCount: number;
  errorsCount: number;
  queuedStaleCount: number;
  topReasons: Array<Exclude<SlaReason, null>>;
};

export type AdminOpsInboxRow = {
  quote: AdminOpsInboxQuote;
  customer: AdminOpsInboxCustomer;
  destinations: AdminOpsInboxDestination[];
  offers: AdminOpsInboxOffer[];
  summary: AdminOpsInboxSummary;
};

type AdminOpsInboxArgs = {
  limit?: number;
  offset?: number;
  filters?: AdminOpsInboxFilters;
};

type QuoteRow = {
  id: string | null;
  created_at: string | null;
  status: string | null;
  title?: string | null;
  selected_offer_id?: string | null;
  selected_provider_id?: string | null;
  customer_name?: string | null;
  customer_email?: string | null;
  company?: string | null;
};

type QuoteHydrationRow = {
  id: string | null;
  customer_name: string | null;
  customer_email: string | null;
  company: string | null;
};

type DestinationRow = {
  id: string | null;
  rfq_id: string | null;
  provider_id: string | null;
  status: string | null;
  created_at: string | null;
  last_status_at?: string | null;
  sent_at?: string | null;
  error_message?: string | null;
  provider?: {
    name?: string | null;
    provider_type?: string | null;
    quoting_mode?: string | null;
  } | null;
};

type OfferRow = {
  rfq_id: string | null;
  provider_id: string | null;
};

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

const DESTINATION_STATUS_COUNTS = [
  "queued",
  "sent",
  "viewed",
  "quoted",
  "declined",
  "error",
] as const;

type DestinationStatusCountKey = (typeof DESTINATION_STATUS_COUNTS)[number];

export async function getAdminOpsInboxRows(
  args: AdminOpsInboxArgs = {},
): Promise<AdminOpsInboxRow[]> {
  await requireAdminUser();

  const limit = normalizeLimit(args.limit);
  const offset = normalizeOffset(args.offset);
  if (limit <= 0) {
    return [];
  }

  const filters = normalizeFilters(args.filters);

  const quotesSupported = await schemaGate({
    enabled: true,
    relation: "quotes",
    requiredColumns: ["id", "created_at", "status"],
    warnPrefix: "[admin ops inbox]",
    warnKey: "admin_ops_inbox:quotes",
  });
  if (!quotesSupported) {
    return [];
  }

  const [
    supportsTitle,
    supportsSelectedOffer,
    supportsSelectedProvider,
    supportsCustomerName,
    supportsCustomerEmail,
    supportsCompany,
  ] = await Promise.all([
    hasColumns("quotes", ["title"]),
    hasColumns("quotes", ["selected_offer_id"]),
    hasColumns("quotes", ["selected_provider_id"]),
    hasColumns("quotes", ["customer_name"]),
    hasColumns("quotes", ["customer_email"]),
    hasColumns("quotes", ["company"]),
  ]);

  if (filters.selectedOnly && !supportsSelectedOffer) {
    warnOnce(
      "admin_ops_inbox:selected_offer_missing",
      "[admin ops inbox] selected-only filter skipped (missing selected_offer_id)",
    );
  }

  const quoteSelect = ["id", "created_at", "status"];
  if (supportsTitle) quoteSelect.push("title");
  if (supportsSelectedOffer) quoteSelect.push("selected_offer_id");
  if (supportsSelectedProvider) quoteSelect.push("selected_provider_id");
  if (supportsCustomerName) quoteSelect.push("customer_name");
  if (supportsCustomerEmail) quoteSelect.push("customer_email");
  if (supportsCompany) quoteSelect.push("company");

  let quoteQuery = supabaseServer
    .from("quotes")
    .select(quoteSelect.join(","))
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (filters.status) {
    quoteQuery = quoteQuery.eq("status", filters.status);
  }

  if (filters.selectedOnly && supportsSelectedOffer) {
    quoteQuery = quoteQuery.not("selected_offer_id", "is", null);
  }

  const { data: quoteData, error: quoteError } = await quoteQuery.returns<QuoteRow[]>();
  if (quoteError) {
    if (
      handleMissingSupabaseSchema({
        relation: "quotes",
        error: quoteError,
        warnPrefix: "[admin ops inbox]",
        warnKey: "admin_ops_inbox:quotes_missing_schema",
      })
    ) {
      return [];
    }
    console.error("[admin ops inbox] failed to load quotes", {
      error: serializeSupabaseError(quoteError),
    });
    return [];
  }

  const quotes = Array.isArray(quoteData) ? quoteData : [];
  const quoteIds = quotes
    .map((row) => normalizeId(row?.id))
    .filter((id): id is string => Boolean(id));
  if (quoteIds.length === 0) {
    return [];
  }

  const customerByQuoteId = seedCustomerMap(quotes);
  await hydrateCustomerInfo({ quoteIds, customerByQuoteId });

  const [destinationsByQuoteId, offersByQuoteId] = await Promise.all([
    loadDestinationsByQuoteId(quoteIds),
    loadOffersByQuoteId(quoteIds),
  ]);

  const now = new Date();
  const rows: AdminOpsInboxRow[] = [];

  for (const quote of quotes) {
    const quoteId = normalizeId(quote?.id);
    if (!quoteId) continue;

    const destinations = destinationsByQuoteId.get(quoteId) ?? [];
    const offers = offersByQuoteId.get(quoteId) ?? [];
    const summary = buildQuoteSummary(destinations, offers, now);

    const row: AdminOpsInboxRow = {
      quote: {
        id: quoteId,
        title: normalizeOptionalString(quote?.title) ?? null,
        created_at: normalizeOptionalString(quote?.created_at),
        status: normalizeOptionalString(quote?.status),
        selected_offer_id: normalizeOptionalString(quote?.selected_offer_id),
        selected_provider_id: normalizeOptionalString(quote?.selected_provider_id),
      },
      customer: customerByQuoteId.get(quoteId) ?? {
        name: null,
        email: null,
        company: null,
      },
      destinations,
      offers,
      summary,
    };

    if (!passesFilters(row, filters, { supportsSelectedOffer })) {
      continue;
    }

    rows.push(row);
  }

  return rows;
}

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeOptionalString(value: unknown): string | null {
  const normalized = normalizeString(value);
  return normalized.length > 0 ? normalized : null;
}

function normalizeId(value: unknown): string | null {
  const normalized = normalizeString(value);
  return normalized.length > 0 ? normalized : null;
}

function normalizeLimit(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_LIMIT;
  }
  const normalized = Math.floor(value);
  if (normalized <= 0) return 0;
  return Math.min(MAX_LIMIT, normalized);
}

function normalizeOffset(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.floor(value));
}

function normalizeFilters(raw?: AdminOpsInboxFilters) {
  const status = normalizeOptionalString(raw?.status);
  const providerId = normalizeOptionalString(raw?.providerId);
  const destinationStatus = normalizeOptionalString(raw?.destinationStatus);
  return {
    status: status ? status.toLowerCase() : null,
    needsActionOnly: Boolean(raw?.needsActionOnly),
    providerId,
    destinationStatus: destinationStatus ? destinationStatus.toLowerCase() : null,
    selectedOnly: Boolean(raw?.selectedOnly),
  };
}

function seedCustomerMap(quotes: QuoteRow[]): Map<string, AdminOpsInboxCustomer> {
  const map = new Map<string, AdminOpsInboxCustomer>();
  for (const quote of quotes) {
    const quoteId = normalizeId(quote?.id);
    if (!quoteId) continue;
    map.set(quoteId, {
      name: normalizeOptionalString(quote?.customer_name),
      email: normalizeOptionalString(quote?.customer_email),
      company: normalizeOptionalString(quote?.company),
    });
  }
  return map;
}

async function hydrateCustomerInfo(args: {
  quoteIds: string[];
  customerByQuoteId: Map<string, AdminOpsInboxCustomer>;
}) {
  const supported = await schemaGate({
    enabled: true,
    relation: "quotes_with_uploads",
    requiredColumns: ["id", "customer_name", "customer_email", "company"],
    warnPrefix: "[admin ops inbox]",
    warnKey: "admin_ops_inbox:quotes_with_uploads",
  });
  if (!supported || args.quoteIds.length === 0) {
    return;
  }

  try {
    const { data, error } = await supabaseServer
      .from("quotes_with_uploads")
      .select("id,customer_name,customer_email,company")
      .in("id", args.quoteIds)
      .returns<QuoteHydrationRow[]>();

    if (error) {
      if (
        handleMissingSupabaseSchema({
          relation: "quotes_with_uploads",
          error,
          warnPrefix: "[admin ops inbox]",
          warnKey: "admin_ops_inbox:quotes_with_uploads_missing_schema",
        })
      ) {
        return;
      }
      console.warn("[admin ops inbox] customer hydration query failed", {
        error: serializeSupabaseError(error),
      });
      return;
    }

    for (const row of Array.isArray(data) ? data : []) {
      const quoteId = normalizeId(row?.id);
      if (!quoteId) continue;
      const existing = args.customerByQuoteId.get(quoteId) ?? {
        name: null,
        email: null,
        company: null,
      };
      args.customerByQuoteId.set(quoteId, {
        name: pickFirst(normalizeOptionalString(row?.customer_name), existing.name),
        email: pickFirst(normalizeOptionalString(row?.customer_email), existing.email),
        company: pickFirst(normalizeOptionalString(row?.company), existing.company),
      });
    }
  } catch (error) {
    if (
      handleMissingSupabaseSchema({
        relation: "quotes_with_uploads",
        error,
        warnPrefix: "[admin ops inbox]",
        warnKey: "admin_ops_inbox:quotes_with_uploads_missing_schema_crash",
      })
    ) {
      return;
    }
    console.warn("[admin ops inbox] customer hydration crashed", {
      error: serializeSupabaseError(error) ?? error,
    });
  }
}

function pickFirst<T extends string | null | undefined>(...values: T[]): T | null {
  for (const value of values) {
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed.length > 0) return trimmed as T;
    } else if (value != null) {
      return value;
    }
  }
  return null;
}

async function loadDestinationsByQuoteId(
  quoteIds: string[],
): Promise<Map<string, AdminOpsInboxDestination[]>> {
  const map = new Map<string, AdminOpsInboxDestination[]>();
  if (quoteIds.length === 0) return map;

  const supported = await schemaGate({
    enabled: true,
    relation: "rfq_destinations",
    requiredColumns: ["id", "rfq_id", "provider_id", "status", "created_at"],
    warnPrefix: "[admin ops inbox]",
    warnKey: "admin_ops_inbox:rfq_destinations",
  });
  if (!supported) {
    return map;
  }

  const [supportsLastStatusAt, supportsSentAt, supportsErrorMessage, providersSupported] =
    await Promise.all([
      hasColumns("rfq_destinations", ["last_status_at"]),
      hasColumns("rfq_destinations", ["sent_at"]),
      hasColumns("rfq_destinations", ["error_message"]),
      schemaGate({
        enabled: true,
        relation: "providers",
        requiredColumns: ["name", "provider_type", "quoting_mode"],
        warnPrefix: "[admin ops inbox]",
        warnKey: "admin_ops_inbox:providers",
      }),
    ]);

  const destinationSelect = [
    "id",
    "rfq_id",
    "provider_id",
    "status",
    "created_at",
    supportsLastStatusAt ? "last_status_at" : null,
    supportsSentAt ? "sent_at" : null,
    supportsErrorMessage ? "error_message" : null,
  ]
    .filter(Boolean)
    .join(",");

  const withProviderSelect = providersSupported
    ? `${destinationSelect},provider:providers(name,provider_type,quoting_mode)`
    : destinationSelect;

  const loadRows = async (select: string): Promise<DestinationRow[] | null> => {
    try {
      const { data, error } = await supabaseServer
        .from("rfq_destinations")
        .select(select)
        .in("rfq_id", quoteIds)
        .order("created_at", { ascending: true })
        .returns<DestinationRow[]>();

      if (error) {
        if (
          handleMissingSupabaseSchema({
            relation: "rfq_destinations",
            error,
            warnPrefix: "[admin ops inbox]",
            warnKey: "admin_ops_inbox:rfq_destinations_missing_schema",
          })
        ) {
          return [];
        }
        return null;
      }

      return Array.isArray(data) ? data : [];
    } catch (error) {
      if (
        handleMissingSupabaseSchema({
          relation: "rfq_destinations",
          error,
          warnPrefix: "[admin ops inbox]",
          warnKey: "admin_ops_inbox:rfq_destinations_missing_schema_crash",
        })
      ) {
        return [];
      }
      console.warn("[admin ops inbox] destinations query crashed", {
        error: serializeSupabaseError(error) ?? error,
      });
      return null;
    }
  };

  let rows: DestinationRow[] | null = await loadRows(withProviderSelect);
  if (rows === null && providersSupported) {
    rows = await loadRows(destinationSelect);
  }

  if (rows === null) {
    console.warn("[admin ops inbox] destinations query failed", {
      quoteCount: quoteIds.length,
    });
    return map;
  }

  for (const row of rows ?? []) {
    const destinationId = normalizeId(row?.id);
    const quoteId = normalizeId(row?.rfq_id);
    const providerId = normalizeId(row?.provider_id);
    if (!destinationId || !quoteId || !providerId) continue;

    const destination: AdminOpsInboxDestination = {
      id: destinationId,
      provider_id: providerId,
      provider_name: normalizeOptionalString(row?.provider?.name),
      provider_type: normalizeOptionalString(row?.provider?.provider_type),
      quoting_mode: normalizeOptionalString(row?.provider?.quoting_mode),
      status: normalizeOptionalString(row?.status),
      created_at: normalizeOptionalString(row?.created_at),
      last_status_at: normalizeOptionalString(row?.last_status_at),
      sent_at: normalizeOptionalString(row?.sent_at),
      error_message: normalizeOptionalString(row?.error_message),
    };

    if (!map.has(quoteId)) {
      map.set(quoteId, []);
    }
    map.get(quoteId)!.push(destination);
  }

  return map;
}

async function loadOffersByQuoteId(
  quoteIds: string[],
): Promise<Map<string, AdminOpsInboxOffer[]>> {
  const map = new Map<string, AdminOpsInboxOffer[]>();
  if (quoteIds.length === 0) return map;

  const supported = await schemaGate({
    enabled: true,
    relation: "rfq_offers",
    requiredColumns: ["rfq_id", "provider_id"],
    warnPrefix: "[admin ops inbox]",
    warnKey: "admin_ops_inbox:rfq_offers",
  });
  if (!supported) {
    return map;
  }

  try {
    const { data, error } = await supabaseServer
      .from("rfq_offers")
      .select("rfq_id,provider_id")
      .in("rfq_id", quoteIds)
      .returns<OfferRow[]>();

    if (error) {
      if (
        handleMissingSupabaseSchema({
          relation: "rfq_offers",
          error,
          warnPrefix: "[admin ops inbox]",
          warnKey: "admin_ops_inbox:rfq_offers_missing_schema",
        })
      ) {
        return map;
      }
      console.warn("[admin ops inbox] offers query failed", {
        error: serializeSupabaseError(error),
      });
      return map;
    }

    for (const row of Array.isArray(data) ? data : []) {
      const quoteId = normalizeId(row?.rfq_id);
      const providerId = normalizeId(row?.provider_id);
      if (!quoteId || !providerId) continue;
      if (!map.has(quoteId)) {
        map.set(quoteId, []);
      }
      map.get(quoteId)!.push({ provider_id: providerId });
    }
  } catch (error) {
    if (
      handleMissingSupabaseSchema({
        relation: "rfq_offers",
        error,
        warnPrefix: "[admin ops inbox]",
        warnKey: "admin_ops_inbox:rfq_offers_missing_schema_crash",
      })
    ) {
      return map;
    }
    console.warn("[admin ops inbox] offers query crashed", {
      error: serializeSupabaseError(error) ?? error,
    });
  }

  return map;
}

function buildQuoteSummary(
  destinations: AdminOpsInboxDestination[],
  offers: AdminOpsInboxOffer[],
  now: Date,
): AdminOpsInboxSummary {
  const counts: Record<DestinationStatusCountKey, number> = {
    queued: 0,
    sent: 0,
    viewed: 0,
    quoted: 0,
    declined: 0,
    error: 0,
  };

  for (const destination of destinations) {
    const status = normalizeString(destination.status).toLowerCase() as DestinationStatusCountKey;
    if (DESTINATION_STATUS_COUNTS.includes(status)) {
      counts[status] += 1;
    }
  }

  const offerProviderIds = new Set(
    offers
      .map((offer) => normalizeId(offer?.provider_id))
      .filter((id): id is string => Boolean(id)),
  );

  const reasonCounts = new Map<Exclude<SlaReason, null>, number>();
  for (const destination of destinations) {
    const result = computeDestinationNeedsAction(
      {
        status: destination.status,
        created_at: destination.created_at,
        last_status_at: destination.last_status_at,
        sent_at: destination.sent_at,
        provider_id: destination.provider_id,
        hasOffer: offerProviderIds.has(destination.provider_id),
      },
      now,
    );

    if (result.needsAction && result.reason) {
      reasonCounts.set(result.reason, (reasonCounts.get(result.reason) ?? 0) + 1);
    }
  }

  const needs = computeQuoteNeedsAction(
    {
      destinations: destinations.map((destination) => ({
        status: destination.status,
        created_at: destination.created_at,
        last_status_at: destination.last_status_at,
        sent_at: destination.sent_at,
        provider_id: destination.provider_id,
      })),
      offers,
    },
    now,
  );

  return {
    counts,
    ...needs,
    topReasons: buildTopReasons(reasonCounts),
  };
}

function buildTopReasons(
  reasonCounts: Map<Exclude<SlaReason, null>, number>,
): Array<Exclude<SlaReason, null>> {
  const sorted = Array.from(reasonCounts.entries()).sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return a[0].localeCompare(b[0]);
  });
  return sorted.slice(0, 2).map(([reason]) => reason);
}

function passesFilters(
  row: AdminOpsInboxRow,
  filters: ReturnType<typeof normalizeFilters>,
  capabilities: { supportsSelectedOffer: boolean },
): boolean {
  if (filters.status) {
    const quoteStatus = normalizeString(row.quote.status).toLowerCase();
    if (!quoteStatus || quoteStatus !== filters.status) {
      return false;
    }
  }

  if (filters.selectedOnly && capabilities.supportsSelectedOffer) {
    if (!row.quote.selected_offer_id) {
      return false;
    }
  }

  if (filters.providerId) {
    const match = row.destinations.some(
      (destination) => normalizeId(destination.provider_id) === filters.providerId,
    );
    if (!match) return false;
  }

  if (filters.destinationStatus) {
    const match = row.destinations.some(
      (destination) =>
        normalizeString(destination.status).toLowerCase() === filters.destinationStatus,
    );
    if (!match) return false;
  }

  if (filters.needsActionOnly && row.summary.needsActionCount <= 0) {
    return false;
  }

  return true;
}
