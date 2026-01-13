import { supabaseServer } from "@/lib/supabaseServer";
import { requireAdminUser } from "@/server/auth";
import { schemaGate } from "@/server/db/schemaContract";
import { loadSupplierMismatchSummary, type SupplierMismatchSummary } from "./supplierMismatchSummary";

export type AdminSupplierDetail = {
  supplierId: string;
  supplierName: string;
  location: string | null;
  primaryEmail: string | null;
  createdAt: string | null;
  capabilities: {
    processes: string[];
    materials: string[];
    certifications: string[];
    notes: string | null;
  } | null;
  recentActivity: {
    quoteId: string | null;
    bidId: string;
    status: string | null;
    updatedAt: string | null;
    createdAt: string | null;
    quoteTitle: string | null;
  }[];
  mismatchSummary: SupplierMismatchSummary | null;
};

type SupplierRowLite = {
  id: string;
  company_name: string | null;
  primary_email: string | null;
  country: string | null;
  created_at: string | null;
};

type SupplierCapabilityRowLite = {
  process: string | null;
  materials: string[] | null;
  certifications: string[] | null;
};

type SupplierBidRowLite = {
  id: string;
  quote_id: string | null;
  status: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type QuoteLite = {
  id: string;
  file_name: string | null;
  company: string | null;
};

function normalizeId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function titleFromQuote(quote: QuoteLite | null, quoteId: string | null): string | null {
  const file = normalizeText(quote?.file_name);
  if (file) return file;
  const company = normalizeText(quote?.company);
  if (company) return company;
  const id = normalizeId(quoteId);
  return id ? `Quote ${id.slice(0, 6)}` : null;
}

export async function loadAdminSupplierDetail(args: {
  supplierId: string;
}): Promise<AdminSupplierDetail | null> {
  await requireAdminUser();

  const supplierId = normalizeId(args?.supplierId);
  if (!supplierId) return null;

  const supplier = await loadSupplierLite(supplierId);
  if (!supplier) return null;

  const [capabilities, recentActivity, mismatchSummary] = await Promise.all([
    loadCapabilitiesSnapshot(supplierId),
    loadRecentSupplierBidActivity(supplierId),
    loadSupplierMismatchSummary([supplierId]).then((map) => map[supplierId] ?? null),
  ]);

  return {
    supplierId,
    supplierName:
      normalizeText(supplier.company_name) ??
      normalizeText(supplier.primary_email) ??
      supplierId,
    location: normalizeText(supplier.country),
    primaryEmail: normalizeText(supplier.primary_email),
    createdAt: normalizeText(supplier.created_at),
    capabilities,
    recentActivity,
    mismatchSummary,
  };
}

async function loadSupplierLite(supplierId: string): Promise<SupplierRowLite | null> {
  try {
    const { data, error } = await supabaseServer
      .from("suppliers")
      .select("id,company_name,primary_email,country,created_at")
      .eq("id", supplierId)
      .maybeSingle<SupplierRowLite>();
    if (error) return null;
    return data ?? null;
  } catch {
    return null;
  }
}

async function loadCapabilitiesSnapshot(
  supplierId: string,
): Promise<AdminSupplierDetail["capabilities"]> {
  const enabled = await schemaGate({
    enabled: true,
    relation: "supplier_capabilities",
    requiredColumns: ["supplier_id", "process"],
    warnPrefix: "[admin suppliers]",
    warnKey: "admin_suppliers:supplier_capabilities_detail",
  });
  if (!enabled) return null;

  try {
    const { data, error } = await supabaseServer
      .from("supplier_capabilities")
      .select("process,materials,certifications")
      .eq("supplier_id", supplierId)
      .order("created_at", { ascending: true })
      .limit(200)
      .returns<SupplierCapabilityRowLite[]>();
    if (error) return null;

    const processes = new Set<string>();
    const materials = new Set<string>();
    const certifications = new Set<string>();

    for (const row of data ?? []) {
      const process = normalizeText(row?.process);
      if (process) processes.add(process);
      (row?.materials ?? []).forEach((m) => {
        const val = normalizeText(m);
        if (val) materials.add(val);
      });
      (row?.certifications ?? []).forEach((c) => {
        const val = normalizeText(c);
        if (val) certifications.add(val);
      });
    }

    const notes =
      data && data.length > 0
        ? null
        : null;

    return {
      processes: Array.from(processes.values()).sort((a, b) => a.localeCompare(b)),
      materials: Array.from(materials.values()).sort((a, b) => a.localeCompare(b)),
      certifications: Array.from(certifications.values()).sort((a, b) => a.localeCompare(b)),
      notes,
    };
  } catch {
    return null;
  }
}

async function loadRecentSupplierBidActivity(
  supplierId: string,
): Promise<AdminSupplierDetail["recentActivity"]> {
  const enabled = await schemaGate({
    enabled: true,
    relation: "supplier_bids",
    requiredColumns: ["supplier_id", "quote_id", "id", "updated_at", "created_at"],
    warnPrefix: "[admin suppliers]",
    warnKey: "admin_suppliers:supplier_bids_recent_activity",
  });
  if (!enabled) return [];

  try {
    const { data: bids, error } = await supabaseServer
      .from("supplier_bids")
      .select("id,quote_id,status,created_at,updated_at")
      .eq("supplier_id", supplierId)
      .order("updated_at", { ascending: false })
      .limit(10)
      .returns<SupplierBidRowLite[]>();
    if (error) return [];

    const normalizedBids = (bids ?? [])
      .map((bid) => ({ ...bid, id: normalizeId(bid?.id), quote_id: normalizeText(bid?.quote_id) }))
      .filter((bid) => bid.id.length > 0);

    const quoteIds = Array.from(new Set(normalizedBids.map((b) => normalizeId(b.quote_id)).filter(Boolean)));
    const quoteById = await loadQuotesLiteByIds(quoteIds);

    return normalizedBids.map((bid) => {
      const quoteId = bid.quote_id;
      const quote = quoteId ? quoteById.get(quoteId) ?? null : null;
      return {
        bidId: bid.id,
        quoteId,
        status: normalizeText(bid.status),
        createdAt: normalizeText(bid.created_at),
        updatedAt: normalizeText(bid.updated_at),
        quoteTitle: titleFromQuote(quote, quoteId),
      };
    });
  } catch {
    return [];
  }
}

async function loadQuotesLiteByIds(quoteIds: string[]): Promise<Map<string, QuoteLite>> {
  const ids = Array.from(new Set((quoteIds ?? []).map((id) => normalizeId(id)).filter(Boolean)));
  const map = new Map<string, QuoteLite>();
  if (ids.length === 0) return map;

  const enabled = await schemaGate({
    enabled: true,
    relation: "quotes_with_uploads",
    requiredColumns: ["id"],
    warnPrefix: "[admin suppliers]",
    warnKey: "admin_suppliers:quotes_with_uploads",
  });
  if (!enabled) return map;

  try {
    const { data, error } = await supabaseServer
      .from("quotes_with_uploads")
      .select("id,file_name,company")
      .in("id", ids)
      .returns<QuoteLite[]>();
    if (error) return map;
    for (const row of data ?? []) {
      const id = normalizeId(row?.id);
      if (!id) continue;
      map.set(id, row);
    }
    return map;
  } catch {
    return map;
  }
}

