import { SHOW_SUPPLIER_DIRECTORY_PUBLIC } from "@/lib/ui/deprecation";
import { supabaseServer } from "@/lib/supabaseServer";
import { hasColumns, schemaGate } from "@/server/db/schemaContract";
import { handleMissingSupabaseSchema, isMissingSupabaseRelationError } from "@/server/db/schemaErrors";

const PROVIDERS_TABLE = "providers";
const PROVIDER_COLUMNS = ["id", "name"] as const;

const UUID_REGEX = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

type ProviderRowLite = {
  id: string;
  name: string | null;
  country?: string | null;
  processes?: string[] | null;
  materials?: string[] | null;
  verification_status?: string | null;
  is_active?: boolean | null;
  show_in_directory?: boolean | null;
};

export type PublicSupplierDirectoryRow = {
  supplierId: string;
  supplierName: string;
  location: string | null;
  processes: string[];
  materials: string[];
  certifications: string[];
  slug: string;
  isVerified: boolean;
  isActive: boolean;
  showInDirectory: boolean;
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

function buildSupplierName(row: ProviderRowLite): string {
  return normalizeText(row.name) ?? `Supplier ${normalizeId(row.id).slice(0, 6)}`;
}

function normalizeVerificationStatus(value: unknown): "verified" | "unverified" | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "verified") return "verified";
  if (normalized === "unverified") return "unverified";
  return null;
}

function resolveShowInDirectory(row: ProviderRowLite, isVerified: boolean, supported: boolean): boolean {
  if (!supported) return true;
  if (typeof row.show_in_directory === "boolean") return row.show_in_directory;
  return isVerified;
}

function resolveActiveStatus(row: ProviderRowLite, supported: boolean): boolean {
  if (!supported) return true;
  return row.is_active === true;
}

function sortDirectoryRows(a: PublicSupplierDirectoryRow, b: PublicSupplierDirectoryRow): number {
  const rank = (row: PublicSupplierDirectoryRow) => {
    if (row.isVerified) return row.isActive ? 0 : 1;
    return 2;
  };
  const rankDiff = rank(a) - rank(b);
  if (rankDiff !== 0) return rankDiff;
  const nameCompare = a.supplierName.localeCompare(b.supplierName, undefined, { sensitivity: "base" });
  if (nameCompare !== 0) return nameCompare;
  return a.supplierId.localeCompare(b.supplierId);
}

