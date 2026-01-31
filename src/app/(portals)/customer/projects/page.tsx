import clsx from "clsx";
import Link from "next/link";

import PortalCard from "@/app/(portals)/PortalCard";
import { PortalShell } from "@/app/(portals)/components/PortalShell";
import { EmptyStateCard } from "@/components/EmptyStateCard";
import {
  formatRelativeTimeCompactFromTimestamp,
  toTimestamp,
} from "@/lib/relativeTime";
import { KickoffNudgeButton } from "@/app/(portals)/customer/components/KickoffNudgeButton";
import { MessageLinkWithUnread } from "@/app/(portals)/components/MessageLinkWithUnread";
import { requireCustomerSessionOrRedirect } from "@/app/(portals)/customer/requireCustomerSessionOrRedirect";
import { getCustomerByUserId } from "@/server/customers";
import { getCustomerAwardedQuotesForProjects } from "@/server/customer/projects";
import { loadUnreadMessageSummary } from "@/server/quotes/messageReads";
import CustomerProjectsListControls, {
  type CustomerProjectsSortKey,
  type CustomerProjectsStatusFilter,
} from "./CustomerProjectsListControls";
import { primaryCtaClasses } from "@/lib/ctas";
import { OneTimeLocalStorageAffirmation } from "@/app/(portals)/shared/OneTimeLocalStorageAffirmation";

export const dynamic = "force-dynamic";

