import Link from "next/link";
import { Fragment } from "react";
import clsx from "clsx";
import AdminDashboardShell from "@/app/admin/AdminDashboardShell";
import AdminTableShell, { adminTableCellClass } from "@/app/admin/AdminTableShell";
import { requireAdminUser } from "@/server/auth";
import { normalizeSearchParams } from "@/lib/route/normalizeSearchParams";
import { formatDateTime } from "@/lib/formatDate";
import {
  listProvidersWithContact,
  PROVIDER_QUOTING_MODES,
  PROVIDER_SOURCES,
  PROVIDER_TYPES,
  PROVIDER_VERIFICATION_STATUSES,
  type ProviderContactRow,
  type ProviderEmailColumn,
  type ProviderQuotingMode,
  type ProviderSource,
  type ProviderType,
  type ProviderVerificationStatus,
} from "@/server/providers";
import { hasColumns } from "@/server/db/schemaContract";
import {
  markProviderContactedAction,
  toggleProviderDirectoryVisibilityAction,
  toggleProviderActiveAction,
  updateProviderContactAction,
  verifyProviderAction,
} from "./actions";
import { CopyOutreachEmailButton } from "./CopyOutreachEmailButton";

export const dynamic = "force-dynamic";

type ActiveFilter = "all" | "active" | "inactive";
type VerificationFilter = "all" | ProviderVerificationStatus;
type TypeFilter = "all" | ProviderType;
type QuotingFilter = "all" | ProviderQuotingMode;
type SourceFilter = "all" | ProviderSource;
type ViewFilter = "all" | "needs_research";

const ACTIVE_FILTERS: Array<{ value: ActiveFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
];

const VERIFICATION_FILTERS: Array<{ value: VerificationFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "verified", label: "Verified" },
  { value: "unverified", label: "Unverified" },
];

const SOURCE_FILTERS: Array<{ value: SourceFilter; label: string }> = [
  { value: "all", label: "All" },
  ...PROVIDER_SOURCES.map((value) => ({ value, label: formatEnumLabel(value) })),
];

const TYPE_FILTERS: Array<{ value: TypeFilter; label: string }> = [
  { value: "all", label: "All" },
  ...PROVIDER_TYPES.map((value) => ({ value, label: formatEnumLabel(value) })),
];

const QUOTING_FILTERS: Array<{ value: QuotingFilter; label: string }> = [
  { value: "all", label: "All" },
  ...PROVIDER_QUOTING_MODES.map((value) => ({ value, label: formatEnumLabel(value) })),
];

