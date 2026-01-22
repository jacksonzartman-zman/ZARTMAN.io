import { supabaseServer } from "@/lib/supabaseServer";
import {
  isMissingTableOrColumnError,
  serializeSupabaseError,
} from "@/server/admin/logging";

type AwardedProjectQuoteRow = {
  id: string;
  status: string | null;
  awarded_at: string | null;
  awarded_supplier_id: string | null;
  customer_id?: string | null;
  upload_id?: string | null;
  kickoff_completed_at?: string | null;
  created_at?: string | null;
};

type UploadRow = {
  id: string;
  file_name?: string | null;
  original_filename?: string | null;
  created_at?: string | null;
};

type CustomerRow = {
  id: string;
  company_name?: string | null;
  email?: string | null;
};

export type SupplierProjectKickoffSummary = {
  totalTasks: number;
  completedTasks: number;
  isComplete: boolean;
};

export type SupplierAwardedProjectQuote = {
  id: string;
  status: string | null;
  awardedAt: string | null;
  projectName: string;
  customerName: string | null;
  kickoff: SupplierProjectKickoffSummary;
};

function normalizeId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function toWonStatusCandidates(): string[] {
  // Some environments used "win" historically; "won" is canonical.
  return ["won", "win"];
}

function emptyKickoffSummary(): SupplierProjectKickoffSummary {
  return { totalTasks: 0, completedTasks: 0, isComplete: false };
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
    return fileLabel;
  }

  const id = normalizeId(row.id);
  const shortId = id ? id.slice(0, 6) : "—";
  return `Search request ${shortId}`;
}

function deriveCustomerName(
  row: AwardedProjectQuoteRow,
  customerById: Map<string, CustomerRow>,
): string | null {
  const customerId = normalizeId(row.customer_id);
  const customer = customerId ? customerById.get(customerId) ?? null : null;
  const label =
    (typeof customer?.company_name === "string" ? customer.company_name.trim() : "") ||
    (typeof customer?.email === "string" ? customer.email.trim() : "") ||
    "";

  if (label) {
    return label;
  }

  return null;
}

export async function getSupplierAwardedQuotesForProjects({
  supplierId,
}: {
  supplierId: string;
}): Promise<SupplierAwardedProjectQuote[]> {
  const normalizedSupplierId = normalizeId(supplierId);
  if (!normalizedSupplierId) {
    return [];
  }

  const quoteTable = "quotes";
  const quoteSelect =
    "id,status,awarded_at,awarded_supplier_id,customer_id,upload_id,kickoff_completed_at,created_at";

  const { data: rows, error } = await supabaseServer
    .from(quoteTable)
    .select(quoteSelect)
    .eq("awarded_supplier_id", normalizedSupplierId)
    .in("status", toWonStatusCandidates())
    .not("awarded_at", "is", null)
    .order("awarded_at", { ascending: false })
    .returns<AwardedProjectQuoteRow[]>();

  if (error) {
    console.error("[supplier projects] quote query failed", {
      supplierId: normalizedSupplierId,
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
  const customerIds = Array.from(
    new Set(quotes.map((q) => normalizeId(q.customer_id)).filter(Boolean)),
  );

  const quoteIdsForKickoff = quotes
    .filter(
      (quote) =>
        !(typeof quote.kickoff_completed_at === "string" &&
          quote.kickoff_completed_at.trim().length > 0),
    )
    .map((quote) => quote.id);

  const [uploadById, customerById, kickoffByQuoteId] = await Promise.all([
    loadUploadMap(uploadIds),
    loadCustomerMap(customerIds),
    loadKickoffSummaryMap({
      quoteIds: quoteIdsForKickoff,
      supplierId: normalizedSupplierId,
    }),
  ]);

  return quotes.map((quote) => {
    const kickoffCompleteFromQuote =
      typeof quote.kickoff_completed_at === "string" &&
      quote.kickoff_completed_at.trim().length > 0;

    const kickoffBase = kickoffByQuoteId.get(quote.id) ?? emptyKickoffSummary();
    const kickoff = kickoffCompleteFromQuote
      ? { ...kickoffBase, isComplete: true }
      : kickoffBase;

    return {
      id: quote.id,
      status: quote.status ?? null,
      awardedAt: quote.awarded_at ?? null,
      projectName: deriveProjectName(quote, uploadById),
      customerName: deriveCustomerName(quote, customerById),
      kickoff,
    };
  });
}

async function loadUploadMap(uploadIds: string[]): Promise<Map<string, UploadRow>> {
  const map = new Map<string, UploadRow>();
  if (uploadIds.length === 0) {
    return map;
  }

  try {
    const { data, error } = await supabaseServer
      .from("uploads")
      .select("id,file_name,original_filename,created_at")
      .in("id", uploadIds)
      .returns<UploadRow[]>();

    if (error) {
      if (isMissingTableOrColumnError(error)) {
        return map;
      }
      console.error("[supplier projects] upload batch query failed", {
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
    console.error("[supplier projects] upload lookup crashed", {
      error: serializeSupabaseError(err) ?? err,
    });
  }

  return map;
}

async function loadCustomerMap(
  customerIds: string[],
): Promise<Map<string, CustomerRow>> {
  const map = new Map<string, CustomerRow>();
  if (customerIds.length === 0) {
    return map;
  }

  try {
    const { data, error } = await supabaseServer
      .from("customers")
      .select("id,company_name,email")
      .in("id", customerIds)
      .returns<CustomerRow[]>();

    if (error) {
      if (isMissingTableOrColumnError(error)) {
        return map;
      }
      console.error("[supplier projects] customer batch query failed", {
        customerIdsCount: customerIds.length,
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
    console.error("[supplier projects] customer lookup crashed", {
      error: serializeSupabaseError(err) ?? err,
    });
  }

  return map;
}

async function loadKickoffSummaryMap({
  quoteIds,
  supplierId,
}: {
  quoteIds: string[];
  supplierId: string;
}): Promise<Map<string, SupplierProjectKickoffSummary>> {
  const map = new Map<string, SupplierProjectKickoffSummary>();
  if (quoteIds.length === 0 || !supplierId) {
    return map;
  }

  try {
    const { data, error } = await supabaseServer
      .from("quote_kickoff_tasks")
      .select("quote_id,completed")
      .eq("supplier_id", supplierId)
      .in("quote_id", quoteIds)
      .returns<{ quote_id: string; completed: boolean | null }[]>();

    if (error) {
      if (isMissingTableOrColumnError(error)) {
        return map;
      }
      console.error("[supplier projects] kickoff tasks query failed", {
        quoteIdsCount: quoteIds.length,
        supplierId,
        error: serializeSupabaseError(error),
      });
      return map;
    }

    const totals = new Map<string, { total: number; completed: number }>();
    for (const task of data ?? []) {
      const quoteId = normalizeId(task.quote_id);
      if (!quoteId) continue;
      const existing = totals.get(quoteId) ?? { total: 0, completed: 0 };
      existing.total += 1;
      if (task.completed) {
        existing.completed += 1;
      }
      totals.set(quoteId, existing);
    }

    for (const [quoteId, value] of totals) {
      const isComplete = value.total > 0 && value.completed >= value.total;
      map.set(quoteId, {
        totalTasks: value.total,
        completedTasks: value.completed,
        isComplete,
      });
    }

    return map;
  } catch (err) {
    if (isMissingTableOrColumnError(err)) {
      return map;
    }
    console.error("[supplier projects] kickoff aggregation crashed", {
      error: serializeSupabaseError(err) ?? err,
    });
    return map;
  }
}
