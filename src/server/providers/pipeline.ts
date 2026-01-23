import {
  listProvidersWithContact,
  type ProviderSource,
  type ProviderContactRow,
  type ProviderEmailColumn,
} from "@/server/providers";
import { supabaseServer } from "@/lib/supabaseServer";
import { assessProviderCapabilityMatch } from "@/lib/provider/capabilityMatch";
import { assessDiscoveryCompleteness } from "@/lib/provider/discoveryCompleteness";
import { scoreProviderProfileCompleteness } from "@/lib/provider/providerProfileCompleteness";
import { hasColumns } from "@/server/db/schemaContract";

export type ProviderPipelineView =
  | "queue"
  | "needs_research"
  | "not_contacted"
  | "contacted"
  | "verified_inactive"
  | "active_verified"
  | "all";

export type ProviderPipelineRow = {
  provider: ProviderContactRow;
  emailValue: string | null;
  websiteValue: string | null;
  rfqUrlValue: string | null;
  discoveryComplete: boolean;
  profileCompleteness: ReturnType<typeof scoreProviderProfileCompleteness>;
  contacted: boolean;
  responded: boolean;
  lastResponseAt: string | null;
  needsResearch: boolean;
  isVerified: boolean;
  isActive: boolean;
  capabilityMatch: ReturnType<typeof assessProviderCapabilityMatch>;
};

export async function listProviderPipelineRows(args: {
  view?: ProviderPipelineView | null;
  search?: string | null;
  match?: "all" | "mismatch" | "partial" | null;
  source?: ProviderSource | null;
  discovery?: "all" | "incomplete" | null;
  profile?: "all" | "incomplete" | "ready_to_verify" | null;
  sort?: "name" | "profile" | null;
  dir?: "asc" | "desc" | null;
}): Promise<{ rows: ProviderPipelineRow[]; emailColumn: ProviderEmailColumn | null }> {
  const { providers, emailColumn } = await listProvidersWithContact();
  const view = normalizeView(args.view);
  const search = normalizeSearchTerm(args.search);
  const matchFilter = normalizeMatchFilter(args.match);
  const source = normalizeSource(args.source);
  const discoveryFilter = normalizeDiscoveryFilter(args.discovery);
  const profileFilter = normalizeProfileFilter(args.profile);
  const sortKey = normalizeSortKey(args.sort);
  const sortDir = normalizeSortDir(args.dir);

  const providerIds = providers.map((provider) => provider.id);
  const { supportsProviderResponses, responseStateByProviderId } =
    await loadProviderResponseState(providerIds);

  const rows = providers.map((provider) => {
    const rawEmailValue = readEmailValue(provider, emailColumn);
    const rawWebsiteValue = provider.website?.trim() || null;
    const notesValue = provider.notes?.trim() || null;
    const emailValue = rawEmailValue ?? extractInviteDetail(notesValue, "Invited email:");
    const websiteValue =
      rawWebsiteValue ?? extractInviteDetail(notesValue, "Invited website:");
    const rfqUrlValue = normalizeOptionalText(provider.rfq_url);
    const contacted = Boolean(provider.contacted_at);
    const responseSnapshot = responseStateByProviderId.get(provider.id) ?? null;
    const lastResponseAt = supportsProviderResponses ? responseSnapshot?.lastResponseAt ?? null : null;
    const responded = supportsProviderResponses
      ? Boolean(responseSnapshot?.responded)
      : hasResponseNotesFlag(provider.notes);
    const isVerified = provider.verification_status === "verified";
    const isActive = provider.is_active;
    const discovery = assessDiscoveryCompleteness({
      name: provider.name,
      email: emailValue,
      website: websiteValue || rfqUrlValue,
      processes: provider.processes,
    });
    const discoveryComplete = discovery.complete;
    const hasWebsite = Boolean(websiteValue || rfqUrlValue);
    const needsResearch =
      provider.source === "discovered" ? !discoveryComplete : !emailValue || !hasWebsite;
    const profileCompleteness = scoreProviderProfileCompleteness({
      companyName: provider.name,
      email: emailValue,
      website: websiteValue || rfqUrlValue,
      processes: provider.processes,
      country: provider.country ?? null,
      states: provider.states,
      materials: provider.materials,
      certifications: null,
    });
    const capabilityMatch = assessProviderCapabilityMatch({
      processes: provider.processes,
      materials: provider.materials,
      country: provider.country ?? null,
      states: provider.states,
    });

    return {
      provider,
      emailValue,
      websiteValue,
      rfqUrlValue,
      discoveryComplete,
      profileCompleteness,
      contacted,
      responded,
      lastResponseAt,
      needsResearch,
      isVerified,
      isActive,
      capabilityMatch,
    };
  });

  const filtered = rows.filter((row) => {
    if (!matchesView(row, view)) return false;
    if (!matchesSearch(row, search)) return false;
    if (!matchesMatchFilter(row, matchFilter)) return false;
    if (!matchesSource(row, source)) return false;
    if (!matchesDiscoveryFilter(row, discoveryFilter)) return false;
    if (!matchesProfileFilter(row, profileFilter)) return false;
    return true;
  });

  const sorted = sortRows(filtered, { sortKey, sortDir });
  return { rows: sorted, emailColumn };
}