export default async function AdminProvidersPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdminUser({ redirectTo: "/login" });

  const usp = normalizeSearchParams(searchParams ? await searchParams : undefined);
  const supportsDirectoryVisibility = await hasColumns("providers", ["show_in_directory"]);
  const activeFilter = parseActiveFilter(usp.get("active"));
  const verificationFilter = parseVerificationFilter(usp.get("verification"));
  const typeFilter = parseTypeFilter(usp.get("type"));
  const quotingFilter = parseQuotingFilter(usp.get("quoting"));
  const sourceFilter = parseSourceFilter(usp.get("source"));
  const viewFilter = parseViewFilter(usp.get("view"));
  const needsResearchFilterActive = viewFilter === "needs_research";
  const inviteFilterActive =
    viewFilter === "all" &&
    sourceFilter === "customer_invite" &&
    verificationFilter === "unverified";
  const defaultFiltersActive =
    viewFilter === "all" &&
    activeFilter === "all" &&
    verificationFilter === "all" &&
    typeFilter === "all" &&
    quotingFilter === "all" &&
    sourceFilter === "all";
  const inviteFilterHref = buildProvidersFilterHref({
    verification: "unverified",
    source: "customer_invite",
  });
  const needsResearchFilterHref = buildProvidersFilterHref({ view: "needs_research" });

  const { providers, emailColumn } = await listProvidersWithContact({
    isActive:
      activeFilter === "all" ? null : activeFilter === "active",
    verificationStatus:
      verificationFilter === "all" ? null : verificationFilter,
    providerType: typeFilter === "all" ? null : typeFilter,
    quotingMode: quotingFilter === "all" ? null : quotingFilter,
    source: sourceFilter === "all" ? null : sourceFilter,
  });

  const providerRows = providers.map((provider) => {
    const rawEmailValue = readEmailValue(provider, emailColumn);
    const rawWebsiteValue = provider.website?.trim() || null;
    const rawNotesValue = provider.notes?.trim() || null;
    const notesValue = stripInviteDetailLines(rawNotesValue);
    const emailValue = rawEmailValue ?? extractInviteDetail(rawNotesValue, "Invited email:");
    const websiteValue =
      rawWebsiteValue ?? extractInviteDetail(rawNotesValue, "Invited website:");
    const contacted = Boolean(provider.contacted_at);
    const missingContactDetails = !emailValue || !websiteValue;
    const needsResearch =
      (provider.source === "customer_invite" && missingContactDetails) ||
      (provider.verification_status !== "verified" && !contacted);

    return {
      provider,
      emailValue,
      websiteValue,
      websiteHref: normalizeWebsiteHref(websiteValue),
      notesValue,
      contacted,
      needsResearch,
    };
  });

  const visibleProviders = needsResearchFilterActive
    ? providerRows.filter((row) => row.needsResearch)
    : providerRows;

  const emptyState = visibleProviders.length === 0;
  const emailLabel = formatEmailLabel(emailColumn);

  return (
    <AdminDashboardShell
      title="Providers"
      description="Review provider status before activating them for customer dispatch."
      actions={
        <div className="flex flex-col gap-2">
          <Link
            href="/admin/providers/import"
            className="text-sm font-semibold text-emerald-200 hover:text-emerald-100"
          >
            Import providers →
          </Link>
        </div>
      }
    >
      <section className="rounded-2xl border border-slate-900/60 bg-slate-950/30 px-6 py-5">
        <div className="flex flex-wrap items-center gap-2 pb-4 text-xs text-slate-400">
          <FilterChip label="All providers" href="/admin/providers" active={defaultFiltersActive} />
          <FilterChip label="Customer invites" href={inviteFilterHref} active={inviteFilterActive} />
          <FilterChip
            label="Needs research"
            href={needsResearchFilterHref}
            active={needsResearchFilterActive}
          />
        </div>
        <form method="GET" action="/admin/providers" className="flex flex-wrap items-end gap-3">
          {viewFilter !== "all" ? (
            <input
              type="hidden"
              name="view"
              value={viewFilter === "needs_research" ? "needs-research" : viewFilter}
            />
          ) : null}
          <FilterSelect
            name="active"
            label="Active"
            defaultValue={activeFilter}
            options={ACTIVE_FILTERS}
          />
          <FilterSelect
            name="verification"
            label="Verification"
            defaultValue={verificationFilter}
            options={VERIFICATION_FILTERS}
          />
          <FilterSelect
            name="type"
            label="Type"
            defaultValue={typeFilter}
            options={TYPE_FILTERS}
          />
          <FilterSelect
            name="quoting"
            label="Quoting mode"
            defaultValue={quotingFilter}
            options={QUOTING_FILTERS}
          />
          <FilterSelect
            name="source"
            label="Source"
            defaultValue={sourceFilter}
            options={SOURCE_FILTERS}
          />
          <button
            type="submit"
            className="rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-emerald-950 hover:bg-emerald-400"
          >
            Apply
          </button>
        </form>
        {!emailColumn ? (
          <p className="mt-3 text-xs text-slate-500">
            Email editing is unavailable until a provider email column is added to the database.
          </p>
        ) : null}
      </section>

      <AdminTableShell
        className="mt-5"
        head={
          <tr>
            <th className="px-5 py-4">Provider</th>
            <th className="px-5 py-4">Type</th>
            <th className="px-5 py-4">Mode</th>
            <th className="px-5 py-4">Active</th>
            <th className="px-5 py-4">Verification</th>
            <th className="px-5 py-4">Source</th>
            <th className="px-5 py-4">Verified at</th>
            <th className="px-5 py-4">Contact</th>
            <th className="px-5 py-4">Actions</th>
          </tr>
        }
        body={
          emptyState ? (
            <tr>
              <td colSpan={9} className="px-6 py-12 text-center text-base text-slate-300">
                <p className="font-medium text-slate-100">No providers found</p>
                <p className="mt-2 text-sm text-slate-400">
                  Adjust the filters to see the full provider list.
                </p>
              </td>
            </tr>
          ) : (
            visibleProviders.map((row) => {
              const {
                provider,
                emailValue,
                websiteValue,
                websiteHref,
                notesValue,
                contacted,
                needsResearch,
              } = row;
              const activeMeta = activePill(provider.is_active);
              const verificationMeta = verificationPill(provider.verification_status);
              const sourceLabel = formatEnumLabel(provider.source);
              const verifiedAtLabel = formatDateTime(provider.verified_at, { includeTime: true });
              const showInviteSummary = provider.source === "customer_invite";
              const outreachSubject = buildOutreachEmailSubject(provider.name);
              const outreachBody = buildOutreachEmailBody(provider.name);
              const showInDirectory = resolveDirectoryVisibility(provider);
              const directoryButtonLabel = showInDirectory
                ? "Hide from directory"
                : "Show in directory";
              return (
                <Fragment key={provider.id}>
                  <tr className="bg-slate-950/40 transition hover:bg-slate-900/40">
                    <td className={clsx(adminTableCellClass, "px-5 py-4")}>
                      <div className="space-y-1">
                        <p className="text-sm font-semibold text-slate-100">{provider.name}</p>
                        <p className="text-xs text-slate-500">{provider.id}</p>
                      </div>
                    </td>
                    <td className={clsx(adminTableCellClass, "px-5 py-4")}>
                      {formatEnumLabel(provider.provider_type)}
                    </td>
                    <td className={clsx(adminTableCellClass, "px-5 py-4")}>
                      {formatEnumLabel(provider.quoting_mode)}
                    </td>
                    <td className={clsx(adminTableCellClass, "px-5 py-4")}>
                      <span className={pillClass(activeMeta.className)}>{activeMeta.label}</span>
                    </td>
                    <td className={clsx(adminTableCellClass, "px-5 py-4")}>
                      <span className={pillClass(verificationMeta.className)}>
                        {verificationMeta.label}
                      </span>
                    </td>
                    <td className={clsx(adminTableCellClass, "px-5 py-4")}>{sourceLabel}</td>
                    <td className={clsx(adminTableCellClass, "px-5 py-4")}>{verifiedAtLabel}</td>
                    <td className={clsx(adminTableCellClass, "px-5 py-4")}>
                      <div className="space-y-1 text-xs text-slate-300">
                        {emailValue ? (
                          <span>{emailValue}</span>
                        ) : emailColumn ? (
                          <span>—</span>
                        ) : (
                          <span className="text-slate-500">Email unavailable</span>
                        )}
                        {websiteValue ? (
                          websiteHref ? (
                            <Link
                              href={websiteHref}
                              className="text-emerald-200 hover:text-emerald-100"
                            >
                              {websiteValue}
                            </Link>
                          ) : (
                            <span>{websiteValue}</span>
                          )
                        ) : (
                          <span className="text-slate-500">Website —</span>
                        )}
                      </div>
                    </td>
                    <td className={clsx(adminTableCellClass, "px-5 py-4")}>
                      <div className="flex flex-col gap-2 text-xs">
                        {websiteHref ? (
                          <a
                            href={websiteHref}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded-full border border-slate-700 px-3 py-1 font-semibold text-slate-200 transition hover:border-slate-500 hover:text-white"
                          >
                            Open website
                          </a>
                        ) : null}
                        {emailValue ? (
                          <CopyOutreachEmailButton subject={outreachSubject} body={outreachBody} />
                        ) : null}
                        {provider.verification_status !== "verified" ? (
                          <form action={verifyProviderAction}>
                            <input type="hidden" name="providerId" value={provider.id} />
                            <button
                              type="submit"
                              className="rounded-full border border-emerald-500/40 px-3 py-1 font-semibold text-emerald-100 transition hover:border-emerald-400 hover:text-white"
                            >
                              Verify
                            </button>
                          </form>
                        ) : (
                          <span className="text-emerald-200">Verified</span>
                        )}
                        {contacted ? (
                          <span className="text-slate-400">Contacted</span>
                        ) : (
                          <form action={markProviderContactedAction}>
                            <input type="hidden" name="providerId" value={provider.id} />
                            <button
                              type="submit"
                              className="rounded-full border border-slate-700 px-3 py-1 font-semibold text-slate-200 transition hover:border-slate-500 hover:text-white"
                            >
                              Mark contacted
                            </button>
                          </form>
                        )}
                        <form action={toggleProviderActiveAction}>
                          <input type="hidden" name="providerId" value={provider.id} />
                          <input
                            type="hidden"
                            name="nextActive"
                            value={provider.is_active ? "false" : "true"}
                          />
                          <button
                            type="submit"
                            className={clsx(
                              "rounded-full border px-3 py-1 font-semibold transition",
                              provider.is_active
                                ? "border-amber-500/40 text-amber-100 hover:border-amber-400 hover:text-white"
                                : "border-blue-500/40 text-blue-100 hover:border-blue-400 hover:text-white",
                            )}
                          >
                            {provider.is_active ? "Deactivate" : "Activate"}
                          </button>
                        </form>
                        {supportsDirectoryVisibility ? (
                          <form action={toggleProviderDirectoryVisibilityAction}>
                            <input type="hidden" name="providerId" value={provider.id} />
                            <input
                              type="hidden"
                              name="nextShowInDirectory"
                              value={showInDirectory ? "false" : "true"}
                            />
                            <button
                              type="submit"
                              className={clsx(
                                "rounded-full border px-3 py-1 font-semibold transition",
                                showInDirectory
                                  ? "border-amber-500/40 text-amber-100 hover:border-amber-400 hover:text-white"
                                  : "border-emerald-500/40 text-emerald-100 hover:border-emerald-400 hover:text-white",
                              )}
                            >
                              {directoryButtonLabel}
                            </button>
                          </form>
                        ) : null}
                        <details className="rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2">
                          <summary className="cursor-pointer font-semibold text-slate-200">
                            Edit contact
                          </summary>
                          <form action={updateProviderContactAction} className="mt-2 space-y-2">
                            <input type="hidden" name="providerId" value={provider.id} />
                            {emailColumn ? (
                              <label className="flex flex-col gap-1 text-[11px] text-slate-400">
                                {emailLabel}
                                <input
                                  name="email"
                                  defaultValue={emailValue ?? ""}
                                  placeholder="name@provider.com"
                                  className="rounded-lg border border-slate-800 bg-slate-950 px-2 py-1 text-xs text-slate-100 focus:border-emerald-400 focus:outline-none"
                                />
                              </label>
                            ) : null}
                            <label className="flex flex-col gap-1 text-[11px] text-slate-400">
                              Website
                              <input
                                name="website"
                                defaultValue={websiteValue ?? ""}
                                placeholder="https://provider.com"
                                className="rounded-lg border border-slate-800 bg-slate-950 px-2 py-1 text-xs text-slate-100 focus:border-emerald-400 focus:outline-none"
                              />
                            </label>
                            <button
                              type="submit"
                              className="w-full rounded-lg bg-emerald-500 px-2 py-1 text-xs font-semibold text-emerald-950 hover:bg-emerald-400"
                            >
                              Save contact
                            </button>
                          </form>
                        </details>
                      </div>
                    </td>
                  </tr>
                  {showInviteSummary ? (
                    <tr className="bg-slate-950/30">
                      <td colSpan={9} className="px-5 pb-5">
                        <div className="rounded-xl border border-slate-900/70 bg-slate-950/40 px-4 py-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                              Invited details
                            </p>
                            {needsResearch ? (
                              <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-100">
                                Needs research
                              </span>
                            ) : null}
                          </div>
                          <div className="mt-3 grid gap-3 text-xs text-slate-300 md:grid-cols-3">
                            <div className="space-y-1">
                              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                                Email
                              </p>
                              <p>{emailValue || "—"}</p>
                            </div>
                            <div className="space-y-1">
                              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                                Website
                              </p>
                              {websiteValue ? (
                                websiteHref ? (
                                  <Link
                                    href={websiteHref}
                                    className="text-emerald-200 hover:text-emerald-100"
                                  >
                                    {websiteValue}
                                  </Link>
                                ) : (
                                  <p>{websiteValue}</p>
                                )
                              ) : (
                                <p>—</p>
                              )}
                            </div>
                            <div className="space-y-1 md:col-span-3">
                              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                                Notes
                              </p>
                              <p className="whitespace-pre-wrap text-slate-200">
                                {notesValue || "—"}
                              </p>
                            </div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })
          )
        }
      />
    </AdminDashboardShell>
  );
}

function FilterSelect<T extends string>({
  name,
  label,
  defaultValue,
  options,
}: {
  name: string;
  label: string;
  defaultValue: T;
  options: Array<{ value: T; label: string }>;
}) {
  return (
    <label className="flex flex-col gap-2">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</span>
      <select
        name={name}
        defaultValue={defaultValue}
        className="w-full min-w-40 rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white focus:border-emerald-400 focus:outline-none"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function FilterChip({
  label,
  href,
  active,
}: {
  label: string;
  href: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={clsx(
        "rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-wide transition",
        active
          ? "border-emerald-400/60 bg-emerald-500/10 text-emerald-100"
          : "border-slate-800 bg-slate-950/60 text-slate-400 hover:border-slate-700 hover:text-slate-200",
      )}
    >
      {label}
    </Link>
  );
}

function buildProvidersFilterHref(filters: {
  active?: ActiveFilter;
  verification?: VerificationFilter;
  type?: TypeFilter;
  quoting?: QuotingFilter;
  source?: SourceFilter;
  view?: ViewFilter;
}): string {
  const params = new URLSearchParams();
  if (filters.active && filters.active !== "all") params.set("active", filters.active);
  if (filters.verification && filters.verification !== "all") {
    params.set("verification", filters.verification);
  }
  if (filters.type && filters.type !== "all") params.set("type", filters.type);
  if (filters.quoting && filters.quoting !== "all") params.set("quoting", filters.quoting);
  if (filters.source && filters.source !== "all") params.set("source", filters.source);
  if (filters.view && filters.view !== "all") {
    params.set("view", filters.view === "needs_research" ? "needs-research" : filters.view);
  }
  const qs = params.toString();
  return qs ? `/admin/providers?${qs}` : "/admin/providers";
}

function parseActiveFilter(value: unknown): ActiveFilter {
  const normalized = normalizeFilterValue(value);
  if (normalized === "active" || normalized === "inactive") {
    return normalized;
  }
  return "all";
}

function parseVerificationFilter(value: unknown): VerificationFilter {
  const normalized = normalizeFilterValue(value);
  if (PROVIDER_VERIFICATION_STATUSES.includes(normalized as ProviderVerificationStatus)) {
    return normalized as ProviderVerificationStatus;
  }
  return "all";
}

function parseTypeFilter(value: unknown): TypeFilter {
  const normalized = normalizeFilterValue(value);
  if (PROVIDER_TYPES.includes(normalized as ProviderType)) {
    return normalized as ProviderType;
  }
  return "all";
}

function parseQuotingFilter(value: unknown): QuotingFilter {
  const normalized = normalizeFilterValue(value);
  if (PROVIDER_QUOTING_MODES.includes(normalized as ProviderQuotingMode)) {
    return normalized as ProviderQuotingMode;
  }
  return "all";
}

function parseSourceFilter(value: unknown): SourceFilter {
  const normalized = normalizeFilterValue(value);
  if (PROVIDER_SOURCES.includes(normalized as ProviderSource)) {
    return normalized as ProviderSource;
  }
  return "all";
}

function parseViewFilter(value: unknown): ViewFilter {
  const normalized = normalizeFilterValue(value);
  if (normalized === "needs_research" || normalized === "needs-research") {
    return "needs_research";
  }
  return "all";
}

function normalizeFilterValue(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase();
}

function formatEnumLabel(value?: string | null): string {
  if (!value) return "";
  const collapsed = value.replace(/[_-]+/g, " ").trim();
  if (!collapsed) return "";
  return collapsed
    .split(" ")
    .map((segment) => (segment ? segment[0].toUpperCase() + segment.slice(1) : ""))
    .join(" ");
}

function formatEmailLabel(column: ProviderEmailColumn | null): string {
  switch (column) {
    case "primary_email":
      return "Primary email";
    case "contact_email":
      return "Contact email";
    case "email":
    default:
      return "Email";
  }
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

function stripInviteDetailLines(notes: string | null): string | null {
  if (!notes) return null;
  const lines = notes
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return false;
      if (trimmed.startsWith("Invited email:")) return false;
      if (trimmed.startsWith("Invited website:")) return false;
      return true;
    })
    .join("\n")
    .trim();
  return lines.length > 0 ? lines : null;
}

function normalizeWebsiteHref(value: string | null): string | null {
  if (!value) return null;
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

function buildOutreachEmailSubject(providerName: string): string {
  const name = normalizeOutreachName(providerName);
  return name ? `Quote request for ${name}` : "Quote request";
}

function buildOutreachEmailBody(providerName: string): string {
  const name = normalizeOutreachName(providerName);
  const greeting = name ? `Hi ${name} team,` : "Hi there,";
  return [
    greeting,
    "",
    "We're looking to request a quote for a customer part.",
    "Are you able to quote from STEP files and drawings?",
    "",
    "If so, please reply with your preferred contact and any quoting requirements.",
    "",
    "Thanks,",
    "Zartman Team",
  ].join("\n");
}

function normalizeOutreachName(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function pillClass(colorClasses: string): string {
  return clsx(
    "inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
    colorClasses,
  );
}

function activePill(isActive: boolean): { label: string; className: string } {
  return isActive
    ? { label: "Active", className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-100" }
    : { label: "Inactive", className: "border-slate-700 bg-slate-900/60 text-slate-200" };
}

function verificationPill(status: ProviderVerificationStatus): { label: string; className: string } {
  if (status === "verified") {
    return { label: "Verified", className: "border-blue-500/40 bg-blue-500/10 text-blue-100" };
  }
  return { label: "Unverified", className: "border-amber-500/40 bg-amber-500/10 text-amber-100" };
}

function resolveDirectoryVisibility(provider: ProviderContactRow): boolean {
  if (typeof provider.show_in_directory === "boolean") {
    return provider.show_in_directory;
  }
  return provider.verification_status === "verified";
}
