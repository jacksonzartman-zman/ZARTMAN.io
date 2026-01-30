import { supabaseServer } from "@/lib/supabaseServer";
import { normalizeEmailInput } from "@/app/(portals)/quotes/pageUtils";
import { getCustomerByEmail, getCustomerByUserId } from "@/server/customers";
import {
  isMissingTableOrColumnError,
  serializeSupabaseError,
} from "@/server/admin/logging";
import { buildQuoteFilesFromRow } from "@/server/quotes/files";
import { deriveQuotePrimaryLabel } from "@/server/quotes/fileSummary";
import { loadQuoteBidAggregates } from "@/server/quotes/bidAggregates";
import {
  deriveCustomerQuoteListStatus,
  getCustomerQuoteStatusMeta,
} from "@/server/quotes/customerSummary";
import { loadUnreadMessageSummary } from "@/server/quotes/messageReads";
import { CUSTOMER_VISIBLE_TIMELINE_EVENT_TYPES } from "@/server/quotes/events";
import type { QuoteBidAggregate } from "@/server/quotes/bidAggregates";

export type CustomerQuoteListRow = {
  id: string;
  createdAt: string;
  updatedAt: string | null;
  rfqLabel: string; // short description/title
  status: string; // reuse existing quote status helper labels
  rfqHistoryStatus: CustomerRfqHistoryStatus;
  hasWinner: boolean;
  award:
    | {
        providerName: string;
        totalPrice: number | string | null;
        currency: string | null;
        leadTimeDaysMin: number | null;
        leadTimeDaysMax: number | null;
        awardedAt: string;
      }
    | null;
  kickoffStatus: "not_started" | "in_progress" | "complete" | "n/a";
  bidsCount: number;
  primaryFileName: string | null;
  fileNames: string[];
  bestPriceAmount: number | null;
  bestPriceCurrency: string | null;
  bestLeadTimeDays: number | null;
  selectedPriceAmount: number | null;
  selectedPriceCurrency: string | null;
  selectedLeadTimeDays: number | null;
  unreadMessagesCount: number;
  lastActivityAt: string | null;
};

export type CustomerRfqHistoryStatus =
  | "Waiting on offers"
  | "Offers ready"
  | "Awarded"
  | "In production"
  | "Delivered";

export type CustomerQuotesListFilters = {
  status?: string; // e.g. "open" | "awarded" | "closed"
  hasWinner?: "yes" | "no";
  kickoff?: "not_started" | "in_progress" | "complete";
};

type QuoteRow = {
  id: string;
  file_name: string | null;
  company: string | null;
  customer_name: string | null;
  customer_email: string | null;
  status: string | null;
  created_at: string | null;
  updated_at: string | null;
  file_names?: string[] | null;
  upload_file_names?: string[] | null;
  file_count?: number | null;
  upload_file_count?: number | null;
  awarded_at?: string | null;
  awarded_supplier_id?: string | null;
  awarded_bid_id?: string | null;
};

const QUOTES_WITH_UPLOADS_COLUMNS =
  "id,file_name,company,customer_name,customer_email,status,created_at,updated_at,file_names,upload_file_names,file_count,upload_file_count,awarded_at,awarded_supplier_id,awarded_bid_id";

type RfqAwardLiteRow = {
  rfq_id: string;
  offer_id: string;
  provider_id: string;
  awarded_at: string;
};

type RfqOfferLiteRow = {
  id: string;
  provider_id: string;
  currency: string | null;
  total_price: number | string | null;
  lead_time_days_min: number | null;
  lead_time_days_max: number | null;
  provider: { name: string | null } | null;
};

function normalizeId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeFilterText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

function isWinnerQuote(row: QuoteRow): boolean {
  const status = (row.status ?? "").trim().toLowerCase();
  return (
    Boolean(row.awarded_at) ||
    Boolean(row.awarded_bid_id) ||
    Boolean(row.awarded_supplier_id) ||
    status === "won"
  );
}

function maxIsoTimestamp(values: Array<string | null | undefined>): string | null {
  let best: string | null = null;
  for (const value of values) {
    if (typeof value !== "string" || !value.trim()) continue;
    if (!best || value > best) {
      best = value;
    }
  }
  return best;
}

