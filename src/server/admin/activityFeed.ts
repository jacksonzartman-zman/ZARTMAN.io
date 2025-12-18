import { supabaseServer } from "@/lib/supabaseServer";
import {
  isMissingTableOrColumnError,
  serializeSupabaseError,
} from "@/server/admin/logging";
import type { QuoteTimelineEvent } from "@/lib/timeline/quoteTimeline";
import { mapRawEventToTimelineEvent } from "@/lib/timeline/quoteTimeline";

export type AdminActivityRow = QuoteTimelineEvent & {
  customerName: string | null;
  supplierName: string | null;
};

type QuoteEventRow = {
  id: string;
  quote_id: string;
  event_type: string;
  actor_role: string | null;
  actor_supplier_id: string | null;
  created_at: string;
  metadata?: unknown;
  payload?: unknown;
};

type QuoteContextRow = {
  id: string;
  customer_name: string | null;
  customer_email: string | null;
  company: string | null;
  file_name: string | null;
  awarded_supplier_id: string | null;
  awarded_at: string | null;
};

type SupplierRow = {
  id: string;
  company_name: string | null;
  primary_email: string | null;
};

type BidSupplierRow = {
  quote_id: string;
  supplier_id: string | null;
  updated_at: string | null;
};

export async function loadAdminActivityFeed(params: {
  limit?: number;
  since?: string | null; // ISO timestamp
}): Promise<AdminActivityRow[]> {
  const limit =
    typeof params.limit === "number" && Number.isFinite(params.limit)
      ? Math.max(1, Math.min(Math.floor(params.limit), 500))
      : 200;
  const since = normalizeIso(params.since ?? null);

  const events = await fetchRecentQuoteEvents({ limit, since });
  if (events.length === 0) {
    return [];
  }

  const quoteIds = Array.from(
    new Set(events.map((e) => e.quote_id).filter((id) => typeof id === "string" && id.trim())),
  );

  const quoteContextById = await fetchQuoteContextByIds(quoteIds);
  const lastBidSupplierByQuoteId = await fetchLastBidSupplierByQuoteId(quoteIds);

  const supplierIds = new Set<string>();
  for (const event of events) {
    const meta = resolveEventMetadata(event);
    const metaSupplierId =
      readString(meta, "supplier_id") ?? readString(meta, "supplierId");
    const quoteAwardedSupplierId =
      quoteContextById.get(event.quote_id)?.awarded_supplier_id ?? null;
    const lastBidSupplierId = lastBidSupplierByQuoteId.get(event.quote_id) ?? null;

    for (const candidate of [
      metaSupplierId,
      quoteAwardedSupplierId,
      lastBidSupplierId,
      normalizeId(event.actor_supplier_id),
    ]) {
      if (candidate) supplierIds.add(candidate);
    }
  }

  const supplierById = await fetchSuppliersByIds(Array.from(supplierIds));

  return events.map((event) => {
    const quoteContext = quoteContextById.get(event.quote_id) ?? null;
    const customerName = resolveCustomerName(quoteContext);
    const supplierName = resolveSupplierName({
      event,
      quoteContext,
      lastBidSupplierId: lastBidSupplierByQuoteId.get(event.quote_id) ?? null,
      supplierById,
    });

    const timelineEvent = mapRawEventToTimelineEvent({
      id: event.id,
      quote_id: event.quote_id,
      event_type: event.event_type,
      created_at: event.created_at,
      actor_role: event.actor_role,
      metadata: resolveEventMetadata(event),
      payload: resolveEventPayload(event),
    });

    return {
      ...timelineEvent,
      customerName,
      supplierName,
    };
  });
}

async function fetchRecentQuoteEvents(args: {
  limit: number;
  since: string | null;
}): Promise<QuoteEventRow[]> {
  const baseColumns =
    "id,quote_id,event_type,actor_role,actor_supplier_id,created_at";

  const runSelect = (columns: string) => {
    let query = supabaseServer.from("quote_events").select(columns);
    if (args.since) {
      query = query.gte("created_at", args.since);
    }
    return query
      .order("created_at", { ascending: false })
      .limit(args.limit)
      .returns<QuoteEventRow[]>();
  };

  try {
    let data: QuoteEventRow[] | null = null;
    let error: unknown = null;

    const attemptWithPayload = await runSelect(`${baseColumns},metadata,payload`);
    if (!attemptWithPayload.error) {
      data = attemptWithPayload.data ?? [];
    } else if (isMissingTableOrColumnError(attemptWithPayload.error)) {
      const attemptMetadataOnly = await runSelect(`${baseColumns},metadata`);
      if (!attemptMetadataOnly.error) {
        data = attemptMetadataOnly.data ?? [];
      } else if (isMissingTableOrColumnError(attemptMetadataOnly.error)) {
        const attemptPayloadOnly = await runSelect(`${baseColumns},payload`);
        if (!attemptPayloadOnly.error) {
          data = attemptPayloadOnly.data ?? [];
        } else {
          error = attemptPayloadOnly.error;
        }
      } else {
        error = attemptMetadataOnly.error;
      }
    } else {
      error = attemptWithPayload.error;
    }

    if (error) {
      console.error("[admin activity] quote_events load failed", {
        error: serializeSupabaseError(error),
      });
      return [];
    }

    return (data ?? []) as QuoteEventRow[];
  } catch (error) {
    console.error("[admin activity] quote_events load crashed", {
      error: serializeSupabaseError(error) ?? error,
    });
    return [];
  }
}

