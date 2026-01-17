import { supabaseServer } from "@/lib/supabaseServer";
import {
  normalizeQuoteStatus,
  QUOTE_OPEN_STATUSES,
  type QuoteStatus,
} from "@/server/quotes/status";
import { loadSupplierById } from "@/server/suppliers/profile";
import type { SupplierRow } from "@/server/suppliers/types";
import { logMarketplaceEvent } from "./events";
import { isMissingRfqTableError, isRfqsFeatureEnabled } from "./flags";
import { explainScore, MIN_MATCH_SCORE } from "./matching";
import type {
  ListOpenRfqsResult,
  MarketplaceRfq,
  MarketplaceRfqStatus,
  MatchableRfq,
} from "./types";

const QUOTE_SELECT_FIELDS = [
  "id",
  "customer_id",
  "status",
  "target_date",
  "created_at",
  "updated_at",
  "upload_id",
].join(",");

const UPLOAD_SELECT_FIELDS = [
  "id",
  "manufacturing_process",
  "quantity",
  "notes",
].join(",");

type QuoteRow = {
  id: string;
  customer_id: string | null;
  status: string | null;
  target_date: string | null;
  created_at: string | null;
  updated_at: string | null;
  upload_id: string | null;
};

type UploadRow = {
  id: string;
  manufacturing_process: string | null;
  quantity: string | null;
  notes: string | null;
};

type QuoteListOptions = {
  ids?: string[];
  customerId?: string;
  statusIn?: string[];
  limit?: number;
  orderByCreatedAtDesc?: boolean;
};

export const OPEN_RFQ_STATUSES: MarketplaceRfqStatus[] = [
  "open",
  "in_review",
  "pending_award",
];

export async function loadRfqById(quoteId: string): Promise<MarketplaceRfq | null> {
  const normalizedId = normalizeId(quoteId);
  if (!normalizedId || !isRfqsFeatureEnabled()) {
    return null;
  }

  const rfqs = await listMarketplaceRfqs({ ids: [normalizedId] });
  return rfqs[0] ?? null;
}

export async function listOpenRfqsForSupplier(
  supplierId: string,
): Promise<ListOpenRfqsResult> {
  if (!supplierId) {
    return { rfqs: [], error: "Supplier ID is required" };
  }

  if (!isRfqsFeatureEnabled()) {
    return { rfqs: [], error: null };
  }

  const supplier = await loadSupplierById(supplierId);
  if (!supplier) {
    return { rfqs: [], error: "Supplier not found" };
  }

  const rfqs = await listOpenMarketplaceRfqs({ limit: 500 });
  const evaluationCache = new Map<string, Promise<MatchableRfq | null>>();

  try {
    const visibleResults = await Promise.all(
      rfqs.map((rfq) =>
        getVisibleRfqForSupplier({
          rfq,
          supplier,
          evaluationCache,
        }),
      ),
    );

    const filtered = visibleResults.filter(
      (entry): entry is MatchableRfq => Boolean(entry),
    );

    return {
      rfqs: filtered,
      error: null,
    };
  } catch (error) {
    console.error("marketplace: listOpenRfqsForSupplier unexpected error", {
      supplierId,
      error,
    });
    return { rfqs: [], error: "Unexpected error while loading RFQs" };
  }
}

export async function updateRfqStatus(
  quoteId: string,
  status: MarketplaceRfqStatus,
): Promise<MarketplaceRfq | null> {
  const normalizedId = normalizeId(quoteId);
  if (!normalizedId || !isRfqsFeatureEnabled()) {
    return null;
  }

  const previous = await loadRfqById(normalizedId);
  const quoteStatus = mapMarketplaceStatusToQuoteStatus(status);

  try {
    const { data, error } = await supabaseServer
      .from("quotes")
      .update({
        status: quoteStatus,
        updated_at: new Date().toISOString(),
      })
      .eq("id", normalizedId)
      .select(QUOTE_SELECT_FIELDS)
      .maybeSingle<QuoteRow>();

    if (error) {
      if (isMissingRfqTableError(error)) {
        return null;
      }
      console.error("marketplace: updateRfqStatus failed", {
        quoteId: normalizedId,
        status,
        error,
      });
      return null;
    }

    const updatedRow = data ?? null;
    const uploadMap = await loadUploadsByIds(
      updatedRow?.upload_id ? [updatedRow.upload_id] : [],
    );
    const updated = updatedRow
      ? buildMarketplaceRfq(updatedRow, uploadMap.get(updatedRow.upload_id ?? "") ?? null)
      : null;

    if (
      updated &&
      status === "open" &&
      (!previous || previous.status !== "open")
    ) {
      await logMarketplaceEvent({
        rfqId: normalizedId,
        type: "rfq_opened",
        actorId: null,
        supplierId: null,
        customerId: updated.customer_id ?? null,
        payload: {
          previous_status: previous?.status ?? null,
        },
      });
    }

    return updated;
  } catch (error) {
    if (isMissingRfqTableError(error)) {
      return null;
    }
    console.error("marketplace: updateRfqStatus unexpected error", {
      quoteId: normalizedId,
      status,
      error,
    });
    return null;
  }
}

