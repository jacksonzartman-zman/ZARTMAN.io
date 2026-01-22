import { supabaseServer } from "@/lib/supabaseServer";
import {
  computeDestinationNeedsAction,
  computeQuoteNeedsAction,
  type SlaConfig,
  type SlaReason,
} from "@/lib/ops/sla";
import {
  handleMissingSupabaseSchema,
  serializeSupabaseError,
  warnOnce,
} from "@/server/admin/logging";
import { requireAdminUser } from "@/server/auth";
import { hasColumns, schemaGate } from "@/server/db/schemaContract";
import { getOpsSlaConfig } from "@/server/ops/settings";
import { parseRfqOfferStatus, type RfqOffer } from "@/server/rfqs/offers";
import { resolveProviderEmailColumn } from "@/server/providers";
import {
  computeAdminReplyState,
  loadQuoteMessageRollups,
  type AdminMessageReplyState,
} from "@/server/quotes/messageState";

export type AdminOpsInboxFilters = {
  status?: string | null;
  needsActionOnly?: boolean | null;
  messageNeedsReplyOnly?: boolean | null;
  introRequestedOnly?: boolean | null;
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
  offer_token: string | null;
  provider_name: string | null;
  provider_email: string | null;
  provider_type: string | null;
  quoting_mode: string | null;
  dispatch_mode: string | null;
  provider_website: string | null;
  provider_rfq_url: string | null;
  status: string | null;
  created_at: string | null;
  last_status_at: string | null;
  dispatch_started_at: string | null;
  sent_at: string | null;
  submitted_at: string | null;
  error_message: string | null;
};

export type AdminOpsInboxOffer = RfqOffer;

export type AdminOpsInboxSummary = {
  counts: {
    queued: number;
    sent: number;
    submitted: number;
    viewed: number;
    quoted: number;
    declined: number;
    error: number;
  };
  needsActionCount: number;
  needsReplyCount: number;
  errorsCount: number;
  queuedStaleCount: number;
  messageNeedsReplyCount: number;
  introRequestsCount: number;
  introRequestProviderIds: string[];
  lastIntroRequestedAt: string | null;
  lastCustomerMessageAt: string | null;
  lastAdminMessageAt: string | null;
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
  slaConfig?: SlaConfig;
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
  offer_token?: string | null;
  status: string | null;
  created_at: string | null;
  last_status_at?: string | null;
  dispatch_started_at?: string | null;
  sent_at?: string | null;
  submitted_at?: string | null;
  error_message?: string | null;
  provider?: {
    name?: string | null;
    provider_type?: string | null;
    quoting_mode?: string | null;
    dispatch_mode?: string | null;
    website?: string | null;
    rfq_url?: string | null;
    primary_email?: string | null;
    email?: string | null;
    contact_email?: string | null;
  } | null;
};

type OfferRow = {
  id: string | null;
  rfq_id: string | null;
  provider_id: string | null;
  destination_id: string | null;
  currency: string | null;
  total_price: number | string | null;
  unit_price: number | string | null;
  tooling_price: number | string | null;
  shipping_price: number | string | null;
  lead_time_days_min: number | string | null;
  lead_time_days_max: number | string | null;
  assumptions: string | null;
  notes?: string | null;
  confidence_score: number | string | null;
  quality_risk_flags: string[] | null;
  status: string | null;
  received_at: string | null;
  created_at: string | null;
};

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

const DESTINATION_STATUS_COUNTS = [
  "queued",
  "sent",
  "submitted",
  "viewed",
  "quoted",
  "declined",
  "error",
] as const;

const OFFER_SELECT = [
  "id",
  "rfq_id",
  "provider_id",
  "destination_id",
  "currency",
  "total_price",
  "unit_price",
  "tooling_price",
  "shipping_price",
  "lead_time_days_min",
  "lead_time_days_max",
  "assumptions",
  "notes",
  "confidence_score",
  "quality_risk_flags",
  "status",
  "received_at",
  "created_at",
].join(",");

type DestinationStatusCountKey = (typeof DESTINATION_STATUS_COUNTS)[number];

