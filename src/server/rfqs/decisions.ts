import { supabaseServer } from "@/lib/supabaseServer";
import type { SupplierBidRow } from "@/server/suppliers/types";
import {
  isWinningBidStatus,
  isLosingBidStatus,
  normalizeBidStatus,
} from "@/lib/bids/status";

export type SupplierDecisionRfqStatus =
  | "needs_quote"
  | "quote_due_soon"
  | "awaiting_reply"
  | "awaiting_files"
  | "ready_to_submit";

export type SupplierDecisionRfq = {
  id: string;
  title: string;
  customerName: string | null;
  status: SupplierDecisionRfqStatus;
  summary: string | null;
  updatedAt: string;
  metadata?: {
    assignment?: string | null;
    bidStatus?: string | null;
  };
};

type SupplierDecisionMetadata = SupplierDecisionRfq["metadata"];

export type SupplierDecision = {
  id: string;
  type: "rfq_invite" | "bid_follow_up" | "win" | "loss";
  title: string;
  description: string;
  relatedQuoteId: string;
  urgencyLevel: "low" | "medium" | "high";
  href: string;
  ctaLabel: string;
  metadata?: SupplierDecisionMetadata;
};

type SupplierDecisionInput = {
  supplierId: string;
  supplierEmail?: string | null;
  limit?: number;
};

type QuoteSummaryRow = {
  id: string;
  file_name: string | null;
  company: string | null;
  customer_name: string | null;
  status: string | null;
  target_date: string | null;
  created_at: string | null;
  assigned_supplier_email: string | null;
  assigned_supplier_name: string | null;
};

type AssignmentRow = {
  quote_id: string | null;
};

const DEFAULT_DECISION_LIMIT = 10;
const ASSIGNMENT_SCAN_LIMIT = 60;
const BID_STALE_THRESHOLD_DAYS = 5;

const QUOTE_FIELDS = [
  "id",
  "file_name",
  "company",
  "customer_name",
  "status",
  "target_date",
  "created_at",
  "assigned_supplier_email",
  "assigned_supplier_name",
].join(",");

const BID_FIELDS = [
  "id",
  "quote_id",
  "status",
  "updated_at",
  "created_at",
  "unit_price",
  "currency",
  "lead_time_days",
].join(",");

export async function getSupplierDecisionQueue(
  args: SupplierDecisionInput,
): Promise<SupplierDecision[]> {
  const supplierId = args.supplierId?.trim();
  if (!supplierId) {
    return [];
  }

  const limit = clampLimit(args.limit ?? DEFAULT_DECISION_LIMIT);
  const supplierEmail = normalizeEmail(args.supplierEmail);

  const [assignmentQuoteIds, bids] = await Promise.all([
    collectRelevantQuoteIds(supplierId, supplierEmail, ASSIGNMENT_SCAN_LIMIT),
    fetchRecentBids(supplierId),
  ]);

  const quoteIdSet = new Set<string>(assignmentQuoteIds);
  bids.forEach((bid) => {
    if (bid.quote_id) {
      quoteIdSet.add(bid.quote_id);
    }
  });

  if (quoteIdSet.size === 0) {
    return [];
  }

  const quoteMap = await fetchQuotesByIds(Array.from(quoteIdSet));
  if (quoteMap.size === 0) {
    return [];
  }

  const bidsByQuote = groupBidsByQuote(bids);
  const decisions: SupplierDecision[] = [];
  const decidedQuotes = new Map<string, SupplierDecision["type"]>();

  bids.forEach((bid) => {
    const quoteId = bid.quote_id ?? null;
    if (!quoteId || decidedQuotes.has(quoteId)) {
      return;
    }
    const quote = quoteMap.get(quoteId);
    if (!quote) {
      return;
    }
    const normalizedStatus = normalizeBidStatus(bid.status);
    if (isWinningBidStatus(normalizedStatus)) {
      decisions.push(buildWinningBidDecision(quote, bid));
      decidedQuotes.set(quoteId, "win");
      return;
    }
    if (isLosingBidStatus(normalizedStatus)) {
      decisions.push(buildLosingBidDecision(quote, bid));
      decidedQuotes.set(quoteId, "loss");
    }
  });

  // Quotes that have an assignment but no bid yet.
  assignmentQuoteIds.forEach((quoteId) => {
    const quote = quoteMap.get(quoteId);
    if (!quote) {
      return;
    }
    if (bidsByQuote.has(quote.id) || decidedQuotes.has(quote.id)) {
      return;
    }
    decisions.push(buildBidNeededDecision(quote));
  });

  // Quotes with pending bids that are getting stale.
  bids.forEach((bid) => {
    const quote = bid.quote_id ? quoteMap.get(bid.quote_id) : null;
    if (!quote || decidedQuotes.has(quote.id)) {
      return;
    }
    if (bid.status !== "pending") {
      return;
    }
    if (!isBidStale(bid)) {
      return;
    }
    decisions.push(buildBidFollowUpDecision(quote, bid));
  });

  return decisions
    .sort((a, b) => compareDecisions(a, b))
    .slice(0, limit);
}

