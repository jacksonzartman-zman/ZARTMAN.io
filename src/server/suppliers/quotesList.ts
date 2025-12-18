import { supabaseServer } from "@/lib/supabaseServer";
import { loadSupplierProfileByUserId } from "@/server/suppliers/profile";
import {
  isMissingTableOrColumnError,
  serializeSupabaseError,
} from "@/server/admin/logging";
import { loadUnreadMessageSummary } from "@/server/quotes/messageReads";
import { buildQuoteFilesFromRow } from "@/server/quotes/files";
import { deriveQuotePrimaryLabel } from "@/server/quotes/fileSummary";
import { normalizeQuoteStatus } from "@/server/quotes/status";
import {
  loadSupplierInboxBidAggregates,
  type SupplierInboxBidAggregate,
} from "@/server/suppliers/inbox";
import {
  loadSupplierSelfBenchHealth,
} from "@/server/suppliers/benchHealth";

export type SupplierQuoteListRow = {
  quoteId: string;
  rfqLabel: string;
  status: string;
  hasBid: boolean;
  isAwardedToSupplier: boolean;
  kickoffStatus: "not_started" | "in_progress" | "complete" | "n/a";
  bidsCount: number | null;
  unreadMessagesCount: number;
  lastActivityAt: string | null;
  matchHealth: "good" | "caution" | "poor" | "unknown";
  benchStatus: "underused" | "balanced" | "overused" | "unknown";
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

function normalizeId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function toIntOrZero(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.floor(value));
  }
  return 0;
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

function deriveKickoffStatus(input: {
  awardedToSupplier: boolean;
  kickoffCompletedAt: string | null;
  totals: { total: number; completed: number } | null;
}): SupplierQuoteListRow["kickoffStatus"] {
  if (!input.awardedToSupplier) return "n/a";
  if (input.kickoffCompletedAt) return "complete";
  const totals = input.totals ?? { total: 0, completed: 0 };
  if (totals.total <= 0) return "not_started";
  if (totals.completed <= 0) return "not_started";
  if (totals.completed >= totals.total) return "complete";
  return "in_progress";
}

