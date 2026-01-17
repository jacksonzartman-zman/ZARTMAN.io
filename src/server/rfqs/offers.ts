import { supabaseServer } from "@/lib/supabaseServer";
import {
  isMissingTableOrColumnError,
  serializeSupabaseError,
} from "@/server/admin/logging";

export const RFQ_OFFER_STATUSES = ["received", "revised", "withdrawn"] as const;

export type RfqOfferStatus = (typeof RFQ_OFFER_STATUSES)[number];

export type RfqOfferProvider = {
  name: string | null;
  provider_type: string | null;
  quoting_mode: string | null;
};

export type RfqOffer = {
  id: string;
  rfq_id: string;
  provider_id: string;
  destination_id: string | null;
  currency: string;
  total_price: number | string | null;
  unit_price: number | string | null;
  tooling_price: number | string | null;
  shipping_price: number | string | null;
  lead_time_days_min: number | null;
  lead_time_days_max: number | null;
  assumptions: string | null;
  confidence_score: number | null;
  quality_risk_flags: string[];
  status: RfqOfferStatus;
  received_at: string;
  created_at: string;
  provider: RfqOfferProvider | null;
};

type RawRfqOfferRow = {
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
  confidence_score: number | string | null;
  quality_risk_flags: string[] | null;
  status: string | null;
  received_at: string | null;
  created_at: string | null;
  provider: RfqOfferProvider | null;
};

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
  "confidence_score",
  "quality_risk_flags",
  "status",
  "received_at",
  "created_at",
  "provider:providers(name,provider_type,quoting_mode)",
].join(",");

const RFQ_OFFER_STATUS_SET = new Set<RfqOfferStatus>(RFQ_OFFER_STATUSES);

export function parseRfqOfferStatus(value: unknown): RfqOfferStatus | null {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (RFQ_OFFER_STATUS_SET.has(normalized as RfqOfferStatus)) {
    return normalized as RfqOfferStatus;
  }
  return null;
}

export async function getRfqOffers(quoteId: string): Promise<RfqOffer[]> {
  const normalizedQuoteId = normalizeId(quoteId);
  if (!normalizedQuoteId) {
    return [];
  }

  try {
    const { data, error } = await supabaseServer
      .from("rfq_offers")
      .select(OFFER_SELECT)
      .eq("rfq_id", normalizedQuoteId)
      .order("created_at", { ascending: true })
      .returns<RawRfqOfferRow[]>();

    if (error) {
      if (isMissingTableOrColumnError(error)) {
        console.warn("[rfq offers] missing schema; returning empty", {
          quoteId: normalizedQuoteId,
          supabaseError: serializeSupabaseError(error),
        });
        return [];
      }
      console.error("[rfq offers] query failed", {
        quoteId: normalizedQuoteId,
        supabaseError: serializeSupabaseError(error),
      });
      return [];
    }

    const rows = Array.isArray(data) ? data : [];
    return rows
      .map((row) => normalizeOfferRow(row))
      .filter((row): row is RfqOffer => Boolean(row));
  } catch (error) {
    if (isMissingTableOrColumnError(error)) {
      console.warn("[rfq offers] missing schema; returning empty", {
        quoteId: normalizedQuoteId,
        supabaseError: serializeSupabaseError(error),
      });
      return [];
    }
    console.error("[rfq offers] unexpected error", {
      quoteId: normalizedQuoteId,
      error: serializeSupabaseError(error) ?? error,
    });
    return [];
  }
}

function normalizeOfferRow(row: RawRfqOfferRow): RfqOffer | null {
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
    confidence_score: normalizeInteger(row?.confidence_score),
    quality_risk_flags: normalizeRiskFlags(row?.quality_risk_flags),
    status: normalizeStatus(row?.status),
    received_at: receivedAt,
    created_at: createdAt,
    provider: row?.provider ?? null,
  };
}

function normalizeStatus(value: unknown): RfqOfferStatus {
  return parseRfqOfferStatus(value) ?? "received";
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

function normalizeOptionalId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