export async function loadPublicSuppliersDirectory(): Promise<PublicSupplierDirectoryRow[]> {
  const supported = await schemaGate({
    enabled: true,
    relation: PROVIDERS_TABLE,
    requiredColumns: [...PROVIDER_COLUMNS],
    warnPrefix: "[public suppliers]",
    warnKey: "public_suppliers:directory",
  });
  if (!supported) return [];

  try {
    const [
      supportsCountry,
      supportsProcesses,
      supportsMaterials,
      supportsVerificationStatus,
      supportsIsActive,
      supportsShowInDirectory,
    ] = await Promise.all([
      hasColumns(PROVIDERS_TABLE, ["country"]),
      hasColumns(PROVIDERS_TABLE, ["processes"]),
      hasColumns(PROVIDERS_TABLE, ["materials"]),
      hasColumns(PROVIDERS_TABLE, ["verification_status"]),
      hasColumns(PROVIDERS_TABLE, ["is_active"]),
      hasColumns(PROVIDERS_TABLE, ["show_in_directory"]),
    ]);

    const selectColumns = [
      ...PROVIDER_COLUMNS,
      ...(supportsCountry ? ["country"] : []),
      ...(supportsProcesses ? ["processes"] : []),
      ...(supportsMaterials ? ["materials"] : []),
      ...(supportsVerificationStatus ? ["verification_status"] : []),
      ...(supportsIsActive ? ["is_active"] : []),
      ...(supportsShowInDirectory ? ["show_in_directory"] : []),
    ];

    let query = supabaseServer.from(PROVIDERS_TABLE).select(selectColumns.join(","));
    if (supportsVerificationStatus && !SHOW_SUPPLIER_DIRECTORY_PUBLIC) {
      query = query.eq("verification_status", "verified");
    }
    query = query.order("name", { ascending: true }).limit(200);

    const { data, error } = await query.returns<ProviderRowLite[]>();

    if (error) {
      if (isMissingSupabaseRelationError(error)) {
        handleMissingSupabaseSchema({
          relation: PROVIDERS_TABLE,
          error,
          warnPrefix: "[public suppliers]",
          warnKey: "public_suppliers:directory_missing_relation",
        });
      }
      return [];
    }

    const providers = Array.isArray(data) ? data : [];
    const rows = providers
      .map((provider) => {
        const supplierId = normalizeId(provider?.id);
        if (!supplierId) return null;
        const supplierName = buildSupplierName(provider);
        const verificationStatus = supportsVerificationStatus
          ? normalizeVerificationStatus(provider?.verification_status) ?? "unverified"
          : "verified";
        const isVerified = verificationStatus === "verified";
        const isActive = resolveActiveStatus(provider, supportsIsActive);
        const showInDirectory = resolveShowInDirectory(
          provider,
          isVerified,
          supportsShowInDirectory,
        );

        if (!showInDirectory) return null;
        if (!SHOW_SUPPLIER_DIRECTORY_PUBLIC && !isVerified) return null;

        return {
          supplierId,
          supplierName,
          location: supportsCountry ? normalizeText(provider?.country) : null,
          processes: supportsProcesses ? normalizeList(provider?.processes) : [],
          materials: supportsMaterials ? normalizeList(provider?.materials) : [],
          certifications: [],
          slug: buildSupplierSlug({ supplierId, supplierName }),
          isVerified,
          isActive,
          showInDirectory,
        };
      })
      .filter((row): row is PublicSupplierDirectoryRow => Boolean(row));

    return rows.sort(sortDirectoryRows);
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
    relation: PROVIDERS_TABLE,
    requiredColumns: [...PROVIDER_COLUMNS],
    warnPrefix: "[public suppliers]",
    warnKey: "public_suppliers:detail",
  });
  if (!supported) return null;

  try {
    const [
      supportsCountry,
      supportsProcesses,
      supportsMaterials,
      supportsVerificationStatus,
      supportsIsActive,
      supportsShowInDirectory,
    ] = await Promise.all([
      hasColumns(PROVIDERS_TABLE, ["country"]),
      hasColumns(PROVIDERS_TABLE, ["processes"]),
      hasColumns(PROVIDERS_TABLE, ["materials"]),
      hasColumns(PROVIDERS_TABLE, ["verification_status"]),
      hasColumns(PROVIDERS_TABLE, ["is_active"]),
      hasColumns(PROVIDERS_TABLE, ["show_in_directory"]),
    ]);

    const selectColumns = [
      ...PROVIDER_COLUMNS,
      ...(supportsCountry ? ["country"] : []),
      ...(supportsProcesses ? ["processes"] : []),
      ...(supportsMaterials ? ["materials"] : []),
      ...(supportsVerificationStatus ? ["verification_status"] : []),
      ...(supportsIsActive ? ["is_active"] : []),
      ...(supportsShowInDirectory ? ["show_in_directory"] : []),
    ];

    const { data, error } = await supabaseServer
      .from(PROVIDERS_TABLE)
      .select(selectColumns.join(","))
      .eq("id", normalizedId)
      .maybeSingle<ProviderRowLite>();

    if (error || !data) {
      if (error && isMissingSupabaseRelationError(error)) {
        handleMissingSupabaseSchema({
          relation: PROVIDERS_TABLE,
          error,
          warnPrefix: "[public suppliers]",
          warnKey: "public_suppliers:detail_missing_relation",
        });
      }
      return null;
    }

    const supplierName = buildSupplierName(data);
    const verificationStatus = supportsVerificationStatus
      ? normalizeVerificationStatus(data?.verification_status) ?? "unverified"
      : "verified";
    const isVerified = verificationStatus === "verified";
    const isActive = resolveActiveStatus(data, supportsIsActive);
    const showInDirectory = resolveShowInDirectory(data, isVerified, supportsShowInDirectory);

    if (!showInDirectory) return null;
    if (!SHOW_SUPPLIER_DIRECTORY_PUBLIC && !isVerified) return null;

    return {
      supplierId: normalizedId,
      supplierName,
      location: supportsCountry ? normalizeText(data?.country) : null,
      processes: supportsProcesses ? normalizeList(data?.processes) : [],
      materials: supportsMaterials ? normalizeList(data?.materials) : [],
      certifications: [],
      slug: buildSupplierSlug({ supplierId: normalizedId, supplierName }),
      isVerified,
      isActive,
      showInDirectory,
    };
  } catch {
    return null;
  }
}
