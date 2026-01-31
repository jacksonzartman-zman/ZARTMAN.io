import Link from "next/link";

import PortalCard from "@/app/(portals)/PortalCard";
import { PortalShell } from "@/app/(portals)/components/PortalShell";
import { EmptyStateCard } from "@/components/EmptyStateCard";
import { requireCustomerSessionOrRedirect } from "@/app/(portals)/customer/requireCustomerSessionOrRedirect";
import { loadCustomerInbox } from "@/server/messages/inbox";
import { resolveThreadStatusLabel } from "@/lib/messages/needsReply";
import { formatRelativeTimeCompactFromTimestamp, toTimestamp } from "@/lib/relativeTime";
import { ctaSizeClasses, primaryCtaClasses } from "@/lib/ctas";

export const dynamic = "force-dynamic";

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
      subtitle="Conversations across your RFQs and projects."
      actions={
        <Link
          href="/customer"
          className="text-xs font-semibold text-slate-300 underline-offset-4 transition hover:text-white hover:underline motion-reduce:transition-none"
        >
          Back to dashboard
        </Link>
      }
    >
      <PortalCard
        title="Messages"
        header={false}
      >
        {rows.length === 0 ? (
          <EmptyStateCard
            title="No conversations yet"
            description="Messages will appear here once RFQs are in progress."
            action={{ label: "View RFQs", href: "/customer/quotes" }}
          />
        ) : (
          <div className="overflow-hidden rounded-2xl bg-slate-950/25 ring-1 ring-slate-800/50">
            <table className="min-w-full divide-y divide-slate-800/40 text-sm">
              <thead className="bg-transparent">
                <tr>
                  <th className="px-5 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                    RFQ
                  </th>
                  <th className="px-5 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                    Thread
                  </th>
                  <th className="hidden px-5 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500 lg:table-cell">
                    Last message
                  </th>
                  <th className="px-5 py-4 text-right text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/40">
                {rows.map((row) => {
                  const threadLabel = resolveThreadStatusLabel("customer", row.needsReplyFrom);
                  const threadPill = statusPillClasses(threadLabel);
                  const lastMessageAtLabel =
                    formatRelativeTimeCompactFromTimestamp(toTimestamp(row.lastMessageAt)) ?? "—";
                  const unread = Math.max(0, Math.floor(row.unreadCount ?? 0));
                  const href = `/customer/quotes/${row.quoteId}?tab=messages#messages`;
                  return (
                    <tr key={row.quoteId} className="hover:bg-slate-900/20">
                      <td className="px-5 py-4 align-middle">
                        <Link
                          href={href}
                          className="flex flex-col gap-1 underline-offset-4 hover:underline"
                        >
                          <span className="text-sm font-semibold leading-tight text-slate-100">
                            {row.rfqLabel}
                          </span>
                          <span className="text-xs text-slate-500">
                            RFQ {row.quoteId.startsWith("Q-") ? row.quoteId : `#${row.quoteId.slice(0, 6)}`}
                          </span>
                        </Link>
                      </td>
                      <td className="px-5 py-4 align-middle">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={[
                              "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                              threadPill,
                            ].join(" ")}
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
                      <td className="hidden px-5 py-4 align-middle lg:table-cell">
                        <div className="space-y-1">
                          <p className="text-xs text-slate-200">{row.lastMessagePreview}</p>
                          <p className="text-[11px] uppercase tracking-[0.22em] text-slate-600">
                            {lastMessageAtLabel}
                          </p>
                        </div>
                      </td>
                      <td className="px-5 py-4 align-middle text-right">
                        <Link
                          href={href}
                          className={`${primaryCtaClasses} ${ctaSizeClasses.sm} text-xs font-semibold uppercase tracking-wide`}
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