async function fetchQuoteContextByIds(
  quoteIds: string[],
): Promise<Map<string, QuoteContextRow>> {
  const byId = new Map<string, QuoteContextRow>();
  if (quoteIds.length === 0) return byId;

  try {
    const { data, error } = await supabaseServer
      .from("quotes_with_uploads")
      .select(
        "id,customer_name,customer_email,company,file_name,awarded_supplier_id,awarded_at",
      )
      .in("id", quoteIds)
      .returns<QuoteContextRow[]>();

    if (error) {
      console.error("[admin activity] quote context load failed", {
        error: serializeSupabaseError(error),
      });
      return byId;
    }

    for (const row of data ?? []) {
      if (row?.id) byId.set(row.id, row);
    }
    return byId;
  } catch (error) {
    console.error("[admin activity] quote context load crashed", {
      error: serializeSupabaseError(error) ?? error,
    });
    return byId;
  }
}

async function fetchLastBidSupplierByQuoteId(
  quoteIds: string[],
): Promise<Map<string, string>> {
  const byQuoteId = new Map<string, string>();
  if (quoteIds.length === 0) return byQuoteId;

  try {
    const limit = Math.min(1500, Math.max(200, quoteIds.length * 3));
    const { data, error } = await supabaseServer
      .from("supplier_bids")
      .select("quote_id,supplier_id,updated_at")
      .in("quote_id", quoteIds)
      .order("updated_at", { ascending: false })
      .limit(limit)
      .returns<BidSupplierRow[]>();

    if (error) {
      console.error("[admin activity] supplier_bids lookup failed", {
        error: serializeSupabaseError(error),
      });
      return byQuoteId;
    }

    for (const row of data ?? []) {
      const quoteId = normalizeId(row.quote_id);
      const supplierId = normalizeId(row.supplier_id);
      if (!quoteId || !supplierId) continue;
      if (!byQuoteId.has(quoteId)) {
        byQuoteId.set(quoteId, supplierId);
      }
    }
    return byQuoteId;
  } catch (error) {
    console.error("[admin activity] supplier_bids lookup crashed", {
      error: serializeSupabaseError(error) ?? error,
    });
    return byQuoteId;
  }
}

async function fetchSuppliersByIds(
  supplierIds: string[],
): Promise<Map<string, SupplierRow>> {
  const byId = new Map<string, SupplierRow>();
  if (supplierIds.length === 0) return byId;

  try {
    const { data, error } = await supabaseServer
      .from("suppliers")
      .select("id,company_name,primary_email")
      .in("id", supplierIds)
      .returns<SupplierRow[]>();

    if (error) {
      console.error("[admin activity] suppliers lookup failed", {
        error: serializeSupabaseError(error),
      });
      return byId;
    }

    for (const row of data ?? []) {
      if (row?.id) byId.set(row.id, row);
    }
    return byId;
  } catch (error) {
    console.error("[admin activity] suppliers lookup crashed", {
      error: serializeSupabaseError(error) ?? error,
    });
    return byId;
  }
}

function resolveCustomerName(quote: QuoteContextRow | null): string | null {
  if (!quote) return null;
  const candidate = firstNonEmpty(
    quote.customer_name,
    quote.company,
    quote.customer_email,
    quote.file_name,
  );
  return candidate ?? null;
}

function resolveSupplierName(args: {
  event: QuoteEventRow;
  quoteContext: QuoteContextRow | null;
  lastBidSupplierId: string | null;
  supplierById: Map<string, SupplierRow>;
}): string | null {
  const meta = resolveEventMetadata(args.event);
  const type = normalizeText(args.event.event_type)?.toLowerCase() ?? "";
  const metaSupplierName =
    readString(meta, "supplier_name") ?? readString(meta, "supplierName");

  if (metaSupplierName) {
    return metaSupplierName;
  }

  const metaSupplierId =
    readString(meta, "supplier_id") ?? readString(meta, "supplierId");
  const awardedSupplierId = normalizeId(args.quoteContext?.awarded_supplier_id);
  const lastBidSupplierId = normalizeId(args.lastBidSupplierId);

  const supplierId =
    type === "bid_received"
      ? metaSupplierId ?? lastBidSupplierId ?? awardedSupplierId
      : type === "capacity_updated" || type === "capacity_update_requested"
        ? metaSupplierId ?? awardedSupplierId ?? lastBidSupplierId
        : metaSupplierId ?? awardedSupplierId ?? lastBidSupplierId;

  const supplier = supplierId ? args.supplierById.get(supplierId) ?? null : null;
  const supplierLabel =
    firstNonEmpty(supplier?.company_name ?? null, supplier?.primary_email ?? null) ??
    null;
  return supplierLabel;
}

function resolveEventMetadata(event: QuoteEventRow): Record<string, unknown> {
  if (isRecord(event.metadata)) return event.metadata;
  if (isRecord(event.payload)) return event.payload;
  return {};
}

function resolveEventPayload(event: QuoteEventRow): Record<string, unknown> | null {
  return isRecord(event.payload) ? event.payload : null;
}

function normalizeId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeIso(value: unknown): string | null {
  const raw = normalizeText(value);
  if (!raw) return null;
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readString(
  metadata: Record<string, unknown>,
  key: string,
): string | null {
  const value = metadata[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function firstNonEmpty(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

