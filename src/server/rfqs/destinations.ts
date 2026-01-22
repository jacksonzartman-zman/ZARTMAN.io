import { supabaseServer } from "@/lib/supabaseServer";
import {
  isMissingTableOrColumnError,
  serializeSupabaseError,
} from "@/server/admin/logging";
import { hasColumns, schemaGate } from "@/server/db/schemaContract";
import type { ProviderSource, ProviderVerificationStatus } from "@/server/providers";

export type RfqDestinationStatus =
  | "draft"
  | "queued"
  | "sent"
  | "submitted"
  | "viewed"
  | "quoted"
  | "declined"
  | "error";

export type RfqDestinationProvider = {
  name: string | null;
  provider_type: string | null;
  quoting_mode: string | null;
  verification_status?: ProviderVerificationStatus | string | null;
  source?: ProviderSource | string | null;
  is_active?: boolean | null;
  country?: string | null;
};

export type RfqDestination = {
  id: string;
  rfq_id: string;
  provider_id: string;
  status: RfqDestinationStatus;
  dispatch_started_at: string | null;
  sent_at: string | null;
  submitted_at: string | null;
  submitted_notes: string | null;
  submitted_by: string | null;
  last_status_at: string;
  external_reference: string | null;
  notes: string | null;
  offer_token: string | null;
  error_message: string | null;
  created_at: string;
  provider: RfqDestinationProvider | null;
};

export type RfqDestinationOfferProvider = RfqDestinationProvider & {
  id: string;
};

export type RfqDestinationOfferQuote = {
  id: string;
  upload_id: string | null;
  customer_name: string | null;
  customer_email: string | null;
  company: string | null;
  status: string | null;
  target_date: string | null;
  file_name: string | null;
};

export type RfqDestinationOfferTokenContext = {
  destination: Omit<RfqDestination, "provider">;
  provider: RfqDestinationOfferProvider;
  quote: RfqDestinationOfferQuote;
};

type RawRfqDestinationRow = {
  id: string | null;
  rfq_id: string | null;
  provider_id: string | null;
  status: string | null;
  dispatch_started_at?: string | null;
  sent_at: string | null;
  submitted_at?: string | null;
  submitted_notes?: string | null;
  submitted_by?: string | null;
  last_status_at: string | null;
  external_reference: string | null;
  notes?: string | null;
  offer_token?: string | null;
  error_message: string | null;
  created_at: string | null;
  provider: RfqDestinationProvider | null;
};

type RawOfferTokenProviderRow = {
  id: string | null;
  name: string | null;
  provider_type: string | null;
  quoting_mode: string | null;
};

type RawOfferTokenQuoteRow = {
  id: string | null;
  upload_id: string | null;
  customer_name: string | null;
  customer_email: string | null;
  company: string | null;
  status: string | null;
  target_date: string | null;
  file_name: string | null;
};

type RawOfferTokenDestinationRow = {
  id: string | null;
  rfq_id: string | null;
  provider_id: string | null;
  status: string | null;
  dispatch_started_at?: string | null;
  sent_at: string | null;
  submitted_at?: string | null;
  submitted_notes?: string | null;
  submitted_by?: string | null;
  last_status_at: string | null;
  external_reference: string | null;
  error_message: string | null;
  created_at: string | null;
  offer_token?: string | null;
  provider: RawOfferTokenProviderRow | null;
  quote: RawOfferTokenQuoteRow | null;
};

const DESTINATION_COLUMNS = [
  "id",
  "rfq_id",
  "provider_id",
  "status",
  "sent_at",
  "last_status_at",
  "external_reference",
  "error_message",
  "created_at",
];

const OFFER_TOKEN_DESTINATION_COLUMNS = [
  "id",
  "rfq_id",
  "provider_id",
  "status",
  "sent_at",
  "last_status_at",
  "external_reference",
  "error_message",
  "created_at",
  "offer_token",
] as const;

const OFFER_TOKEN_PROVIDER_COLUMNS = ["id", "name", "provider_type", "quoting_mode"] as const;

const OFFER_TOKEN_QUOTE_COLUMNS = [
  "id",
  "upload_id",
  "customer_name",
  "customer_email",
  "company",
  "status",
  "target_date",
  "file_name",
] as const;