export async function getAdminOpsInboxRows(
  args: AdminOpsInboxArgs = {},
): Promise<AdminOpsInboxRow[]> {
  await requireAdminUser();

  const slaConfig = args.slaConfig ?? (await getOpsSlaConfig());
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

  const [destinationsByQuoteId, offersByQuoteId, messageRollupsByQuoteId] = await Promise.all([
    loadDestinationsByQuoteId(quoteIds),
    loadOffersByQuoteId(quoteIds),
    loadQuoteMessageRollups(quoteIds),
  ]);

  const introRequestsByQuoteId = await loadIntroRequestsByQuoteId(quoteIds);

  const now = new Date();
  const emptyMessageState: AdminMessageReplyState = {
    needsReply: false,
    lastCustomerMessageAt: null,
    lastAdminMessageAt: null,
  };
  const rows: AdminOpsInboxRow[] = [];

  for (const quote of quotes) {
    const quoteId = normalizeId(quote?.id);
    if (!quoteId) continue;

    const destinations = destinationsByQuoteId.get(quoteId) ?? [];
    const offers = offersByQuoteId.get(quoteId) ?? [];
    const messageRollup = messageRollupsByQuoteId[quoteId] ?? null;
    const messageState = messageRollup ? computeAdminReplyState(messageRollup) : emptyMessageState;
    const introMeta =
      introRequestsByQuoteId.get(quoteId) ?? { count: 0, latestAt: null, providerIds: [] };
    const summary = buildQuoteSummary(
      destinations,
      offers,
      now,
      slaConfig,
      messageState,
      introMeta.count,
      introMeta.providerIds,
      introMeta.latestAt,
    );

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

function normalizeOptionalId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeCurrency(value: unknown): string {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length > 0) {
      return trimmed.toUpperCase();
    }
  }
  return "USD";
}

function normalizeNumeric(value: unknown): number | string | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  return null;
}

function normalizeInteger(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? Math.round(value) : null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? Math.round(parsed) : null;
  }
  return null;
}

