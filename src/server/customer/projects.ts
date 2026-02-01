import { supabaseServer } from "@/lib/supabaseServer";
import {
  isMissingTableOrColumnError,
  serializeSupabaseError,
} from "@/server/admin/logging";
import { CUSTOMER_VISIBLE_TIMELINE_EVENT_TYPES } from "@/server/quotes/events";
import { loadKickoffProgressRollupsByQuoteId } from "@/server/quotes/kickoffTasks";

type AwardedProjectQuoteRow = {
  id: string;
  status: string | null;
  awarded_at: string | null;
  awarded_supplier_id: string | null;
  kickoff_completed_at?: string | null;
  upload_id?: string | null;
  created_at?: string | null;
};

type UploadRow = {
  id: string;
  file_name?: string | null;
  original_filename?: string | null;
  created_at?: string | null;
};

export type CustomerProjectKickoffSummary = {
  totalTasks: number;
  completedTasks: number;
  isComplete: boolean;
};

export type CustomerAwardedProjectQuote = {
  id: string;
  status: string | null;
  awardedAt: string | null;
  awardedSupplierId: string | null;
  projectName: string;
  supplierName: string | null;
  kickoff: CustomerProjectKickoffSummary;
  kickoffCompletedAt: string | null;
  lastUpdatedAt: string | null;
};

function normalizeId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function toWonStatusCandidates(): string[] {
  // Some environments used "win" historically; "won" is canonical.
  return ["won", "win"];
}

function deriveProjectName(
  row: AwardedProjectQuoteRow,
  uploadById: Map<string, UploadRow>,
): string {
  const uploadId = normalizeId(row.upload_id);
  const upload = uploadId ? uploadById.get(uploadId) ?? null : null;
  const fileLabel =
    (typeof upload?.original_filename === "string"
      ? upload.original_filename.trim()
      : "") ||
    (typeof upload?.file_name === "string" ? upload.file_name.trim() : "") ||
    "";

  if (fileLabel) {
    return `Search request: ${fileLabel}`;
  }

  const id = normalizeId(row.id);
  const shortId = id ? id.slice(0, 6) : "—";
  return `Search request ${shortId}`;
}

function emptyKickoffSummary(): CustomerProjectKickoffSummary {
  return { totalTasks: 0, completedTasks: 0, isComplete: false };
}

export async function getCustomerAwardedQuotesForProjects({
  customerId,
}: {
  customerId: string;
}): Promise<CustomerAwardedProjectQuote[]> {
  const normalizedCustomerId = normalizeId(customerId);
  if (!normalizedCustomerId) {
    return [];
  }

  const quoteTable = "quotes";
  const quoteSelect =
    "id,status,awarded_at,awarded_supplier_id,kickoff_completed_at,upload_id,created_at";

  const { data: rows, error } = await supabaseServer()
    .from(quoteTable)
    .select(quoteSelect)
    .eq("customer_id", normalizedCustomerId)
    .in("status", toWonStatusCandidates())
    .not("awarded_supplier_id", "is", null)
    .not("awarded_at", "is", null)
    .order("awarded_at", { ascending: false })
    .returns<AwardedProjectQuoteRow[]>();

  if (error) {
    console.error("[customer projects] quote query failed", {
      customerId: normalizedCustomerId,
      table: quoteTable,
      select: quoteSelect,
      error: serializeSupabaseError(error),
    });
    return [];
  }

  const quotes = Array.isArray(rows) ? rows : [];
  if (quotes.length === 0) {
    return [];
  }

  const uploadIds = Array.from(
    new Set(quotes.map((q) => normalizeId(q.upload_id)).filter(Boolean)),
  );
  const uploadById = await loadUploadMap(uploadIds);

  const quoteIds = quotes.map((quote) => quote.id);
  const supplierIds = Array.from(
    new Set(
      quotes
        .map((quote) => normalizeId(quote.awarded_supplier_id))
        .filter(Boolean),
    ),
  );

  const awardedByQuoteId = buildAwardedSupplierMap(quotes);
  const [supplierMap, kickoffByQuoteId] = await Promise.all([
    loadSupplierNameMap(supplierIds),
    loadKickoffRollupsByQuoteId({
      quoteIds,
      awardedSupplierByQuoteId: awardedByQuoteId,
    }),
  ]);

  const lastEventByQuoteId = await loadLastCustomerVisibleEventAtByQuoteId(quoteIds);

  return quotes.map((quote) => {
    const awardedSupplierId = normalizeId(quote.awarded_supplier_id) || null;
    const supplierName = awardedSupplierId
      ? supplierMap.get(awardedSupplierId) ?? awardedSupplierId
      : null;
    const kickoffBase = kickoffByQuoteId.get(quote.id) ?? emptyKickoffSummary();
    const kickoffCompleteFromQuote =
      typeof quote.kickoff_completed_at === "string" &&
      quote.kickoff_completed_at.trim().length > 0;
    const kickoff = kickoffCompleteFromQuote
      ? { ...kickoffBase, isComplete: true }
      : kickoffBase;
    const lastEventAt = lastEventByQuoteId.get(quote.id) ?? null;
    const lastUpdatedAt = lastEventAt ?? (quote.awarded_at ?? null);

    return {
      id: quote.id,
      status: quote.status ?? null,
      awardedAt: quote.awarded_at ?? null,
      awardedSupplierId,
      projectName: deriveProjectName(quote, uploadById),
      supplierName,
      kickoff,
      kickoffCompletedAt: kickoffCompleteFromQuote ? (quote.kickoff_completed_at ?? null) : null,
      lastUpdatedAt,
    };
  });
}

