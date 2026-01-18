import { supabaseServer } from "@/lib/supabaseServer";
import { schemaGate } from "@/server/db/schemaContract";
import {
  handleMissingSupabaseSchema,
  isMissingColumnError,
  isMissingSupabaseRelationError,
} from "@/server/db/schemaErrors";

const SUPPLIERS_TABLE = "suppliers";
const SUPPLIER_COLUMNS = ["id", "company_name", "country"] as const;
const SUPPLIER_SELECT = SUPPLIER_COLUMNS.join(",");

const CAPABILITIES_TABLE = "supplier_capabilities";
const CAPABILITY_COLUMNS = ["supplier_id", "process", "materials", "certifications"] as const;
const CAPABILITY_SELECT = CAPABILITY_COLUMNS.join(",");

const UUID_REGEX = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

type SupplierRowLite = {
  id: string;
  company_name: string | null;
  country: string | null;
};

type SupplierCapabilityLiteRow = {
  supplier_id: string | null;
  process: string | null;
  materials: string[] | null;
  certifications: string[] | null;
};

export type PublicSupplierDirectoryRow = {
  supplierId: string;
  supplierName: string;
  location: string | null;
  processes: string[];
  materials: string[];
  certifications: string[];
  slug: string;
};

type CapabilitySummary = {
  processes: string[];
  materials: string[];
  certifications: string[];
};