function normalizeOptionalText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeRiskFlags(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((flag) => (typeof flag === "string" ? flag.trim() : ""))
    .filter((flag) => flag.length > 0);
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
    messageNeedsReplyOnly: Boolean(raw?.messageNeedsReplyOnly),
    introRequestedOnly: Boolean(raw?.introRequestedOnly),
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

  const [
    supportsLastStatusAt,
    supportsSentAt,
    supportsErrorMessage,
    supportsOfferToken,
    providersSupported,
    supportsDispatchMode,
    supportsRfqUrl,
    supportsProviderWebsite,
    supportsSubmittedAt,
    supportsDispatchStartedAt,
    providerEmailColumn,
  ] = await Promise.all([
    hasColumns("rfq_destinations", ["last_status_at"]),
    hasColumns("rfq_destinations", ["sent_at"]),
    hasColumns("rfq_destinations", ["error_message"]),
    hasColumns("rfq_destinations", ["offer_token"]),
    schemaGate({
      enabled: true,
      relation: "providers",
      requiredColumns: ["name", "provider_type", "quoting_mode"],
      warnPrefix: "[admin ops inbox]",
      warnKey: "admin_ops_inbox:providers",
    }),
    hasColumns("providers", ["dispatch_mode"]),
    hasColumns("providers", ["rfq_url"]),
    hasColumns("providers", ["website"]),
    hasColumns("rfq_destinations", ["submitted_at"]),
    hasColumns("rfq_destinations", ["dispatch_started_at"]),
    resolveProviderEmailColumn(),
  ]);

  const destinationSelect = [
    "id",
    "rfq_id",
    "provider_id",
    "status",
    "created_at",
    supportsLastStatusAt ? "last_status_at" : null,
    supportsDispatchStartedAt ? "dispatch_started_at" : null,
    supportsSentAt ? "sent_at" : null,
    supportsSubmittedAt ? "submitted_at" : null,
    supportsErrorMessage ? "error_message" : null,
    supportsOfferToken ? "offer_token" : null,
  ]
    .filter(Boolean)
    .join(",");

  const providerColumns = ["name", "provider_type", "quoting_mode"];
  if (supportsDispatchMode) providerColumns.push("dispatch_mode");
  if (supportsRfqUrl) providerColumns.push("rfq_url");
  if (supportsProviderWebsite) providerColumns.push("website");
  if (providerEmailColumn) providerColumns.push(providerEmailColumn);
  const withProviderSelect = providersSupported
    ? `${destinationSelect},provider:providers(${providerColumns.join(",")})`
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
      offer_token: normalizeOptionalString(row?.offer_token),
      provider_name: normalizeOptionalString(row?.provider?.name),
      provider_email: normalizeOptionalString(
        providerEmailColumn && row?.provider
          ? (row.provider as Record<string, unknown>)[providerEmailColumn]
          : null,
      ),
      provider_type: normalizeOptionalString(row?.provider?.provider_type),
      quoting_mode: normalizeOptionalString(row?.provider?.quoting_mode),
      dispatch_mode: normalizeOptionalString(row?.provider?.dispatch_mode),
      provider_website: normalizeOptionalString(row?.provider?.website),
      provider_rfq_url: normalizeOptionalString(row?.provider?.rfq_url),
      status: normalizeOptionalString(row?.status),
      created_at: normalizeOptionalString(row?.created_at),
      last_status_at: normalizeOptionalString(row?.last_status_at),
      dispatch_started_at: normalizeOptionalString(row?.dispatch_started_at),
      sent_at: normalizeOptionalString(row?.sent_at),
      submitted_at: normalizeOptionalString(row?.submitted_at),
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
      .select(OFFER_SELECT)
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
      const offer = normalizeOfferRow(row);
      if (!offer) continue;
      const quoteId = normalizeId(offer.rfq_id);
      if (!quoteId) continue;
      if (!map.has(quoteId)) {
        map.set(quoteId, []);
      }
      map.get(quoteId)!.push(offer);
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

function normalizeOfferRow(row: OfferRow): RfqOffer | null {
  const id = normalizeId(row?.id);
  const rfqId = normalizeId(row?.rfq_id);
  const providerId = normalizeId(row?.provider_id);
  if (!id || !rfqId || !providerId) {
    return null;
  }

  const createdAt = row?.created_at ?? new Date().toISOString();
  const receivedAt = row?.received_at ?? createdAt;

  return {
    id,
    rfq_id: rfqId,
    provider_id: providerId,
    destination_id: normalizeOptionalId(row?.destination_id),
    currency: normalizeCurrency(row?.currency),
    total_price: normalizeNumeric(row?.total_price),
    unit_price: normalizeNumeric(row?.unit_price),
    tooling_price: normalizeNumeric(row?.tooling_price),
    shipping_price: normalizeNumeric(row?.shipping_price),
    lead_time_days_min: normalizeInteger(row?.lead_time_days_min),
    lead_time_days_max: normalizeInteger(row?.lead_time_days_max),
    assumptions: normalizeOptionalText(row?.assumptions),
    notes: row?.notes ?? null,
    confidence_score: normalizeInteger(row?.confidence_score),
    quality_risk_flags: normalizeRiskFlags(row?.quality_risk_flags),
    status: parseRfqOfferStatus(row?.status) ?? "received",
    received_at: receivedAt,
    created_at: createdAt,
    provider: null,
  };
}

function buildQuoteSummary(
  destinations: AdminOpsInboxDestination[],
  offers: AdminOpsInboxOffer[],
  now: Date,
  slaConfig: SlaConfig,
  messageState: AdminMessageReplyState,
  introRequestsCount: number,
  introRequestProviderIds: string[],
  lastIntroRequestedAt: string | null,
): AdminOpsInboxSummary {
  const counts: Record<DestinationStatusCountKey, number> = {
    queued: 0,
    sent: 0,
    submitted: 0,
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
      slaConfig,
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
    slaConfig,
  );

  const messageNeedsReplyCount = messageState.needsReply ? 1 : 0;
  const introNeedsAction = introRequestsCount > 0 ? 1 : 0;

  return {
    counts,
    needsActionCount: needs.needsActionCount + messageNeedsReplyCount + introNeedsAction,
    needsReplyCount: needs.needsReplyCount,
    errorsCount: needs.errorsCount,
    queuedStaleCount: needs.queuedStaleCount,
    messageNeedsReplyCount,
    introRequestsCount,
    introRequestProviderIds,
    lastIntroRequestedAt,
    lastCustomerMessageAt: messageState.lastCustomerMessageAt,
    lastAdminMessageAt: messageState.lastAdminMessageAt,
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

  if (filters.messageNeedsReplyOnly && row.summary.messageNeedsReplyCount <= 0) {
    return false;
  }

  if (filters.introRequestedOnly && row.summary.introRequestsCount <= 0) {
    return false;
  }

  return true;
}

async function loadIntroRequestsByQuoteId(
  quoteIds: string[],
): Promise<Map<string, { count: number; latestAt: string | null; providerIds: string[] }>> {
  const map = new Map<string, { count: number; latestAt: string | null; providerIds: string[] }>();
  if (quoteIds.length === 0) return map;

  const supported = await schemaGate({
    enabled: true,
    relation: "ops_events",
    requiredColumns: ["quote_id", "event_type", "created_at", "payload"],
    warnPrefix: "[admin ops inbox]",
    warnKey: "admin_ops_inbox:ops_events",
  });
  if (!supported) return map;

  type OpsEventRow = {
    quote_id: string | null;
    event_type: string | null;
    created_at: string | null;
    provider_id: string | null;
  };

  try {
    const { data, error } = await supabaseServer
      .from("ops_events")
      .select("quote_id,event_type,created_at,provider_id:payload->>provider_id")
      .in("event_type", ["customer_intro_requested", "customer_intro_handled"])
      .in("quote_id", quoteIds)
      .order("created_at", { ascending: false })
      .returns<OpsEventRow[]>();

    if (error) {
      if (
        handleMissingSupabaseSchema({
          relation: "ops_events",
          error,
          warnPrefix: "[admin ops inbox]",
          warnKey: "admin_ops_inbox:ops_events_missing_schema",
        })
      ) {
        return map;
      }
      console.warn("[admin ops inbox] intro requests query failed", {
        error: serializeSupabaseError(error),
      });
      return map;
    }

    const latestRequestedAtByKey = new Map<string, string>();
    const latestHandledAtByKey = new Map<string, string>();

    for (const row of Array.isArray(data) ? data : []) {
      const quoteId = normalizeId(row?.quote_id);
      const providerId = normalizeOptionalString(row?.provider_id);
      const eventType = normalizeOptionalString(row?.event_type);
      const createdAt = normalizeOptionalString(row?.created_at);
      if (!quoteId || !providerId || !eventType || !createdAt) continue;

      const key = `${quoteId}:${providerId}`;
      if (eventType === "customer_intro_requested") {
        const existing = latestRequestedAtByKey.get(key);
        if (!existing || createdAt > existing) {
          latestRequestedAtByKey.set(key, createdAt);
        }
        continue;
      }
      if (eventType === "customer_intro_handled") {
        const existing = latestHandledAtByKey.get(key);
        if (!existing || createdAt > existing) {
          latestHandledAtByKey.set(key, createdAt);
        }
      }
    }

    const pendingProvidersByQuoteId = new Map<string, { providerIds: string[]; latestAt: string }>();

    for (const [key, requestedAt] of latestRequestedAtByKey.entries()) {
      const handledAt = latestHandledAtByKey.get(key) ?? null;
      if (handledAt && handledAt >= requestedAt) {
        continue;
      }

      const [quoteId, providerId] = key.split(":");
      if (!quoteId || !providerId) continue;

      const existing = pendingProvidersByQuoteId.get(quoteId);
      if (!existing) {
        pendingProvidersByQuoteId.set(quoteId, { providerIds: [providerId], latestAt: requestedAt });
        continue;
      }
      if (!existing.providerIds.includes(providerId)) {
        existing.providerIds.push(providerId);
      }
      if (requestedAt > existing.latestAt) {
        existing.latestAt = requestedAt;
      }
    }

    for (const [quoteId, pending] of pendingProvidersByQuoteId.entries()) {
      map.set(quoteId, {
        count: pending.providerIds.length,
        latestAt: pending.latestAt ?? null,
        providerIds: pending.providerIds,
      });
    }
  } catch (error) {
    if (
      handleMissingSupabaseSchema({
        relation: "ops_events",
        error,
        warnPrefix: "[admin ops inbox]",
        warnKey: "admin_ops_inbox:ops_events_missing_schema_crash",
      })
    ) {
      return map;
    }
    console.warn("[admin ops inbox] intro requests query crashed", {
      error: serializeSupabaseError(error) ?? error,
    });
  }

  return map;
}
