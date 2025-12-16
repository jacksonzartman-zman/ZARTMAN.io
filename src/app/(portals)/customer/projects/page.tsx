import clsx from "clsx";
import Link from "next/link";
import type { ReadonlyURLSearchParams } from "next/navigation";

import PortalCard from "@/app/(portals)/PortalCard";
import { PortalShell } from "@/app/(portals)/components/PortalShell";
import { formatDateTime } from "@/lib/formatDate";
import {
  formatRelativeTimeCompactFromTimestamp,
  toTimestamp,
} from "@/lib/relativeTime";
import { requireUser } from "@/server/auth";
import { getCustomerByUserId } from "@/server/customers";
import { getCustomerAwardedQuotesForProjects } from "@/server/customer/projects";
import CustomerProjectsListControls, {
  type CustomerProjectsSortKey,
  type CustomerProjectsStatusFilter,
} from "./CustomerProjectsListControls";

export const dynamic = "force-dynamic";

function formatAwardedDate(value: string | null): string {
  if (!value) return "—";
  return formatDateTime(value) ?? "—";
}

function formatLastUpdated(value: string | null): string {
  const ts = toTimestamp(value);
  return formatRelativeTimeCompactFromTimestamp(ts) ?? "—";
}

function formatKickoffStatus(summary: {
  totalTasks: number;
  completedTasks: number;
  isComplete: boolean;
}): { label: string; detail: string; tone: string } {
  const total = Math.max(0, Math.floor(summary.totalTasks ?? 0));
  const completed = Math.max(0, Math.floor(summary.completedTasks ?? 0));
  const isComplete = Boolean(summary.isComplete);
  const label = isComplete ? "Complete" : "In progress";
  const detail = total > 0 ? `${completed} / ${total}` : "";
  const tone = isComplete ? "text-emerald-300" : "text-blue-200";
  return { label, detail, tone };
}

type CustomerProjectsPageProps = {
  searchParams?: Promise<ReadonlyURLSearchParams>;
};

function getParam(searchParams: ReadonlyURLSearchParams | null | undefined, key: string): string {
  if (!searchParams) return "";
  const value = searchParams.get(key);
  return typeof value === "string" ? value : "";
}