const OFFER_TOKEN_SELECT = [
  "id",
  "rfq_id",
  "provider_id",
  "status",
  "sent_at",
  "last_status_at",
  "external_reference",
  "error_message",
  "created_at",
  "offer_token",
  `provider:providers(${OFFER_TOKEN_PROVIDER_COLUMNS.join(",")})`,
  `quote:quotes(${OFFER_TOKEN_QUOTE_COLUMNS.join(",")})`,
].join(",");

const DESTINATION_STATUSES: ReadonlySet<RfqDestinationStatus> = new Set([
  "draft",
  "queued",
  "sent",
  "submitted",
  "viewed",
  "quoted",
  "declined",
  "error",
]);

export async function getRfqDestinations(rfqId: string): Promise<RfqDestination[]> {
  const normalizedId = normalizeId(rfqId);
  if (!normalizedId) {
    return [];
  }

  const [
    supportsOfferToken,
    includeProviderCountry,
    supportsSubmittedMeta,
    supportsDispatchStartedAt,
    supportsDestinationNotes,
  ] = await Promise.all([
    hasColumns("rfq_destinations", ["offer_token"]),
    hasColumns("providers", ["country"]),
    hasColumns("rfq_destinations", ["submitted_at", "submitted_notes", "submitted_by"]),
    hasColumns("rfq_destinations", ["dispatch_started_at"]),
    hasColumns("rfq_destinations", ["notes"]),
  ]);
  const providerColumns = ["name", "provider_type", "quoting_mode"];
  if (includeProviderCountry) {
    providerColumns.push("country");
  }
  const destinationProviderSelect = `provider:providers(${providerColumns.join(",")})`;
  const submittedColumns = supportsSubmittedMeta
    ? ["submitted_at", "submitted_notes", "submitted_by"]
    : [];
  const destinationSelect = [
    ...DESTINATION_COLUMNS,
    supportsDispatchStartedAt ? "dispatch_started_at" : null,
    ...submittedColumns,
    supportsDestinationNotes ? "notes" : null,
    supportsOfferToken ? "offer_token" : null,
    destinationProviderSelect,
  ]
    .filter(Boolean)
    .join(",");

  try {
    const { data, error } = await supabaseServer
      .from("rfq_destinations")
      .select(destinationSelect)
      .eq("rfq_id", normalizedId)
      .order("created_at", { ascending: true })
      .returns<RawRfqDestinationRow[]>();

    if (error) {
      if (isMissingTableOrColumnError(error)) {
        console.warn("[rfq destinations] missing schema; returning empty", {
          rfqId: normalizedId,
          supabaseError: serializeSupabaseError(error),
        });
        return [];
      }
      console.error("[rfq destinations] query failed", {
        rfqId: normalizedId,
        supabaseError: serializeSupabaseError(error),
      });
      return [];
    }

    const rows = Array.isArray(data) ? data : [];
    return rows
      .map((row) => normalizeDestinationRow(row))
      .filter((row): row is RfqDestination => Boolean(row));
  } catch (error) {
    if (isMissingTableOrColumnError(error)) {
      console.warn("[rfq destinations] missing schema; returning empty", {
        rfqId: normalizedId,
        supabaseError: serializeSupabaseError(error),
      });
      return [];
    }
    console.error("[rfq destinations] unexpected error", {
      rfqId: normalizedId,
      error: serializeSupabaseError(error) ?? error,
    });
    return [];
  }
}

type RawRfqDestinationLiteRow = {
  id: string | null;
  rfq_id: string | null;
  provider_id: string | null;
  status: string | null;
  sent_at: string | null;
  last_status_at: string | null;
  external_reference: string | null;
  error_message: string | null;
  created_at: string | null;
};

/**
 * Performance-oriented destination fetch used for customer portal summary states.
 * Avoids expensive provider joins and schema-probing for optional columns.
 *
 * Returned rows are normalized into `RfqDestination` with optional fields set to null.
 */
