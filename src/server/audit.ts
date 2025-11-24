import { supabaseServer } from "@/lib/supabaseServer";

export type AuditEvent = {
  id: string;
  actorEmail: string;
  action: string;
  targetType: string;
  targetId: string;
  timestamp: string;
};

type AuditAction =
  | "quote.created"
  | "quote.status_changed"
  | "supplier.bid_submitted"
  | "supplier.selected"
  | "user.logged_in";

type AuditLogFilter = {
  quoteId?: string;
  supplierId?: string;
  userEmail?: string | null;
  limit?: number;
};

type QuoteAuditRow = {
  id: string;
  email: string | null;
  status: string | null;
  created_at: string | null;
  updated_at: string | null;
  assigned_supplier_email: string | null;
};

type BidAuditRow = {
  id: string;
  quote_id: string | null;
  supplier_id: string | null;
  status: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type SupplierAuditRow = {
  id: string;
  primary_email: string | null;
  company_name: string | null;
  created_at: string | null;
};

const DEFAULT_LIMIT = 50;
const FALLBACK_ACTOR = "system@zartman.com";

export async function loadAuditLog(
  filter: AuditLogFilter,
): Promise<AuditEvent[]> {
  const limit = Math.max(1, Math.min(filter.limit ?? DEFAULT_LIMIT, 200));
  const loaders: Array<Promise<AuditEvent[]>> = [];

  if (filter.quoteId) {
    loaders.push(loadQuoteAuditEvents(filter.quoteId));
  }

  if (filter.supplierId) {
    loaders.push(loadSupplierAuditEvents(filter.supplierId));
  }

  if (filter.userEmail) {
    loaders.push(loadUserAuditEvents(filter.userEmail));
  }

  if (loaders.length === 0) {
    return [];
  }

  const results = await Promise.all(loaders);
  const deduped = new Map<string, AuditEvent>();

  results
    .flat()
    .sort((a, b) => {
      const aTime = Date.parse(a.timestamp) || 0;
      const bTime = Date.parse(b.timestamp) || 0;
      return bTime - aTime;
    })
    .forEach((event) => {
      if (!deduped.has(event.id)) {
        deduped.set(event.id, event);
      }
    });

  return Array.from(deduped.values()).slice(0, limit);
}

export function buildUserLoginEvent(
  email: string,
  timestamp = new Date().toISOString(),
): AuditEvent {
  const normalizedEmail = normalizeEmail(email) ?? FALLBACK_ACTOR;
  return {
    id: `user:${normalizedEmail}:login:${timestamp}`,
    actorEmail: normalizedEmail,
    action: "user.logged_in",
    targetType: "user",
    targetId: normalizedEmail,
    timestamp,
  };
}

async function loadQuoteAuditEvents(quoteId: string): Promise<AuditEvent[]> {
  if (!quoteId) {
    return [];
  }

  try {
    const { data, error } = await supabaseServer
      .from("quotes_with_uploads")
      .select(
        "id,email,status,assigned_supplier_email,created_at,updated_at",
      )
      .eq("id", quoteId)
      .maybeSingle<QuoteAuditRow>();

    if (error) {
      console.error("audit: quote lookup failed", { quoteId, error });
      return [];
    }

    if (!data) {
      return [];
    }

    const quoteEvents: AuditEvent[] = [];
    quoteEvents.push(
      buildQuoteEvent("quote.created", data, {
        timestamp: data.created_at,
        actorFallback: data.email,
      }),
    );

    if (data.updated_at && data.updated_at !== data.created_at) {
      quoteEvents.push(
        buildQuoteEvent("quote.status_changed", data, {
          timestamp: data.updated_at,
          actorFallback: data.assigned_supplier_email ?? data.email,
        }),
      );
    }

    const bidEvents = await buildBidEventsForQuote(data.id);
    return [...quoteEvents, ...bidEvents];
  } catch (error) {
    console.error("audit: unexpected quote error", { quoteId, error });
    return [];
  }
}

async function buildBidEventsForQuote(quoteId: string): Promise<AuditEvent[]> {
  const bidRows = await selectBidsByFilter({ quoteId });
  if (bidRows.length === 0) {
    return [];
  }

  const supplierIds = Array.from(
    new Set(
      bidRows
        .map((row) => row.supplier_id)
        .filter((value): value is string => Boolean(value)),
    ),
  );
  const suppliers = await selectSuppliersByIds(supplierIds);
  const supplierEmailMap = new Map<string, string>();
  suppliers.forEach((supplier) => {
    if (supplier.id) {
      supplierEmailMap.set(
        supplier.id,
        supplier.primary_email?.toLowerCase() ?? FALLBACK_ACTOR,
      );
    }
  });

  return bidRows.flatMap((bid) =>
    buildBidEvents({
      bid,
      quoteId,
      supplierEmail:
        supplierEmailMap.get(bid.supplier_id ?? "") ?? FALLBACK_ACTOR,
    }),
  );
}

async function loadSupplierAuditEvents(
  supplierId: string,
): Promise<AuditEvent[]> {
  if (!supplierId) {
    return [];
  }

  try {
    const { data: supplier, error: supplierError } = await supabaseServer
      .from("suppliers")
      .select("id,primary_email,company_name,created_at")
      .eq("id", supplierId)
      .maybeSingle<SupplierAuditRow>();

    if (supplierError) {
      console.error("audit: supplier lookup failed", {
        supplierId,
        error: supplierError,
      });
      return [];
    }

    if (!supplier) {
      return [];
    }

    const supplierEmail =
      normalizeEmail(supplier.primary_email) ?? FALLBACK_ACTOR;
    const bidRows = await selectBidsByFilter({ supplierId });

    const events = bidRows.flatMap((bid) =>
      buildBidEvents({
        bid,
        quoteId: bid.quote_id ?? "",
        supplierEmail,
      }),
    );

    events.push({
      id: `supplier:${supplier.id}:created`,
      actorEmail: supplierEmail,
      action: "user.logged_in",
      targetType: "supplier",
      targetId: supplier.id,
      timestamp: safeTimestamp(supplier.created_at),
    });

    return events;
  } catch (error) {
    console.error("audit: supplier audit failed", { supplierId, error });
    return [];
  }
}

async function loadUserAuditEvents(
  email: string | null,
): Promise<AuditEvent[]> {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) {
    return [];
  }

  try {
    const { data, error } = await supabaseServer
      .from("quotes_with_uploads")
      .select("id,created_at")
      .ilike("email", normalizedEmail)
      .order("created_at", { ascending: false })
      .limit(25);

    if (error) {
      console.error("audit: user quote lookup failed", {
        email: normalizedEmail,
        error,
      });
      return [buildUserLoginEvent(normalizedEmail)];
    }

    const quoteEvents =
      data?.map((quote) =>
        buildQuoteEvent("quote.created", {
          ...quote,
          email: normalizedEmail,
          updated_at: quote.created_at ?? null,
          assigned_supplier_email: null,
          status: null,
        }),
      ) ?? [];

    return [buildUserLoginEvent(normalizedEmail), ...quoteEvents];
  } catch (error) {
    console.error("audit: user audit unexpected error", {
      email: normalizedEmail,
      error,
    });
    return [buildUserLoginEvent(normalizedEmail)];
  }
}

