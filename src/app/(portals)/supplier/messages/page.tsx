import Link from "next/link";
import clsx from "clsx";

import PortalCard from "@/app/(portals)/PortalCard";
import { PortalShell } from "@/app/(portals)/components/PortalShell";
import { EmptyStateCard } from "@/components/EmptyStateCard";
import { requireUser } from "@/server/auth";
import { loadSupplierProfileByUserId } from "@/server/suppliers";
import { loadSupplierInbox } from "@/server/messages/inbox";
import { resolveThreadStatusLabel } from "@/lib/messages/needsReply";
import { formatRelativeTimeCompactFromTimestamp, toTimestamp } from "@/lib/relativeTime";
import { ctaSizeClasses, primaryInfoCtaClasses } from "@/lib/ctas";

export const dynamic = "force-dynamic";

function kickoffPill(status: "not_started" | "in_progress" | "complete" | "n/a") {
  if (status === "n/a") {
    return { label: "Kickoff: —", className: "border-slate-800 bg-slate-950/50 text-slate-300" };
  }
  if (status === "complete") {
    return {
      label: "Kickoff complete",
      className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-100",
    };
  }
  if (status === "in_progress") {
    return {
      label: "Kickoff in progress",
      className: "border-blue-500/40 bg-blue-500/10 text-blue-100",
    };
  }
  return {
    label: "Kickoff not started",
    className: "border-slate-800 bg-slate-950/50 text-slate-300",
  };
}

function statusPillClasses(label: string) {
  if (label === "Needs your reply") {
    return "border-amber-500/40 bg-amber-500/10 text-amber-100";
  }
  if (label === "Up to date") {
    return "border-slate-800 bg-slate-950/50 text-slate-300";
  }
  if (label === "Status unknown") {
    return "border-slate-800 bg-slate-950/50 text-slate-400";
  }
  return "border-slate-800 bg-slate-900/40 text-slate-200";
}

export default async function SupplierMessagesPage() {
  const user = await requireUser({ redirectTo: "/supplier/messages" });
  const profile = await loadSupplierProfileByUserId(user.id);
  const supplier = profile?.supplier ?? null;

  if (!supplier) {
    return (
      <PortalShell
        workspace="supplier"
        title="Messages"
        subtitle="Conversations across your RFQs and projects."
        actions={
          <Link
            href="/supplier"
            className="inline-flex items-center rounded-full border border-blue-400/40 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-blue-100 transition hover:border-blue-300 hover:text-white"
          >
            Back to dashboard
          </Link>
        }
      >
        <PortalCard
          title="Messages"
          description="We’ll show your RFQ conversations here once your supplier workspace is connected."
        >
          <EmptyStateCard
            title="Complete supplier onboarding"
            description="Finish onboarding to unlock RFQs and the shared message inbox."
            action={{ label: "Finish onboarding", href: "/supplier/onboarding" }}
          />
        </PortalCard>
      </PortalShell>
    );
  }

  const rows = await loadSupplierInbox(user.id);

  return (
    <PortalShell
      workspace="supplier"
      title="Messages"
      subtitle="Conversations across your RFQs and projects."
      actions={
        <Link
          href="/supplier"
          className="inline-flex items-center rounded-full border border-blue-400/40 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-blue-100 transition hover:border-blue-300 hover:text-white"
        >
          Back to dashboard
        </Link>
      }
    >
      <PortalCard
        title="Messages"
        description="One inbox for every RFQ thread—see what needs your attention and jump back into context."
      >
        {rows.length === 0 ? (
          <EmptyStateCard
            title="No conversations yet"
            description="When customers or admins message you about RFQs, they’ll appear here."
            action={{ label: "View RFQs", href: "/supplier/quotes" }}
          />
        ) : (
          <div className="overflow-hidden rounded-2xl border border-slate-900/70 bg-black/40">
            <table className="min-w-full divide-y divide-slate-900/70 text-sm">
              <thead className="bg-slate-900/60">
                <tr>
                  <th className="px-5 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">
                    RFQ
                  </th>
                  <th className="px-5 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">
                    Thread
                  </th>
                  <th className="px-5 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">
                    Status
                  </th>
                  <th className="px-5 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">
                    Last message
                  </th>
                  <th className="px-5 py-4 text-right text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-900/70">
                {rows.map((row) => {
                  const threadLabel = resolveThreadStatusLabel("supplier", row.needsReplyFrom);
                  const threadPill = statusPillClasses(threadLabel);
                  const kickoff = kickoffPill(row.kickoffStatus);
                  const lastMessageAtLabel =
                    formatRelativeTimeCompactFromTimestamp(toTimestamp(row.lastMessageAt)) ?? "—";
                  const unread = Math.max(0, Math.floor(row.unreadCount ?? 0));
                  const href = `/supplier/quotes/${row.quoteId}?tab=messages#messages`;
                  return (
                    <tr key={row.quoteId} className="hover:bg-slate-900/50">
                      <td className="px-5 py-4 align-middle">
                        <Link
                          href={href}
                          className="flex flex-col gap-1 underline-offset-4 hover:underline"
                        >
                          <span className="font-medium text-slate-100">{row.rfqLabel}</span>
                          <span className="text-xs text-slate-500">
                            RFQ {row.quoteId.startsWith("Q-") ? row.quoteId : `#${row.quoteId.slice(0, 6)}`}
                          </span>
                        </Link>
                      </td>
                      <td className="px-5 py-4 align-middle">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={clsx(
                              "inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-semibold",
                              threadPill,
                            )}
                          >
                            {threadLabel}
                          </span>
                          {unread > 0 ? (
                            <span className="inline-flex min-w-[1.75rem] items-center justify-center rounded-full bg-red-500/20 px-2 py-0.5 text-[11px] font-semibold text-red-100">
                              {unread > 99 ? "99+" : unread}
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-5 py-4 align-middle">
                        <div className="flex flex-wrap gap-2">
                          <span className="inline-flex rounded-full border border-slate-800 bg-slate-950/50 px-3 py-1 text-[11px] font-semibold text-slate-200">
                            {row.quoteStatus}
                          </span>
                          <span
                            className={clsx(
                              "inline-flex rounded-full border px-3 py-1 text-[11px] font-semibold",
                              kickoff.className,
                            )}
                          >
                            {kickoff.label}
                          </span>
                        </div>
                      </td>
                      <td className="px-5 py-4 align-middle">
                        <div className="space-y-1">
                          <p className="text-xs text-slate-200">{row.lastMessagePreview}</p>
                          <p className="text-[11px] uppercase tracking-wide text-slate-600">
                            {lastMessageAtLabel}
                          </p>
                        </div>
                      </td>
                      <td className="px-5 py-4 align-middle text-right">
                        <Link
                          href={href}
                          className={`${primaryInfoCtaClasses} ${ctaSizeClasses.sm} text-xs font-semibold uppercase tracking-wide`}
                        >
                          Open conversation
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