export async function getRfqDestinationsLite(rfqId: string): Promise<RfqDestination[]> {
  const normalizedId = normalizeId(rfqId);
  if (!normalizedId) {
    return [];
  }

  const destinationSelect = DESTINATION_COLUMNS.join(",");

  try {
    const { data, error } = await supabaseServer
      .from("rfq_destinations")
      .select(destinationSelect)
      .eq("rfq_id", normalizedId)
      .order("created_at", { ascending: true })
      .returns<RawRfqDestinationLiteRow[]>();

    if (error) {
      if (isMissingTableOrColumnError(error)) {
        console.warn("[rfq destinations] missing schema; returning empty (lite)", {
          rfqId: normalizedId,
          supabaseError: serializeSupabaseError(error),
        });
        return [];
      }
      console.error("[rfq destinations] query failed (lite)", {
        rfqId: normalizedId,
        supabaseError: serializeSupabaseError(error),
      });
      return [];
    }

    const rows = Array.isArray(data) ? data : [];
    return rows
      .map((row) => {
        const id = normalizeId(row?.id);
        const rfqId = normalizeId(row?.rfq_id);
        const providerId = normalizeId(row?.provider_id);
        if (!id || !rfqId || !providerId) {
          return null;
        }

        const createdAt = row?.created_at ?? new Date().toISOString();
        const lastStatusAt = row?.last_status_at ?? createdAt;

        const destination: RfqDestination = {
          id,
          rfq_id: rfqId,
          provider_id: providerId,
          status: normalizeDestinationStatus(row?.status),
          dispatch_started_at: null,
          sent_at: row?.sent_at ?? null,
          submitted_at: null,
          submitted_notes: null,
          submitted_by: null,
          last_status_at: lastStatusAt,
          external_reference: row?.external_reference ?? null,
          notes: null,
          offer_token: null,
          error_message: row?.error_message ?? null,
          created_at: createdAt,
          provider: null,
        };

        return destination;
      })
      .filter((row): row is RfqDestination => Boolean(row));
  } catch (error) {
    if (isMissingTableOrColumnError(error)) {
      console.warn("[rfq destinations] missing schema; returning empty (lite)", {
        rfqId: normalizedId,
        supabaseError: serializeSupabaseError(error),
      });
      return [];
    }
    console.error("[rfq destinations] unexpected error (lite)", {
      rfqId: normalizedId,
      error: serializeSupabaseError(error) ?? error,
    });
    return [];
  }
}

export async function getDestinationByOfferToken(
  token: string,
): Promise<RfqDestinationOfferTokenContext | null> {
  const normalizedToken = normalizeToken(token);
  if (!isValidOfferToken(normalizedToken)) {
    return null;
  }

  const destinationsSupported = await schemaGate({
    enabled: true,
    relation: "rfq_destinations",
    requiredColumns: [...OFFER_TOKEN_DESTINATION_COLUMNS],
    warnPrefix: "[rfq offer token]",
    warnKey: "rfq_offer_token:destinations",
  });
  if (!destinationsSupported) {
    return null;
  }

  const [providersSupported, quotesSupported] = await Promise.all([
    schemaGate({
      enabled: true,
      relation: "providers",
      requiredColumns: [...OFFER_TOKEN_PROVIDER_COLUMNS],
      warnPrefix: "[rfq offer token]",
      warnKey: "rfq_offer_token:providers",
    }),
    schemaGate({
      enabled: true,
      relation: "quotes",
      requiredColumns: [...OFFER_TOKEN_QUOTE_COLUMNS],
      warnPrefix: "[rfq offer token]",
      warnKey: "rfq_offer_token:quotes",
    }),
  ]);

  if (!providersSupported || !quotesSupported) {
    return null;
  }

  try {
    const { data, error } = await supabaseServer
      .from("rfq_destinations")
      .select(OFFER_TOKEN_SELECT)
      .eq("offer_token", normalizedToken)
      .maybeSingle<RawOfferTokenDestinationRow>();

    if (error) {
      if (isMissingTableOrColumnError(error)) {
        return null;
      }
      console.error("[rfq offer token] lookup failed", {
        tokenPresent: Boolean(normalizedToken),
        supabaseError: serializeSupabaseError(error),
      });
      return null;
    }

    return normalizeOfferTokenRow(data);
  } catch (error) {
    if (isMissingTableOrColumnError(error)) {
      return null;
    }
    console.error("[rfq offer token] lookup crashed", {
      tokenPresent: Boolean(normalizedToken),
      error: serializeSupabaseError(error) ?? error,
    });
    return null;
  }
}