/**
 * Phase 1 Polish checklist
 * - Done: Empty state (no projects) is consistent + role-appropriate
 * - Done: Empty state (filters) stays calm + actionable
 */

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
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function CustomerProjectsPage({
  searchParams,
}: CustomerProjectsPageProps) {
  const spObj = (searchParams ? await searchParams : {}) ?? {};
  const sp = (key: string) => {
    const v = spObj[key];
    return Array.isArray(v) ? v[0] : v;
  };

  const user = await requireCustomerSessionOrRedirect("/customer/projects");
  const customer = await getCustomerByUserId(user.id);

  if (!customer) {
    return (
      <PortalShell
        workspace="customer"
        title="Projects"
        subtitle="Execution stage: awarded projects in progress and history."
      >
        <PortalCard
          title="Complete your customer profile"
          description="Link a customer workspace to track awarded projects and kickoff progress."
          action={
            <Link
              href="/customer"
              className="inline-flex items-center rounded-full bg-emerald-500 px-4 py-2 text-sm font-semibold text-black transition hover:bg-emerald-400"
            >
              Back to dashboard
            </Link>
          }
        >
          <p className="text-sm text-slate-300">
            We couldn&apos;t find a customer workspace linked to{" "}
            <span className="break-anywhere font-medium text-slate-100">{user.email}</span>.
          </p>
        </PortalCard>
      </PortalShell>
    );
  }

  const projects = await getCustomerAwardedQuotesForProjects({
    customerId: customer.id,
  });

  const statusRaw = (sp("status") ?? "").trim();
  const status: CustomerProjectsStatusFilter =
    statusRaw === "in_progress" || statusRaw === "complete" || statusRaw === "all"
      ? statusRaw
      : "in_progress";

  const sortRaw = (sp("sort") ?? "").trim();
  const sort: CustomerProjectsSortKey =
    sortRaw === "updated" || sortRaw === "awarded" || sortRaw === "supplier" ? sortRaw : "updated";

  const supplierFilter = (sp("supplier") ?? "").trim() || undefined;

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

  const messageSummary = await loadUnreadMessageSummary({
    quoteIds: filteredProjects.map((project) => project.id),
    userId: user.id,
  });

  function extractOriginFileLabel(projectName: string): string | null {
    const raw = (projectName ?? "").trim();
    if (!raw) return null;
    const lowered = raw.toLowerCase();
    if (lowered.startsWith("rfq:")) {
      const value = raw.slice("rfq:".length).trim();
      return value || null;
    }
    if (lowered.startsWith("search request:")) {
      const value = raw.slice("search request:".length).trim();
      return value || null;
    }
    return null;
  }

  return (
    <PortalShell
      workspace="customer"
      title="Projects"
      subtitle="Execution stage: awarded projects in progress and history."
    >
      <PortalCard title="Projects" header={false} className="p-7">
        {projects.length === 0 ? (
          <EmptyStateCard
            title="No projects yet"
            description="Projects appear once you award a supplier."
            action={{ label: "View RFQs", href: "/customer/quotes" }}
          />
        ) : (
          <>
            <CustomerProjectsListControls
              basePath="/customer/projects"
              suppliers={suppliers}
              className="mb-4"
            />

            {filteredProjects.length === 0 ? (
              status === "in_progress" && !supplierFilter ? (
                <EmptyStateCard
                  title="No active projects"
                  description="You’re all caught up. New awards will appear here."
                  action={{ label: "View completed", href: "/customer/projects?status=complete" }}
                />
              ) : (
                <EmptyStateCard
                  title="No projects match these filters"
                  description="Try switching status tabs or clearing the supplier filter."
                />
              )
            ) : (
              <div className="overflow-hidden">
                <table className="min-w-full text-sm">
                  <thead className="sr-only">
                    <tr>
                      <th scope="col">Project</th>
                      <th scope="col" className="hidden md:table-cell">
                        Open
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/50">
                    {filteredProjects.map((project) => {
                      const supplierLabel = project.supplierName?.trim()
                        ? project.supplierName
                        : "Supplier pending";
                      const originFileLabel = extractOriginFileLabel(project.projectName);
                      const kickoff = formatKickoffStatus(project.kickoff);
                      const canNudge =
                        Boolean(project.awardedSupplierId) && !project.kickoff.isComplete;
                      const summary = messageSummary[project.id];
                      const hasUnread = Boolean(summary && summary.unreadCount > 0);
                      const lastMessageAt = summary?.lastMessage?.created_at ?? null;
                      const lastMessageAtLabel =
                        formatRelativeTimeCompactFromTimestamp(toTimestamp(lastMessageAt)) ?? "—";

                      return (
                        <tr
                          key={project.id}
                          className="group hover:bg-slate-900/15 motion-reduce:transition-none"
                        >
                          <td className="px-5 py-4 align-middle">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="min-w-0 truncate text-sm font-semibold leading-tight text-slate-100">
                                  {originFileLabel ?? project.projectName}
                                </span>
                                <OneTimeLocalStorageAffirmation
                                  as="span"
                                  storageKey={`customer.project.now_active_affirmed.v1:${project.id}`}
                                  className="hidden shrink-0 items-center rounded-full border border-slate-900/60 bg-slate-950/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500 sm:inline-flex"
                                >
                                  Now active
                                </OneTimeLocalStorageAffirmation>
                              </div>

                              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                                <span className={clsx("font-semibold", kickoff.tone)}>
                                  {kickoff.label}
                                </span>
                                <span aria-hidden="true" className="text-slate-700">
                                  ·
                                </span>
                                <span className="tabular-nums">
                                  Updated {formatLastUpdated(project.lastUpdatedAt)}
                                </span>
                                <span className="hidden lg:inline">
                                  <span aria-hidden="true" className="mx-2 text-slate-700">
                                    ·
                                  </span>
                                  <span className="tabular-nums">Last message {lastMessageAtLabel}</span>
                                </span>
                                {originFileLabel ? (
                                  <span className="hidden xl:inline-flex min-w-0 max-w-[28rem] items-center gap-2">
                                    <span aria-hidden="true" className="text-slate-700">
                                      ·
                                    </span>
                                    <span className="truncate">
                                      From RFQ: {originFileLabel}
                                    </span>
                                  </span>
                                ) : null}
                              </div>

                              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-semibold text-slate-500">
                                <Link
                                  href={`/customer/quotes/${project.id}`}
                                  className="inline-flex items-center rounded-full bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-100 ring-1 ring-inset ring-emerald-400/25 hover:bg-emerald-500/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300 md:hidden"
                                >
                                  Open →
                                </Link>
                                <Link
                                  href={`/customer/quotes/${project.id}?tab=activity#timeline`}
                                  className="underline-offset-4 hover:text-slate-200 hover:underline motion-reduce:transition-none"
                                >
                                  Activity
                                </Link>
                                <MessageLinkWithUnread
                                  href={`/customer/quotes/${project.id}?tab=messages#messages`}
                                  unread={hasUnread}
                                  className="underline-offset-4 hover:text-slate-200 hover:underline motion-reduce:transition-none"
                                >
                                  Messages
                                </MessageLinkWithUnread>
                                {canNudge && project.awardedSupplierId ? (
                                  <KickoffNudgeButton
                                    quoteId={project.id}
                                    supplierId={project.awardedSupplierId}
                                    variant="link"
                                    className="text-[11px] font-semibold text-slate-500 hover:text-slate-200 motion-reduce:transition-none"
                                  />
                                ) : null}
                                <span className="hidden md:inline text-slate-700" aria-hidden="true">
                                  ·
                                </span>
                                <span className="hidden md:inline tabular-nums text-slate-600">
                                  {supplierLabel}
                                </span>
                              </div>
                            </div>
                          </td>

                          <td className="hidden px-5 py-4 align-middle text-right md:table-cell">
                            <Link
                              href={`/customer/quotes/${project.id}`}
                              className={clsx(
                                "inline-flex items-center rounded-full px-3 py-1.5 text-xs font-semibold",
                                "text-emerald-100 ring-1 ring-inset ring-emerald-400/30",
                                "bg-emerald-500/10 hover:bg-emerald-500/15",
                                "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300",
                                "transition motion-reduce:transition-none",
                              )}
                            >
                              Open project →
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