async function collectRelevantQuoteIds(
  supplierId: string,
  supplierEmail: string | null,
  limit: number,
): Promise<string[]> {
  const ids = new Set<string>();

  const addRows = (rows: AssignmentRow[] | null | undefined) => {
    if (!rows) {
      return;
    }
    rows.forEach((row) => {
      if (row.quote_id) {
        ids.add(row.quote_id);
      }
    });
  };

  // New invite table: quote_invites (supplier_id-based).
  try {
    const { data, error } = await supabaseServer()
      .from("quote_invites")
      .select("quote_id")
      .eq("supplier_id", supplierId)
      .limit(limit);
    if (error) {
      console.error("supplier decisions: invite query by id failed", {
        supplierId,
        error,
      });
    }
    addRows((data as AssignmentRow[]) ?? []);
  } catch (error) {
    console.error("supplier decisions: invite query by id error", {
      supplierId,
      error,
    });
  }

  try {
    const { data, error } = await supabaseServer()
      .from("quote_suppliers")
      .select("quote_id")
      .eq("supplier_id", supplierId)
      .limit(limit);
    if (error) {
      console.error("supplier decisions: assignment query by id failed", {
        supplierId,
        error,
      });
    }
    addRows((data as AssignmentRow[]) ?? []);
  } catch (error) {
    console.error("supplier decisions: assignment query by id error", {
      supplierId,
      error,
    });
  }

  if (ids.size < limit && supplierEmail) {
    try {
      const { data, error } = await supabaseServer()
        .from("quote_suppliers")
        .select("quote_id")
        .ilike("supplier_email", supplierEmail)
        .limit(limit - ids.size);
      if (error) {
        console.error("supplier decisions: assignment query by email failed", {
          supplierEmail,
          error,
        });
      }
      addRows((data as AssignmentRow[]) ?? []);
    } catch (error) {
      console.error("supplier decisions: assignment query by email error", {
        supplierEmail,
        error,
      });
    }
  }

  if (ids.size < limit && supplierEmail) {
    try {
      const { data, error } = await supabaseServer()
        .from("quotes_with_uploads")
        .select("id")
        .ilike("assigned_supplier_email", supplierEmail)
        .limit(limit - ids.size);
      if (error) {
        console.error("supplier decisions: assigned quote lookup failed", {
          supplierEmail,
          error,
        });
      }
      (data as { id: string }[] | null | undefined)?.forEach((row) => {
        if (row.id) {
          ids.add(row.id);
        }
      });
    } catch (error) {
      console.error("supplier decisions: assigned quote lookup error", {
        supplierEmail,
        error,
      });
    }
  }

  return Array.from(ids).slice(0, limit);
}

async function fetchQuotesByIds(
  quoteIds: string[],
): Promise<Map<string, QuoteSummaryRow>> {
  if (quoteIds.length === 0) {
    return new Map();
  }

  try {
    const { data, error } = await supabaseServer()
      .from("quotes_with_uploads")
      .select(QUOTE_FIELDS)
      .in("id", quoteIds);

    if (error) {
      console.error("supplier decisions: quote lookup failed", {
        quoteIds,
        error,
      });
      return new Map();
    }

    const rows = Array.isArray(data)
      ? (data as unknown as QuoteSummaryRow[])
      : [];
    return new Map(rows.map((row) => [row.id, row]));
  } catch (error) {
    console.error("supplier decisions: quote lookup error", {
      quoteIds,
      error,
    });
    return new Map();
  }
}

