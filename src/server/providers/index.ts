import { supabaseServer } from "@/lib/supabaseServer";
import { serializeSupabaseError } from "@/server/admin/logging";
import { hasColumns, schemaGate } from "@/server/db/schemaContract";

export const PROVIDER_TYPES = [
  "marketplace",
  "direct_supplier",
  "factory",
  "broker",
] as const;

export type ProviderType = (typeof PROVIDER_TYPES)[number];

export const PROVIDER_QUOTING_MODES = ["manual", "email", "api"] as const;
export type ProviderQuotingMode = (typeof PROVIDER_QUOTING_MODES)[number];

export const PROVIDER_VERIFICATION_STATUSES = ["unverified", "verified"] as const;
export type ProviderVerificationStatus = (typeof PROVIDER_VERIFICATION_STATUSES)[number];

export const PROVIDER_SOURCES = ["manual", "csv_import", "discovered", "customer_invite"] as const;
export type ProviderSource = (typeof PROVIDER_SOURCES)[number];

export type ProviderRow = {
  id: string;
  name: string;
  provider_type: ProviderType;
  quoting_mode: ProviderQuotingMode;
  is_active: boolean;
  website: string | null;
  notes: string | null;
  verification_status: ProviderVerificationStatus;
  source: ProviderSource;
  verified_at: string | null;
  contacted_at?: string | null;
  created_at: string;
};

export type ProviderStatusSnapshot = {
  id: string;
  is_active: boolean;
  verification_status: ProviderVerificationStatus;
};

export type ProviderListFilters = {
  isActive?: boolean | null;
  verificationStatus?: ProviderVerificationStatus | null;
  providerType?: ProviderType | null;
  quotingMode?: ProviderQuotingMode | null;
  source?: ProviderSource | null;
};

export type ProviderEmailColumn = "primary_email" | "email" | "contact_email";
export type ProviderContactRow = ProviderRow & {
  primary_email?: string | null;
  email?: string | null;
  contact_email?: string | null;
};

const PROVIDERS_TABLE = "providers";
const PROVIDER_COLUMNS = [
  "id",
  "name",
  "provider_type",
  "quoting_mode",
  "is_active",
  "website",
  "notes",
  "verification_status",
  "source",
  "verified_at",
  "created_at",
] as const;
const PROVIDER_SELECT = PROVIDER_COLUMNS.join(",");

export async function getActiveProviders(): Promise<ProviderRow[]> {
  const supported = await schemaGate({
    enabled: true,
    relation: PROVIDERS_TABLE,
    requiredColumns: [...PROVIDER_COLUMNS],
    warnPrefix: "[providers]",
    warnKey: "providers:get_active",
  });
  if (!supported) {
    return [];
  }

  try {
    const { data, error } = await supabaseServer
      .from(PROVIDERS_TABLE)
      .select(PROVIDER_SELECT)
      .eq("is_active", true)
      .eq("verification_status", "verified")
      .order("name", { ascending: true })
      .returns<ProviderRow[]>();

    if (error) {
      console.warn("[providers] getActiveProviders failed", { error });
      return [];
    }

    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.warn("[providers] getActiveProviders crashed", { error });
    return [];
  }
}

export async function listProviders(filters: ProviderListFilters = {}): Promise<ProviderRow[]> {
  const supported = await schemaGate({
    enabled: true,
    relation: PROVIDERS_TABLE,
    requiredColumns: [...PROVIDER_COLUMNS],
    warnPrefix: "[providers]",
    warnKey: "providers:list",
  });
  if (!supported) {
    return [];
  }

  try {
    let query = supabaseServer
      .from(PROVIDERS_TABLE)
      .select(PROVIDER_SELECT)
      .order("name", { ascending: true });

    if (typeof filters.isActive === "boolean") {
      query = query.eq("is_active", filters.isActive);
    }
    if (filters.verificationStatus) {
      query = query.eq("verification_status", filters.verificationStatus);
    }
    if (filters.providerType) {
      query = query.eq("provider_type", filters.providerType);
    }
    if (filters.quotingMode) {
      query = query.eq("quoting_mode", filters.quotingMode);
    }
    if (filters.source) {
      query = query.eq("source", filters.source);
    }

    const { data, error } = await query.returns<ProviderRow[]>();

    if (error) {
      console.warn("[providers] listProviders failed", { error });
      return [];
    }

    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.warn("[providers] listProviders crashed", { error });
    return [];
  }
}