function normalizeOpsStatus(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function deriveRfqHistoryStatus(input: {
  hasWinner: boolean;
  bidsCount: number;
  opsStatus: string | null;
}): CustomerRfqHistoryStatus {
  const ops = normalizeOpsStatus(input.opsStatus);

  if (ops) {
    // Delivered buckets.
    if (["delivered", "shipped", "completed", "complete"].includes(ops)) {
      return "Delivered";
    }
    // In production buckets.
    if (
      [
        "in_production",
        "in production",
        "production",
        "manufacturing",
        "building",
        "in_build",
      ].includes(ops)
    ) {
      return "In production";
    }
  }

  if (input.hasWinner) return "Awarded";
  if (input.bidsCount > 0) return "Offers ready";
  return "Waiting on offers";
}

type KickoffTotals = { total: number; completed: number };

function deriveKickoffStatus(input: {
  hasWinner: boolean;
  kickoffCompletedAt: string | null;
  totals: KickoffTotals | null;
}): CustomerQuoteListRow["kickoffStatus"] {
  if (!input.hasWinner) return "n/a";
  if (input.kickoffCompletedAt) return "complete";
  const totals = input.totals ?? { total: 0, completed: 0 };
  if (totals.total <= 0) return "not_started";
  if (totals.completed <= 0) return "not_started";
  if (totals.completed >= totals.total) return "complete";
  return "in_progress";
}

export async function loadCustomerQuotesList(
  userIdOrEmail: { userId: string | null; email: string | null },
  filters: CustomerQuotesListFilters,
): Promise<CustomerQuoteListRow[]> {
  const userId = normalizeId(userIdOrEmail.userId);
  const email = normalizeEmailInput(userIdOrEmail.email ?? null);

  const customer =
    userId ? await getCustomerByUserId(userId) : null;
  const customerFallback =
    !customer && email ? await getCustomerByEmail(email) : null;
  const customerEmail = normalizeEmailInput(customer?.email ?? customerFallback?.email ?? email);
  if (!customerEmail) {
    return [];
  }

  let quoteRows: QuoteRow[] = [];
  try {
    const { data, error } = await supabaseServer()
      .from("quotes_with_uploads")
      .select(QUOTES_WITH_UPLOADS_COLUMNS)
      .ilike("customer_email", customerEmail)
      .order("updated_at", { ascending: false })
      .returns<QuoteRow[]>();
    if (error) {
      console.error("[customer quotes list] quotes query failed", {
        userId: userId || null,
        email: customerEmail,
        error: serializeSupabaseError(error) ?? error,
      });
      return [];
    }
    quoteRows = (data ?? []) as QuoteRow[];
  } catch (error) {
    console.error("[customer quotes list] quotes query crashed", {
      userId: userId || null,
      email: customerEmail,
      error: serializeSupabaseError(error) ?? error,
    });
    return [];
  }

  if (quoteRows.length === 0) {
    return [];
  }

  const quoteIds = quoteRows.map((row) => row.id).filter(Boolean);

  const rfqAwardsByQuoteId = await loadRfqAwardsByQuoteId(quoteIds);
  const offerIds = Array.from(
    new Set(
      Array.from(rfqAwardsByQuoteId.values())
        .map((row) => normalizeId(row.offer_id))
        .filter(Boolean),
    ),
  );
  const rfqOffersById = offerIds.length > 0 ? await loadRfqOffersByIds(offerIds) : new Map();

  const bidAggregates: Record<string, QuoteBidAggregate> =
    quoteIds.length > 0 ? await loadQuoteBidAggregates(quoteIds) : {};

  const unreadSummary =
    userId && quoteIds.length > 0
      ? await loadUnreadMessageSummary({ quoteIds, userId })
      : {};

  const lastEventAtByQuoteId = await loadLastCustomerVisibleEventAtByQuoteId(quoteIds);

  const kickoffCompletedAtByQuoteId = await loadKickoffCompletedAtByQuoteId(quoteIds);
  const opsStatusByQuoteId = await loadOpsStatusByQuoteId(quoteIds);
  const kickoffTotalsByKey = await loadKickoffTotalsByWinnerSupplier(quoteRows);

  const statusFilter = normalizeFilterText(filters?.status);
  const hasWinnerFilter = normalizeFilterText(filters?.hasWinner);
  const kickoffFilter = normalizeFilterText(filters?.kickoff);

  const rows: CustomerQuoteListRow[] = quoteRows
    .map((quote) => {
      const files = buildQuoteFilesFromRow(quote);
      const rfqLabel = deriveQuotePrimaryLabel(quote, { files });
      const createdAt =
        quote.created_at ??
        quote.updated_at ??
        new Date().toISOString();
      const aggregate = bidAggregates[quote.id];
      const listStatusKey = deriveCustomerQuoteListStatus({
        quoteStatus: quote.status,
        aggregate,
      });
      const statusMeta = getCustomerQuoteStatusMeta(listStatusKey);
      const rfqAward = rfqAwardsByQuoteId.get(quote.id) ?? null;
      const hasWinner = isWinnerQuote(quote) || Boolean(rfqAward);
      const bidsCount = aggregate?.bidCount ?? 0;
      const opsStatus = opsStatusByQuoteId.get(quote.id) ?? null;
      const rfqHistoryStatus = deriveRfqHistoryStatus({ hasWinner, bidsCount, opsStatus });
      const primaryFileName =
        typeof files[0]?.filename === "string" && files[0].filename.trim().length > 0
          ? files[0].filename.trim()
          : null;
      const fileNames = Array.from(
        new Set(
          files
            .map((file) => (typeof file?.filename === "string" ? file.filename.trim() : ""))
            .filter(Boolean),
        ),
      );
      const bestPriceAmount = aggregate?.bestPriceAmount ?? null;
      const bestPriceCurrency = aggregate?.bestPriceCurrency ?? null;
      const bestLeadTimeDays = aggregate?.fastestLeadTimeDays ?? null;
      const selectedPriceAmount =
        hasWinner ? aggregate?.winningBidAmount ?? null : null;
      const selectedPriceCurrency =
        hasWinner ? aggregate?.winningBidCurrency ?? null : null;
      const selectedLeadTimeDays =
        hasWinner ? aggregate?.winningBidLeadTimeDays ?? null : null;
      const unread = unreadSummary[quote.id]?.unreadCount ?? 0;
      const lastMessageAt = unreadSummary[quote.id]?.lastMessage?.created_at ?? null;
      const lastEventAt = lastEventAtByQuoteId.get(quote.id) ?? null;
      const kickoffCompletedAt = kickoffCompletedAtByQuoteId.get(quote.id) ?? null;
      const winnerSupplierId = normalizeId(quote.awarded_supplier_id) || null;
      const kickoffKey = winnerSupplierId ? `${quote.id}:${winnerSupplierId}` : null;
      const kickoffTotals = kickoffKey ? kickoffTotalsByKey.get(kickoffKey) ?? null : null;
      const kickoffStatus = deriveKickoffStatus({
        hasWinner,
        kickoffCompletedAt,
        totals: kickoffTotals,
      });
      const lastActivityAt = maxIsoTimestamp([
        lastEventAt,
        lastMessageAt,
        quote.updated_at,
        quote.awarded_at,
        rfqAward?.awarded_at ?? null,
        quote.created_at,
      ]);

      const awardedOffer = rfqAward ? rfqOffersById.get(rfqAward.offer_id) ?? null : null;
      const awardProviderName =
        (awardedOffer?.provider?.name ?? "").trim() ||
        (typeof rfqAward?.provider_id === "string" && rfqAward.provider_id.trim()
          ? `Provider ${rfqAward.provider_id.trim().slice(0, 6)}`
          : "Provider");

      return {
        id: quote.id,
        createdAt,
        updatedAt: quote.updated_at ?? null,
        rfqLabel,
        status: statusMeta.label,
        rfqHistoryStatus,
        hasWinner,
        award: rfqAward
          ? {
              providerName: awardProviderName,
              totalPrice: awardedOffer?.total_price ?? null,
              currency: awardedOffer?.currency ?? null,
              leadTimeDaysMin: awardedOffer?.lead_time_days_min ?? null,
              leadTimeDaysMax: awardedOffer?.lead_time_days_max ?? null,
              awardedAt: rfqAward.awarded_at,
            }
          : null,
        kickoffStatus,
        bidsCount,
        primaryFileName,
        fileNames,
        bestPriceAmount,
        bestPriceCurrency,
        bestLeadTimeDays,
        selectedPriceAmount,
        selectedPriceCurrency,
        selectedLeadTimeDays,
        unreadMessagesCount: unread,
        lastActivityAt,
      };
    })
    .filter((row) => {
      if (statusFilter === "awarded") {
        return row.status === "Awarded";
      }
      if (statusFilter === "closed") {
        return row.status === "Closed";
      }
      if (statusFilter === "open") {
        return row.status === "Submitted" || row.status === "Bids received";
      }
      return true;
    })
    .filter((row) => {
      if (hasWinnerFilter === "yes") return row.hasWinner;
      if (hasWinnerFilter === "no") return !row.hasWinner;
      return true;
    })
    .filter((row) => {
      if (!kickoffFilter) return true;
      return row.kickoffStatus === kickoffFilter;
    });

  rows.sort((a, b) => {
    const aKey = a.lastActivityAt ?? a.createdAt;
    const bKey = b.lastActivityAt ?? b.createdAt;
    if (aKey === bKey) return b.createdAt.localeCompare(a.createdAt);
    return bKey.localeCompare(aKey);
  });

  return rows;
}

async function loadRfqAwardsByQuoteId(
  quoteIds: string[],
): Promise<Map<string, RfqAwardLiteRow>> {
  const map = new Map<string, RfqAwardLiteRow>();
  const ids = (Array.isArray(quoteIds) ? quoteIds : []).map(normalizeId).filter(Boolean);
  if (ids.length === 0) return map;

  try {
    const { data, error } = await supabaseServer()
      .from("rfq_awards")
      .select("rfq_id,offer_id,provider_id,awarded_at")
      .in("rfq_id", ids)
      .returns<RfqAwardLiteRow[]>();

    if (error) {
      if (isMissingTableOrColumnError(error)) return map;
      console.error("[customer quotes list] rfq_awards query failed", {
        quoteIdsCount: ids.length,
        error: serializeSupabaseError(error) ?? error,
      });
      return map;
    }

    for (const row of data ?? []) {
      const rfqId = normalizeId(row?.rfq_id);
      const offerId = normalizeId(row?.offer_id);
      const providerId = normalizeId(row?.provider_id);
      const awardedAt = typeof row?.awarded_at === "string" ? row.awarded_at : "";
      if (!rfqId || !offerId || !providerId || !awardedAt) continue;
      map.set(rfqId, { rfq_id: rfqId, offer_id: offerId, provider_id: providerId, awarded_at: awardedAt });
    }
  } catch (error) {
    if (isMissingTableOrColumnError(error)) return map;
    console.error("[customer quotes list] rfq_awards query crashed", {
      quoteIdsCount: ids.length,
      error: serializeSupabaseError(error) ?? error,
    });
  }

  return map;
}

async function loadRfqOffersByIds(
  offerIds: string[],
): Promise<Map<string, RfqOfferLiteRow>> {
  const map = new Map<string, RfqOfferLiteRow>();
  const ids = (Array.isArray(offerIds) ? offerIds : []).map(normalizeId).filter(Boolean);
  if (ids.length === 0) return map;

  try {
    const { data, error } = await supabaseServer()
      .from("rfq_offers")
      .select("id,provider_id,currency,total_price,lead_time_days_min,lead_time_days_max,provider:providers(name)")
      .in("id", ids)
      .returns<RfqOfferLiteRow[]>();

    if (error) {
      if (isMissingTableOrColumnError(error)) return map;
      console.error("[customer quotes list] rfq_offers query failed", {
        offerIdsCount: ids.length,
        error: serializeSupabaseError(error) ?? error,
      });
      return map;
    }

    for (const row of data ?? []) {
      const id = normalizeId(row?.id);
      const providerId = normalizeId(row?.provider_id);
      if (!id || !providerId) continue;
      map.set(id, {
        id,
        provider_id: providerId,
        currency: typeof row.currency === "string" ? row.currency.trim() || null : null,
        total_price: row.total_price ?? null,
        lead_time_days_min:
          typeof row.lead_time_days_min === "number" && Number.isFinite(row.lead_time_days_min)
            ? row.lead_time_days_min
            : null,
        lead_time_days_max:
          typeof row.lead_time_days_max === "number" && Number.isFinite(row.lead_time_days_max)
            ? row.lead_time_days_max
            : null,
        provider: row.provider ?? null,
      });
    }
  } catch (error) {
    if (isMissingTableOrColumnError(error)) return map;
    console.error("[customer quotes list] rfq_offers query crashed", {
      offerIdsCount: ids.length,
      error: serializeSupabaseError(error) ?? error,
    });
  }

  return map;
}

async function loadLastCustomerVisibleEventAtByQuoteId(
  quoteIds: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const ids = (Array.isArray(quoteIds) ? quoteIds : []).map((id) => normalizeId(id)).filter(Boolean);
  if (ids.length === 0) return map;

  try {
    const { data, error } = await supabaseServer()
      .from("quote_events")
      .select("quote_id,event_type,created_at")
      .in("quote_id", ids)
      .in("event_type", Array.from(CUSTOMER_VISIBLE_TIMELINE_EVENT_TYPES))
      .order("created_at", { ascending: false })
      .returns<{ quote_id: string; event_type: string; created_at: string }[]>();

    if (error) {
      if (isMissingTableOrColumnError(error)) {
        return map;
      }
      console.error("[customer quotes list] quote events query failed", {
        quoteIdsCount: ids.length,
        error: serializeSupabaseError(error) ?? error,
      });
      return map;
    }

    for (const row of data ?? []) {
      const quoteId = normalizeId(row.quote_id);
      const createdAt = typeof row.created_at === "string" ? row.created_at : "";
      if (!quoteId || !createdAt) continue;
      // rows are sorted desc, so first seen is latest
      if (!map.has(quoteId)) {
        map.set(quoteId, createdAt);
      }
    }
  } catch (error) {
    if (isMissingTableOrColumnError(error)) {
      return map;
    }
    console.error("[customer quotes list] quote events query crashed", {
      quoteIdsCount: ids.length,
      error: serializeSupabaseError(error) ?? error,
    });
  }

  return map;
}

async function loadKickoffCompletedAtByQuoteId(
  quoteIds: string[],
): Promise<Map<string, string | null>> {
  const map = new Map<string, string | null>();
  const ids = (Array.isArray(quoteIds) ? quoteIds : []).map((id) => normalizeId(id)).filter(Boolean);
  if (ids.length === 0) return map;

  for (const id of ids) {
    map.set(id, null);
  }

  try {
    const { data, error } = await supabaseServer()
      .from("quotes")
      .select("id,kickoff_completed_at")
      .in("id", ids)
      .returns<{ id: string; kickoff_completed_at?: string | null }[]>();
    if (error) {
      if (isMissingTableOrColumnError(error)) {
        return map;
      }
      console.error("[customer quotes list] kickoff_completed_at query failed", {
        quoteIdsCount: ids.length,
        error: serializeSupabaseError(error) ?? error,
      });
      return map;
    }
    for (const row of data ?? []) {
      const id = normalizeId(row.id);
      if (!id) continue;
      const value =
        typeof row.kickoff_completed_at === "string" && row.kickoff_completed_at.trim()
          ? row.kickoff_completed_at
          : null;
      map.set(id, value);
    }
  } catch (error) {
    if (isMissingTableOrColumnError(error)) {
      return map;
    }
    console.error("[customer quotes list] kickoff_completed_at query crashed", {
      quoteIdsCount: ids.length,
      error: serializeSupabaseError(error) ?? error,
    });
  }

  return map;
}

async function loadOpsStatusByQuoteId(
  quoteIds: string[],
): Promise<Map<string, string | null>> {
  const map = new Map<string, string | null>();
  const ids = (Array.isArray(quoteIds) ? quoteIds : []).map((id) => normalizeId(id)).filter(Boolean);
  if (ids.length === 0) return map;

  for (const id of ids) {
    map.set(id, null);
  }

  try {
    const { data, error } = await supabaseServer()
      .from("quotes")
      .select("id,ops_status")
      .in("id", ids)
      .returns<{ id: string; ops_status?: string | null }[]>();
    if (error) {
      if (isMissingTableOrColumnError(error)) {
        return map;
      }
      console.error("[customer quotes list] ops_status query failed", {
        quoteIdsCount: ids.length,
        error: serializeSupabaseError(error) ?? error,
      });
      return map;
    }
    for (const row of data ?? []) {
      const id = normalizeId(row.id);
      if (!id) continue;
      const value =
        typeof row.ops_status === "string" && row.ops_status.trim()
          ? row.ops_status
          : null;
      map.set(id, value);
    }
  } catch (error) {
    if (isMissingTableOrColumnError(error)) {
      return map;
    }
    console.error("[customer quotes list] ops_status query crashed", {
      quoteIdsCount: ids.length,
      error: serializeSupabaseError(error) ?? error,
    });
  }

  return map;
}

async function loadKickoffTotalsByWinnerSupplier(
  quotes: QuoteRow[],
): Promise<Map<string, KickoffTotals>> {
  const map = new Map<string, KickoffTotals>();

  const winnerPairs: Array<{ quoteId: string; supplierId: string }> = quotes
    .map((q) => {
      const quoteId = normalizeId(q.id);
      const supplierId = normalizeId(q.awarded_supplier_id);
      const hasWinner = isWinnerQuote(q);
      if (!quoteId || !supplierId || !hasWinner) return null;
      return { quoteId, supplierId };
    })
    .filter(Boolean) as Array<{ quoteId: string; supplierId: string }>;

  if (winnerPairs.length === 0) {
    return map;
  }

  const quoteIds = Array.from(new Set(winnerPairs.map((p) => p.quoteId)));
  const supplierIds = Array.from(new Set(winnerPairs.map((p) => p.supplierId)));
  const winnerSupplierByQuoteId = new Map<string, string>();
  for (const pair of winnerPairs) {
    winnerSupplierByQuoteId.set(pair.quoteId, pair.supplierId);
  }

  try {
    const { data, error } = await supabaseServer()
      .from("quote_kickoff_tasks")
      .select("quote_id,supplier_id,completed")
      .in("quote_id", quoteIds)
      .in("supplier_id", supplierIds)
      .returns<{ quote_id: string; supplier_id: string; completed: boolean | null }[]>();

    if (error) {
      if (isMissingTableOrColumnError(error)) {
        return map;
      }
      console.error("[customer quotes list] kickoff tasks query failed", {
        quoteIdsCount: quoteIds.length,
        supplierIdsCount: supplierIds.length,
        error: serializeSupabaseError(error) ?? error,
      });
      return map;
    }

    const totals = new Map<string, KickoffTotals>();
    for (const row of data ?? []) {
      const quoteId = normalizeId(row.quote_id);
      const supplierId = normalizeId(row.supplier_id);
      if (!quoteId || !supplierId) continue;
      const winnerSupplierId = winnerSupplierByQuoteId.get(quoteId);
      if (!winnerSupplierId || winnerSupplierId !== supplierId) {
        continue;
      }
      const key = `${quoteId}:${supplierId}`;
      const existing = totals.get(key) ?? { total: 0, completed: 0 };
      existing.total += 1;
      if (row.completed) {
        existing.completed += 1;
      }
      totals.set(key, existing);
    }

    for (const [key, value] of totals) {
      map.set(key, value);
    }
  } catch (error) {
    if (isMissingTableOrColumnError(error)) {
      return map;
    }
    console.error("[customer quotes list] kickoff tasks query crashed", {
      error: serializeSupabaseError(error) ?? error,
    });
  }

  return map;
}

