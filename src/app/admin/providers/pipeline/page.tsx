import Link from "next/link";
import { Fragment } from "react";
import clsx from "clsx";
import AdminDashboardShell from "@/app/admin/AdminDashboardShell";
import AdminTableShell, { adminTableCellClass } from "@/app/admin/AdminTableShell";
import { CopyOutreachEmailButton } from "@/app/admin/providers/CopyOutreachEmailButton";
import {
  markProviderContactedAction,
  toggleProviderActiveAction,
  unverifyProviderAction,
  verifyProviderAction,
} from "@/app/admin/providers/actions";
import { formatDateTime } from "@/lib/formatDate";
import { normalizeSearchParams } from "@/lib/route/normalizeSearchParams";
import { requireAdminUser } from "@/server/auth";
import { listOpsEventsForProvider, type OpsEventRecord } from "@/server/ops/events";
import {
  listProviderPipelineRows,
  type ProviderPipelineRow,
  type ProviderPipelineView,
} from "@/server/providers/pipeline";

export const dynamic = "force-dynamic";

const PIPELINE_FILTERS: Array<{ value: ProviderPipelineView; label: string }> = [
  { value: "queue", label: "Queue" },
  { value: "needs_research", label: "Needs research" },
  { value: "not_contacted", label: "Not contacted" },
  { value: "contacted", label: "Contacted (not verified)" },
  { value: "verified_inactive", label: "Verified (not active)" },
  { value: "active_verified", label: "Active + verified" },
];

export default async function AdminProviderPipelinePage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdminUser({ redirectTo: "/login" });

  const usp = normalizeSearchParams(searchParams ? await searchParams : undefined);
  const view = parsePipelineView(usp.get("view"));
  const searchInput = normalizeSearchInput(usp.get("search"));

  const { rows, emailColumn } = await listProviderPipelineRows({
    view,
    search: searchInput,
  });

  const opsEventsByProviderId = new Map<string, OpsEventRecord[]>();
  await Promise.all(
    rows.map(async (row) => {
      const result = await listOpsEventsForProvider(row.provider.id, { limit: 20 });
      opsEventsByProviderId.set(row.provider.id, result.ok ? result.events : []);
    }),
  );

  const isEmpty = rows.length === 0;

  return (
    <AdminDashboardShell
      title="Provider pipeline"
      description="Track discovery, outreach, verification, and activation in one queue."
      actions={
        <div className="flex flex-col gap-2">
          <Link
            href="/admin/providers"
            className="text-sm font-semibold text-emerald-200 hover:text-emerald-100"
          >
            Providers review →
          </Link>
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
          {PIPELINE_FILTERS.map((filter) => {
            const href = buildPipelineFilterHref({ view: filter.value, search: searchInput });
            return (
              <FilterChip key={filter.value} label={filter.label} href={href} active={view === filter.value} />
            );
          })}
        </div>
        <form method="GET" action="/admin/providers/pipeline" className="flex flex-wrap items-end gap-3">
          {view !== "queue" ? (
            <input type="hidden" name="view" value={serializePipelineView(view)} />
          ) : null}
          <label className="flex w-full min-w-[220px] flex-1 flex-col gap-2 sm:w-auto">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Search
            </span>
            <input
              type="search"
              name="search"
              defaultValue={searchInput ?? ""}
              placeholder="Search name or domain"
              className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white focus:border-emerald-400 focus:outline-none"
            />
          </label>
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
            <th className="px-5 py-4">Contact</th>
            <th className="px-5 py-4">Status</th>
            <th className="px-5 py-4">Actions</th>
          </tr>
        }
        body={
          isEmpty ? (
            <tr>
              <td colSpan={4} className="px-6 py-12 text-center text-base text-slate-300">
                <p className="font-medium text-slate-100">No providers found</p>
                <p className="mt-2 text-sm text-slate-400">
                  Adjust the filters to see more providers in the pipeline.
                </p>
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <ProviderPipelineRowDisplay
                key={row.provider.id}
                row={row}
                emailColumnAvailable={Boolean(emailColumn)}
                opsEvents={opsEventsByProviderId.get(row.provider.id) ?? []}
              />
            ))
          )
        }
      />
    </AdminDashboardShell>
  );
}

