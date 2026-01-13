import { supabaseServer } from "@/lib/supabaseServer";
import { requireAdminUser } from "@/server/auth";
import { schemaGate } from "@/server/db/schemaContract";
import { loadSupplierMismatchSummary } from "@/server/admin/supplierMismatchSummary";

export type AdminSupplierDirectoryStatus = "active" | "paused" | "pending" | "unknown";

export type AdminSupplierDirectoryRow = {
  supplierId: string;
  supplierName: string;
  location: string | null;
  capabilitySummary: string | null;
  lastActivityAt: string | null;
  status: AdminSupplierDirectoryStatus;
  mismatchCount: number | null;
  lastMismatchAt: string | null;
};

type SupplierBaseRow = {
  id: string;
  company_name: string | null;
  primary_email: string | null;
  country: string | null;
  created_at: string | null;
  status?: string | null;
};

type SupplierCapabilityLiteRow = {
  supplier_id: string | null;
  process: string | null;
  materials: string[] | null;
};

type SupplierBidLiteRow = {
  supplier_id: string | null;
  updated_at: string | null;
  created_at: string | null;
};

function normalizeId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeStatus(value: unknown): AdminSupplierDirectoryStatus {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (raw === "paused") return "paused";
  if (raw === "pending") return "pending";
  if (raw === "active") return "active";
  if (raw.length === 0) return "unknown";
  // Unknown statuses default to "active" for admin filtering expectations.
  return "active";
}

function coerceLimit(value: unknown): number {
  const raw = typeof value === "string" ? Number(value) : typeof value === "number" ? value : NaN;
  if (!Number.isFinite(raw)) return 50;
  return Math.max(1, Math.min(200, Math.floor(raw)));
}

function truncateList(values: string[], limit: number): string[] {
  if (values.length <= limit) return values;
  return values.slice(0, limit);
}

