import Link from "next/link";

import PortalCard from "@/app/(portals)/PortalCard";
import {
  PortalShell,
  PORTAL_SURFACE_CARD,
} from "@/app/(portals)/components/PortalShell";
import { EmptyStateCard } from "@/components/EmptyStateCard";
import { requireCustomerSessionOrRedirect } from "@/app/(portals)/customer/requireCustomerSessionOrRedirect";
import { loadCustomerInbox } from "@/server/messages/inbox";
import { resolveThreadStatusLabel } from "@/lib/messages/needsReply";
import { formatRelativeTimeCompactFromTimestamp, toTimestamp } from "@/lib/relativeTime";

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
        className={`${PORTAL_SURFACE_CARD} p-0`}
      >
        {rows.length === 0 ? (
          <div className="p-6">
            <EmptyStateCard
              title="No conversations yet"
              description="Messages will appear here once RFQs are in progress."
              action={{ label: "View RFQs", href: "/customer/quotes" }}
            />
          </div>
        ) : (
          <div className="overflow-hidden">
            <div className="divide-y divide-slate-800/40">
              {rows.map((row) => {
                const threadLabel = resolveThreadStatusLabel("customer", row.needsReplyFrom);
                const threadPill = statusPillClasses(threadLabel);
                const lastMessageAtLabel =
                  formatRelativeTimeCompactFromTimestamp(toTimestamp(row.lastMessageAt)) ?? "—";
                const unread = Math.max(0, Math.floor(row.unreadCount ?? 0));
                const href = `/customer/quotes/${row.quoteId}?tab=messages#messages`;
                const rfqIdLabel = row.quoteId.startsWith("Q-")
                  ? row.quoteId
                  : `#${row.quoteId.slice(0, 6)}`;
                const preview = row.lastMessagePreview?.trim() ? row.lastMessagePreview : "—";

                return (
                  <div
                    key={row.quoteId}
                    className="flex flex-col gap-3 px-6 py-4 hover:bg-slate-900/20 md:h-16 md:flex-row md:items-center md:gap-6 md:py-0"
                  >
                    <div className="min-w-0 flex-1">
                      <Link
                        href={href}
                        className="block min-w-0 truncate text-sm font-semibold leading-tight text-slate-100 underline-offset-4 hover:underline"
                      >
                        {row.rfqLabel}
                      </Link>

                      <div className="mt-1 flex min-w-0 items-center gap-2 text-xs">
                        <span className="min-w-0 flex-1 truncate text-slate-300/70">{preview}</span>
                        <span className="flex shrink-0 flex-wrap items-center gap-2 text-[11px] text-slate-500 md:flex-nowrap md:whitespace-nowrap">
                          <span
                            className={[
                              "inline-flex items-center rounded-full border px-2 py-0.5 font-semibold uppercase tracking-wide",
                              "whitespace-nowrap",
                              threadPill,
                            ].join(" ")}
                          >
                            {threadLabel}
                          </span>
                          {unread > 0 ? (
                            <span className="inline-flex min-w-[1.75rem] items-center justify-center whitespace-nowrap rounded-full bg-red-500/20 px-2 py-0.5 text-[11px] font-semibold text-red-100">
                              {unread > 99 ? "99+" : unread}
                            </span>
                          ) : null}
                        </span>
                        <span className="hidden shrink-0 items-center gap-2 whitespace-nowrap text-[11px] tabular-nums text-slate-500 md:flex">
                          <span className="text-slate-600">•</span>
                          <span>{lastMessageAtLabel}</span>
                          <span className="text-slate-600">•</span>
                          <span>RFQ {rfqIdLabel}</span>
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-3 md:ml-auto md:justify-end">
                      <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500 md:hidden">
                        {lastMessageAtLabel}
                      </span>
                      <Link
                        href={href}
                        className="inline-flex items-center justify-center whitespace-nowrap rounded-full border border-slate-800 bg-slate-950/40 px-4 py-1.5 text-xs font-semibold text-slate-200 transition-colors hover:bg-slate-900/40 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-200/60 motion-reduce:transition-none"
                      >
                        Open conversation <span aria-hidden="true">→</span>
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </PortalCard>
    </PortalShell>
  );
}

