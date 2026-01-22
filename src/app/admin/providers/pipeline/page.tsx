import Link from "next/link";
import clsx from "clsx";
import AdminDashboardShell from "@/app/admin/AdminDashboardShell";
import AdminTableShell from "@/app/admin/AdminTableShell";
import ProviderPipelineTableBody from "@/app/admin/providers/pipeline/ProviderPipelineTableBody";
import { normalizeSearchParams } from "@/lib/route/normalizeSearchParams";
import { requireAdminUser } from "@/server/auth";
import { listOpsEventsForProvider, type OpsEventRecord } from "@/server/ops/events";
import { hasColumns } from "@/server/db/schemaContract";
import {
  listProviderPipelineRows,
  type ProviderPipelineView,
} from "@/server/providers/pipeline";

export const dynamic = "force-dynamic";

type MatchFilter = "all" | "mismatch" | "partial";

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
  const matchFilter = parseMatchFilter(usp.get("match"));

  const { rows, emailColumn } = await listProviderPipelineRows({
    view,
    search: searchInput,
    match: matchFilter,
  });

  const supportsDirectoryVisibility = await hasColumns("providers", ["show_in_directory"]);
  const opsEventsByProviderId: Record<string, OpsEventRecord[]> = {};
  await Promise.all(
    rows.map(async (row) => {
      const result = await listOpsEventsForProvider(row.provider.id, { limit: 20 });
      opsEventsByProviderId[row.provider.id] = result.ok ? result.events : [];
    }),
  );

  const isEmpty = rows.length === 0;
  const mismatchOnlyHref = buildPipelineFilterHref({
    view,
    search: searchInput,
    match: "mismatch",
  });
  const partialOnlyHref = buildPipelineFilterHref({
    view,
    search: searchInput,
    match: "partial",
  });

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
            const href = buildPipelineFilterHref({
              view: filter.value,
              search: searchInput,
              match: matchFilter,
            });
            return (
              <FilterChip key={filter.value} label={filter.label} href={href} active={view === filter.value} />
            );
          })}
          <FilterChip
            label="Mismatch only"
            href={mismatchOnlyHref}
            active={matchFilter === "mismatch"}
          />
          <FilterChip
            label="Partial only"
            href={partialOnlyHref}
            active={matchFilter === "partial"}
          />
        </div>
        <form method="GET" action="/admin/providers/pipeline" className="flex flex-wrap items-end gap-3">
          {view !== "queue" ? (
            <input type="hidden" name="view" value={serializePipelineView(view)} />
          ) : null}
          {matchFilter !== "all" ? (
            <input type="hidden" name="match" value={matchFilter} />
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
            <th className="px-5 py-4">Select</th>
            <th className="px-5 py-4">Provider</th>
            <th className="px-5 py-4">Contact</th>
            <th className="px-5 py-4">Match health</th>
            <th className="px-5 py-4">Status</th>
            <th className="px-5 py-4">Next action</th>
            <th className="px-5 py-4">Actions</th>
          </tr>
        }
        body={
          isEmpty ? (
            <tr>
              <td colSpan={7} className="px-6 py-12 text-center text-base text-slate-300">
                <p className="font-medium text-slate-100">No providers found</p>
                <p className="mt-2 text-sm text-slate-400">
                  Adjust the filters to see more providers in the pipeline.
                </p>
              </td>
            </tr>
          ) : (
            <ProviderPipelineTableBody
              rows={rows}
              emailColumnAvailable={Boolean(emailColumn)}
              opsEventsByProviderId={opsEventsByProviderId}
              supportsDirectoryVisibility={supportsDirectoryVisibility}
            />
          )
        }
      />
    </AdminDashboardShell>
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
  match?: MatchFilter;
}): string {
  const params = new URLSearchParams();
  if (args.view && args.view !== "queue") {
    params.set("view", serializePipelineView(args.view));
  }
  if (args.search) {
    params.set("search", args.search);
  }
  if (args.match && args.match !== "all") {
    params.set("match", args.match);
  }
  const qs = params.toString();
  return qs ? `/admin/providers/pipeline?${qs}` : "/admin/providers/pipeline";
}

function normalizeSearchInput(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseMatchFilter(value: unknown): MatchFilter {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (normalized === "mismatch") return "mismatch";
  if (normalized === "partial") return "partial";
  return "all";
}
