import Link from "next/link";
import clsx from "clsx";

import PortalCard from "@/app/(portals)/PortalCard";
import { PortalShell } from "@/app/(portals)/components/PortalShell";
import { EmptyStateCard } from "@/components/EmptyStateCard";
import { requireUser } from "@/server/auth";
import { loadSupplierProfileByUserId } from "@/server/suppliers";
import { loadSupplierInbox } from "@/server/messages/inbox";
import { formatRelativeTimeCompactFromTimestamp, toTimestamp } from "@/lib/relativeTime";
import { ctaSizeClasses, primaryInfoCtaClasses } from "@/lib/ctas";
import { UnreadBadge } from "@/components/shared/primitives/UnreadBadge";
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

export default async function SupplierMessagesPage() {
  const user = await requireUser({ redirectTo: "/supplier/messages" });
  const profile = await loadSupplierProfileByUserId(user.id);
  const supplier = profile?.supplier ?? null;

  if (!supplier) {
    return (
      <PortalShell
        workspace="supplier"
        title="Messages"
        subtitle="Your command center for conversations: triage threads and jump back into context."
      >
        <PortalCard
          title="Messages"
          description="We’ll show your RFQ conversations here once your supplier workspace is connected."
        >
          <EmptyStateCard
            title="Complete supplier onboarding"
            description="Finish onboarding to unlock RFQs and the shared message inbox."
            tone="info"
            actionVariant="info"
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
      subtitle="Your command center for conversations: triage threads and jump back into context."
      actions={
        <Link
          href="/supplier"
          className="inline-flex items-center rounded-full border border-blue-400/40 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-blue-100 transition hover:border-blue-300 hover:text-white motion-reduce:transition-none"
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
            tone="info"
            actionVariant="info"
            action={{ label: "View RFQs", href: "/supplier/quotes" }}
          />
        ) : (
          <div className="-mx-6 overflow-hidden border-t border-slate-800/40">
            <table className="min-w-full table-fixed text-sm">
              <thead className="bg-transparent">
                <tr>
                  <th className={clsx(PORTAL_TH, "w-[14rem]")}>
                    RFQ
                  </th>
                  <th className={clsx(PORTAL_TH, "w-[14rem]")}>
                    Thread
                  </th>
                  <th className={clsx(PORTAL_TH, "w-[16rem]")}>
                    Status
                  </th>
                  <th className={PORTAL_TH}>
                    Last message
                  </th>
                  <th className={clsx(PORTAL_TH_RIGHT, "w-[12rem]")}>
                    Action
                  </th>
                </tr>
              </thead>
              <tbody className={PORTAL_DIVIDER}>
                {rows.map((row) => {
                  const kickoff = kickoffPill(row.kickoffStatus);
                  const lastMessageAtLabel =
                    formatRelativeTimeCompactFromTimestamp(toTimestamp(row.lastMessageAt)) ?? "—";
                  const unread = Math.max(0, Math.floor(row.unreadCount ?? 0));
                  const href = `/supplier/quotes/${row.quoteId}?tab=messages#messages`;
                  return (
                    <tr key={row.quoteId} className={PORTAL_ROW}>
                      <td className={PORTAL_CELL}>
                        <Link
                          href={href}
                          className="flex flex-col gap-1 underline-offset-4 hover:underline"
                        >
                          <span className={PORTAL_TITLE}>{row.rfqLabel}</span>
                          <span className="text-xs text-slate-500">
                            RFQ {row.quoteId.startsWith("Q-") ? row.quoteId : `#${row.quoteId.slice(0, 6)}`}
                          </span>
                        </Link>
                      </td>
                      <td className={PORTAL_CELL}>
                        <div className="flex flex-wrap items-center gap-2">
                          {row.needsReply ? (
                            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                              Needs reply
                            </span>
                          ) : null}
                          <UnreadBadge count={unread} />
                        </div>
                      </td>
                      <td className={PORTAL_CELL}>
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
                      <td className={PORTAL_CELL}>
                        <div className="min-w-0 space-y-1">
                          <p className="truncate text-xs text-slate-200" title={row.lastMessagePreview}>
                            {row.lastMessagePreview}
                          </p>
                          <p className="text-[11px] uppercase tracking-wide text-slate-600">
                            {lastMessageAtLabel}
                          </p>
                        </div>
                      </td>
                      <td className={PORTAL_CELL_RIGHT}>
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