export async function listProvidersWithContact(
  filters: ProviderListFilters = {},
): Promise<{ providers: ProviderContactRow[]; emailColumn: ProviderEmailColumn | null }> {
  const [emailColumn, supportsContactedAt] = await Promise.all([
    resolveProviderEmailColumn(),
    hasColumns(PROVIDERS_TABLE, ["contacted_at"]),
  ]);
  const selectColumns = [
    ...PROVIDER_COLUMNS,
    ...(emailColumn ? [emailColumn] : []),
    ...(supportsContactedAt ? ["contacted_at"] : []),
  ];
  const supported = await schemaGate({
    enabled: true,
    relation: PROVIDERS_TABLE,
    requiredColumns: selectColumns,
    warnPrefix: "[providers]",
    warnKey: "providers:list_with_contact",
  });
  if (!supported) {
    return { providers: [], emailColumn };
  }

  try {
    let query = supabaseServer
      .from(PROVIDERS_TABLE)
      .select(selectColumns.join(","))
      .order("name", { ascending: true });

    if (typeof filters.isActive === "boolean") {
      query = query.eq("is_active", filters.isActive);
    }
    if (filters.verificationStatus) {
      query = query.eq("verification_status", filters.verificationStatus);
    }
    if (filters.providerType) {
      query = query.eq("provider_type", filters.providerType);
    }
    if (filters.quotingMode) {
      query = query.eq("quoting_mode", filters.quotingMode);
    }
    if (filters.source) {
      query = query.eq("source", filters.source);
    }

    const { data, error } = await query.returns<ProviderContactRow[]>();

    if (error) {
      console.warn("[providers] listProvidersWithContact failed", { error });
      return { providers: [], emailColumn };
    }

    return { providers: Array.isArray(data) ? data : [], emailColumn };
  } catch (error) {
    console.warn("[providers] listProvidersWithContact crashed", { error });
    return { providers: [], emailColumn };
  }
}

export async function getProviderStatusByIds(
  providerIds: string[],
): Promise<Map<string, ProviderStatusSnapshot>> {
  const normalizedIds = Array.from(
    new Set(
      providerIds
        .map((id) => (typeof id === "string" ? id.trim() : ""))
        .filter((id) => id.length > 0),
    ),
  );
  const map = new Map<string, ProviderStatusSnapshot>();
  if (normalizedIds.length === 0) {
    return map;
  }

  const supported = await schemaGate({
    enabled: true,
    relation: PROVIDERS_TABLE,
    requiredColumns: ["id", "is_active", "verification_status"],
    warnPrefix: "[providers]",
    warnKey: "providers:status_snapshot",
  });
  if (!supported) {
    return map;
  }

  try {
    const { data, error } = await supabaseServer
      .from(PROVIDERS_TABLE)
      .select("id,is_active,verification_status")
      .in("id", normalizedIds)
      .returns<Array<ProviderStatusSnapshot>>();

    if (error) {
      console.warn("[providers] getProviderStatusByIds failed", { error });
      return map;
    }

    for (const row of data ?? []) {
      if (row?.id) {
        map.set(row.id, row);
      }
    }
    return map;
  } catch (error) {
    console.warn("[providers] getProviderStatusByIds crashed", { error });
    return map;
  }
}

export async function resolveProviderEmailColumn(): Promise<ProviderEmailColumn | null> {
  const [supportsPrimaryEmail, supportsEmail, supportsContactEmail] = await Promise.all([
    hasColumns(PROVIDERS_TABLE, ["primary_email"]),
    hasColumns(PROVIDERS_TABLE, ["email"]),
    hasColumns(PROVIDERS_TABLE, ["contact_email"]),
  ]);

  if (supportsPrimaryEmail) return "primary_email";
  if (supportsEmail) return "email";
  if (supportsContactEmail) return "contact_email";
  return null;
}

export type CreateProviderStubInput = {
  name: string;
  email?: string | null;
  notes?: string | null;
};

export async function createDiscoveredProviderStub(
  input: CreateProviderStubInput,
): Promise<{ providerId: string | null }> {
  return createProviderStub({
    ...input,
    source: "discovered",
    warnKey: "providers:create_discovered_stub",
  });
}

export async function createCustomerInviteProviderStub(
  input: CreateProviderStubInput,
): Promise<{ providerId: string | null }> {
  return createProviderStub({
    ...input,
    source: "customer_invite",
    includeInviteDomain: true,
    warnKey: "providers:create_customer_invite_stub",
  });
}

type CreateProviderStubOptions = CreateProviderStubInput & {
  source: ProviderSource;
  includeInviteDomain?: boolean;
  warnKey: string;
};