function buildQuoteEvent(
  action: AuditAction,
  quote: QuoteAuditRow,
  options?: { timestamp?: string | null; actorFallback?: string | null },
): AuditEvent {
  return {
    id: `quote:${quote.id}:${action}:${options?.timestamp ?? quote.created_at ?? Date.now()}`,
    actorEmail: normalizeEmail(options?.actorFallback) ?? FALLBACK_ACTOR,
    action,
    targetType: "quote",
    targetId: quote.id,
    timestamp: safeTimestamp(options?.timestamp ?? quote.created_at),
  };
}

function buildBidEvents({
  bid,
  quoteId,
  supplierEmail,
}: {
  bid: BidAuditRow;
  quoteId: string;
  supplierEmail: string;
}): AuditEvent[] {
  const submissionEvent: AuditEvent = {
    id: `quote:${quoteId}:bid:${bid.id}:submitted`,
    actorEmail: supplierEmail,
    action: "supplier.bid_submitted",
    targetType: "quote",
    targetId: quoteId,
    timestamp: safeTimestamp(bid.created_at ?? bid.updated_at),
  };

  const events: AuditEvent[] = [submissionEvent];

  if ((bid.status ?? "").toLowerCase() === "accepted") {
    events.push({
      id: `quote:${quoteId}:bid:${bid.id}:selected`,
      actorEmail: supplierEmail,
      action: "supplier.selected",
      targetType: "quote",
      targetId: quoteId,
      timestamp: safeTimestamp(bid.updated_at ?? bid.created_at),
    });
  }

  return events;
}

async function selectBidsByFilter(filter: {
  quoteId?: string;
  supplierId?: string;
}): Promise<BidAuditRow[]> {
  if (!filter.quoteId && !filter.supplierId) {
    return [];
  }

  try {
    let query = supabaseServer
      .from("supplier_bids")
      .select("id,quote_id,supplier_id,status,created_at,updated_at")
      .order("created_at", { ascending: false })
      .limit(100);

    if (filter.quoteId) {
      query = query.eq("quote_id", filter.quoteId);
    }

    if (filter.supplierId) {
      query = query.eq("supplier_id", filter.supplierId);
    }

    const { data, error } = await query;
    if (error) {
      console.error("audit: bid lookup failed", { filter, error });
      return [];
    }

    return (data as BidAuditRow[]) ?? [];
  } catch (error) {
    console.error("audit: unexpected bid error", { filter, error });
    return [];
  }
}

async function selectSuppliersByIds(
  supplierIds: string[],
): Promise<SupplierAuditRow[]> {
  if (supplierIds.length === 0) {
    return [];
  }

  try {
    const { data, error } = await supabaseServer
      .from("suppliers")
      .select("id,primary_email,company_name,created_at")
      .in("id", supplierIds);

    if (error) {
      console.error("audit: supplier email lookup failed", {
        supplierIds,
        error,
      });
      return [];
    }

    return (data as SupplierAuditRow[]) ?? [];
  } catch (error) {
    console.error("audit: unexpected supplier email error", {
      supplierIds,
      error,
    });
    return [];
  }
}

function normalizeEmail(value: string | null | undefined): string | null {
  if (!value || typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function safeTimestamp(value?: string | null): string {
  if (value && !Number.isNaN(Date.parse(value))) {
    return value;
  }
  return new Date().toISOString();
}