function titleCase(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  return trimmed
    .split(/\s+/g)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function buildCapabilitySummary(processes: string[], materials: string[]): string | null {
  const proc = Array.from(new Set(processes.map((p) => p.trim()).filter(Boolean)));
  const mats = Array.from(new Set(materials.map((m) => m.trim()).filter(Boolean)));

  const procLabel = truncateList(proc.map(titleCase), 2);
  const matLabel = truncateList(mats.map(titleCase), 2);

  if (procLabel.length === 0 && matLabel.length === 0) return null;
  if (procLabel.length > 0 && matLabel.length === 0) {
    return proc.length > 2 ? `${procLabel.join(", ")} (+${proc.length - 2})` : procLabel.join(", ");
  }
  if (procLabel.length === 0 && matLabel.length > 0) {
    return mats.length > 2 ? `${matLabel.join(", ")} (+${mats.length - 2})` : matLabel.join(", ");
  }
  const procPart = proc.length > 2 ? `${procLabel.join(", ")} (+${proc.length - 2})` : procLabel.join(", ");
  const matPart = mats.length > 2 ? `${matLabel.join(", ")} (+${mats.length - 2})` : matLabel.join(", ");
  return `${procPart} · ${matPart}`;
}

export async function loadAdminSuppliersDirectory(args?: {
  q?: string | null;
  status?: "all" | "active" | "paused" | "pending" | null;
  cap?: string | null;
  limit?: number | string | null;
}): Promise<AdminSupplierDirectoryRow[]> {
  await requireAdminUser();

  const limit = coerceLimit(args?.limit);
  const q = normalizeText(args?.q) ?? null;
  const cap = normalizeText(args?.cap) ?? null;
  const statusFilter =
    args?.status === "all" || args?.status === "active" || args?.status === "paused" || args?.status === "pending"
      ? args.status
      : "all";

  // Optional status column gate: only needed when filtering for non-default states.
  const canUseStatusColumn = await schemaGate({
    enabled: statusFilter !== "all",
    relation: "suppliers",
    requiredColumns: ["status"],
    warnPrefix: "[admin suppliers]",
    warnKey: "admin_suppliers:suppliers_status_column",
  });

  // Capability filter gate (optional).
  const canUseCapabilities = await schemaGate({
    enabled: Boolean(cap),
    relation: "supplier_capabilities",
    requiredColumns: ["supplier_id", "process"],
    warnPrefix: "[admin suppliers]",
    warnKey: "admin_suppliers:supplier_capabilities_filter",
  });

  let supplierIdsByCapability: string[] | null = null;
  if (cap && canUseCapabilities) {
    try {
      const { data, error } = await supabaseServer
        .from("supplier_capabilities")
        .select("supplier_id,process")
        .ilike("process", `%${cap}%`)
        .limit(500)
        .returns<Array<Pick<SupplierCapabilityLiteRow, "supplier_id">>>();
      if (!error) {
        supplierIdsByCapability = Array.from(
          new Set((data ?? []).map((row) => normalizeId(row?.supplier_id)).filter(Boolean)),
        );
      }
    } catch {
      supplierIdsByCapability = null;
    }
  }

  const selectBase = "id,company_name,primary_email,country,created_at";
  const select = canUseStatusColumn ? `${selectBase},status` : selectBase;

  try {
    let query = supabaseServer.from("suppliers").select(select).returns<SupplierBaseRow[]>();

    if (q) {
      // Keep it simple and schema-stable: name/email search only.
      query = query.or(`company_name.ilike.%${q}%,primary_email.ilike.%${q}%`);
    }

    if (supplierIdsByCapability && supplierIdsByCapability.length === 0) {
      return [];
    }
    if (supplierIdsByCapability && supplierIdsByCapability.length > 0) {
      query = query.in("id", supplierIdsByCapability);
    }

    if (canUseStatusColumn && (statusFilter === "paused" || statusFilter === "pending")) {
      query = query.eq("status", statusFilter);
    }
    if (canUseStatusColumn && statusFilter === "active") {
      // "Active" means "not explicitly paused/pending" (also includes nulls/unknowns).
      query = query.not("status", "in", "(paused,pending)");
    }

    query = query.order("created_at", { ascending: false }).limit(limit);

    const { data, error } = await query;
    if (error) {
      return [];
    }

    const suppliers = Array.isArray(data) ? data : [];
    const supplierIds = suppliers.map((row) => normalizeId(row?.id)).filter(Boolean);

    const [capabilityBySupplierId, lastActivityBySupplierId, mismatchBySupplierId] =
      await Promise.all([
        loadCapabilitySummariesBySupplierIds(supplierIds),
        loadLastActivityBySupplierIds(supplierIds),
        loadSupplierMismatchSummary(supplierIds),
      ]);

    const rows: AdminSupplierDirectoryRow[] = suppliers
      .map((supplier) => {
        const supplierId = normalizeId(supplier?.id);
        if (!supplierId) return null;
        const supplierName =
          normalizeText(supplier?.company_name) ??
          normalizeText(supplier?.primary_email) ??
          supplierId;

        const computedStatus = canUseStatusColumn ? normalizeStatus(supplier?.status) : "active";

        const mismatch = mismatchBySupplierId[supplierId] ?? null;
        return {
          supplierId,
          supplierName,
          location: normalizeText(supplier?.country),
          capabilitySummary: capabilityBySupplierId.get(supplierId) ?? null,
          lastActivityAt: lastActivityBySupplierId.get(supplierId) ?? null,
          status: computedStatus,
          mismatchCount: mismatch ? mismatch.mismatchCount : null,
          lastMismatchAt: mismatch ? mismatch.lastMismatchAt : null,
        };
      })
      .filter((row): row is AdminSupplierDirectoryRow => Boolean(row));

    return rows;
  } catch {
    return [];
  }
}

async function loadCapabilitySummariesBySupplierIds(
  supplierIds: string[],
): Promise<Map<string, string | null>> {
  const ids = Array.from(new Set((supplierIds ?? []).map((id) => normalizeId(id)).filter(Boolean)));
  const map = new Map<string, string | null>();
  if (ids.length === 0) return map;

  const enabled = await schemaGate({
    enabled: true,
    relation: "supplier_capabilities",
    requiredColumns: ["supplier_id", "process"],
    warnPrefix: "[admin suppliers]",
    warnKey: "admin_suppliers:supplier_capabilities_summary",
  });
  if (!enabled) return map;

  try {
    const { data, error } = await supabaseServer
      .from("supplier_capabilities")
      .select("supplier_id,process,materials")
      .in("supplier_id", ids)
      .order("created_at", { ascending: true })
      .limit(2000)
      .returns<SupplierCapabilityLiteRow[]>();

    if (error) return map;

    const processesBySupplier = new Map<string, string[]>();
    const materialsBySupplier = new Map<string, string[]>();

    for (const row of data ?? []) {
      const supplierId = normalizeId(row?.supplier_id);
      if (!supplierId) continue;

      const process = normalizeText(row?.process);
      if (process) {
        const list = processesBySupplier.get(supplierId) ?? [];
        list.push(process);
        processesBySupplier.set(supplierId, list);
      }

      const mats = Array.isArray(row?.materials) ? row.materials : [];
      if (mats.length > 0) {
        const list = materialsBySupplier.get(supplierId) ?? [];
        mats.forEach((m) => {
          const normalized = normalizeText(m);
          if (normalized) list.push(normalized);
        });
        materialsBySupplier.set(supplierId, list);
      }
    }

    for (const id of ids) {
      const proc = processesBySupplier.get(id) ?? [];
      const mats = materialsBySupplier.get(id) ?? [];
      map.set(id, buildCapabilitySummary(proc, mats));
    }

    return map;
  } catch {
    return map;
  }
}

async function loadLastActivityBySupplierIds(
  supplierIds: string[],
): Promise<Map<string, string | null>> {
  const ids = Array.from(new Set((supplierIds ?? []).map((id) => normalizeId(id)).filter(Boolean)));
  const map = new Map<string, string | null>();
  if (ids.length === 0) return map;

  const enabled = await schemaGate({
    enabled: true,
    relation: "supplier_bids",
    requiredColumns: ["supplier_id", "updated_at", "created_at"],
    warnPrefix: "[admin suppliers]",
    warnKey: "admin_suppliers:supplier_bids_last_activity",
  });
  if (!enabled) return map;

  try {
    const { data, error } = await supabaseServer
      .from("supplier_bids")
      .select("supplier_id,updated_at,created_at")
      .in("supplier_id", ids)
      .order("updated_at", { ascending: false })
      // Best-effort scan: enough rows to find a recent touch per supplier.
      .limit(Math.min(2000, ids.length * 20))
      .returns<SupplierBidLiteRow[]>();

    if (error) return map;

    for (const row of data ?? []) {
      const supplierId = normalizeId(row?.supplier_id);
      if (!supplierId) continue;
      if (map.has(supplierId)) continue;
      const ts = normalizeText(row?.updated_at) ?? normalizeText(row?.created_at);
      map.set(supplierId, ts);
    }

    return map;
  } catch {
    return map;
  }
}

