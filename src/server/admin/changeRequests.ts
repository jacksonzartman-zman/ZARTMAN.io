import { supabaseServer } from "@/lib/supabaseServer";
import { requireAdminUser } from "@/server/auth";
import { buildQuoteFilesFromRow } from "@/server/quotes/files";
import { deriveQuotePrimaryLabel } from "@/server/quotes/fileSummary";

export type AdminChangeRequestStatusFilter = "open" | "resolved" | "all";

export type AdminChangeRequestRow = {
  id: string;
  quoteId: string;
  changeType: string;
  notes: string;
  status: "open" | "resolved" | (string & {});
  createdAt: string;
  createdByUserId: string | null;
  createdByRole: string;
  resolvedAt: string | null;
  quote: {
    rfqLabel: string;
    customerName: string | null;
    customerEmail: string | null;
  };
};

type QuoteChangeRequestDbRow = {
  id: string;
  quote_id: string;
  change_type: string;
  notes: string;
  status: string;
  created_at: string;
  created_by_user_id: string | null;
  created_by_role: string;
  resolved_at: string | null;
};

type QuoteWithUploadsRow = {
  id: string;
  file_name: string | null;
  company: string | null;
  customer_name: string | null;
  customer_email: string | null;
  upload_id?: string | null;
  upload_name?: string | null;
  file_names?: string[] | null;
  upload_file_names?: string[] | null;
  file_count?: number | null;
  upload_file_count?: number | null;
};

export async function loadAdminChangeRequests(args?: {
  status?: AdminChangeRequestStatusFilter;
  limit?: number;
}): Promise<AdminChangeRequestRow[]> {
  // Defense-in-depth: admin routes are already gated in `src/app/admin/layout.tsx`,
  // but keep this here so service-role backed data can't be queried accidentally.
  await requireAdminUser();

  const status = normalizeStatusFilter(args?.status);
  const limit = normalizeLimit(args?.limit);

  let query = supabaseServer
    .from("quote_change_requests")
    .select(
      "id,quote_id,change_type,notes,status,created_at,created_by_user_id,created_by_role,resolved_at",
    )
    .order("created_at", { ascending: false })
    .limit(limit);

  if (status === "open" || status === "resolved") {
    query = query.eq("status", status);
  }

  const { data, error } = await query.returns<QuoteChangeRequestDbRow[]>();
  if (error) {
    console.error("[admin change-requests inbox] load failed", {
      error,
      status,
      limit,
    });
    return [];
  }

  const rows = Array.isArray(data) ? data : [];
  const quoteIds = Array.from(
    new Set(
      rows
        .map((row) => (typeof row?.quote_id === "string" ? row.quote_id.trim() : ""))
        .filter(Boolean),
    ),
  );

  const quoteById = await loadQuotesById(quoteIds);

  return rows.map((row) => {
    const quoteId = normalizeId(row.quote_id);
    const quote = quoteById.get(quoteId) ?? null;
    const files = quote ? buildQuoteFilesFromRow(quote) : [];
    const rfqLabel = quote ? deriveQuotePrimaryLabel(quote, { files }) : fallbackQuoteLabel(quoteId);

    return {
      id: normalizeId(row.id),
      quoteId,
      changeType: typeof row.change_type === "string" ? row.change_type : "",
      notes: typeof row.notes === "string" ? row.notes : "",
      status: (typeof row.status === "string" ? row.status : "open") as AdminChangeRequestRow["status"],
      createdAt: typeof row.created_at === "string" ? row.created_at : new Date().toISOString(),
      createdByUserId: typeof row.created_by_user_id === "string" ? row.created_by_user_id : null,
      createdByRole: typeof row.created_by_role === "string" ? row.created_by_role : "customer",
      resolvedAt: typeof row.resolved_at === "string" ? row.resolved_at : null,
      quote: {
        rfqLabel,
        customerName: typeof quote?.customer_name === "string" ? quote.customer_name : null,
        customerEmail: typeof quote?.customer_email === "string" ? quote.customer_email : null,
      },
    };
  });
}

async function loadQuotesById(quoteIds: string[]): Promise<Map<string, QuoteWithUploadsRow>> {
  const ids = Array.from(new Set((quoteIds ?? []).map(normalizeId).filter(Boolean)));
  const map = new Map<string, QuoteWithUploadsRow>();
  if (ids.length === 0) return map;

  // Best-effort: quote label + customer info via the stable view.
  const { data, error } = await supabaseServer
    .from("quotes_with_uploads")
    .select(
      "id,file_name,company,customer_name,customer_email,upload_id,upload_name,file_names,upload_file_names,file_count,upload_file_count",
    )
    .in("id", ids)
    .returns<QuoteWithUploadsRow[]>();

  if (error) {
    console.error("[admin change-requests inbox] quotes_with_uploads lookup failed", {
      quoteIdsCount: ids.length,
      error,
    });
    return map;
  }

  for (const row of data ?? []) {
    const id = normalizeId(row.id);
    if (id) {
      map.set(id, row);
    }
  }

  return map;
}

function normalizeStatusFilter(value: unknown): AdminChangeRequestStatusFilter {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (normalized === "open" || normalized === "resolved" || normalized === "all") {
    return normalized;
  }
  return "all";
}

function normalizeLimit(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 100;
  }
  return Math.max(1, Math.min(100, Math.floor(value)));
}

function normalizeId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function fallbackQuoteLabel(quoteId: string): string {
  const id = normalizeId(quoteId);
  if (!id) return "Quote";
  return id.startsWith("Q-") ? id : `Quote ${id.slice(0, 6)}`;
}