function normalizeId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeList(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return values
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter((value) => value.length > 0);
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function buildSupplierSlug(args: { supplierId: string; supplierName: string }): string {
  const base = slugify(args.supplierName) || "supplier";
  const id = normalizeId(args.supplierId);
  return id ? `${base}-${id}` : base;
}

export function extractSupplierIdFromSlug(slug: string): string {
  const normalized = normalizeText(slug) ?? "";
  if (!normalized) return "";
  const matches = normalized.match(UUID_REGEX);
  return matches?.[matches.length - 1] ?? "";
}

function buildSupplierName(row: SupplierRowLite): string {
  return normalizeText(row.company_name) ?? `Supplier ${normalizeId(row.id).slice(0, 6)}`;
}

function buildCapabilityMap(rows: SupplierCapabilityLiteRow[]): Map<string, CapabilitySummary> {
  const map = new Map<string, CapabilitySummary>();

  for (const row of rows ?? []) {
    const supplierId = normalizeId(row?.supplier_id);
    if (!supplierId) continue;

    const current = map.get(supplierId) ?? { processes: [], materials: [], certifications: [] };
    const process = normalizeText(row?.process);
    if (process) current.processes.push(process);

    normalizeList(row?.materials).forEach((material) => current.materials.push(material));
    normalizeList(row?.certifications).forEach((cert) => current.certifications.push(cert));

    map.set(supplierId, current);
  }

  for (const [supplierId, summary] of map) {
    const processes = Array.from(new Set(summary.processes)).sort((a, b) => a.localeCompare(b));
    const materials = Array.from(new Set(summary.materials)).sort((a, b) => a.localeCompare(b));
    const certifications = Array.from(new Set(summary.certifications)).sort((a, b) => a.localeCompare(b));
    map.set(supplierId, { processes, materials, certifications });
  }

  return map;
}

async function loadCapabilitySummariesBySupplierIds(
  supplierIds: string[],
): Promise<Map<string, CapabilitySummary>> {
  const ids = Array.from(new Set((supplierIds ?? []).map((id) => normalizeId(id)).filter(Boolean)));
  if (ids.length === 0) return new Map();

  const supported = await schemaGate({
    enabled: true,
    relation: CAPABILITIES_TABLE,
    requiredColumns: [...CAPABILITY_COLUMNS],
    warnPrefix: "[public suppliers]",
    warnKey: "public_suppliers:supplier_capabilities",
  });
  if (!supported) return new Map();

  try {
    const { data, error } = await supabaseServer
      .from(CAPABILITIES_TABLE)
      .select(CAPABILITY_SELECT)
      .in("supplier_id", ids)
      .order("created_at", { ascending: true })
      .limit(2000)
      .returns<SupplierCapabilityLiteRow[]>();
    if (error) return new Map();

    return buildCapabilityMap(Array.isArray(data) ? data : []);
  } catch {
    return new Map();
  }
}

export async function loadPublicSuppliersDirectory(): Promise<PublicSupplierDirectoryRow[]> {
  const supported = await schemaGate({
    enabled: true,
    relation: SUPPLIERS_TABLE,
    requiredColumns: [...SUPPLIER_COLUMNS],
    warnPrefix: "[public suppliers]",
    warnKey: "public_suppliers:directory",
  });
  if (!supported) return [];

  try {
    const buildQuery = (withVerified: boolean) => {
      let query = supabaseServer.from(SUPPLIERS_TABLE).select(SUPPLIER_SELECT);
      if (withVerified) {
        query = query.eq("verified", true);
      }
      return query.order("company_name", { ascending: true }).limit(200);
    };

    let data: SupplierRowLite[] | null = null;
    let error: unknown = null;

    ({ data, error } = await buildQuery(true).returns<SupplierRowLite[]>());

    if (error && isMissingColumnError(error, "verified")) {
      ({ data, error } = await buildQuery(false).returns<SupplierRowLite[]>());
    }

    if (error) {
      if (isMissingSupabaseRelationError(error)) {
        handleMissingSupabaseSchema({
          relation: SUPPLIERS_TABLE,
          error,
          warnPrefix: "[public suppliers]",
          warnKey: "public_suppliers:directory_missing_relation",
        });
      }
      return [];
    }

    const suppliers = Array.isArray(data) ? data : [];
    const supplierIds = suppliers.map((row) => normalizeId(row?.id)).filter(Boolean);
    const capabilityMap = await loadCapabilitySummariesBySupplierIds(supplierIds);

    return suppliers
      .map((supplier) => {
        const supplierId = normalizeId(supplier?.id);
        if (!supplierId) return null;
        const supplierName = buildSupplierName(supplier);
        const capabilities = capabilityMap.get(supplierId) ?? {
          processes: [],
          materials: [],
          certifications: [],
        };
        return {
          supplierId,
          supplierName,
          location: normalizeText(supplier?.country),
          processes: capabilities.processes,
          materials: capabilities.materials,
          certifications: capabilities.certifications,
          slug: buildSupplierSlug({ supplierId, supplierName }),
        };
      })
      .filter((row): row is PublicSupplierDirectoryRow => Boolean(row));
  } catch {
    return [];
  }
}

export async function loadPublicSupplierById(
  supplierId: string,
): Promise<PublicSupplierDirectoryRow | null> {
  const normalizedId = normalizeId(supplierId);
  if (!normalizedId) return null;

  const supported = await schemaGate({
    enabled: true,
    relation: SUPPLIERS_TABLE,
    requiredColumns: [...SUPPLIER_COLUMNS],
    warnPrefix: "[public suppliers]",
    warnKey: "public_suppliers:detail",
  });
  if (!supported) return null;

  try {
    const buildQuery = (withVerified: boolean) => {
      let query = supabaseServer.from(SUPPLIERS_TABLE).select(SUPPLIER_SELECT).eq("id", normalizedId);
      if (withVerified) {
        query = query.eq("verified", true);
      }
      return query.maybeSingle<SupplierRowLite>();
    };

    let data: SupplierRowLite | null = null;
    let error: unknown = null;

    ({ data, error } = await buildQuery(true));

    if (error && isMissingColumnError(error, "verified")) {
      ({ data, error } = await buildQuery(false));
    }

    if (error || !data) {
      if (error && isMissingSupabaseRelationError(error)) {
        handleMissingSupabaseSchema({
          relation: SUPPLIERS_TABLE,
          error,
          warnPrefix: "[public suppliers]",
          warnKey: "public_suppliers:detail_missing_relation",
        });
      }
      return null;
    }

    const capabilityMap = await loadCapabilitySummariesBySupplierIds([normalizedId]);
    const supplierName = buildSupplierName(data);
    const capabilities = capabilityMap.get(normalizedId) ?? {
      processes: [],
      materials: [],
      certifications: [],
    };

    return {
      supplierId: normalizedId,
      supplierName,
      location: normalizeText(data?.country),
      processes: capabilities.processes,
      materials: capabilities.materials,
      certifications: capabilities.certifications,
      slug: buildSupplierSlug({ supplierId: normalizedId, supplierName }),
    };
  } catch {
    return null;
  }
}
