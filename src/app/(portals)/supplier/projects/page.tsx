import clsx from "clsx";
import Link from "next/link";

import PortalCard from "@/app/(portals)/PortalCard";
import {
  PortalShell,
  PORTAL_SURFACE_CARD,
  PORTAL_SURFACE_CARD_INTERACTIVE_QUIET,
} from "@/app/(portals)/components/PortalShell";
import { EmptyStateCard } from "@/components/EmptyStateCard";
import { formatDateTime } from "@/lib/formatDate";
import {
  formatRelativeTimeCompactFromTimestamp,
  toTimestamp,
} from "@/lib/relativeTime";
import { MessageLinkWithUnread } from "@/app/(portals)/components/MessageLinkWithUnread";
import { requireUser } from "@/server/auth";
import { loadSupplierProfileByUserId } from "@/server/suppliers";
import { getSupplierAwardedQuotesForProjects } from "@/server/supplier/projects";
import { loadUnreadMessageSummary } from "@/server/quotes/messageReads";
import { OneTimeLocalStorageAffirmation } from "@/app/(portals)/shared/OneTimeLocalStorageAffirmation";
import {
  PORTAL_CELL,
  PORTAL_CELL_RIGHT,
  PORTAL_DIVIDER,
  PORTAL_ROW,
  PORTAL_TH,
  PORTAL_TH_RIGHT,
  PORTAL_TITLE,
} from "@/app/(portals)/components/portalTableRhythm";

export const dynamic = "force-dynamic";

/**
 * Phase 1 Polish checklist
 * - Done: Empty state (no projects) is consistent + role-appropriate
 */

function formatAwardedDate(value: string | null): string {
  if (!value) return "—";
  return formatDateTime(value) ?? "—";
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
  const detail = total > 0 ? `${completed} / ${total}` : "—";
  const tone = isComplete ? "text-emerald-300" : "text-blue-200";
  return { label, detail, tone };
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

export default async function SupplierProjectsPage() {
  const user = await requireUser({ redirectTo: "/supplier/projects" });
  const profile = await loadSupplierProfileByUserId(user.id);
  const supplier = profile?.supplier ?? null;

  if (!supplier) {
    return (
      <PortalShell
        workspace="supplier"
        title="Projects"
        subtitle="Awarded projects in progress and history."
      >
        <EmptyStateCard
          title="Complete supplier onboarding"
          description="Finish onboarding to start tracking awarded projects here."
          tone="info"
          actionVariant="info"
          action={{ label: "Back to dashboard", href: "/supplier" }}
        />
      </PortalShell>
    );
  }

  const projects = await getSupplierAwardedQuotesForProjects({
    supplierId: supplier.id,
  });

  const messageSummary = await loadUnreadMessageSummary({
    quoteIds: projects.map((project) => project.id),
    userId: user.id,
  });

  return (
    <PortalShell
      workspace="supplier"
      title="Projects"
      subtitle="Awarded projects in progress and history."
    >
      <PortalCard
        title="Execution queue"
        className={PORTAL_SURFACE_CARD}
      >
        {projects.length === 0 ? (
          <EmptyStateCard
            title="No projects yet"
            description="When a customer awards your bid, it will show up here as a project."
            action={{ label: "View RFQs", href: "/supplier/quotes" }}
          />
        ) : (
          <div className="overflow-hidden">
            <table className="min-w-full text-sm">
              <thead className="bg-transparent">
                <tr>
                  <th className={PORTAL_TH}>
                    Project
                  </th>
                  <th className={`hidden md:table-cell ${PORTAL_TH}`}>
                    Kickoff
                  </th>
                  <th className={`hidden lg:table-cell ${PORTAL_TH}`}>
                    Last message
                  </th>
                  <th className={`hidden md:table-cell ${PORTAL_TH_RIGHT}`}>
                    Open
                  </th>
                </tr>
              </thead>
              <tbody className={PORTAL_DIVIDER}>
                {projects.map((project) => {
                  const customerLabel = project.customerName?.trim()
                    ? project.customerName
                    : "Customer pending";
                  const kickoff = formatKickoffStatus(project.kickoff);
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
                    <tr
                      key={project.id}
                      className={PORTAL_ROW}
                    >
                      <td className={PORTAL_CELL}>
                        <div className="flex flex-col gap-2">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <span className={PORTAL_TITLE}>{project.projectName}</span>
                              <OneTimeLocalStorageAffirmation
                                as="span"
                                storageKey={`supplier.project.now_active_affirmed.v1:${project.id}`}
                                className="shrink-0 items-center rounded-full border border-slate-900/60 bg-slate-950/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500"
                              >
                                Now active
                              </OneTimeLocalStorageAffirmation>
                            </div>
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                              <span>
                                RFQ{" "}
                                {project.id.startsWith("Q-") ? project.id : `#${project.id.slice(0, 6)}`}
                              </span>
                              <span className="text-slate-700" aria-hidden="true">
                                ·
                              </span>
                              <span>{customerLabel}</span>
                              <span className="text-slate-700" aria-hidden="true">
                                ·
                              </span>
                              <span className="tabular-nums">{formatAwardedDate(project.awardedAt)}</span>
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-semibold text-slate-500">
                            <Link
                              href={`/supplier/quotes/${project.id}?tab=activity#timeline`}
                              className="underline-offset-4 hover:text-slate-200 hover:underline motion-reduce:transition-none"
                            >
                              Activity
                            </Link>
                            <MessageLinkWithUnread
                              href={`/supplier/quotes/${project.id}?tab=messages#messages`}
                              unread={hasUnread}
                              className="underline-offset-4 hover:text-slate-200 hover:underline motion-reduce:transition-none"
                            >
                              Messages
                            </MessageLinkWithUnread>
                            <span className="text-slate-700 md:hidden" aria-hidden="true">
                              ·
                            </span>
                            <Link
                              href={`/supplier/quotes/${project.id}`}
                              className={clsx(
                                "md:hidden inline-flex items-center",
                                "text-[11px] font-semibold text-slate-200",
                                "underline-offset-4 hover:text-white hover:underline",
                                "motion-reduce:transition-none",
                              )}
                            >
                              Open project →
                            </Link>
                          </div>
                        </div>
                      </td>
                      <td className={`hidden md:table-cell ${PORTAL_CELL}`}>
                        <div className="space-y-1">
                          <p className={clsx("font-medium", kickoff.tone)}>
                            {kickoff.label}
                          </p>
                          <p className="text-xs text-slate-400">
                            {kickoff.detail} tasks completed
                          </p>
                        </div>
                      </td>
                      <td className={`hidden lg:table-cell ${PORTAL_CELL}`}>
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
                      <td className={`hidden md:table-cell ${PORTAL_CELL_RIGHT}`}>
                        <Link
                          href={`/supplier/quotes/${project.id}`}
                          className={clsx(
                            "inline-flex items-center rounded-full px-3 py-1.5 text-xs font-semibold",
                            "text-blue-100 ring-1 ring-inset ring-blue-400/30",
                            "bg-blue-500/10 hover:bg-blue-500/15",
                            "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-200",
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
      </PortalCard>
    </PortalShell>
  );
}