export default async function CustomerProjectsPage({
  searchParams,
}: CustomerProjectsPageProps) {
  const user = await requireUser({ redirectTo: "/customer/projects" });
  const customer = await getCustomerByUserId(user.id);

  if (!customer) {
    return (
      <PortalShell
        workspace="customer"
        title="Projects"
        subtitle="Awarded jobs in progress and history."
      >
        <section className="space-y-3 rounded-2xl border border-slate-900 bg-slate-950/60 p-6">
          <p className="text-sm text-slate-300">
            We couldn&apos;t find a customer workspace linked to {user.email}. Go back to your dashboard
            and complete your profile to start tracking projects.
          </p>
          <Link
            href="/customer"
            className="inline-flex items-center rounded-full bg-emerald-500 px-4 py-2 text-sm font-semibold text-black transition hover:bg-emerald-400"
          >
            Back to dashboard
          </Link>
        </section>
      </PortalShell>
    );
  }

  const projects = await getCustomerAwardedQuotesForProjects({
    customerId: customer.id,
  });

  const resolvedSearchParams = await searchParams;
  const status = (getParam(resolvedSearchParams, "status") as CustomerProjectsStatusFilter) || "in_progress";
  const sort = (getParam(resolvedSearchParams, "sort") as CustomerProjectsSortKey) || "updated";
  const supplierFilter = getParam(resolvedSearchParams, "supplier");

  const suppliers = Array.from(
    new Map(
      projects
        .map((project) => {
          const id = (project.awardedSupplierId ?? "").trim();
          const label = (project.supplierName ?? "").trim();
          return id ? [id, label || id] : null;
        })
        .filter(Boolean) as Array<[string, string]>,
    ).entries(),
  )
    .map(([id, label]) => ({ id, label }))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));

  const filteredProjects = projects
    .filter((project) => {
      if (status === "all") return true;
      const completeFromQuote = Boolean(project.kickoffCompletedAt);
      return status === "complete" ? completeFromQuote : !completeFromQuote;
    })
    .filter((project) => {
      const supplierId = (project.awardedSupplierId ?? "").trim();
      if (!supplierFilter) return true;
      return supplierId === supplierFilter;
    })
    .slice();

  filteredProjects.sort((a, b) => {
    if (sort === "supplier") {
      const aName = (a.supplierName ?? a.awardedSupplierId ?? "").toLowerCase();
      const bName = (b.supplierName ?? b.awardedSupplierId ?? "").toLowerCase();
      const bySupplier = aName.localeCompare(bName);
      if (bySupplier !== 0) return bySupplier;
      const aUpdated = toTimestamp(a.lastUpdatedAt) ?? -Infinity;
      const bUpdated = toTimestamp(b.lastUpdatedAt) ?? -Infinity;
      return bUpdated - aUpdated;
    }
    if (sort === "awarded") {
      const aAwarded = toTimestamp(a.awardedAt) ?? -Infinity;
      const bAwarded = toTimestamp(b.awardedAt) ?? -Infinity;
      return bAwarded - aAwarded;
    }
    const aUpdated = toTimestamp(a.lastUpdatedAt) ?? -Infinity;
    const bUpdated = toTimestamp(b.lastUpdatedAt) ?? -Infinity;
    return bUpdated - aUpdated;
  });

  return (
    <PortalShell
      workspace="customer"
      title="Projects"
      subtitle="Awarded jobs in progress and history."
    >
      <PortalCard
        title="Projects"
        description="Track what’s happening now across awarded jobs, kickoff progress, and history."
      >
        {projects.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-800 bg-black/40 px-4 py-6 text-sm text-slate-300">
            <p className="font-medium text-slate-100">No awarded projects yet.</p>
            <p className="mt-1 text-slate-400">
              When you award a winning supplier on a quote, it will show up here as a project.
            </p>
            <div className="mt-4">
              <Link
                href="/customer/quotes"
                className="inline-flex items-center rounded-full bg-emerald-500 px-4 py-2 text-sm font-semibold text-black transition hover:bg-emerald-400"
              >
                View quotes
              </Link>
            </div>
          </div>
        ) : (
          <>
            <CustomerProjectsListControls
              basePath="/customer/projects"
              suppliers={suppliers}
              className="mb-4"
            />

            {filteredProjects.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-800 bg-black/40 px-4 py-6 text-sm text-slate-300">
                <p className="font-medium text-slate-100">No projects match these filters.</p>
                <p className="mt-1 text-slate-400">
                  Try switching status tabs or clearing the supplier filter.
                </p>
              </div>
            ) : (
              <div className="overflow-hidden rounded-2xl border border-slate-900/70 bg-black/40">
                <table className="min-w-full divide-y divide-slate-900/70 text-sm">
                  <thead className="bg-slate-900/60">
                    <tr>
                      <th className="px-5 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">
                        Project
                      </th>
                      <th className="px-5 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">
                        Supplier
                      </th>
                      <th className="px-5 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">
                        Awarded
                      </th>
                      <th className="px-5 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">
                        Last updated
                      </th>
                      <th className="px-5 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">
                        Kickoff
                      </th>
                      <th className="px-5 py-4 text-right text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-900/70">
                    {filteredProjects.map((project) => {
                      const supplierLabel = project.supplierName?.trim()
                        ? project.supplierName
                        : "Supplier pending";
                      const kickoff = formatKickoffStatus(project.kickoff);
                      const kickoffSubtext = project.kickoff.isComplete
                        ? "Kickoff complete"
                        : kickoff.detail
                          ? `Kickoff in progress (${kickoff.detail})`
                          : "Kickoff in progress";

                      return (
                        <tr key={project.id} className="hover:bg-slate-900/50">
                          <td className="px-5 py-4 align-middle">
                            <div className="flex flex-col">
                              <span className="font-medium text-slate-100">
                                {project.projectName}
                              </span>
                              <span className="text-xs text-slate-500">
                                Quote {project.id.startsWith("Q-") ? project.id : `#${project.id.slice(0, 6)}`}
                              </span>
                            </div>
                          </td>
                          <td className="px-5 py-4 align-middle text-slate-200">
                            {supplierLabel}
                          </td>
                          <td className="px-5 py-4 align-middle text-slate-300">
                            {formatAwardedDate(project.awardedAt)}
                          </td>
                          <td className="px-5 py-4 align-middle text-slate-300">
                            {formatLastUpdated(project.lastUpdatedAt)}
                          </td>
                          <td className="px-5 py-4 align-middle">
                            <div className="space-y-1">
                              <p className={clsx("font-medium", kickoff.tone)}>{kickoff.label}</p>
                              <p className="text-xs text-slate-400">{kickoffSubtext}</p>
                            </div>
                          </td>
                          <td className="px-5 py-4 align-middle text-right">
                            <Link
                              href={`/customer/quotes/${project.id}`}
                              className="inline-flex min-w-[9rem] items-center justify-center rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-black transition hover:bg-emerald-400"
                            >
                              View project
                            </Link>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </PortalCard>
    </PortalShell>
  );
}

