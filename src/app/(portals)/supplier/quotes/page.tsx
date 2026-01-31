import Link from "next/link";

import {
  PortalShell,
  PORTAL_SURFACE_CARD,
} from "../../components/PortalShell";
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
import { getDemoSupplierProviderIdFromCookie } from "@/server/demo/demoSupplierProvider";

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
import { computeRfqQualitySummary } from "@/server/quotes/rfqQualitySignals";
import { EmptyStateCard } from "@/components/EmptyStateCard";
import { ctaSizeClasses, primaryInfoCtaClasses } from "@/lib/ctas";
import { formatDateTime } from "@/lib/formatDate";
import { matchQuotesToSupplier } from "@/server/suppliers";
import { buildSupplierInboxRows } from "@/app/(portals)/supplier/inboxRows";
import {
  PORTAL_CELL,
  PORTAL_CELL_RIGHT,
  PORTAL_DIVIDER,
  PORTAL_ROW,
  PORTAL_TH,
  PORTAL_TH_RIGHT,
} from "@/app/(portals)/components/portalTableRhythm";

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

function formatReceivedAt(value: string | null): string {
  const relative = formatRelativeTimeCompactFromTimestamp(toTimestamp(value));
  return relative ? `Received ${relative}` : "Received —";
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
        title="RFQs"
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
        title="RFQs"
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
  const rfqQualityFilter = normalizeText(sp.get("rfqQuality"));

  const demoProviderId = await getDemoSupplierProviderIdFromCookie();
  const allRows = approvalGateActive
    ? []
    : await loadSupplierQuotesList(user.id, { providerIdOverride: demoProviderId });

  let filteredRows = allRows
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

  if (
    rfqQualityFilter === "high" ||
    rfqQualityFilter === "medium" ||
    rfqQualityFilter === "low" ||
    rfqQualityFilter === "min"
  ) {
    const summaries = await Promise.all(
      filteredRows.map((row) =>
        computeRfqQualitySummary(row.quoteId).catch(() => null),
      ),
    );
    filteredRows = filteredRows.filter((row, idx) => {
      const score = summaries[idx]?.score ?? 0;
      if (rfqQualityFilter === "high") return score >= 85;
      if (rfqQualityFilter === "medium") return score >= 70 && score <= 84;
      if (rfqQualityFilter === "low") return score >= 50 && score <= 69;
      return score < 50;
    });
  }

  const hasFilters = Boolean(
    statusFilter ||
      kickoffFilter ||
      messagesFilter ||
      partsCoverageFilter ||
      rfqQualityFilter,
  );

  const rfqMetaByQuoteId = new Map<
    string,
    {
      receivedAt: string | null;
      processHint: string | null;
      quantityHint: string | null;
      targetDate: string | null;
    }
  >();

  if (!approvalGateActive && supplier) {
    const visibleQuoteIds = new Set(filteredRows.map((row) => row.quoteId));
    try {
      const matchesResult = await matchQuotesToSupplier(
        {
          supplierId: supplier.id,
          supplierEmail: supplier.primary_email ?? user.email ?? null,
        },
        {
          maxMatches: Math.max(40, Math.min(200, visibleQuoteIds.size + 20)),
          quoteFetchLimit: Math.max(80, Math.min(300, visibleQuoteIds.size * 2)),
        },
      );

      const inboxRows = buildSupplierInboxRows({
        matches: matchesResult.data ?? [],
        bidAggregates: {},
        capabilities: profile?.capabilities ?? [],
      });

      for (const row of inboxRows) {
        if (!visibleQuoteIds.has(row.quoteId)) continue;
        rfqMetaByQuoteId.set(row.quoteId, {
          receivedAt: row.createdAt ?? null,
          processHint: row.processHint ?? null,
          quantityHint: row.quantityHint ?? null,
          targetDate: row.targetDate ?? null,
        });
      }
    } catch (error) {
      console.error("[supplier quotes] match metadata load failed", {
        supplierId: supplier.id,
        error,
      });
    }
  }

  return (
    <PortalShell
      workspace="supplier"
      title="RFQs"
      subtitle="RFQs you’re invited to, have quoted on, or have been awarded."
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
            Messages
          </Link>
        </div>
      }
    >
      <PortalCard
        title="RFQs"
        header={false}
        className={`${PORTAL_SURFACE_CARD} p-0`}
      >
        <div className="p-6">
          <form method="get" className="flex flex-wrap items-end gap-3">
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
            <label className="flex flex-col gap-1 text-xs font-semibold text-slate-300">
              RFQ quality
              <select
                name="rfqQuality"
                defaultValue={rfqQualityFilter}
                className="rounded-lg border border-slate-800 bg-slate-950/60 px-2 py-2 text-xs text-slate-100 outline-none transition focus:border-blue-400"
              >
                <option value="">All</option>
                <option value="high">High (85+)</option>
                <option value="medium">Medium (70–84)</option>
                <option value="low">Low (50–69)</option>
                <option value="min">Min (&lt; 50)</option>
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
        </div>

        {approvalGateActive ? (
          <div className="px-6 pb-6">
            <EmptyStateCard
              title="RFQs unlock after approval"
              description="We’ll populate this list as soon as your supplier profile is approved."
              tone="info"
              actionVariant="info"
              action={{ label: "Back to dashboard", href: "/supplier" }}
            />
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="px-6 pb-6">
            {hasFilters ? (
              <EmptyStateCard
                title="No RFQs match these filters"
                description="Try clearing filters to see everything."
                tone="info"
                actionVariant="info"
                action={{ label: "Clear filters", href: "/supplier/quotes" }}
              />
            ) : (
              <EmptyStateCard
                title="No RFQs yet"
                description="Invites and quotes will appear here as soon as you’re included."
                tone="info"
                actionVariant="info"
                action={{ label: "Back to dashboard", href: "/supplier" }}
              />
            )}
          </div>
        ) : (
          <div className="overflow-hidden border-t border-slate-800/40">
            <table className="min-w-full table-fixed text-sm">
              <thead className="bg-transparent">
                <tr>
                  <th className={PORTAL_TH}>
                    RFQ
                  </th>
                  <th className={`hidden w-[15rem] md:table-cell ${PORTAL_TH}`}>
                    Status
                  </th>
                  <th className={`w-[12.5rem] ${PORTAL_TH_RIGHT}`}>
                    Action
                  </th>
                </tr>
              </thead>
              <tbody className={PORTAL_DIVIDER}>
                {filteredRows.map((row) => {
                  const closedByAward = Boolean(row.hasAward);
                  const open = isOpenQuoteStatus(row.status) && !closedByAward;
                  const coreStatus = row.isAwardedToSupplier
                    ? "Awarded to you"
                    : closedByAward
                      ? "RFQ closed"
                      : open
                        ? "Open"
                        : "Closed";
                  const unread = Math.max(0, Math.floor(row.unreadMessagesCount ?? 0));
                  const messagesHref = `/supplier/quotes/${row.quoteId}?tab=messages#messages`;
                  const partsCount = typeof row.partsCount === "number" ? row.partsCount : 0;
                  const meta = rfqMetaByQuoteId.get(row.quoteId) ?? null;
                  const receivedLabel = formatReceivedAt(meta?.receivedAt ?? null);
                  const processLabel = meta?.processHint?.trim() ? meta.processHint : "Process —";
                  const quantityLabel = meta?.quantityHint?.trim() ? meta.quantityHint : "Qty —";
                  const needByLabel = meta?.targetDate
                    ? (formatDateTime(meta.targetDate, { includeTime: false }) ?? "—")
                    : "—";
                  const secondaryMeta = `${receivedLabel} • ${processLabel} • ${quantityLabel} • Need-by ${needByLabel}`;
                  const ctaLabel = open && !row.hasBid ? "Submit offer →" : "Open RFQ →";
                  const statusLine = row.hasBid ? `${coreStatus} • Offer submitted` : coreStatus;

                  return (
                    <tr
                      key={row.quoteId}
                      className={PORTAL_ROW}
                    >
                      <td className={PORTAL_CELL}>
                        <div className="flex min-w-0 flex-col">
                          <Link
                            href={`/supplier/quotes/${row.quoteId}`}
                            className="truncate text-sm font-semibold leading-tight text-slate-100 underline-offset-4 transition hover:underline motion-reduce:transition-none"
                          >
                            {row.rfqLabel}
                          </Link>
                          <span
                            className="mt-1 truncate text-xs text-slate-500 md:whitespace-nowrap"
                            title={secondaryMeta}
                          >
                            {secondaryMeta}
                          </span>

                          <div className="mt-2 flex items-center gap-3 md:hidden">
                            <QuoteStatusBadge status={row.status} size="sm" />
                            <Link
                              href={messagesHref}
                              className="inline-flex items-center gap-2 text-xs font-medium text-slate-400 underline-offset-4 hover:text-slate-200 hover:underline"
                            >
                              <span className="whitespace-nowrap">Messages</span>
                              {unread > 0 ? (
                                <span className="inline-flex min-w-[1.6rem] items-center justify-center rounded-full border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-[10px] font-semibold text-red-100 tabular-nums">
                                  {unread > 99 ? "99+" : unread}
                                </span>
                              ) : null}
                            </Link>
                          </div>
                        </div>
                      </td>
                      <td className={`hidden md:table-cell ${PORTAL_CELL}`}>
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center justify-between gap-3">
                            <QuoteStatusBadge status={row.status} size="sm" />
                            <span className="text-xs text-slate-500 tabular-nums whitespace-nowrap">
                              {formatLastActivity(row.lastActivityAt)}
                            </span>
                          </div>
                          <p className="text-xs text-slate-500">{statusLine}</p>
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-xs text-slate-500 tabular-nums whitespace-nowrap">
                              {partsCount.toLocaleString()} part{partsCount === 1 ? "" : "s"}
                            </span>
                            <Link
                              href={messagesHref}
                              className="inline-flex items-center gap-2 text-xs font-medium text-slate-400 underline-offset-4 hover:text-slate-200 hover:underline"
                            >
                              <span className="whitespace-nowrap">Messages</span>
                              {unread > 0 ? (
                                <span className="inline-flex min-w-[1.6rem] items-center justify-center rounded-full border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-[10px] font-semibold text-red-100 tabular-nums">
                                  {unread > 99 ? "99+" : unread}
                                </span>
                              ) : null}
                            </Link>
                          </div>
                        </div>
                      </td>
                      <td className={PORTAL_CELL_RIGHT}>
                        <Link
                          href={`/supplier/quotes/${row.quoteId}`}
                          className={`${primaryInfoCtaClasses} ${ctaSizeClasses.sm} inline-flex min-w-[11rem] justify-center text-xs font-semibold uppercase tracking-wide motion-reduce:transition-none`}
                        >
                          {ctaLabel}
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
