import clsx from "clsx";
import Link from "next/link";

import PortalCard from "@/app/(portals)/PortalCard";
import { PortalShell } from "@/app/(portals)/components/PortalShell";
import { EmptyStateCard } from "@/components/EmptyStateCard";
import { formatDateTime } from "@/lib/formatDate";
import {
  formatRelativeTimeCompactFromTimestamp,
  toTimestamp,
} from "@/lib/relativeTime";
import { KickoffNudgeButton } from "@/app/(portals)/customer/components/KickoffNudgeButton";
import { MessageLinkWithUnread } from "@/app/(portals)/components/MessageLinkWithUnread";
import { requireUser } from "@/server/auth";
import { getCustomerByUserId } from "@/server/customers";
import { getCustomerAwardedQuotesForProjects } from "@/server/customer/projects";
import { loadUnreadMessageSummary } from "@/server/quotes/messageReads";
import CustomerProjectsListControls, {
  type CustomerProjectsSortKey,
  type CustomerProjectsStatusFilter,
} from "./CustomerProjectsListControls";

export const dynamic = "force-dynamic";

/**
 * Phase 1 Polish checklist
 * - Done: Empty state (no projects) is consistent + role-appropriate
 * - Done: Empty state (filters) stays calm + actionable
 */

function formatAwardedDate(value: string | null): string {
  if (!value) return "—";
  return formatDateTime(value) ?? "—";
}

function formatLastUpdated(value: string | null): string {
  const ts = toTimestamp(value);
  return formatRelativeTimeCompactFromTimestamp(ts) ?? "—";
}

function formatMessageSenderLabel(senderRole: string | null | undefined): string {
  const normalized = (senderRole ?? "").trim().toLowerCase();
  if (normalized === "supplier") return "Supplier";
  if (normalized === "customer") return "Customer";
  if (normalized === "system") return "System";
  return "Admin";
}

function formatLastMessagePreview(input: {
  currentUserId: string;
  senderId: string | null;
  senderRole: string;
  body: string;
}): string {
  const prefix =
    input.senderId && input.senderId === input.currentUserId
      ? "You"
      : formatMessageSenderLabel(input.senderRole);
  const body = (input.body ?? "").trim();
  if (!body) return "—";
  return `${prefix}: ${body}`;
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
          <EmptyStateCard
            title="No projects yet"
            description="You don&apos;t have any awarded work yet. Once you award a supplier on a quote, projects will show up here."
            action={{ label: "View Quotes", href: "/customer/quotes" }}
          />
        ) : (
          <>
            <CustomerProjectsListControls
              basePath="/customer/projects"
              suppliers={suppliers}
              className="mb-4"
            />

            {filteredProjects.length === 0 ? (
              <EmptyStateCard
                title="No projects match these filters"
                description="Try switching status tabs or clearing the supplier filter."
              />
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
                        Last message
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
                      const canNudge =
                        Boolean(project.awardedSupplierId) && !project.kickoff.isComplete;
                      const summary = messageSummary[project.id];
                      const hasUnread = Boolean(summary && summary.unreadCount > 0);
                      const lastMessageAt = summary?.lastMessage?.created_at ?? null;
                      const lastMessageAtLabel =
                        formatRelativeTimeCompactFromTimestamp(toTimestamp(lastMessageAt)) ?? "—";
                      const lastMessagePreview = summary?.lastMessage
                        ? formatLastMessagePreview({
                            currentUserId: user.id,
                            senderId: summary.lastMessage.sender_id,
                            senderRole: summary.lastMessage.sender_role,
                            body: summary.lastMessage.body,
                          })
                        : "—";

                      return (
                        <tr key={project.id} className="hover:bg-slate-900/50">
                          <td className="px-5 py-4 align-middle">
                            <div className="flex flex-col">
                              <span className="font-medium text-slate-100">
                                {project.projectName}
                              </span>
                              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                                <span>
                                  Quote{" "}
                                  {project.id.startsWith("Q-")
                                    ? project.id
                                    : `#${project.id.slice(0, 6)}`}
                                </span>
                                <Link
                                  href={`/customer/quotes/${project.id}#decision`}
                                  className="font-semibold text-emerald-200 hover:underline"
                                >
                                  View RFQ
                                </Link>
                              </div>
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
                              <p
                                className={clsx(
                                  "text-xs",
                                  hasUnread ? "text-slate-200" : "text-slate-500",
                                )}
                              >
                                {lastMessagePreview}
                              </p>
                              <p className="text-[11px] uppercase tracking-wide text-slate-600">
                                {lastMessageAtLabel}
                              </p>
                            </div>
                          </td>
                          <td className="px-5 py-4 align-middle">
                            <div className="space-y-1">
                              <p className={clsx("font-medium", kickoff.tone)}>{kickoff.label}</p>
                              <p className="text-xs text-slate-400">{kickoffSubtext}</p>
                            </div>
                          </td>
                          <td className="px-5 py-4 align-middle text-right">
                            <div className="flex flex-wrap justify-end gap-2">
                              {canNudge && project.awardedSupplierId ? (
                                <KickoffNudgeButton
                                  quoteId={project.id}
                                  supplierId={project.awardedSupplierId}
                                  className="items-stretch"
                                />
                              ) : null}
                              <Link
                                href={`/customer/quotes/${project.id}?tab=activity`}
                                className="inline-flex min-w-[7.5rem] items-center justify-center rounded-lg border border-slate-700 bg-slate-950/40 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:border-slate-500 hover:text-white"
                              >
                                Activity
                              </Link>
                              <MessageLinkWithUnread
                                href={`/customer/quotes/${project.id}?tab=messages`}
                                unread={hasUnread}
                                className="min-w-[7.5rem] rounded-lg border border-slate-700 bg-slate-950/40 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:border-slate-500 hover:text-white"
                              >
                                Messages
                              </MessageLinkWithUnread>
                              <Link
                                href={`/customer/quotes/${project.id}`}
                                className="inline-flex min-w-[9rem] items-center justify-center rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-black transition hover:bg-emerald-400"
                              >
                                View project
                              </Link>
                            </div>
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

