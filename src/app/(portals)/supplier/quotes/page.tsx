import Link from "next/link";

import { PortalShell } from "../../components/PortalShell";
import { PortalLoginPanel } from "../../PortalLoginPanel";
import PortalCard from "../../PortalCard";
import { EmptyStateNotice } from "../../EmptyStateNotice";

import { getServerAuthUser } from "@/server/auth";
import { resolveUserRoles } from "@/server/users/roles";
import {
  getSupplierApprovalStatus,
  loadSupplierProfileByUserId,
} from "@/server/suppliers";
import { approvalsEnabled } from "@/server/suppliers/flags";

import {
  loadSupplierQuotesList,
  type SupplierQuoteListRow,
} from "@/server/suppliers/quotesList";
import { QuoteStatusBadge } from "@/app/(portals)/components/QuoteStatusBadge";
import { isOpenQuoteStatus } from "@/server/quotes/status";
import {
  formatRelativeTimeCompactFromTimestamp,
  toTimestamp,
} from "@/lib/relativeTime";
import { normalizeSearchParams } from "@/lib/route/normalizeSearchParams";
import { resolveMaybePromise, type SearchParamsLike } from "@/app/(portals)/quotes/pageUtils";

export const dynamic = "force-dynamic";

type SupplierQuotesPageProps = {
  searchParams?: Promise<SearchParamsLike>;
};

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function formatLastActivity(value: string | null): string {
  return formatRelativeTimeCompactFromTimestamp(toTimestamp(value)) ?? "—";
}