function normalizeDestinationRow(row: RawRfqDestinationRow): RfqDestination | null {
  const id = normalizeId(row?.id);
  const rfqId = normalizeId(row?.rfq_id);
  const providerId = normalizeId(row?.provider_id);
  if (!id || !rfqId || !providerId) {
    return null;
  }

  const createdAt = row?.created_at ?? new Date().toISOString();
  const lastStatusAt = row?.last_status_at ?? createdAt;

  return {
    id,
    rfq_id: rfqId,
    provider_id: providerId,
    status: normalizeDestinationStatus(row?.status),
    dispatch_started_at: row?.dispatch_started_at ?? null,
    sent_at: row?.sent_at ?? null,
    submitted_at: row?.submitted_at ?? null,
    submitted_notes: normalizeOptionalText(row?.submitted_notes),
    submitted_by: normalizeOptionalText(row?.submitted_by),
    last_status_at: lastStatusAt,
    external_reference: row?.external_reference ?? null,
    notes: normalizeOptionalText(row?.notes),
    offer_token: normalizeOptionalText(row?.offer_token),
    error_message: row?.error_message ?? null,
    created_at: createdAt,
    provider: row?.provider ?? null,
  };
}

function normalizeOfferTokenRow(
  row: RawOfferTokenDestinationRow | null | undefined,
): RfqDestinationOfferTokenContext | null {
  const destinationId = normalizeId(row?.id);
  const rfqId = normalizeId(row?.rfq_id);
  const providerId = normalizeId(row?.provider_id);
  if (!destinationId || !rfqId || !providerId) {
    return null;
  }

  const provider = normalizeOfferTokenProvider(row?.provider, providerId);
  if (!provider) {
    return null;
  }

  const quote = normalizeOfferTokenQuote(row?.quote, rfqId);
  if (!quote) {
    return null;
  }

  const createdAt = row?.created_at ?? new Date().toISOString();
  const lastStatusAt = row?.last_status_at ?? createdAt;

  return {
    destination: {
      id: destinationId,
      rfq_id: rfqId,
      provider_id: providerId,
      status: normalizeDestinationStatus(row?.status),
      dispatch_started_at: row?.dispatch_started_at ?? null,
      sent_at: row?.sent_at ?? null,
      submitted_at: row?.submitted_at ?? null,
      submitted_notes: normalizeOptionalText(row?.submitted_notes),
      submitted_by: normalizeOptionalText(row?.submitted_by),
      last_status_at: lastStatusAt,
      external_reference: row?.external_reference ?? null,
      notes: null,
      offer_token: normalizeOptionalText(row?.offer_token),
      error_message: row?.error_message ?? null,
      created_at: createdAt,
    },
    provider,
    quote,
  };
}

function normalizeOfferTokenProvider(
  row: RawOfferTokenProviderRow | null | undefined,
  providerId: string,
): RfqDestinationOfferProvider | null {
  const id = normalizeId(row?.id);
  if (!id || id !== providerId) {
    return null;
  }

  return {
    id,
    name: normalizeOptionalText(row?.name),
    provider_type: normalizeOptionalText(row?.provider_type),
    quoting_mode: normalizeOptionalText(row?.quoting_mode),
  };
}

function normalizeOfferTokenQuote(
  row: RawOfferTokenQuoteRow | null | undefined,
  quoteId: string,
): RfqDestinationOfferQuote | null {
  const id = normalizeId(row?.id);
  if (!id || id !== quoteId) {
    return null;
  }

  return {
    id,
    upload_id: normalizeOptionalId(row?.upload_id),
    customer_name: normalizeOptionalText(row?.customer_name),
    customer_email: normalizeOptionalText(row?.customer_email),
    company: normalizeOptionalText(row?.company),
    status: normalizeOptionalText(row?.status),
    target_date: normalizeOptionalText(row?.target_date),
    file_name: normalizeOptionalText(row?.file_name),
  };
}

function normalizeDestinationStatus(value: string | null | undefined): RfqDestinationStatus {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (DESTINATION_STATUSES.has(normalized as RfqDestinationStatus)) {
    return normalized as RfqDestinationStatus;
  }
  return "draft";
}

function normalizeId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeOptionalId(value: unknown): string | null {
  const id = normalizeId(value);
  return id.length > 0 ? id : null;
}

function normalizeOptionalText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeToken(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isValidOfferToken(token: string): boolean {
  return token.length >= 32 && token.length <= 256;
}