async function fetchRecentBids(supplierId: string): Promise<SupplierBidRow[]> {
  if (!supplierId) {
    return [];
  }

  try {
    const { data, error } = await supabaseServer()
      .from("supplier_bids")
      .select(BID_FIELDS)
      .eq("supplier_id", supplierId)
      .order("updated_at", { ascending: false })
      .limit(50);

    if (error) {
      console.error("supplier decisions: bid query failed", {
        supplierId,
        error,
      });
      return [];
    }

    return Array.isArray(data)
      ? (data as unknown as SupplierBidRow[])
      : [];
  } catch (error) {
    console.error("supplier decisions: bid query error", {
      supplierId,
      error,
    });
    return [];
  }
}

function buildBidNeededDecision(quote: QuoteSummaryRow): SupplierDecision {
  const quoteLabel = getQuoteLabel(quote);
  const description = buildBidNeededDescription(quote);
  const rfq: SupplierDecisionRfq = {
    id: quote.id,
    title: quoteLabel,
    customerName: quote.customer_name ?? quote.company ?? null,
    status: "needs_quote",
    summary: description,
    updatedAt: quote.created_at ?? new Date().toISOString(),
    metadata: {
      assignment:
        quote.assigned_supplier_name ?? quote.assigned_supplier_email ?? null,
    },
  };

  return transformRfqToDecision(rfq, {
    id: `rfq_invite:${quote.id}`,
    type: "rfq_invite",
    title: `Share pricing for ${quoteLabel}`,
    description,
    relatedQuoteId: quote.id,
    urgencyLevel: deriveUrgencyLevel(quote.target_date, quote.created_at),
    href: `/supplier/quotes/${quote.id}`,
    ctaLabel: "Open search request",
  });
}

function buildBidFollowUpDecision(
  quote: QuoteSummaryRow,
  bid: SupplierBidRow,
): SupplierDecision {
  const quoteLabel = getQuoteLabel(quote);
  const updatedAt = bid.updated_at ?? bid.created_at;
  const ageDays = updatedAt ? computeAgeInDays(updatedAt) : null;
  const ageDescription =
    ageDays !== null ? `Last touched ${ageDays} day${ageDays === 1 ? "" : "s"} ago.` : "";

  const metadata = normalizeSupplierDecisionMetadata({
    bidStatus: bid.status ?? null,
  });

  return {
    id: `bid_follow_up:${bid.id}`,
    type: "bid_follow_up",
    title: `Refresh your offer on ${quoteLabel}`,
    description: `${buildCustomerLabel(quote)} is still reviewing. ${ageDescription}`.trim(),
    relatedQuoteId: quote.id,
    urgencyLevel: deriveUrgencyLevel(quote.target_date, quote.created_at, true),
    href: `/supplier/quotes/${quote.id}`,
    ctaLabel: "Update offer",
    metadata,
  };
}

function buildWinningBidDecision(
  quote: QuoteSummaryRow,
  bid: SupplierBidRow,
): SupplierDecision {
  const quoteLabel = getQuoteLabel(quote);
  const targetDate = formatTargetDate(quote.target_date);
  const description = targetDate
    ? `${buildCustomerLabel(quote)} awarded this search request to you. Target ship ${targetDate}.`
    : `${buildCustomerLabel(quote)} awarded this search request to you.`;
  const metadata = normalizeSupplierDecisionMetadata({
    bidStatus: normalizeBidStatus(bid.status),
  });

  return {
    id: `bid_win:${bid.id}`,
    type: "win",
    title: `Selected for ${quoteLabel}`,
    description,
    relatedQuoteId: quote.id,
    urgencyLevel: "medium",
    href: `/supplier/quotes/${quote.id}`,
    ctaLabel: "Open workspace",
    metadata,
  };
}

function buildLosingBidDecision(
  quote: QuoteSummaryRow,
  bid: SupplierBidRow,
): SupplierDecision {
  const quoteLabel = getQuoteLabel(quote);
  const metadata = normalizeSupplierDecisionMetadata({
    bidStatus: normalizeBidStatus(bid.status),
  });

  return {
    id: `bid_loss:${bid.id}`,
    type: "loss",
    title: `Not selected: ${quoteLabel}`,
    description: `${buildCustomerLabel(quote)} moved forward with another supplier. Save your pricing for the next invite.`,
    relatedQuoteId: quote.id,
    urgencyLevel: "low",
    href: `/supplier/quotes/${quote.id}`,
    ctaLabel: "Review quote",
    metadata,
  };
}