function buildAwardedSupplierMap(
  quotes: AwardedProjectQuoteRow[],
): Map<string, string> {
  const map = new Map<string, string>();
  for (const quote of quotes) {
    const supplierId = normalizeId(quote.awarded_supplier_id);
    if (supplierId) {
      map.set(quote.id, supplierId);
    }
  }
  return map;
}

async function loadSupplierNameMap(
  supplierIds: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (supplierIds.length === 0) {
    return map;
  }

  const { data, error } = await supabaseServer()
    .from("suppliers")
    .select("id,company_name,primary_email")
    .in("id", supplierIds)
    .returns<{ id: string; company_name: string | null; primary_email: string | null }[]>();

  if (error) {
    console.error("[customer projects] supplier batch query failed", {
      supplierIdsCount: supplierIds.length,
      error: serializeSupabaseError(error),
    });
    return map;
  }

  for (const row of data ?? []) {
    const id = normalizeId(row.id);
    if (!id) continue;
    const name =
      row.company_name?.trim() ||
      row.primary_email?.trim() ||
      null;
    if (name) {
      map.set(id, name);
    }
  }

  return map;
}

async function loadKickoffRollupsByQuoteId({
  quoteIds,
  awardedSupplierByQuoteId,
}: {
  quoteIds: string[];
  awardedSupplierByQuoteId: Map<string, string>;
}): Promise<Map<string, CustomerProjectKickoffSummary>> {
  const map = new Map<string, CustomerProjectKickoffSummary>();
  if (quoteIds.length === 0) {
    return map;
  }

  const rollups = await loadKickoffProgressRollupsByQuoteId({
    quoteIds,
    awardedSupplierByQuoteId,
  });

  for (const quoteId of quoteIds) {
    const normalizedQuoteId = normalizeId(quoteId);
    if (!normalizedQuoteId) continue;
    const r = rollups.get(normalizedQuoteId);
    if (!r) continue;
    map.set(normalizedQuoteId, {
      totalTasks: r.totalTasks,
      completedTasks: r.completedTasks,
      isComplete: r.isComplete,
    });
  }

  return map;
}

async function loadUploadMap(uploadIds: string[]): Promise<Map<string, UploadRow>> {
  const map = new Map<string, UploadRow>();
  if (uploadIds.length === 0) {
    return map;
  }

  try {
    const { data, error } = await supabaseServer()
      .from("uploads")
      .select("id,file_name,original_filename,created_at")
      .in("id", uploadIds)
      .returns<UploadRow[]>();

    if (error) {
      if (isMissingTableOrColumnError(error)) {
        return map;
      }
      console.error("[customer projects] upload batch query failed", {
        uploadIdsCount: uploadIds.length,
        error: serializeSupabaseError(error),
      });
      return map;
    }

    for (const row of data ?? []) {
      const id = normalizeId(row.id);
      if (!id) continue;
      map.set(id, row);
    }
  } catch (err) {
    if (isMissingTableOrColumnError(err)) {
      return map;
    }
    console.error("[customer projects] upload lookup crashed", {
      error: serializeSupabaseError(err) ?? err,
    });
  }

  return map;
}

async function loadLastCustomerVisibleEventAtByQuoteId(
  quoteIds: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (quoteIds.length === 0) {
    return map;
  }

  try {
    const { data, error } = await supabaseServer()
      .from("quote_events")
      .select("quote_id,event_type,created_at")
      .in("quote_id", quoteIds)
      .in("event_type", Array.from(CUSTOMER_VISIBLE_TIMELINE_EVENT_TYPES))
      .order("created_at", { ascending: false })
      .returns<{ quote_id: string; event_type: string; created_at: string }[]>();

    if (error) {
      if (isMissingTableOrColumnError(error)) {
        return map;
      }
      console.error("[customer projects] quote events batch query failed", {
        quoteIdsCount: quoteIds.length,
        error: serializeSupabaseError(error),
      });
      return map;
    }

    for (const row of data ?? []) {
      const quoteId = normalizeId(row.quote_id);
      const createdAt = typeof row.created_at === "string" ? row.created_at : "";
      if (!quoteId || !createdAt) continue;
      // Rows are sorted desc, so first seen is max(created_at).
      if (!map.has(quoteId)) {
        map.set(quoteId, createdAt);
      }
    }
  } catch (err) {
    if (isMissingTableOrColumnError(err)) {
      return map;
    }
    console.error("[customer projects] quote events lookup crashed", {
      error: serializeSupabaseError(err) ?? err,
    });
  }

  return map;
}

