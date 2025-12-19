import Link from "next/link";

import { PortalShell } from "../../components/PortalShell";
import { PortalLoginPanel } from "../../PortalLoginPanel";
import PortalCard from "../../PortalCard";
import { EmptyStateNotice } from "../../EmptyStateNotice";

import { getServerAuthUser } from "@/server/auth";
import { resolveUserRoles } from "@/server/users/roles";
import {
  getSupplierApprovalStatus,
  loadSupplierProfileByUserId,
} from "@/server/suppliers";
import { approvalsEnabled } from "@/server/suppliers/flags";
import {
  loadSupplierRfqsDiscovery,
  type SupplierRfqsDiscoveryFilters,
  type SupplierRfqsDiscoveryRow,
} from "@/server/suppliers/rfqsDiscovery";
import { QuoteStatusBadge } from "@/app/(portals)/components/QuoteStatusBadge";
import {
  formatRelativeTimeCompactFromTimestamp,
  toTimestamp,
} from "@/lib/relativeTime";
import { normalizeSearchParams } from "@/lib/route/normalizeSearchParams";
import { resolveMaybePromise, type SearchParamsLike } from "@/app/(portals)/quotes/pageUtils";

export const dynamic = "force-dynamic";

type SupplierRfqsDiscoveryPageProps = {
  searchParams?: Promise<SearchParamsLike>;
};

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeLower(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function formatDue(value: string | null): string {
  return formatRelativeTimeCompactFromTimestamp(toTimestamp(value)) ?? "—";
}

function asMatchHealth(value: unknown): SupplierRfqsDiscoveryFilters["matchHealth"] {
  const v = normalizeLower(value);
  if (v === "good" || v === "caution" || v === "poor" || v === "unknown") return v;
  return null;
}

function asBenchStatus(value: unknown): SupplierRfqsDiscoveryFilters["benchStatus"] {
  const v = normalizeLower(value);
  if (v === "underused" || v === "balanced" || v === "overused" || v === "unknown") return v;
  return null;
}

function matchHealthChip(value: SupplierRfqsDiscoveryRow["matchHealth"]) {
  switch (value) {
    case "good":
      return {
        label: "Good",
        className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-100",
      };
    case "caution":
      return {
        label: "Caution",
        className: "border-amber-500/40 bg-amber-500/10 text-amber-100",
      };
    case "poor":
      return {
        label: "Poor",
        className: "border-red-500/40 bg-red-500/10 text-red-100",
      };
    default:
      return {
        label: "Unknown",
        className: "border-slate-800 bg-slate-950/50 text-slate-300",
      };
  }
}

function benchChip(value: SupplierRfqsDiscoveryRow["benchStatus"]) {
  switch (value) {
    case "underused":
      return {
        label: "Underused",
        className: "border-blue-500/40 bg-blue-500/10 text-blue-100",
      };
    case "balanced":
      return {
        label: "Balanced",
        className: "border-slate-800 bg-slate-950/50 text-slate-200",
      };
    case "overused":
      return {
        label: "Overused",
        className: "border-amber-500/40 bg-amber-500/10 text-amber-100",
      };
    default:
      return {
        label: "Unknown",
        className: "border-slate-800 bg-slate-950/50 text-slate-300",
      };
  }
}

function pill(label: string, className: string) {
  return (
    <span
      className={`inline-flex w-fit items-center rounded-full border px-3 py-1 text-[11px] font-semibold ${className}`}
    >
      {label}
    </span>
  );
}

export default async function SupplierRfqsDiscoveryPage({
  searchParams,
}: SupplierRfqsDiscoveryPageProps) {
  const { user } = await getServerAuthUser();

  if (!user) {
    return <PortalLoginPanel role="supplier" fallbackRedirect="/supplier/rfqs" />;
  }

  const roles = await resolveUserRoles(user.id);
  if (!roles?.isSupplier) {
    return (
      <PortalShell
        workspace="supplier"
        title="RFQs for you"
        subtitle="This workspace is reserved for supplier accounts."
      >
        <EmptyStateNotice
          title="Supplier access required"
          description="Switch to the customer portal or contact support if you need supplier access."
          action={
            <Link
              href="/customer"
              className="text-sm font-semibold text-blue-300 underline-offset-4 hover:underline"
            >
              Go to customer portal
            </Link>
          }
        />
      </PortalShell>
    );
  }

  const profile = await loadSupplierProfileByUserId(user.id);
  const supplier = profile?.supplier ?? null;
  if (!supplier) {
    return (
      <PortalShell
        workspace="supplier"
        title="RFQs for you"
        subtitle="Finish onboarding to start receiving RFQs here."
      >
        <EmptyStateNotice
          title="Complete supplier onboarding"
          description="Share your capabilities so we can route the right RFQs."
          action={
            <Link
              href="/supplier/onboarding"
              className="text-sm font-semibold text-blue-300 underline-offset-4 hover:underline"
            >
              Finish onboarding
            </Link>
          }
        />
      </PortalShell>
    );
  }

  const approvalsOn = approvalsEnabled();
  const supplierStatus = supplier?.status ?? "pending";
  const approvalStatus =
    profile?.approvalStatus ??
    getSupplierApprovalStatus({ status: supplierStatus });
  const approvalGateActive = approvalsOn && approvalStatus !== "approved";

  const resolvedSearchParams = await resolveMaybePromise(searchParams);
  const sp = normalizeSearchParams(resolvedSearchParams);

  const filters: SupplierRfqsDiscoveryFilters = {
    search: normalizeText(sp.get("search")) || null,
    status: normalizeText(sp.get("status")) || null,
    process: normalizeText(sp.get("process")) || null,
    material: normalizeText(sp.get("material")) || null,
    region: normalizeText(sp.get("region")) || null,
    matchHealth: asMatchHealth(sp.get("matchHealth")),
    benchStatus: asBenchStatus(sp.get("benchStatus")),
  };

  const hasFilters = Boolean(
    filters.search ||
      filters.status ||
      filters.process ||
      filters.material ||
      filters.region ||
      filters.matchHealth ||
      filters.benchStatus,
  );

  const rows = approvalGateActive ? [] : await loadSupplierRfqsDiscovery(user.id, filters);

  return (
    <PortalShell
      workspace="supplier"
      title="RFQs for you"
      subtitle="Sorted by how well they fit your capabilities and current bench."
      actions={
        <div className="flex flex-wrap gap-3">
          <Link
            href="/supplier"
            className="inline-flex items-center rounded-full border border-blue-400/40 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-blue-100 transition hover:border-blue-300 hover:text-white"
          >
            Back to dashboard
          </Link>
          <Link
            href="/supplier/quotes"
            className="inline-flex items-center rounded-full border border-slate-800 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-200 transition hover:border-slate-600 hover:text-white"
          >
            Your quotes
          </Link>
        </div>
      }
    >
      <PortalCard
        title="Recommended RFQs"
        description="A marketplace-style inbox of open RFQs you’re eligible to bid on."
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-400">
            Sort: Recommended
          </p>
          <Link
            href="/supplier/rfqs"
            className="text-xs font-semibold text-slate-300 underline-offset-4 hover:underline"
          >
            Clear filters
          </Link>
        </div>

        <form method="get" className="mb-4 flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs font-semibold text-slate-300">
            Search
            <input
              name="search"
              defaultValue={filters.search ?? ""}
              placeholder="Customer, RFQ…"
              className="w-56 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 text-xs text-slate-100 outline-none transition focus:border-blue-400"
            />
          </label>

          <label className="flex flex-col gap-1 text-xs font-semibold text-slate-300">
            Status
            <select
              name="status"
              defaultValue={normalizeLower(filters.status)}
              className="rounded-lg border border-slate-800 bg-slate-950/60 px-2 py-2 text-xs text-slate-100 outline-none transition focus:border-blue-400"
            >
              <option value="">All</option>
              <option value="open">Open</option>
            </select>
          </label>

          <label className="flex flex-col gap-1 text-xs font-semibold text-slate-300">
            Process
            <input
              name="process"
              defaultValue={filters.process ?? ""}
              placeholder="e.g. CNC"
              className="w-40 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 text-xs text-slate-100 outline-none transition focus:border-blue-400"
            />
          </label>

          <label className="flex flex-col gap-1 text-xs font-semibold text-slate-300">
            Material
            <input
              name="material"
              defaultValue={filters.material ?? ""}
              placeholder="e.g. aluminum"
              className="w-40 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 text-xs text-slate-100 outline-none transition focus:border-blue-400"
            />
          </label>

          <label className="flex flex-col gap-1 text-xs font-semibold text-slate-300">
            Region
            <input
              name="region"
              defaultValue={filters.region ?? ""}
              placeholder="e.g. US / 94107"
              className="w-40 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 text-xs text-slate-100 outline-none transition focus:border-blue-400"
            />
          </label>

          <label className="flex flex-col gap-1 text-xs font-semibold text-slate-300">
            Match health
            <select
              name="matchHealth"
              defaultValue={filters.matchHealth ?? ""}
              className="rounded-lg border border-slate-800 bg-slate-950/60 px-2 py-2 text-xs text-slate-100 outline-none transition focus:border-blue-400"
            >
              <option value="">Any</option>
              <option value="good">Good</option>
              <option value="caution">Caution</option>
              <option value="poor">Poor</option>
              <option value="unknown">Unknown</option>
            </select>
          </label>

          <label className="flex flex-col gap-1 text-xs font-semibold text-slate-300">
            Bench
            <select
              name="benchStatus"
              defaultValue={filters.benchStatus ?? ""}
              className="rounded-lg border border-slate-800 bg-slate-950/60 px-2 py-2 text-xs text-slate-100 outline-none transition focus:border-blue-400"
            >
              <option value="">Any</option>
              <option value="underused">Underused</option>
              <option value="balanced">Balanced</option>
              <option value="overused">Overused</option>
              <option value="unknown">Unknown</option>
            </select>
          </label>

          <button
            type="submit"
            className="inline-flex items-center rounded-lg bg-blue-500 px-4 py-2 text-xs font-semibold text-black transition hover:bg-blue-400"
          >
            Apply
          </button>
        </form>

        {approvalGateActive ? (
          <div className="rounded-2xl border border-slate-900/70 bg-black/40 p-6">
            <p className="text-sm font-semibold text-slate-100">
              RFQs unlock after approval
            </p>
            <p className="mt-2 text-sm text-slate-400">
              We’ll populate this list as soon as your supplier profile is approved.
            </p>
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-2xl border border-slate-900/70 bg-black/40 p-6">
            {hasFilters ? (
              <>
                <p className="text-sm font-semibold text-slate-100">
                  No RFQs match your current filters.
                </p>
                <p className="mt-2 text-sm text-slate-400">
                  Try clearing filters to see all open RFQs you can bid on.
                </p>
                <div className="mt-4">
                  <Link
                    href="/supplier/rfqs"
                    className="inline-flex items-center rounded-full bg-blue-500 px-4 py-2 text-sm font-semibold text-black transition hover:bg-blue-400"
                  >
                    Clear filters
                  </Link>
                </div>
              </>
            ) : (
              <>
                <p className="text-sm font-semibold text-slate-100">
                  No open RFQs for you yet
                </p>
                <p className="mt-2 text-sm text-slate-400">
                  Check back soon or update your capabilities so we can route better-fit work.
                </p>
                <div className="mt-4 flex flex-wrap gap-3">
                  <Link
                    href="/supplier/onboarding"
                    className="inline-flex items-center rounded-full bg-blue-500 px-4 py-2 text-sm font-semibold text-black transition hover:bg-blue-400"
                  >
                    Update capabilities
                  </Link>
                  <Link
                    href="/supplier"
                    className="inline-flex items-center rounded-full border border-slate-800 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:border-slate-600 hover:text-white"
                  >
                    Back to dashboard
                  </Link>
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-slate-900/70 bg-black/40">
            <table className="min-w-full divide-y divide-slate-900/70 text-sm">
              <thead className="bg-slate-900/60">
                <tr>
                  <th className="px-5 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">
                    RFQ
                  </th>
                  <th className="px-5 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">
                    Region
                  </th>
                  <th className="px-5 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">
                    Processes
                  </th>
                  <th className="px-5 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">
                    Materials
                  </th>
                  <th className="px-5 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">
                    Status
                  </th>
                  <th className="px-5 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">
                    Due
                  </th>
                  <th className="px-5 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">
                    Match
                  </th>
                  <th className="px-5 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">
                    Bench
                  </th>
                  <th className="px-5 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-900/70">
                {rows.map((row) => {
                  const match = matchHealthChip(row.matchHealth);
                  const bench = benchChip(row.benchStatus);
                  const isRecommended = row.recommendedScore >= 50;
                  const hasBid = row.hasAlreadyBid;

                  return (
                    <tr key={row.quoteId} className="hover:bg-slate-900/50">
                      <td className="px-5 py-4 align-middle">
                        <div className="flex flex-col gap-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <Link
                              href={`/supplier/quotes/${row.quoteId}#bid`}
                              className="font-medium text-slate-100 underline-offset-4 transition hover:underline"
                            >
                              {row.rfqLabel}
                            </Link>
                            {isRecommended
                              ? pill(
                                  "Recommended",
                                  "border-blue-400/40 bg-blue-500/10 text-blue-100",
                                )
                              : null}
                            {hasBid
                              ? pill(
                                  "Bid submitted",
                                  "border-slate-800 bg-slate-950/50 text-slate-200",
                                )
                              : null}
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs text-slate-500">
                              {row.customerName ?? "Customer"}
                            </span>
                            {row.isAlreadyInvited
                              ? pill(
                                  "Invited",
                                  "border-emerald-500/20 bg-emerald-500/5 text-emerald-100",
                                )
                              : null}
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-4 align-middle text-slate-300">
                        {row.region ?? "—"}
                      </td>
                      <td className="px-5 py-4 align-middle">
                        <div className="flex flex-wrap gap-2">
                          {(row.processes.length > 0 ? row.processes : ["—"]).map((p) => (
                            <span
                              key={p}
                              className="inline-flex items-center rounded-full border border-slate-800 bg-slate-950/50 px-3 py-1 text-[11px] font-semibold text-slate-200"
                            >
                              {p}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-5 py-4 align-middle">
                        <div className="flex flex-wrap gap-2">
                          {(row.materials.length > 0 ? row.materials.slice(0, 3) : ["—"]).map(
                            (m) => (
                              <span
                                key={m}
                                className="inline-flex items-center rounded-full border border-slate-800 bg-slate-950/50 px-3 py-1 text-[11px] font-semibold text-slate-200"
                              >
                                {m}
                              </span>
                            ),
                          )}
                          {row.materials.length > 3 ? (
                            <span className="text-xs text-slate-500">
                              +{row.materials.length - 3}
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-5 py-4 align-middle">
                        <QuoteStatusBadge status={row.status} size="sm" />
                      </td>
                      <td className="px-5 py-4 align-middle text-slate-300">
                        {formatDue(row.dueAt)}
                      </td>
                      <td className="px-5 py-4 align-middle">
                        <span
                          className={`inline-flex w-fit items-center rounded-full border px-3 py-1 text-[11px] font-semibold ${match.className}`}
                        >
                          {match.label}
                        </span>
                      </td>
                      <td className="px-5 py-4 align-middle">
                        <span
                          className={`inline-flex w-fit items-center rounded-full border px-3 py-1 text-[11px] font-semibold ${bench.className}`}
                        >
                          {bench.label}
                        </span>
                      </td>
                      <td className="px-5 py-4 align-middle">
                        <Link
                          href={`/supplier/quotes/${row.quoteId}#bid`}
                          className="inline-flex items-center rounded-lg bg-blue-500 px-3 py-2 text-xs font-semibold text-black transition hover:bg-blue-400"
                        >
                          View RFQ
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </PortalCard>
    </PortalShell>
  );
}