export async function loadSupplierQuotesList(
  supplierUserId: string,
): Promise<SupplierQuoteListRow[]> {
  const userId = normalizeId(supplierUserId);
  if (!userId) return [];

  const profile = await loadSupplierProfileByUserId(userId);
  const supplier = profile?.supplier ?? null;
  const supplierId = normalizeId(supplier?.id);
  const supplierEmail = normalizeId(supplier?.primary_email);
  if (!supplierId) return [];

  // Visibility = union of: invited, assigned, has bid, awarded.
  const quoteIds = new Set<string>();

  try {
    const [awarded, bids, invites, assignedLegacy, assignedQuoteSuppliers] = await Promise.all([
      supabaseServer
        .from("quotes")
        .select("id")
        .eq("awarded_supplier_id", supplierId)
        .returns<{ id: string }[]>(),
      supabaseServer
        .from("supplier_bids")
        .select("quote_id")
        .eq("supplier_id", supplierId)
        .returns<{ quote_id: string }[]>(),
      supabaseServer
        .from("quote_invites")
        .select("quote_id")
        .eq("supplier_id", supplierId)
        .returns<{ quote_id: string }[]>(),
      supplierEmail
        ? supabaseServer
            .from("quotes")
            .select("id")
            .eq("assigned_supplier_email", supplierEmail)
            .returns<{ id: string }[]>()
        : Promise.resolve({ data: [], error: null } as any),
      supplierEmail
        ? supabaseServer
            .from("quote_suppliers")
            .select("quote_id")
            .eq("supplier_email", supplierEmail)
            .returns<{ quote_id: string }[]>()
        : Promise.resolve({ data: [], error: null } as any),
    ]);

    for (const row of awarded.data ?? []) {
      const id = normalizeId((row as any)?.id);
      if (id) quoteIds.add(id);
    }
    for (const row of bids.data ?? []) {
      const id = normalizeId((row as any)?.quote_id);
      if (id) quoteIds.add(id);
    }
    for (const row of invites.data ?? []) {
      const id = normalizeId((row as any)?.quote_id);
      if (id) quoteIds.add(id);
    }
    for (const row of assignedLegacy.data ?? []) {
      const id = normalizeId((row as any)?.id);
      if (id) quoteIds.add(id);
    }
    for (const row of assignedQuoteSuppliers.data ?? []) {
      const id = normalizeId((row as any)?.quote_id);
      if (id) quoteIds.add(id);
    }

    // Best-effort: ignore missing optional tables/columns.
    if (invites.error && !isMissingTableOrColumnError(invites.error)) {
      console.error("[supplier quotes list] quote_invites query failed", {
        supplierId,
        error: serializeSupabaseError(invites.error) ?? invites.error,
      });
    }
    if (assignedLegacy.error && !isMissingTableOrColumnError(assignedLegacy.error)) {
      console.error("[supplier quotes list] assigned_supplier_email query failed", {
        supplierId,
        error: serializeSupabaseError(assignedLegacy.error) ?? assignedLegacy.error,
      });
    }
    if (assignedQuoteSuppliers.error && !isMissingTableOrColumnError(assignedQuoteSuppliers.error)) {
      console.error("[supplier quotes list] quote_suppliers query failed", {
        supplierId,
        error: serializeSupabaseError(assignedQuoteSuppliers.error) ?? assignedQuoteSuppliers.error,
      });
    }
    if (bids.error && !isMissingTableOrColumnError(bids.error)) {
      console.error("[supplier quotes list] supplier_bids query failed", {
        supplierId,
        error: serializeSupabaseError(bids.error) ?? bids.error,
      });
    }
    if (awarded.error && !isMissingTableOrColumnError(awarded.error)) {
      console.error("[supplier quotes list] awarded quotes query failed", {
        supplierId,
        error: serializeSupabaseError(awarded.error) ?? awarded.error,
      });
    }
  } catch (error) {
    console.error("[supplier quotes list] visibility query crashed", {
      supplierId,
      error: serializeSupabaseError(error) ?? error,
    });
    return [];
  }

  const ids = Array.from(quoteIds);
  if (ids.length === 0) return [];

  let quotes: QuoteRow[] = [];
  try {
    const { data, error } = await supabaseServer
      .from("quotes_with_uploads")
      .select(QUOTES_WITH_UPLOADS_COLUMNS)
      .in("id", ids)
      .order("updated_at", { ascending: false })
      .returns<QuoteRow[]>();

    if (error) {
      console.error("[supplier quotes list] quotes_with_uploads query failed", {
        supplierId,
        quoteIdsCount: ids.length,
        error: serializeSupabaseError(error) ?? error,
      });
      return [];
    }

    quotes = (data ?? []) as QuoteRow[];
  } catch (error) {
    console.error("[supplier quotes list] quotes_with_uploads query crashed", {
      supplierId,
      quoteIdsCount: ids.length,
      error: serializeSupabaseError(error) ?? error,
    });
    return [];
  }

  if (quotes.length === 0) return [];

  const quoteIdsList = quotes.map((q) => q.id).filter(Boolean);

  const [bidAggregates, unreadSummary, kickoffCompletedAtByQuoteId, kickoffTotalsByQuoteId, bench] =
    await Promise.all([
      loadSupplierInboxBidAggregates(supplierId, quoteIdsList),
      loadUnreadMessageSummary({ quoteIds: quoteIdsList, userId }),
      loadKickoffCompletedAtByQuoteId(quoteIdsList),
      loadKickoffTotalsForSupplier({ quoteIds: quoteIdsList, supplierId }),
      loadSupplierSelfBenchHealth(supplierId).catch((error) => {
        console.error("[supplier quotes list] bench health load failed", {
          supplierId,
          error: serializeSupabaseError(error) ?? error,
        });
        return null;
      }),
    ]);

  const matchHealth: SupplierQuoteListRow["matchHealth"] =
    bench?.matchHealth ?? "unknown";
  const benchStatus: SupplierQuoteListRow["benchStatus"] =
    bench?.benchStatus ?? "unknown";

  const rows: SupplierQuoteListRow[] = quotes.map((quote) => {
    const quoteId = normalizeId(quote.id);
    const files = buildQuoteFilesFromRow(quote as any);
    const rfqLabel = deriveQuotePrimaryLabel(quote as any, { files });

    const aggregate: SupplierInboxBidAggregate | undefined =
      bidAggregates[quoteId];
    const hasBid = toIntOrZero(aggregate?.bidCount) > 0;

    const awardedSupplierId = normalizeId(quote.awarded_supplier_id);
    const isAwardedToSupplier = Boolean(awardedSupplierId && awardedSupplierId === supplierId);

    const unread = unreadSummary[quoteId]?.unreadCount ?? 0;
    const lastMessageAt = unreadSummary[quoteId]?.lastMessage?.created_at ?? null;
    const lastBidAt = aggregate?.lastBidAt ?? null;

    const kickoffCompletedAt = kickoffCompletedAtByQuoteId.get(quoteId) ?? null;
    const kickoffTotals = kickoffTotalsByQuoteId.get(quoteId) ?? null;
    const kickoffStatus = deriveKickoffStatus({
      awardedToSupplier: isAwardedToSupplier,
      kickoffCompletedAt,
      totals: kickoffTotals,
    });

    const lastActivityAt = maxIsoTimestamp([
      lastMessageAt,
      lastBidAt,
      quote.updated_at,
      quote.awarded_at,
      quote.created_at,
    ]);

    return {
      quoteId,
      rfqLabel,
      status: normalizeQuoteStatus(quote.status),
      hasBid,
      isAwardedToSupplier,
      kickoffStatus,
      bidsCount: null,
      unreadMessagesCount: Math.max(0, Math.floor(unread)),
      lastActivityAt,
      matchHealth,
      benchStatus,
    };
  });

  rows.sort((a, b) => {
    const aKey = a.lastActivityAt ?? "";
    const bKey = b.lastActivityAt ?? "";
    if (aKey === bKey) return a.quoteId.localeCompare(b.quoteId);
    return bKey.localeCompare(aKey);
  });

  return rows;
}