function kickoffPill(status: SupplierQuoteListRow["kickoffStatus"]) {
  if (status === "n/a") {
    return { label: "—", className: "text-slate-500" };
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

function matchHealthChip(value: SupplierQuoteListRow["matchHealth"]) {
  switch (value) {
    case "good":
      return {
        label: "Match: Good",
        className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-100",
      };
    case "caution":
      return {
        label: "Match: Caution",
        className: "border-amber-500/40 bg-amber-500/10 text-amber-100",
      };
    case "poor":
      return {
        label: "Match: Poor",
        className: "border-red-500/40 bg-red-500/10 text-red-100",
      };
    default:
      return {
        label: "Match: Unknown",
        className: "border-slate-800 bg-slate-950/50 text-slate-300",
      };
  }
}

function benchChip(value: SupplierQuoteListRow["benchStatus"]) {
  switch (value) {
    case "underused":
      return {
        label: "Bench: Underused",
        className: "border-blue-500/40 bg-blue-500/10 text-blue-100",
      };
    case "balanced":
      return {
        label: "Bench: Balanced",
        className: "border-slate-800 bg-slate-950/50 text-slate-200",
      };
    case "overused":
      return {
        label: "Bench: Overused",
        className: "border-amber-500/40 bg-amber-500/10 text-amber-100",
      };
    default:
      return {
        label: "Bench: Unknown",
        className: "border-slate-800 bg-slate-950/50 text-slate-300",
      };
  }
}

function partsCoverageChip(value: SupplierQuoteListRow["partsCoverageHealth"]) {
  switch (value) {
    case "good":
      return {
        label: "Parts: Good",
        helper: null as string | null,
        className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-100",
      };
    case "needs_attention":
      return {
        label: "Parts: Needs attention",
        helper: "Clarify missing drawings/CAD during kickoff.",
        className: "border-amber-500/40 bg-amber-500/10 text-amber-100",
      };
    default:
      return {
        label: "No parts defined",
        helper: null as string | null,
        className: "border-slate-800 bg-slate-950/50 text-slate-300",
      };
  }
}

export default async function SupplierQuotesPage({
  searchParams,
}: SupplierQuotesPageProps) {
  const { user } = await getServerAuthUser();

  if (!user) {
    return (
      <PortalLoginPanel role="supplier" fallbackRedirect="/supplier/quotes" />
    );
  }

  const roles = await resolveUserRoles(user.id);
  if (!roles?.isSupplier) {
    return (
      <PortalShell
        workspace="supplier"
        title="Quotes"
        subtitle="This workspace is reserved for supplier accounts."
      >
        <EmptyStateNotice
          title="Supplier access required"
          description="Switch to the customer portal or contact support if you need supplier access."
          action={
            <Link
              href="/customer"
              className="text-sm font-semibold text-blue-300 underline-offset-4 hover:underline"
            >
              Go to customer portal
            </Link>
          }
        />
      </PortalShell>
    );
  }

  const profile = await loadSupplierProfileByUserId(user.id);
  const supplier = profile?.supplier ?? null;
  if (!supplier) {
    return (
      <PortalShell
        workspace="supplier"
        title="Quotes"
        subtitle="Finish onboarding to start receiving RFQs here."
      >
        <EmptyStateNotice
          title="Complete supplier onboarding"
          description="Share capabilities, certifications, and documents so we can route the right RFQs."
          action={
            <Link
              href="/supplier/onboarding"
              className="text-sm font-semibold text-blue-300 underline-offset-4 hover:underline"
            >
              Finish onboarding
            </Link>
          }
        />
      </PortalShell>
    );
  }

  const approvalsOn = approvalsEnabled();
  const supplierStatus = supplier?.status ?? "pending";
  const approvalStatus =
    profile?.approvalStatus ??
    getSupplierApprovalStatus({ status: supplierStatus });
  const approvalGateActive = approvalsOn && approvalStatus !== "approved";

  const resolvedSearchParams = await resolveMaybePromise(searchParams);
  const sp = normalizeSearchParams(resolvedSearchParams);

  const statusFilter = normalizeText(sp.get("status"));
  const kickoffFilter = normalizeText(sp.get("kickoff"));
  const messagesFilter = normalizeText(sp.get("messages"));
  const partsCoverageFilter = normalizeText(sp.get("partsCoverage"));

  const allRows = approvalGateActive ? [] : await loadSupplierQuotesList(user.id);

  const filteredRows = allRows
    .filter((row) => {
      if (statusFilter === "awarded") {
        return row.isAwardedToSupplier;
      }
      if (statusFilter === "open") {
        return !row.isAwardedToSupplier && isOpenQuoteStatus(row.status);
      }
      if (statusFilter === "closed") {
        return !row.isAwardedToSupplier && !isOpenQuoteStatus(row.status);
      }
      return true;
    })
    .filter((row) => {
      if (!kickoffFilter) return true;
      return row.isAwardedToSupplier && row.kickoffStatus === kickoffFilter;
    })
    .filter((row) => {
      if (messagesFilter === "unread") {
        return row.unreadMessagesCount > 0;
      }
      if (messagesFilter === "up_to_date") {
        return row.unreadMessagesCount <= 0;
      }
      if (messagesFilter === "needs_reply") {
        // We don't currently surface needsReplyFrom on this list; treat as unread for now.
        return row.unreadMessagesCount > 0;
      }
      return true;
    })
    .filter((row) => {
      if (!partsCoverageFilter) return true;
      if (
        partsCoverageFilter === "good" ||
        partsCoverageFilter === "needs_attention" ||
        partsCoverageFilter === "none"
      ) {
        return row.partsCoverageHealth === partsCoverageFilter;
      }
      return true;
    });

  const hasFilters = Boolean(
    statusFilter || kickoffFilter || messagesFilter || partsCoverageFilter,
  );

  return (
    <PortalShell
      workspace="supplier"
      title="Quotes"
      subtitle="RFQs you’re invited to, have bid on, or have been awarded."
      actions={
        <div className="flex flex-wrap gap-3">
          <Link
            href="/supplier"
            className="inline-flex items-center rounded-full border border-blue-400/40 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-blue-100 transition hover:border-blue-300 hover:text-white"
          >
            Back to dashboard
          </Link>
          <Link
            href="/supplier/messages"
            className="inline-flex items-center rounded-full border border-slate-800 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-200 transition hover:border-slate-600 hover:text-white"
          >
            Message inbox
          </Link>
        </div>
      }
    >
      <PortalCard
        title="RFQs"
        description="Status, kickoff, messages, and match health at a glance."
      >
        <form method="get" className="mb-4 flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs font-semibold text-slate-300">
            Status
            <select
              name="status"
              defaultValue={statusFilter}
              className="rounded-lg border border-slate-800 bg-slate-950/60 px-2 py-2 text-xs text-slate-100 outline-none transition focus:border-blue-400"
            >
              <option value="">All</option>
              <option value="open">Open</option>
              <option value="awarded">Awarded to you</option>
              <option value="closed">Closed</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-slate-300">
            Kickoff
            <select
              name="kickoff"
              defaultValue={kickoffFilter}
              className="rounded-lg border border-slate-800 bg-slate-950/60 px-2 py-2 text-xs text-slate-100 outline-none transition focus:border-blue-400"
            >
              <option value="">All</option>
              <option value="not_started">Not started</option>
              <option value="in_progress">In progress</option>
              <option value="complete">Complete</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-slate-300">
            Messages
            <select
              name="messages"
              defaultValue={messagesFilter}
              className="rounded-lg border border-slate-800 bg-slate-950/60 px-2 py-2 text-xs text-slate-100 outline-none transition focus:border-blue-400"
            >
              <option value="">All</option>
              <option value="needs_reply">Needs reply</option>
              <option value="unread">Unread only</option>
              <option value="up_to_date">Up to date</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-slate-300">
            Parts
            <select
              name="partsCoverage"
              defaultValue={partsCoverageFilter}
              className="rounded-lg border border-slate-800 bg-slate-950/60 px-2 py-2 text-xs text-slate-100 outline-none transition focus:border-blue-400"
            >
              <option value="">All</option>
              <option value="needs_attention">Needs attention</option>
              <option value="good">Good</option>
              <option value="none">No parts</option>
            </select>
          </label>
          <button
            type="submit"
            className="inline-flex items-center rounded-lg bg-blue-500 px-4 py-2 text-xs font-semibold text-black transition hover:bg-blue-400"
          >
            Apply
          </button>
          <Link
            href="/supplier/quotes"
            className="text-xs font-semibold text-slate-300 underline-offset-4 hover:underline"
          >
            Clear
          </Link>
        </form>

        {approvalGateActive ? (
          <div className="rounded-2xl border border-slate-900/70 bg-black/40 p-6">
            <p className="text-sm font-semibold text-slate-100">
              RFQs unlock after approval
            </p>
            <p className="mt-2 text-sm text-slate-400">
              We’ll populate this list as soon as your supplier profile is approved.
            </p>
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="rounded-2xl border border-slate-900/70 bg-black/40 p-6">
            {hasFilters ? (
              <>
                <p className="text-sm font-semibold text-slate-100">
                  No RFQs match these filters
                </p>
                <p className="mt-2 text-sm text-slate-400">
                  Try clearing filters to see all RFQs.
                </p>
                <div className="mt-4">
                  <Link
                    href="/supplier/quotes"
                    className="inline-flex items-center rounded-full bg-blue-500 px-4 py-2 text-sm font-semibold text-black transition hover:bg-blue-400"
                  >
                    Clear filters
                  </Link>
                </div>
              </>
            ) : (
              <>
                <p className="text-sm font-semibold text-slate-100">No RFQs yet</p>
                <p className="mt-2 text-sm text-slate-400">
                  No RFQs yet. When customers invite you to bid or we route work your way, RFQs will appear here.
                </p>
                <div className="mt-4">
                  <Link
                    href="/supplier"
                    className="inline-flex items-center rounded-full bg-blue-500 px-4 py-2 text-sm font-semibold text-black transition hover:bg-blue-400"
                  >
                    Back to dashboard
                  </Link>
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-slate-900/70 bg-black/40">
            <table className="min-w-full divide-y divide-slate-900/70 text-sm">
              <thead className="bg-slate-900/60">
                <tr>
                  <th className="px-5 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">
                    RFQ / Quote
                  </th>
                  <th className="px-5 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">
                    Status
                  </th>
                  <th className="px-5 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">
                    Parts
                  </th>
                  <th className="px-5 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">
                    Kickoff
                  </th>
                  <th className="px-5 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">
                    Messages
                  </th>
                  <th className="px-5 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">
                    Match
                  </th>
                  <th className="px-5 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">
                    Last activity
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-900/70">
                {filteredRows.map((row) => {
                  const open = isOpenQuoteStatus(row.status);
                  const coreStatus = row.isAwardedToSupplier
                    ? "Awarded to you"
                    : open
                      ? "Open"
                      : "Closed";
                  const subtext = row.hasBid ? `${coreStatus} • Bid submitted` : coreStatus;
                  const kickoff = kickoffPill(row.kickoffStatus);
                  const unread = Math.max(0, Math.floor(row.unreadMessagesCount ?? 0));
                  const matchChip = matchHealthChip(row.matchHealth);
                  const bench = benchChip(row.benchStatus);
                  const partsChip = partsCoverageChip(row.partsCoverageHealth);
                  const partsCount = typeof row.partsCount === "number" ? row.partsCount : 0;

                  return (
                    <tr key={row.quoteId} className="hover:bg-slate-900/50">
                      <td className="px-5 py-4 align-middle">
                        <div className="flex flex-col">
                          <Link
                            href={`/supplier/quotes/${row.quoteId}`}
                            className="font-medium text-slate-100 underline-offset-4 transition hover:underline"
                          >
                            {row.rfqLabel}
                          </Link>
                          <span className="text-xs text-slate-500">{subtext}</span>
                        </div>
                      </td>
                      <td className="px-5 py-4 align-middle">
                        <QuoteStatusBadge status={row.status} size="sm" />
                        {row.isAwardedToSupplier ? (
                          <p className="mt-2 text-xs font-semibold text-emerald-200">
                            Awarded to you
                          </p>
                        ) : null}
                      </td>
                      <td className="px-5 py-4 align-middle">
                        <Link
                          href={`/supplier/quotes/${row.quoteId}#uploads`}
                          className="group inline-flex flex-col items-start gap-1 underline-offset-4 hover:underline"
                        >
                          <span
                            className={`inline-flex w-fit items-center rounded-full border px-3 py-1 text-[11px] font-semibold ${partsChip.className}`}
                          >
                            {partsChip.label}
                          </span>
                          <span className="text-xs text-slate-500">
                            {partsCount.toLocaleString()} part{partsCount === 1 ? "" : "s"}
                          </span>
                          {partsChip.helper ? (
                            <span className="text-xs text-slate-500">{partsChip.helper}</span>
                          ) : null}
                        </Link>
                      </td>
                      <td className="px-5 py-4 align-middle">
                        {row.isAwardedToSupplier ? (
                          <span
                            className={`inline-flex w-fit items-center rounded-full border px-3 py-1 text-[11px] font-semibold ${kickoff.className}`}
                          >
                            {kickoff.label}
                          </span>
                        ) : (
                          <span className="text-sm text-slate-400">
                            {open ? "Waiting for decision" : "Not awarded"}
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-4 align-middle">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm text-slate-300">
                            {unread > 0 ? "Unread" : "Up to date"}
                          </span>
                          {unread > 0 ? (
                            <span className="inline-flex min-w-[1.75rem] items-center justify-center rounded-full bg-red-500/20 px-2 py-0.5 text-[11px] font-semibold text-red-100">
                              {unread > 99 ? "99+" : unread}
                            </span>
                          ) : null}
                        </div>
                        {unread > 0 ? (
                          <p className="mt-1 text-xs text-slate-500">
                            See inbox for “Needs your reply” signals
                          </p>
                        ) : (
                          <p className="mt-1 text-xs text-slate-500">—</p>
                        )}
                      </td>
                      <td className="px-5 py-4 align-middle">
                        <div className="flex flex-col gap-2">
                          <span
                            className={`inline-flex w-fit items-center rounded-full border px-3 py-1 text-[11px] font-semibold ${matchChip.className}`}
                          >
                            {matchChip.label}
                          </span>
                          <span
                            className={`inline-flex w-fit items-center rounded-full border px-3 py-1 text-[11px] font-semibold ${bench.className}`}
                          >
                            {bench.label}
                          </span>
                        </div>
                      </td>
                      <td className="px-5 py-4 align-middle text-slate-300">
                        {formatLastActivity(row.lastActivityAt)}
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