export async function listCustomerRfqs(
  customerId: string,
  options?: { limit?: number },
): Promise<MarketplaceRfq[]> {
  const normalizedId = normalizeId(customerId);
  if (!normalizedId || !isRfqsFeatureEnabled()) {
    return [];
  }
  return listMarketplaceRfqs({
    customerId: normalizedId,
    limit: options?.limit,
  });
}

export async function listOpenCustomerRfqs(
  customerId: string,
  options?: { limit?: number },
): Promise<MarketplaceRfq[]> {
  const normalizedId = normalizeId(customerId);
  if (!normalizedId || !isRfqsFeatureEnabled()) {
    return [];
  }
  return listMarketplaceRfqs({
    customerId: normalizedId,
    statusIn: [...QUOTE_OPEN_STATUSES],
    limit: options?.limit,
  });
}

export async function listMarketplaceRfqsByIds(
  rfqIds: string[],
): Promise<MarketplaceRfq[]> {
  const normalizedIds = normalizeIds(rfqIds);
  if (normalizedIds.length === 0 || !isRfqsFeatureEnabled()) {
    return [];
  }
  return listMarketplaceRfqs({ ids: normalizedIds });
}

export async function listOpenMarketplaceRfqs(options?: {
  limit?: number;
}): Promise<MarketplaceRfq[]> {
  if (!isRfqsFeatureEnabled()) {
    return [];
  }
  return listMarketplaceRfqs({
    statusIn: [...QUOTE_OPEN_STATUSES],
    limit: options?.limit,
  });
}

async function getVisibleRfqForSupplier(args: {
  rfq: MarketplaceRfq;
  supplier: SupplierRow;
  evaluationCache: Map<string, Promise<MatchableRfq | null>>;
}): Promise<MatchableRfq | null> {
  const cacheKey = `${args.rfq.id}:${args.supplier.id}`;
  const cached = args.evaluationCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const evaluationPromise = (async () => {
    const breakdown = await explainScore(args.rfq, args.supplier);
    const score = Math.round(breakdown.total);

    if (score < MIN_MATCH_SCORE) {
      await logMarketplaceEvent({
        rfqId: args.rfq.id,
        type: "visibility_filtered",
        supplierId: args.supplier.id,
        actorId: args.supplier.id,
        payload: {
          score,
          threshold: MIN_MATCH_SCORE,
          factors: breakdown.factors,
        },
      });
      return null;
    }

    return {
      ...args.rfq,
      match_score: score,
      match_explanation: breakdown,
    };
  })().finally(() => {
    args.evaluationCache.delete(cacheKey);
  });

  args.evaluationCache.set(cacheKey, evaluationPromise);
  return evaluationPromise;
}

async function listMarketplaceRfqs(
  options: QuoteListOptions,
): Promise<MarketplaceRfq[]> {
  if (!isRfqsFeatureEnabled()) {
    return [];
  }

  const normalizedIds = normalizeIds(options.ids);
  if (options.ids && normalizedIds.length === 0) {
    return [];
  }

  const normalizedCustomerId = normalizeId(options.customerId ?? "");
  if (options.customerId && !normalizedCustomerId) {
    return [];
  }

  const normalizedStatuses = normalizeStatusList(options.statusIn);

  try {
    let query = supabaseServer.from("quotes").select(QUOTE_SELECT_FIELDS);

    if (normalizedIds.length > 0) {
      query = query.in("id", normalizedIds);
    }
    if (normalizedCustomerId) {
      query = query.eq("customer_id", normalizedCustomerId);
    }
    if (normalizedStatuses.length > 0) {
      query = query.in("status", normalizedStatuses);
    }
    if (options.orderByCreatedAtDesc !== false) {
      query = query.order("created_at", { ascending: false });
    }
    if (options.limit && options.limit > 0) {
      query = query.limit(options.limit);
    }

    const { data, error } = await query.returns<QuoteRow[]>();

    if (error) {
      if (isMissingRfqTableError(error)) {
        return [];
      }
      console.error("marketplace: listMarketplaceRfqs query failed", {
        options,
        error,
      });
      return [];
    }

    const rows = Array.isArray(data) ? data : [];
    const uploadMap = await loadUploadsByIds(
      rows.map((row) => row.upload_id).filter((id): id is string => Boolean(id)),
    );

    return rows.map((row) =>
      buildMarketplaceRfq(row, uploadMap.get(row.upload_id ?? "") ?? null),
    );
  } catch (error) {
    if (isMissingRfqTableError(error)) {
      return [];
    }
    console.error("marketplace: listMarketplaceRfqs unexpected error", {
      options,
      error,
    });
    return [];
  }
}

