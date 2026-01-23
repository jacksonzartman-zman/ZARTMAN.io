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

export const PROVIDER_DISPATCH_MODES = ["email", "web_form", "api"] as const;
export type ProviderDispatchMode = (typeof PROVIDER_DISPATCH_MODES)[number];

export const PROVIDER_VERIFICATION_STATUSES = ["unverified", "verified"] as const;
export type ProviderVerificationStatus = (typeof PROVIDER_VERIFICATION_STATUSES)[number];

export const PROVIDER_SOURCES = ["manual", "csv_import", "discovered", "customer_invite"] as const;
export type ProviderSource = (typeof PROVIDER_SOURCES)[number];

export type ProviderRow = {
  id: string;
  name: string;
  provider_type: ProviderType;
  quoting_mode: ProviderQuotingMode;
  dispatch_mode?: ProviderDispatchMode | null;
  is_active: boolean;
  website: string | null;
  rfq_url?: string | null;
  notes: string | null;
  processes?: string[] | null;
  materials?: string[] | null;
  country?: string | null;
  states?: string[] | null;
  verification_status: ProviderVerificationStatus;
  source: ProviderSource;
  verified_at: string | null;
  show_in_directory?: boolean | null;
  contacted_at?: string | null;
  created_at: string;
};

export type ProviderStatusSnapshot = {
  id: string;
  is_active: boolean;
  verification_status: ProviderVerificationStatus;
  source?: ProviderSource | null;
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

async function resolveProviderSelectColumns(): Promise<string[]> {
  const [
    supportsDispatchMode,
    supportsRfqUrl,
    supportsProcesses,
    supportsMaterials,
    supportsCountry,
    supportsStates,
    supportsShowInDirectory,
  ] = await Promise.all([
    hasColumns(PROVIDERS_TABLE, ["dispatch_mode"]),
    hasColumns(PROVIDERS_TABLE, ["rfq_url"]),
    hasColumns(PROVIDERS_TABLE, ["processes"]),
    hasColumns(PROVIDERS_TABLE, ["materials"]),
    hasColumns(PROVIDERS_TABLE, ["country"]),
    hasColumns(PROVIDERS_TABLE, ["states"]),
    hasColumns(PROVIDERS_TABLE, ["show_in_directory"]),
  ]);

  return [
    ...PROVIDER_COLUMNS,
    ...(supportsDispatchMode ? ["dispatch_mode"] : []),
    ...(supportsRfqUrl ? ["rfq_url"] : []),
    ...(supportsProcesses ? ["processes"] : []),
    ...(supportsMaterials ? ["materials"] : []),
    ...(supportsCountry ? ["country"] : []),
    ...(supportsStates ? ["states"] : []),
    ...(supportsShowInDirectory ? ["show_in_directory"] : []),
  ];
}

export async function getActiveProviders(): Promise<ProviderRow[]> {
  const selectColumns = await resolveProviderSelectColumns();
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
    const { data, error } = await supabaseServer()
      .from(PROVIDERS_TABLE)
      .select(selectColumns.join(","))
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
  const selectColumns = await resolveProviderSelectColumns();
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
    let query = supabaseServer()
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
  const [emailColumn, supportsContactedAt, baseColumns] = await Promise.all([
    resolveProviderEmailColumn(),
    hasColumns(PROVIDERS_TABLE, ["contacted_at"]),
    resolveProviderSelectColumns(),
  ]);
  const selectColumns = [
    ...baseColumns,
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
    let query = supabaseServer()
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

export async function getProviderWithContactById(
  providerId: string,
): Promise<{ provider: ProviderContactRow | null; emailColumn: ProviderEmailColumn | null }> {
  const normalizedProviderId = normalizeText(providerId);
  if (!normalizedProviderId) {
    return { provider: null, emailColumn: null };
  }

  const [emailColumn, supportsContactedAt, baseColumns] = await Promise.all([
    resolveProviderEmailColumn(),
    hasColumns(PROVIDERS_TABLE, ["contacted_at"]),
    resolveProviderSelectColumns(),
  ]);

  const selectColumns = [
    ...baseColumns,
    ...(emailColumn ? [emailColumn] : []),
    ...(supportsContactedAt ? ["contacted_at"] : []),
  ];

  const supported = await schemaGate({
    enabled: true,
    relation: PROVIDERS_TABLE,
    requiredColumns: selectColumns,
    warnPrefix: "[providers]",
    warnKey: "providers:get_with_contact_by_id",
  });
  if (!supported) {
    return { provider: null, emailColumn };
  }

  try {
    const { data, error } = await supabaseServer()
      .from(PROVIDERS_TABLE)
      .select(selectColumns.join(","))
      .eq("id", normalizedProviderId)
      .maybeSingle<ProviderContactRow>();

    if (error) {
      console.warn("[providers] getProviderWithContactById failed", {
        providerId: normalizedProviderId,
        error: serializeSupabaseError(error) ?? error,
      });
      return { provider: null, emailColumn };
    }

    return { provider: data ?? null, emailColumn };
  } catch (error) {
    console.warn("[providers] getProviderWithContactById crashed", { providerId: normalizedProviderId, error });
    return { provider: null, emailColumn };
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
    const supportsSource = await hasColumns(PROVIDERS_TABLE, ["source"]);
    const selectColumns = supportsSource
      ? "id,is_active,verification_status,source"
      : "id,is_active,verification_status";
    const { data, error } = await supabaseServer()
      .from(PROVIDERS_TABLE)
      .select(selectColumns)
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
  website?: string | null;
  processes?: string[] | null;
  materials?: string[] | null;
  notes?: string | null;
};

export type UpdateDiscoveredProviderStubInput = {
  providerId: string;
  name: string;
  email?: string | null;
  website?: string | null;
  processes?: string[] | null;
  materials?: string[] | null;
  notes?: string | null;
  country?: string | null;
  states?: string[] | null;
};

export type UpdateDiscoveredProviderStubResult =
  | { ok: true; providerId: string }
  | { ok: false; providerId: string; error: string };

export async function createDiscoveredProviderStub(
  input: CreateProviderStubInput,
): Promise<{ providerId: string | null }> {
  return createProviderStub({
    ...input,
    source: "discovered",
    warnKey: "providers:create_discovered_stub",
  });
}

export async function updateDiscoveredProviderStub(
  input: UpdateDiscoveredProviderStubInput,
): Promise<UpdateDiscoveredProviderStubResult> {
  const providerId = normalizeText(input.providerId);
  if (!providerId) {
    return { ok: false, providerId: "", error: "providerId is required" };
  }

  const name = normalizeText(input.name);
  if (!name) {
    return { ok: false, providerId, error: "name is required" };
  }

  const supported = await schemaGate({
    enabled: true,
    relation: PROVIDERS_TABLE,
    requiredColumns: ["id", "name", "source"],
    warnPrefix: "[providers]",
    warnKey: "providers:update_discovered_stub",
  });
  if (!supported) {
    return { ok: false, providerId, error: "Schema unavailable" };
  }

  let source: ProviderSource | null = null;
  try {
    const { data, error } = await supabaseServer()
      .from(PROVIDERS_TABLE)
      .select("id,source")
      .eq("id", providerId)
      .maybeSingle<{ id: string | null; source: ProviderSource | null }>();
    if (!error && data) {
      source = data.source ?? null;
    }
  } catch (error) {
    console.warn("[providers] updateDiscoveredProviderStub lookup crashed", { providerId, error });
  }

  if (source !== "discovered") {
    return { ok: false, providerId, error: "Provider is not a discovered stub." };
  }

  const [
    emailColumn,
    supportsWebsite,
    supportsProcesses,
    supportsMaterials,
    supportsNotes,
    supportsCountry,
    supportsStates,
  ] = await Promise.all([
    resolveProviderEmailColumn(),
    hasColumns(PROVIDERS_TABLE, ["website"]),
    hasColumns(PROVIDERS_TABLE, ["processes"]),
    hasColumns(PROVIDERS_TABLE, ["materials"]),
    hasColumns(PROVIDERS_TABLE, ["notes"]),
    hasColumns(PROVIDERS_TABLE, ["country"]),
    hasColumns(PROVIDERS_TABLE, ["states"]),
  ]);

  const normalizedEmail = normalizeEmail(input.email);
  const normalizedWebsite = normalizeWebsite(input.website);
  const normalizedProcesses = normalizeTagList(input.processes);
  const normalizedMaterials = normalizeTagList(input.materials);
  const normalizedNotes = normalizeOptionalText(input.notes);
  const normalizedCountry = normalizeOptionalText(input.country);
  const normalizedStates = normalizeStringList(input.states).map((value) => value.toUpperCase());

  let existingNotes: string | null = null;
  if (supportsNotes) {
    try {
      const { data, error } = await supabaseServer()
        .from(PROVIDERS_TABLE)
        .select("id,notes")
        .eq("id", providerId)
        .maybeSingle<{ id: string | null; notes: string | null }>();
      if (!error && data) {
        existingNotes = normalizeOptionalText(data.notes);
      }
    } catch (error) {
      console.warn("[providers] updateDiscoveredProviderStub notes lookup crashed", { providerId, error });
    }
  }

  const includeWebsiteLine = Boolean(normalizedWebsite && !supportsWebsite);
  const includeEmailLine = Boolean(normalizedEmail && !emailColumn);
  const extraLines: string[] = [];
  if (includeWebsiteLine && normalizedWebsite) {
    extraLines.push(`Invited website: ${normalizedWebsite}`);
  }
  if (includeEmailLine && normalizedEmail) {
    extraLines.push(`Invited email: ${normalizedEmail}`);
  }

  const finalNotes = supportsNotes
    ? mergeProviderNotes({ preferredNotes: normalizedNotes, existingNotes, extraLines })
    : null;

  const updates: Record<string, unknown> = {
    name,
  };
  if (supportsWebsite) {
    updates.website = normalizedWebsite;
  }
  if (emailColumn) {
    updates[emailColumn] = normalizedEmail;
  }
  if (supportsProcesses) {
    updates.processes = normalizedProcesses.length > 0 ? normalizedProcesses : [];
  }
  if (supportsMaterials) {
    updates.materials = normalizedMaterials.length > 0 ? normalizedMaterials : [];
  }
  if (supportsNotes) {
    updates.notes = finalNotes;
  }
  if (supportsCountry) {
    updates.country = normalizedCountry;
  }
  if (supportsStates) {
    updates.states = normalizedStates.length > 0 ? normalizedStates : [];
  }

  const requiredColumns = [
    "id",
    "name",
    ...(supportsWebsite ? ["website"] : []),
    ...(emailColumn ? [emailColumn] : []),
    ...(supportsProcesses ? ["processes"] : []),
    ...(supportsMaterials ? ["materials"] : []),
    ...(supportsNotes ? ["notes"] : []),
    ...(supportsCountry ? ["country"] : []),
    ...(supportsStates ? ["states"] : []),
  ];

  const updateSupported = await schemaGate({
    enabled: true,
    relation: PROVIDERS_TABLE,
    requiredColumns,
    warnPrefix: "[providers]",
    warnKey: "providers:update_discovered_stub_fields",
  });
  if (!updateSupported) {
    return { ok: false, providerId, error: "Schema unavailable" };
  }

  try {
    const { error } = await supabaseServer().from(PROVIDERS_TABLE).update(updates).eq("id", providerId);
    if (error) {
      console.warn("[providers] updateDiscoveredProviderStub failed", {
        providerId,
        error: serializeSupabaseError(error) ?? error,
      });
      return { ok: false, providerId, error: "Unable to update provider." };
    }
    return { ok: true, providerId };
  } catch (error) {
    console.warn("[providers] updateDiscoveredProviderStub crashed", {
      providerId,
      error: serializeSupabaseError(error) ?? error,
    });
    return { ok: false, providerId, error: "Unable to update provider." };
  }
}

function mergeProviderNotes(args: {
  preferredNotes: string | null;
  existingNotes: string | null;
  extraLines: string[];
}): string | null {
  let notes = normalizeOptionalText(args.preferredNotes) ?? normalizeOptionalText(args.existingNotes);
  for (const line of args.extraLines) {
    const normalizedLine = normalizeOptionalText(line);
    if (!normalizedLine) continue;
    if (!notes) {
      notes = normalizedLine;
      continue;
    }
    if (!notes.includes(normalizedLine)) {
      notes = `${notes}\n${normalizedLine}`;
    }
  }
  return notes;
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
  const normalizedWebsite = normalizeWebsite(input.website);
  const normalizedProcesses = normalizeTagList(input.processes);
  const normalizedMaterials = normalizeTagList(input.materials);
  const inviteDomain = input.includeInviteDomain ? normalizeDomainFromEmail(normalizedEmail) : null;
  const websiteFromDomain = inviteDomain ? normalizeWebsiteFromDomain(inviteDomain) : null;
  const preferredWebsite = normalizedWebsite ?? websiteFromDomain;

  const needsNotesColumn = Boolean(normalizedNotes || normalizedEmail || normalizedWebsite || inviteDomain);
  const needsWebsiteColumn = Boolean(preferredWebsite);
  const needsProcessesColumn = normalizedProcesses.length > 0;
  const needsMaterialsColumn = normalizedMaterials.length > 0;
  const [
    supportsVerificationStatus,
    supportsSource,
    supportsNotes,
    supportsWebsite,
    supportsIsVerified,
    emailColumn,
    supportsProcesses,
    supportsMaterials,
    supportsShowInDirectory,
  ] =
    await Promise.all([
      hasColumns(PROVIDERS_TABLE, ["verification_status"]),
      hasColumns(PROVIDERS_TABLE, ["source"]),
      needsNotesColumn ? hasColumns(PROVIDERS_TABLE, ["notes"]) : Promise.resolve(false),
      needsWebsiteColumn ? hasColumns(PROVIDERS_TABLE, ["website"]) : Promise.resolve(false),
      hasColumns(PROVIDERS_TABLE, ["is_verified"]),
      resolveProviderEmailColumn(),
      needsProcessesColumn ? hasColumns(PROVIDERS_TABLE, ["processes"]) : Promise.resolve(false),
      needsMaterialsColumn ? hasColumns(PROVIDERS_TABLE, ["materials"]) : Promise.resolve(false),
      hasColumns(PROVIDERS_TABLE, ["show_in_directory"]),
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
  if (supportsWebsite && preferredWebsite) {
    payload.website = preferredWebsite;
  }
  if (supportsProcesses && normalizedProcesses.length > 0) {
    payload.processes = normalizedProcesses;
  }
  if (supportsMaterials && normalizedMaterials.length > 0) {
    payload.materials = normalizedMaterials;
  }
  if (supportsShowInDirectory && input.source === "discovered") {
    payload.show_in_directory = false;
  }
  if (supportsNotes) {
    const includeWebsiteLine = Boolean(normalizedWebsite && !supportsWebsite);
    const includeEmailLine = Boolean(normalizedEmail && !emailColumn);
    const includeDomainLine =
      Boolean(inviteDomain) &&
      !includeWebsiteLine &&
      !includeEmailLine &&
      (!supportsWebsite || !preferredWebsite);
    const notesValue = buildInviteNotes({
      notes: normalizedNotes,
      domain: inviteDomain,
      includeDomain: includeDomainLine,
      includeWebsite: includeWebsiteLine,
      website: normalizedWebsite,
      includeEmail: includeEmailLine,
      email: normalizedEmail,
    });
    if (notesValue) {
      payload.notes = notesValue;
    }
  }
  if (emailColumn && normalizedEmail) {
    payload[emailColumn] = normalizedEmail;
  }

  try {
    const { data, error } = await supabaseServer()
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

function normalizeWebsite(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const hasScheme = /^https?:\/\//i.test(trimmed);
  const candidate = hasScheme ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
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

function normalizeTagList(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const normalized = values
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter((value) => value.length > 0)
    .map((value) => value.toLowerCase());
  return Array.from(new Set(normalized));
}

function normalizeStringList(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const normalized = values
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter((value) => value.length > 0);
  return Array.from(new Set(normalized));
}

function buildInviteNotes({
  notes,
  domain,
  includeDomain,
  includeWebsite,
  website,
  includeEmail,
  email,
}: {
  notes: string | null;
  domain: string | null;
  includeDomain: boolean;
  includeWebsite: boolean;
  website: string | null;
  includeEmail: boolean;
  email: string | null;
}): string | null {
  let normalizedNotes = normalizeOptionalText(notes);
  const lines: string[] = [];

  if (includeWebsite && website) {
    lines.push(`Invited website: ${website}`);
  }

  if (includeEmail && email) {
    lines.push(`Invited email: ${email}`);
  }

  if (includeDomain && domain) {
    lines.push(`Invited domain: ${domain}`);
  }

  for (const line of lines) {
    if (!line) continue;
    if (!normalizedNotes) {
      normalizedNotes = line;
      continue;
    }
    if (!normalizedNotes.includes(line)) {
      normalizedNotes = `${normalizedNotes}\n${line}`;
    }
  }

  return normalizedNotes;
}