function ProviderPipelineRowDisplay({
  row,
  emailColumnAvailable,
  opsEvents,
}: {
  row: ProviderPipelineRow;
  emailColumnAvailable: boolean;
  opsEvents: OpsEventRecord[];
}) {
  const { provider, emailValue, websiteValue, rfqUrlValue, contacted, needsResearch } = row;
  const websiteHref = normalizeWebsiteHref(websiteValue);
  const rfqUrlHref = normalizeWebsiteHref(rfqUrlValue);
  const openWebsiteHref = websiteHref ?? rfqUrlHref;
  const activeMeta = activePill(provider.is_active);
  const verificationMeta = verificationPill(provider.verification_status);
  const contactMeta = contactedPill(contacted);
  const contactedAtLabel = provider.contacted_at
    ? formatDateTime(provider.contacted_at, { includeTime: true })
    : null;
  const outreachSubject = buildOutreachEmailSubject(provider.name);
  const outreachBody = buildOutreachEmailBody(provider.name);

  return (
    <Fragment>
      <tr className="bg-slate-950/40 transition hover:bg-slate-900/40">
        <td className={clsx(adminTableCellClass, "px-5 py-4")}>
          <div className="space-y-1">
            <p className="text-sm font-semibold text-slate-100">{provider.name}</p>
            <p className="text-xs text-slate-500">{provider.id}</p>
            <p className="text-[11px] text-slate-400">{formatEnumLabel(provider.source)}</p>
          </div>
        </td>
        <td className={clsx(adminTableCellClass, "px-5 py-4")}>
          <div className="space-y-1 text-xs text-slate-300">
            {emailValue ? (
              <span>{emailValue}</span>
            ) : emailColumnAvailable ? (
              <span>—</span>
            ) : (
              <span className="text-slate-500">Email unavailable</span>
            )}
            {websiteValue ? (
              websiteHref ? (
                <Link href={websiteHref} className="text-emerald-200 hover:text-emerald-100">
                  {websiteValue}
                </Link>
              ) : (
                <span>{websiteValue}</span>
              )
            ) : (
              <span className="text-slate-500">Website —</span>
            )}
            {rfqUrlValue ? (
              rfqUrlHref ? (
                <Link href={rfqUrlHref} className="text-emerald-200 hover:text-emerald-100">
                  {rfqUrlValue}
                </Link>
              ) : (
                <span>{rfqUrlValue}</span>
              )
            ) : (
              <span className="text-slate-500">RFQ URL —</span>
            )}
          </div>
        </td>
        <td className={clsx(adminTableCellClass, "px-5 py-4")}>
          <div className="flex flex-wrap items-center gap-2">
            <span className={pillClass(contactMeta.className)}>{contactMeta.label}</span>
            <span className={pillClass(verificationMeta.className)}>{verificationMeta.label}</span>
            <span className={pillClass(activeMeta.className)}>{activeMeta.label}</span>
            {needsResearch ? (
              <span className={pillClass("border-amber-500/40 bg-amber-500/10 text-amber-100")}>
                Needs research
              </span>
            ) : null}
          </div>
          {contactedAtLabel ? (
            <p className="mt-2 text-[11px] text-slate-500">Contacted {contactedAtLabel}</p>
          ) : null}
        </td>
        <td className={clsx(adminTableCellClass, "px-5 py-4")}>
          <div className="flex flex-col gap-2 text-xs">
            {openWebsiteHref ? (
              <a
                href={openWebsiteHref}
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
              <form action={unverifyProviderAction}>
                <input type="hidden" name="providerId" value={provider.id} />
                <button
                  type="submit"
                  className="rounded-full border border-amber-500/40 px-3 py-1 font-semibold text-amber-100 transition hover:border-amber-400 hover:text-white"
                >
                  Unverify
                </button>
              </form>
            )}
            <form action={toggleProviderActiveAction}>
              <input type="hidden" name="providerId" value={provider.id} />
              <input type="hidden" name="nextActive" value={provider.is_active ? "false" : "true"} />
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
          </div>
        </td>
      </tr>
      <tr className="bg-slate-950/30">
        <td colSpan={4} className="px-5 pb-5">
          <details className="rounded-xl border border-slate-900/70 bg-slate-950/40 px-4 py-3">
            <summary className="cursor-pointer font-semibold text-slate-200">
              Ops timeline ({opsEvents.length})
            </summary>
            <div className="mt-3">
              {opsEvents.length === 0 ? (
                <p className="text-xs text-slate-400">No ops events yet.</p>
              ) : (
                <div className="divide-y divide-slate-900/60">
                  {opsEvents.map((event) => {
                    const timestamp =
                      formatDateTime(event.created_at, { includeTime: true }) ?? event.created_at;
                    return (
                      <div
                        key={event.id}
                        className="grid gap-3 py-3 sm:grid-cols-[150px_minmax(0,1fr)]"
                      >
                        <div className="text-xs text-slate-400">{timestamp}</div>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-slate-100">
                            {formatOpsEventTypeLabel(event.event_type)}
                          </p>
                          <p className="mt-0.5 text-xs text-slate-400">
                            {renderProviderOpsEventSummary(event)}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </details>
        </td>
      </tr>
    </Fragment>
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

function parsePipelineView(value: unknown): ProviderPipelineView {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  switch (normalized) {
    case "needs-research":
    case "needs_research":
      return "needs_research";
    case "not-contacted":
    case "not_contacted":
      return "not_contacted";
    case "contacted":
      return "contacted";
    case "verified-inactive":
    case "verified_inactive":
      return "verified_inactive";
    case "active-verified":
    case "active_verified":
      return "active_verified";
    case "all":
      return "all";
    case "queue":
    default:
      return "queue";
  }
}

function serializePipelineView(view: ProviderPipelineView): string {
  switch (view) {
    case "needs_research":
      return "needs-research";
    case "not_contacted":
      return "not-contacted";
    case "verified_inactive":
      return "verified-inactive";
    case "active_verified":
      return "active-verified";
    default:
      return view;
  }
}

function buildPipelineFilterHref(args: {
  view: ProviderPipelineView;
  search?: string | null;
}): string {
  const params = new URLSearchParams();
  if (args.view && args.view !== "queue") {
    params.set("view", serializePipelineView(args.view));
  }
  if (args.search) {
    params.set("search", args.search);
  }
  const qs = params.toString();
  return qs ? `/admin/providers/pipeline?${qs}` : "/admin/providers/pipeline";
}

function normalizeSearchInput(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
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

function formatOpsEventTypeLabel(value: string): string {
  const label = formatEnumLabel(value);
  return label || "Event";
}

function renderProviderOpsEventSummary(event: OpsEventRecord): string {
  const payload = event.payload ?? {};
  switch (event.event_type) {
    case "provider_contacted": {
      const email = resolvePayloadString(payload, "provider_email");
      return email ? `Outreach logged (${email})` : "Outreach logged";
    }
    case "provider_verified":
      return "Verification marked verified";
    case "provider_unverified":
      return "Verification reset";
    case "provider_activated":
      return "Provider activated";
    case "provider_deactivated":
      return "Provider deactivated";
    case "supplier_invited": {
      const supplierName = resolvePayloadString(payload, "supplier_name");
      return supplierName ? `Supplier invited (${supplierName})` : "Supplier invited";
    }
    default:
      return "Ops event recorded";
  }
}

function resolvePayloadString(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
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

function contactedPill(contacted: boolean): { label: string; className: string } {
  return contacted
    ? { label: "Contacted", className: "border-blue-500/40 bg-blue-500/10 text-blue-100" }
    : { label: "Not contacted", className: "border-slate-700 bg-slate-900/60 text-slate-200" };
}

function activePill(isActive: boolean): { label: string; className: string } {
  return isActive
    ? { label: "Active", className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-100" }
    : { label: "Inactive", className: "border-slate-700 bg-slate-900/60 text-slate-200" };
}

function verificationPill(status: string): { label: string; className: string } {
  if (status === "verified") {
    return { label: "Verified", className: "border-blue-500/40 bg-blue-500/10 text-blue-100" };
  }
  return { label: "Unverified", className: "border-amber-500/40 bg-amber-500/10 text-amber-100" };
}