async function loadUploadsByIds(uploadIds: string[]): Promise<Map<string, UploadRow>> {
  const normalizedIds = normalizeIds(uploadIds);
  if (normalizedIds.length === 0) {
    return new Map();
  }

  try {
    const { data, error } = await supabaseServer
      .from("uploads")
      .select(UPLOAD_SELECT_FIELDS)
      .in("id", normalizedIds)
      .returns<UploadRow[]>();

    if (error) {
      if (!isMissingRfqTableError(error)) {
        console.error("marketplace: loadUploadsByIds failed", {
          uploadCount: normalizedIds.length,
          error,
        });
      }
      return new Map();
    }

    const rows = Array.isArray(data) ? data : [];
    return rows.reduce<Map<string, UploadRow>>((map, row) => {
      if (row?.id) {
        map.set(row.id, row);
      }
      return map;
    }, new Map());
  } catch (error) {
    if (!isMissingRfqTableError(error)) {
      console.error("marketplace: loadUploadsByIds unexpected error", {
        uploadCount: normalizedIds.length,
        error,
      });
    }
    return new Map();
  }
}

function buildMarketplaceRfq(
  quote: QuoteRow,
  upload?: UploadRow | null,
): MarketplaceRfq {
  const createdAt = quote.created_at ?? new Date().toISOString();
  const updatedAt = quote.updated_at ?? createdAt;

  return {
    id: quote.id,
    customer_id: quote.customer_id ?? null,
    status: mapQuoteStatusToMarketplace(quote.status),
    title: null,
    description: normalizeOptionalText(upload?.notes ?? null),
    quantity: normalizeQuantity(upload?.quantity ?? null),
    process_requirements: normalizeRequirementList(upload?.manufacturing_process ?? null),
    material_requirements: null,
    certification_requirements: null,
    target_date: quote.target_date ?? null,
    created_at: createdAt,
    updated_at: updatedAt,
    priority: null,
    files: null,
    upload_id: quote.upload_id ?? null,
  };
}

function mapQuoteStatusToMarketplace(status: string | null): MarketplaceRfqStatus {
  const normalized = normalizeQuoteStatus(status);
  switch (normalized) {
    case "submitted":
      return "open";
    case "in_review":
      return "in_review";
    case "quoted":
      return "pending_award";
    case "approved":
      return "pending_award";
    case "won":
      return "awarded";
    case "lost":
      return "closed";
    case "cancelled":
      return "cancelled";
    default:
      return "open";
  }
}

function mapMarketplaceStatusToQuoteStatus(
  status: MarketplaceRfqStatus,
): QuoteStatus {
  switch (status) {
    case "draft":
      return "submitted";
    case "open":
      return "submitted";
    case "in_review":
      return "in_review";
    case "pending_award":
      return "approved";
    case "awarded":
      return "won";
    case "closed":
      return "lost";
    case "cancelled":
      return "cancelled";
    default:
      return "submitted";
  }
}

function normalizeRequirementList(value: string | null): string[] | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  return [trimmed];
}

function normalizeQuantity(value: string | null): number | null {
  if (typeof value !== "string") {
    return null;
  }
  const cleaned = value.replace(/[^0-9.]/g, "").trim();
  if (!cleaned) {
    return null;
  }
  const parsed = Number.parseFloat(cleaned);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return Math.round(parsed);
}

function normalizeOptionalText(value: string | null): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeIds(values?: string[] | null): string[] {
  if (!Array.isArray(values)) {
    return [];
  }
  const unique = new Set<string>();
  values.forEach((value) => {
    const normalized = normalizeId(value);
    if (normalized) {
      unique.add(normalized);
    }
  });
  return Array.from(unique);
}

function normalizeId(value?: string | null): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeStatusList(values?: string[] | null): string[] {
  if (!Array.isArray(values)) {
    return [];
  }
  return values
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter((value) => value.length > 0);
}
