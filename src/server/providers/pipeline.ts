import {
  listProvidersWithContact,
  type ProviderContactRow,
  type ProviderEmailColumn,
} from "@/server/providers";
import { assessProviderCapabilityMatch } from "@/lib/provider/capabilityMatch";

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
  contacted: boolean;
  needsResearch: boolean;
  isVerified: boolean;
  isActive: boolean;
  capabilityMatch: ReturnType<typeof assessProviderCapabilityMatch>;
};

export async function listProviderPipelineRows(args: {
  view?: ProviderPipelineView | null;
  search?: string | null;
  match?: "all" | "mismatch" | "partial" | null;
}): Promise<{ rows: ProviderPipelineRow[]; emailColumn: ProviderEmailColumn | null }> {
  const { providers, emailColumn } = await listProvidersWithContact();
  const view = normalizeView(args.view);
  const search = normalizeSearchTerm(args.search);
  const matchFilter = normalizeMatchFilter(args.match);

  const rows = providers.map((provider) => {
    const rawEmailValue = readEmailValue(provider, emailColumn);
    const rawWebsiteValue = provider.website?.trim() || null;
    const notesValue = provider.notes?.trim() || null;
    const emailValue = rawEmailValue ?? extractInviteDetail(notesValue, "Invited email:");
    const websiteValue =
      rawWebsiteValue ?? extractInviteDetail(notesValue, "Invited website:");
    const rfqUrlValue = normalizeOptionalText(provider.rfq_url);
    const contacted = Boolean(provider.contacted_at);
    const isVerified = provider.verification_status === "verified";
    const isActive = provider.is_active;
    const hasWebsite = Boolean(websiteValue || rfqUrlValue);
    const needsResearch = !emailValue || !hasWebsite;
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
      contacted,
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
    return true;
  });

  return { rows: filtered, emailColumn };
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
