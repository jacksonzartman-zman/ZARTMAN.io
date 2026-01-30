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
import { requireCustomerSessionOrRedirect } from "@/app/(portals)/customer/requireCustomerSessionOrRedirect";
import { getCustomerByUserId } from "@/server/customers";
import { getCustomerAwardedQuotesForProjects } from "@/server/customer/projects";
import { loadUnreadMessageSummary } from "@/server/quotes/messageReads";
import CustomerProjectsListControls, {
  type CustomerProjectsSortKey,
  type CustomerProjectsStatusFilter,
} from "./CustomerProjectsListControls";
import { primaryCtaClasses } from "@/lib/ctas";

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
    if (raw.toLowerCase().startsWith("search request:")) {
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
      <PortalCard
        title="Projects"
        description="Execution stage: kickoff progress, production status, and delivery history. Each project originates from an RFQ."
      >
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
              <div className="overflow-hidden rounded-2xl bg-slate-950/25 ring-1 ring-slate-800/50">
                <table className="min-w-full divide-y divide-slate-800/40 text-sm">
                  <thead className="bg-transparent">
                    <tr>
                      <th className="px-5 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                        Project
                      </th>
                      <th className="px-5 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                        Supplier
                      </th>
                      <th className="hidden px-5 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500 md:table-cell">
                        Awarded
                      </th>
                      <th className="hidden px-5 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500 md:table-cell">
                        Last updated
                      </th>
                      <th className="hidden px-5 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500 lg:table-cell">
                        Last message
                      </th>
                      <th className="hidden px-5 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500 md:table-cell">
                        Kickoff
                      </th>
                      <th className="px-5 py-4 text-right text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/40">
                    {filteredProjects.map((project) => {
                      const supplierLabel = project.supplierName?.trim()
                        ? project.supplierName
                        : "Supplier pending";
                      const originFileLabel = extractOriginFileLabel(project.projectName);
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
                        <tr key={project.id} className="hover:bg-slate-900/20">
                          <td className="px-5 py-4 align-middle">
                            <div className="flex flex-col">
                              <span className="font-medium text-slate-100">
                                {originFileLabel ?? project.projectName}
                              </span>
                              <span className="mt-1 text-xs text-slate-500">
                                RFQ{" "}
                                {project.id.startsWith("Q-")
                                  ? project.id
                                  : `#${project.id.slice(0, 6)}`}
                              </span>
                            </div>
                          </td>
                          <td className="px-5 py-4 align-middle text-slate-200">
                            {supplierLabel}
                          </td>
                          <td className="hidden px-5 py-4 align-middle text-slate-300 md:table-cell">
                            {formatAwardedDate(project.awardedAt)}
                          </td>
                          <td className="hidden px-5 py-4 align-middle text-slate-300 md:table-cell">
                            {formatLastUpdated(project.lastUpdatedAt)}
                          </td>
                          <td className="hidden px-5 py-4 align-middle lg:table-cell">
                            <div className="space-y-1">
                              <p
                                className={clsx(
                                  "text-xs",
                                  hasUnread ? "text-slate-200" : "text-slate-500",
                                )}
                              >
                                {lastMessagePreview}
                              </p>
                              <p className="text-[11px] uppercase tracking-[0.22em] text-slate-600">
                                {lastMessageAtLabel}
                              </p>
                            </div>
                          </td>
                          <td className="hidden px-5 py-4 align-middle md:table-cell">
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
                                className="inline-flex items-center text-xs font-semibold text-slate-300 underline-offset-4 transition hover:text-white hover:underline"
                              >
                                Activity
                              </Link>
                              <MessageLinkWithUnread
                                href={`/customer/quotes/${project.id}?tab=messages`}
                                unread={hasUnread}
                                className="text-xs font-semibold text-slate-300 underline-offset-4 transition hover:text-white hover:underline"
                              >
                                Messages
                              </MessageLinkWithUnread>
                              <Link
                                href={`/customer/quotes/${project.id}`}
                                className={`${primaryCtaClasses} px-4 py-1.5 text-xs font-semibold uppercase tracking-wide`}
                              >
                                Open project
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