async function createProviderStub(
  input: CreateProviderStubOptions,
): Promise<{ providerId: string | null }> {
  const name = normalizeText(input.name);
  if (!name) {
    return { providerId: null };
  }

  const supported = await schemaGate({
    enabled: true,
    relation: PROVIDERS_TABLE,
    requiredColumns: ["name", "provider_type", "quoting_mode", "is_active"],
    warnPrefix: "[providers]",
    warnKey: input.warnKey,
  });
  if (!supported) {
    return { providerId: null };
  }

  const normalizedEmail = normalizeEmail(input.email);
  const normalizedNotes = normalizeOptionalText(input.notes);
  const inviteDomain = input.includeInviteDomain ? normalizeDomainFromEmail(normalizedEmail) : null;
  const websiteFromDomain = inviteDomain ? normalizeWebsiteFromDomain(inviteDomain) : null;

  const [supportsVerificationStatus, supportsSource, supportsNotes, supportsWebsite, supportsIsVerified, emailColumn] =
    await Promise.all([
      hasColumns(PROVIDERS_TABLE, ["verification_status"]),
      hasColumns(PROVIDERS_TABLE, ["source"]),
      normalizedNotes || inviteDomain ? hasColumns(PROVIDERS_TABLE, ["notes"]) : Promise.resolve(false),
      inviteDomain ? hasColumns(PROVIDERS_TABLE, ["website"]) : Promise.resolve(false),
      hasColumns(PROVIDERS_TABLE, ["is_verified"]),
      resolveProviderEmailColumn(),
    ]);

  const payload: Record<string, unknown> = {
    name,
    provider_type: "direct_supplier",
    quoting_mode: "email",
    is_active: false,
  };

  if (supportsVerificationStatus) {
    payload.verification_status = "unverified";
  }
  if (supportsIsVerified) {
    payload.is_verified = false;
  }
  if (supportsSource) {
    payload.source = input.source;
  }
  if (supportsWebsite && websiteFromDomain) {
    payload.website = websiteFromDomain;
  }
  if (supportsNotes) {
    const notesValue = buildInviteNotes({
      notes: normalizedNotes,
      domain: inviteDomain,
      includeDomain: Boolean(inviteDomain && (!supportsWebsite || !websiteFromDomain)),
    });
    if (notesValue) {
      payload.notes = notesValue;
    }
  }
  if (emailColumn && normalizedEmail) {
    payload[emailColumn] = normalizedEmail;
  }

  try {
    const { data, error } = await supabaseServer
      .from(PROVIDERS_TABLE)
      .insert(payload)
      .select("id")
      .maybeSingle<{ id: string | null }>();

    if (error) {
      console.warn("[providers] create provider stub failed", {
        error: serializeSupabaseError(error) ?? error,
      });
      return { providerId: null };
    }

    const providerId = normalizeText(data?.id);
    return { providerId: providerId || null };
  } catch (error) {
    console.warn("[providers] create provider stub crashed", {
      error: serializeSupabaseError(error) ?? error,
    });
    return { providerId: null };
  }
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeOptionalText(value: unknown): string | null {
  const normalized = normalizeText(value);
  return normalized.length > 0 ? normalized : null;
}

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized || !normalized.includes("@")) return null;
  return normalized;
}

function normalizeDomainFromEmail(email: string | null): string | null {
  if (!email) return null;
  const atIndex = email.lastIndexOf("@");
  if (atIndex < 0) return null;
  const domain = email.slice(atIndex + 1).trim().toLowerCase();
  if (!domain || !domain.includes(".")) return null;
  if (/\s/.test(domain)) return null;
  return domain;
}

function normalizeWebsiteFromDomain(domain: string): string | null {
  const trimmed = domain.trim().toLowerCase();
  if (!trimmed) return null;
  const candidate = `https://${trimmed}`;
  try {
    return new URL(candidate).toString();
  } catch {
    return null;
  }
}

function buildInviteNotes({
  notes,
  domain,
  includeDomain,
}: {
  notes: string | null;
  domain: string | null;
  includeDomain: boolean;
}): string | null {
  const normalizedNotes = normalizeOptionalText(notes);
  if (!includeDomain || !domain) {
    return normalizedNotes;
  }
  const domainLine = `Invited domain: ${domain}`;
  if (!normalizedNotes) {
    return domainLine;
  }
  if (normalizedNotes.includes(domainLine)) {
    return normalizedNotes;
  }
  return `${normalizedNotes}\n${domainLine}`;
}