function transformRfqToDecision(
  rfq: SupplierDecisionRfq,
  decision: Omit<SupplierDecision, "metadata">,
): SupplierDecision {
  const metadata = normalizeSupplierDecisionMetadata(rfq.metadata);
  return metadata ? { ...decision, metadata } : decision;
}

function normalizeSupplierDecisionMetadata(
  metadata?: SupplierDecisionMetadata,
): SupplierDecisionMetadata | undefined {
  if (!metadata) {
    return undefined;
  }

  const normalized: SupplierDecisionMetadata = {};

  const assignment =
    typeof metadata.assignment === "string"
      ? metadata.assignment
      : metadata.assignment === null
        ? null
        : undefined;
  if (assignment !== undefined) {
    normalized.assignment = assignment;
  }

  const bidStatus =
    typeof metadata.bidStatus === "string"
      ? metadata.bidStatus
      : metadata.bidStatus === null
        ? null
        : undefined;
  if (bidStatus !== undefined) {
    normalized.bidStatus = bidStatus;
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function buildBidNeededDescription(quote: QuoteSummaryRow): string {
  const customerLabel = buildCustomerLabel(quote);
  const targetDate = formatTargetDate(quote.target_date);
  if (targetDate) {
    return `${customerLabel} invited your shop to bid. Target ship date ${targetDate}.`;
  }
  return `${customerLabel} invited your shop to bid. Share pricing to stay in the rotation.`;
}

function buildCustomerLabel(quote: QuoteSummaryRow): string {
  return (
    quote.company ??
    quote.customer_name ??
    quote.assigned_supplier_name ??
    "The buyer"
  );
}

function formatTargetDate(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(new Date(parsed));
}

function deriveUrgencyLevel(
  targetDate: string | null,
  createdAt: string | null,
  bump?: boolean,
): SupplierDecision["urgencyLevel"] {
  const daysToTarget = computeDaysToTarget(targetDate);
  if (daysToTarget !== null) {
    if (daysToTarget <= 5) {
      return "high";
    }
    if (daysToTarget <= 12) {
      return "medium";
    }
    return bump ? "medium" : "low";
  }

  const age = computeAgeInDays(createdAt);
  if (age !== null) {
    if (age >= 10) {
      return "high";
    }
    if (age >= 4) {
      return "medium";
    }
  }

  return bump ? "medium" : "low";
}

function computeDaysToTarget(targetDate: string | null): number | null {
  if (!targetDate) {
    return null;
  }
  const parsed = Date.parse(targetDate);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  const diffMs = parsed - Date.now();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

function computeAgeInDays(timestamp: string | null | undefined): number | null {
  if (!timestamp) {
    return null;
  }
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  const diffMs = Date.now() - parsed;
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

function isBidStale(bid: SupplierBidRow): boolean {
  const updatedAt = bid.updated_at ?? bid.created_at;
  const age = computeAgeInDays(updatedAt);
  return age !== null && age >= BID_STALE_THRESHOLD_DAYS;
}

function getQuoteLabel(quote: QuoteSummaryRow): string {
  if (quote.file_name) {
    return quote.file_name;
  }
  if (quote.company) {
    return quote.company;
  }
  if (quote.customer_name) {
    return quote.customer_name;
  }
  return `Quote ${quote.id.slice(0, 8)}`;
}

function normalizeEmail(value?: string | null): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function clampLimit(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return DEFAULT_DECISION_LIMIT;
  }
  return Math.min(Math.max(Math.round(value), 1), 25);
}

function groupBidsByQuote(
  bids: SupplierBidRow[],
): Map<string, SupplierBidRow[]> {
  return bids.reduce<Map<string, SupplierBidRow[]>>((map, bid) => {
    if (!bid.quote_id) {
      return map;
    }
    const existing = map.get(bid.quote_id) ?? [];
    existing.push(bid);
    map.set(bid.quote_id, existing);
    return map;
  }, new Map());
}

function compareDecisions(
  a: SupplierDecision,
  b: SupplierDecision,
): number {
  const urgencyRank: Record<SupplierDecision["urgencyLevel"], number> = {
    high: 3,
    medium: 2,
    low: 1,
  };
  const diff = urgencyRank[b.urgencyLevel] - urgencyRank[a.urgencyLevel];
  if (diff !== 0) {
    return diff;
  }
  return a.id.localeCompare(b.id);
}