async function loadKickoffCompletedAtByQuoteId(
  quoteIds: string[],
): Promise<Map<string, string | null>> {
  const map = new Map<string, string | null>();
  const ids = Array.from(new Set((quoteIds ?? []).map(normalizeId).filter(Boolean)));
  if (ids.length === 0) return map;

  for (const id of ids) {
    map.set(id, null);
  }

  try {
    const { data, error } = await supabaseServer
      .from("quotes")
      .select("id,kickoff_completed_at")
      .in("id", ids)
      .returns<{ id: string; kickoff_completed_at?: string | null }[]>();

    if (error) {
      if (isMissingTableOrColumnError(error)) return map;
      console.error("[supplier quotes list] kickoff_completed_at query failed", {
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
    if (isMissingTableOrColumnError(error)) return map;
    console.error("[supplier quotes list] kickoff_completed_at query crashed", {
      quoteIdsCount: ids.length,
      error: serializeSupabaseError(error) ?? error,
    });
  }

  return map;
}

async function loadKickoffTotalsForSupplier(args: {
  quoteIds: string[];
  supplierId: string;
}): Promise<Map<string, { total: number; completed: number }>> {
  const map = new Map<string, { total: number; completed: number }>();
  const quoteIds = Array.from(new Set((args.quoteIds ?? []).map(normalizeId).filter(Boolean)));
  const supplierId = normalizeId(args.supplierId);
  if (quoteIds.length === 0 || !supplierId) return map;

  try {
    const { data, error } = await supabaseServer
      .from("quote_kickoff_tasks")
      .select("quote_id,supplier_id,completed")
      .in("quote_id", quoteIds)
      .eq("supplier_id", supplierId)
      .returns<{ quote_id: string; supplier_id: string; completed: boolean | null }[]>();

    if (error) {
      if (isMissingTableOrColumnError(error)) return map;
      console.error("[supplier quotes list] kickoff tasks query failed", {
        quoteIdsCount: quoteIds.length,
        error: serializeSupabaseError(error) ?? error,
      });
      return map;
    }

    for (const row of data ?? []) {
      const quoteId = normalizeId(row.quote_id);
      if (!quoteId) continue;
      const existing = map.get(quoteId) ?? { total: 0, completed: 0 };
      existing.total += 1;
      if (row.completed) {
        existing.completed += 1;
      }
      map.set(quoteId, existing);
    }
  } catch (error) {
    if (isMissingTableOrColumnError(error)) return map;
    console.error("[supplier quotes list] kickoff tasks query crashed", {
      quoteIdsCount: quoteIds.length,
      error: serializeSupabaseError(error) ?? error,
    });
  }

  return map;
}