function normalizeView(view: ProviderPipelineView | null | undefined): ProviderPipelineView {
  return view ?? "queue";
}

function matchesView(row: ProviderPipelineRow, view: ProviderPipelineView): boolean {
  switch (view) {
    case "needs_research":
      return row.needsResearch;
    case "not_contacted":
      return !row.contacted;
    case "contacted":
      return row.contacted && !row.isVerified;
    case "verified_inactive":
      return row.isVerified && !row.isActive;
    case "active_verified":
      return row.isVerified && row.isActive;
    case "all":
      return true;
    case "queue":
    default:
      return (
        !row.contacted ||
        (row.contacted && !row.isVerified) ||
        (row.isVerified && !row.isActive)
      );
  }
}

function matchesSearch(row: ProviderPipelineRow, search: string | null): boolean {
  if (!search) return true;
  const haystack = [
    row.provider.name,
    row.emailValue,
    row.websiteValue,
    row.rfqUrlValue,
    row.provider.website,
    row.provider.rfq_url,
    row.provider.notes,
  ]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join(" ")
    .toLowerCase();
  return haystack.includes(search);
}

function normalizeSearchTerm(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeMatchFilter(
  value: "all" | "mismatch" | "partial" | null | undefined,
): "all" | "mismatch" | "partial" {
  if (value === "mismatch" || value === "partial") return value;
  return "all";
}

function matchesMatchFilter(
  row: ProviderPipelineRow,
  filter: ReturnType<typeof normalizeMatchFilter>,
): boolean {
  if (filter === "mismatch") return row.capabilityMatch.health === "mismatch";
  if (filter === "partial") return row.capabilityMatch.health === "partial";
  return true;
}

function normalizeSource(value: ProviderSource | null | undefined): ProviderSource | null {
  if (!value) return null;
  return value;
}

function matchesSource(row: ProviderPipelineRow, source: ProviderSource | null): boolean {
  if (!source) return true;
  return row.provider.source === source;
}

function normalizeDiscoveryFilter(
  value: "all" | "incomplete" | null | undefined,
): "all" | "incomplete" {
  if (value === "incomplete") return "incomplete";
  return "all";
}

function matchesDiscoveryFilter(
  row: ProviderPipelineRow,
  filter: ReturnType<typeof normalizeDiscoveryFilter>,
): boolean {
  if (filter !== "incomplete") return true;
  if (row.provider.source !== "discovered") return false;
  return !row.discoveryComplete;
}

function normalizeProfileFilter(
  value: "all" | "incomplete" | "ready_to_verify" | null | undefined,
): "all" | "incomplete" | "ready_to_verify" {
  if (value === "incomplete" || value === "ready_to_verify") return value;
  return "all";
}

function matchesProfileFilter(
  row: ProviderPipelineRow,
  filter: ReturnType<typeof normalizeProfileFilter>,
): boolean {
  if (filter === "all") return true;
  if (filter === "incomplete") {
    return !row.profileCompleteness.readyToVerify;
  }
  // ready_to_verify
  return (
    row.provider.verification_status !== "verified" &&
    row.responded &&
    row.profileCompleteness.readyToVerify
  );
}

function hasResponseNotesFlag(notes: string | null): boolean {
  if (!notes) return false;
  const lines = notes.split("\n");
  return lines.some((line) => {
    const trimmed = line.trim().toLowerCase();
    if (!trimmed) return false;
    if (trimmed.startsWith("response notes:")) return true;
    if (trimmed.startsWith("response:")) return true;
    if (trimmed.startsWith("[response]")) return true;
    if (trimmed.startsWith("#response")) return true;
    return false;
  });
}

function normalizeSortKey(value: "name" | "profile" | null | undefined): "name" | "profile" {
  if (value === "profile") return "profile";
  return "name";
}

function normalizeSortDir(value: "asc" | "desc" | null | undefined): "asc" | "desc" {
  if (value === "asc" || value === "desc") return value;
  return "desc";
}

function sortRows(
  rows: ProviderPipelineRow[],
  args: { sortKey: ReturnType<typeof normalizeSortKey>; sortDir: ReturnType<typeof normalizeSortDir> },
): ProviderPipelineRow[] {
  const sorted = [...rows];
  sorted.sort((a, b) => {
    if (args.sortKey === "profile") {
      const sa = a.profileCompleteness.score;
      const sb = b.profileCompleteness.score;
      if (sa !== sb) {
        return args.sortDir === "asc" ? sa - sb : sb - sa;
      }
    }
    // fallback: stable-ish name ordering
    const nameDiff = (a.provider.name ?? "").localeCompare(b.provider.name ?? "");
    if (nameDiff !== 0) return nameDiff;
    return a.provider.id.localeCompare(b.provider.id);
  });
  return sorted;
}

function readEmailValue(provider: ProviderContactRow, column: ProviderEmailColumn | null): string | null {
  if (!column) return null;
  const raw = provider[column];
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

function extractInviteDetail(
  notes: string | null,
  prefix: "Invited email:" | "Invited website:",
): string | null {
  if (!notes) return null;
  const lines = notes.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith(prefix)) {
      const value = trimmed.slice(prefix.length).trim();
      return value || null;
    }
  }
  return null;
}

