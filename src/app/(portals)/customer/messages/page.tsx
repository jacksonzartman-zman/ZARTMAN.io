import Link from "next/link";
import clsx from "clsx";

import PortalCard from "@/app/(portals)/PortalCard";
import { PortalShell } from "@/app/(portals)/components/PortalShell";
import { EmptyStateCard } from "@/components/EmptyStateCard";
import { requireCustomerSessionOrRedirect } from "@/app/(portals)/customer/requireCustomerSessionOrRedirect";
import { loadCustomerInbox } from "@/server/messages/inbox";
import { resolveThreadStatusLabel } from "@/lib/messages/needsReply";
import { formatRelativeTimeCompactFromTimestamp, toTimestamp } from "@/lib/relativeTime";

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

export default async function CustomerMessagesPage() {
  const user = await requireCustomerSessionOrRedirect("/customer/messages");
  const rows = await loadCustomerInbox({ userId: user.id, email: user.email ?? null });

  return (
    <PortalShell
      workspace="customer"
      title="Messages"
      subtitle="Conversations across your search requests and projects."
      actions={
        <Link
          href="/customer"
          className="inline-flex items-center rounded-full border border-emerald-400/40 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-emerald-100 transition hover:border-emerald-300 hover:text-white"
        >
          Back to dashboard
        </Link>
      }
    >
      <PortalCard
        title="Messages"
        description="One inbox for every search request thread—see what needs your attention and jump back into context."
      >
        {rows.length === 0 ? (
          <EmptyStateCard
            title="No conversations yet"
            description="Messages will appear here once search requests are in progress."
            action={{ label: "View search requests", href: "/customer/quotes" }}
          />
        ) : (
          <div className="overflow-hidden rounded-2xl bg-slate-950/25 ring-1 ring-slate-800/50">
            <table className="min-w-full divide-y divide-slate-800/40 text-sm">
              <thead className="bg-transparent">
                <tr>
                  <th className="px-5 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                    Search request
                  </th>
                  <th className="px-5 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                    Thread
                  </th>
                  <th className="hidden px-5 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500 md:table-cell">
                    Status
                  </th>
                  <th className="hidden px-5 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500 lg:table-cell">
                    Last message
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/40">
                {rows.map((row) => {
                  const threadLabel = resolveThreadStatusLabel("customer", row.needsReplyFrom);
                  const threadPill = statusPillClasses(threadLabel);
                  const kickoff = kickoffPill(row.kickoffStatus);
                  const lastMessageAtLabel =
                    formatRelativeTimeCompactFromTimestamp(toTimestamp(row.lastMessageAt)) ?? "—";
                  const unread = Math.max(0, Math.floor(row.unreadCount ?? 0));
                  return (
                    <tr key={row.quoteId} className="hover:bg-slate-900/20">
                      <td className="px-5 py-5 align-middle">
                        <Link
                          href={`/customer/quotes/${row.quoteId}?tab=messages#messages`}
                          className="flex flex-col gap-1 underline-offset-4 hover:underline"
                        >
                          <span className="text-[15px] font-semibold text-slate-100">
                            {row.rfqLabel}
                          </span>
                          <span className="text-xs text-slate-500">
                            Quote {row.quoteId.startsWith("Q-") ? row.quoteId : `#${row.quoteId.slice(0, 6)}`}
                          </span>
                        </Link>
                      </td>
                      <td className="px-5 py-5 align-middle">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={clsx(
                              "inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold",
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
                      <td className="hidden px-5 py-5 align-middle md:table-cell">
                        <div className="flex flex-wrap gap-2">
                          <span className="inline-flex rounded-full border border-slate-800/80 bg-slate-950/35 px-2.5 py-1 text-[11px] font-semibold text-slate-200">
                            {row.quoteStatus}
                          </span>
                          <span
                            className={clsx(
                              "inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold",
                              kickoff.className,
                            )}
                          >
                            {kickoff.label}
                          </span>
                        </div>
                      </td>
                      <td className="hidden px-5 py-5 align-middle lg:table-cell">
                        <div className="space-y-1">
                          <p className="text-xs text-slate-200">{row.lastMessagePreview}</p>
                          <p className="text-[11px] uppercase tracking-[0.22em] text-slate-600">
                            {lastMessageAtLabel}
                          </p>
                        </div>
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