function normalizeOptionalText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

type ProviderResponseState = {
  responded: boolean;
  lastResponseAt: string | null;
};

async function loadProviderResponseState(
  providerIds: string[],
): Promise<{
  supportsProviderResponses: boolean;
  responseStateByProviderId: Map<string, ProviderResponseState>;
}> {
  const map = new Map<string, ProviderResponseState>();
  const ids = Array.from(new Set(providerIds.filter((id) => typeof id === "string" && id.trim().length > 0)));
  if (ids.length === 0) {
    return { supportsProviderResponses: false, responseStateByProviderId: map };
  }

  const supportsProviderResponses = await hasColumns("provider_responses", [
    "provider_id",
    "response_at",
  ]);
  if (!supportsProviderResponses) {
    return { supportsProviderResponses: false, responseStateByProviderId: map };
  }

  try {
    type ProviderResponseRow = { provider_id: string | null; response_at: string | null };
    const { data, error } = await supabaseServer()
      .from("provider_responses")
      .select("provider_id,response_at")
      .in("provider_id", ids)
      .order("response_at", { ascending: false })
      .returns<ProviderResponseRow[]>();

    if (error) {
      // If the query fails for any reason (schema drift, RLS, etc), keep the map empty
      // so callers can fall back to notes tags.
      return { supportsProviderResponses: false, responseStateByProviderId: map };
    }

    for (const row of data ?? []) {
      const providerId = normalizeOptionalText(row?.provider_id);
      const responseAt = normalizeOptionalText(row?.response_at);
      if (!providerId || !responseAt) continue;
      if (map.has(providerId)) continue; // first row wins (ordered desc)
      map.set(providerId, { responded: true, lastResponseAt: responseAt });
    }

    return { supportsProviderResponses: true, responseStateByProviderId: map };
  } catch {
    return { supportsProviderResponses: false, responseStateByProviderId: map };
  }
}
