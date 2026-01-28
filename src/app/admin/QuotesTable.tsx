/**
 * Phase 1 Polish checklist
 * - Done: Admin inbox empty state is positive + calm
 * - Done: Copy normalization ("RFQ" consistently in table)
 */

import clsx from "clsx";
import Link from "next/link";
import { formatDateTime } from "@/lib/formatDate";
import type { AdminQuoteListStatus, AdminQuotesView } from "@/types/adminQuotes";
import AdminTableShell, { adminTableCellClass } from "./AdminTableShell";
import { ctaSizeClasses, secondaryCtaClasses } from "@/lib/ctas";
import {
  type CapacityCapability,
  type CapacityLevel,
} from "@/server/admin/capacity";
import {
  ActionGroup,
  ActionGroupSection,
  ActionPillButton,
  ActionPillLink,
  ActionPillMenu,
} from "@/components/actions/ActionGroup";
import type {
  AdminThreadNeedsReplyFrom,
  AdminThreadStalenessBucket,
} from "@/server/admin/messageSla";
import type { PartsCoverageHealth } from "@/lib/quote/partsCoverage";
import { awardCheapestOfferAction } from "./quotes/demoActions";

export type QuoteCapacitySummary = {
  supplierId: string;
  weekStartDate: string; // YYYY-MM-DD
  coverageCount: number; // 0..4
  totalCount: number; // 4
  levels: Record<CapacityCapability, CapacityLevel | null>;
  lastUpdatedAt: string | null; // ISO
};

export type QuoteRow = {
  id: string;
  rfqLabel: string;
  createdAt: string | null;
  customerName?: string | null;
  customerEmail?: string | null;
  company?: string | null;
  fileCountLabel: string;
  status: AdminQuoteListStatus;
  statusLabel: string;
  statusHelper: string;
  statusClassName: string;
  kickoffProgress?: { completed: number; total: number | null } | null;
  threadLastMessageAt: string | null;
  threadNeedsReplyFrom: AdminThreadNeedsReplyFrom | null;
  threadStalenessBucket: AdminThreadStalenessBucket;
  threadUnreadForAdmin: boolean;
  adminNeedsReply: boolean;
  adminOverdue?: boolean;
  bidSummary: string;
  bidCountLabel: string;
  bestPriceLabel: string;
  leadTimeLabel: string;
  hasWinningBid: boolean;
  bidCount: number;
  latestBidAt: string | null;
  hasAwardedBid: boolean;
  hasAward: boolean;
  awardedAt: string | null;
  awardedSupplierName: string | null;
  awardWinnerName: string | null;
  capacityNextWeek?: QuoteCapacitySummary | null;
  partsCoverageHealth: PartsCoverageHealth;
  partsCount: number | null;
  ctaHref: string;
  bidsHref: string;
};

type QuotesTableProps = {
  quotes: QuoteRow[];
  totalCount: number;
  currentView: AdminQuotesView;
  searchTerm?: string;
  demoSupplierProvidersByQuoteId?: Record<
    string,
    Array<{ providerId: string; label: string }>
  >;
  demoReturnToBase?: string;
};

export default function QuotesTable({
  quotes,
  totalCount,
  currentView,
  searchTerm,
  demoSupplierProvidersByQuoteId,
  demoReturnToBase,
}: QuotesTableProps) {
  const showEmptyState = quotes.length === 0;
  const emptyState = getEmptyStateCopy({ totalCount, currentView, searchTerm });
  const demoEnabled = Boolean(demoReturnToBase && demoReturnToBase.startsWith("/admin/quotes"));

  return (
    <AdminTableShell
      tableClassName="min-w-[1180px] w-full border-separate border-spacing-0 text-sm"
      head={
        <tr>
          <th className="px-5 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">
            RFQ
          </th>
          <th className="px-5 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">
            Customer
          </th>
          <th className="px-5 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">
            Status
          </th>
          <th className="px-5 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">
            Offers
          </th>
          <th className="w-[16rem] min-w-[16rem] px-5 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">
            Award
          </th>
          <th className="px-5 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">
            Kickoff
          </th>
          <th className="px-5 py-4 text-right text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">
            Actions
          </th>
        </tr>
      }
      body={
        showEmptyState ? (
          <tr>
            <td
              colSpan={7}
              className="px-6 py-12 text-center text-base text-slate-300"
            >
              <p className="font-medium text-slate-100">{emptyState.title}</p>
              <p className="mt-2 text-sm text-slate-400">{emptyState.description}</p>
            </td>
          </tr>
        ) : (
          quotes.map((row) => {
            const createdAtLabel = formatDateTime(row.createdAt, {
              includeTime: true,
            });
            const latestBidLabel = row.latestBidAt
              ? formatDateTime(row.latestBidAt, { includeTime: true })
              : null;
            const awardedAtLabel = row.awardedAt
              ? formatDateTime(row.awardedAt, { includeTime: true })
              : null;
            const rowAnchorId = `rfq-${row.id}`;
            const returnToWithAnchor =
              demoEnabled && demoReturnToBase ? `${demoReturnToBase}#${rowAnchorId}` : null;

            const offersLabel =
              row.bidCount > 0
                ? `${row.bidCount} offer${row.bidCount === 1 ? "" : "s"}`
                : "No offers yet";
            const kickoffLabel = (() => {
              if (!row.hasAward) return "Locked";
              if (!demoEnabled) return "Unlocked";
              if (!row.kickoffProgress) return "—";
              const completed = row.kickoffProgress.completed;
              const total = row.kickoffProgress.total;
              if (typeof total === "number" && total > 0) return `${completed}/${total}`;
              return `${completed}/—`;
            })();

            return (
              <tr
                key={row.id}
                id={rowAnchorId}
                className="border-b border-slate-800/60 bg-slate-950/40 transition hover:bg-slate-900/40"
              >
                <td className={adminTableCellClass}>
                  <div className="flex flex-col gap-1">
                    <Link
                      href={`/admin/quotes/${row.id}`}
                      className="text-sm font-semibold text-emerald-100 hover:text-emerald-300"
                    >
                      <span className="max-w-[240px] truncate">{row.rfqLabel}</span>
                    </Link>
                    <p className="text-[11px] uppercase tracking-wide text-slate-500">
                      Created {createdAtLabel ?? "—"}
                    </p>
                  </div>
                </td>
                <td className={adminTableCellClass}>
                  <div className="space-y-1 text-xs">
                    <p className="font-medium text-slate-100">
                      {row.company || "—"}
                    </p>
                    {row.customerEmail ? (
                      <a
                        href={`mailto:${row.customerEmail}`}
                        className="text-emerald-200 hover:underline"
                      >
                        {row.customerEmail}
                      </a>
                    ) : (
                      <p className="text-slate-500">Email unavailable</p>
                    )}
                    {row.customerName ? (
                      <p className="text-slate-500">{row.customerName}</p>
                    ) : null}
                  </div>
                </td>
                <td className={adminTableCellClass}>
                  <div className="space-y-1">
                    <span
                      className={clsx("pill pill-table", row.statusClassName)}
                    >
                      {row.statusLabel}
                    </span>
                    <p className="text-xs text-slate-400">{row.statusHelper}</p>
                  </div>
                </td>
                <td className={clsx(adminTableCellClass, "text-xs text-slate-200")}>
                  <p className="font-semibold text-slate-100">{offersLabel}</p>
                  <p className="text-slate-400">
                    Best: {row.bestPriceLabel} · Lead: {row.leadTimeLabel}
                  </p>
                  <p className="mt-2 text-slate-500">
                    Latest offer: {row.bidCount > 0 ? latestBidLabel ?? "—" : "—"}
                  </p>
                </td>
                <td className={clsx(adminTableCellClass, "text-xs text-slate-200")}>
                  {row.hasAward ? (
                    <div className="space-y-1">
                      <p className="font-semibold text-emerald-100">Awarded</p>
                      <p className="text-slate-300">
                        {row.awardWinnerName || row.awardedSupplierName || "Winning supplier selected"}
                      </p>
                      <p className="text-slate-400">
                        {awardedAtLabel ? `At ${awardedAtLabel}` : "At —"}
                      </p>
                    </div>
                  ) : (
                    <p className="text-slate-500">Not awarded</p>
                  )}
                  {demoSupplierProvidersByQuoteId?.[row.id]?.length || demoEnabled ? (
                    <div className="mt-3">
                      <ActionGroup>
                        {demoSupplierProvidersByQuoteId?.[row.id]?.length ? (
                          <ActionGroupSection title="View as">
                            {demoSupplierProvidersByQuoteId[row.id]!.slice(0, 3).map((provider) => (
                              <ActionPillLink
                                key={provider.providerId}
                                href={`/admin/quotes/demo/supplier?providerId=${encodeURIComponent(
                                  provider.providerId,
                                )}&quoteId=${encodeURIComponent(row.id)}`}
                                title={`Set demo supplier provider: ${provider.label}`}
                              >
                                View as {provider.label}
                              </ActionPillLink>
                            ))}
                            {demoSupplierProvidersByQuoteId[row.id]!.length > 3 ? (
                              <ActionPillMenu
                                label="More…"
                                title="More demo supplier providers"
                                items={demoSupplierProvidersByQuoteId[row.id]!
                                  .slice(3)
                                  .map((provider) => ({
                                    key: provider.providerId,
                                    label: `View as ${provider.label}`,
                                    href: `/admin/quotes/demo/supplier?providerId=${encodeURIComponent(
                                      provider.providerId,
                                    )}&quoteId=${encodeURIComponent(row.id)}`,
                                    title: `Set demo supplier provider: ${provider.label}`,
                                  }))}
                              />
                            ) : null}
                          </ActionGroupSection>
                        ) : null}
                        {demoEnabled ? (
                          <ActionGroupSection title="Demo tools" divider>
                            <ActionPillLink
                              href={`/customer/quotes/${encodeURIComponent(row.id)}`}
                              target="_blank"
                              rel="noreferrer"
                              title="Open the customer quote page in a new tab"
                            >
                              View as Customer
                            </ActionPillLink>
                            <ActionPillLink
                              href={`/admin/quotes/demo/clear-supplier?quoteId=${encodeURIComponent(
                                row.id,
                              )}${
                                returnToWithAnchor
                                  ? `&returnTo=${encodeURIComponent(returnToWithAnchor)}`
                                  : ""
                              }`}
                              title="Clear the demo supplier provider cookie"
                            >
                              Clear demo supplier
                            </ActionPillLink>
                            <form action={awardCheapestOfferAction} className="w-full">
                              <input type="hidden" name="quoteId" value={row.id} />
                              <input
                                type="hidden"
                                name="returnTo"
                                value={
                                  returnToWithAnchor ?? demoReturnToBase ?? "/admin/quotes"
                                }
                              />
                              <ActionPillButton
                                type="submit"
                                variant="warning"
                                title="Award the lowest total price offer"
                              >
                                Award cheapest
                              </ActionPillButton>
                            </form>
                          </ActionGroupSection>
                        ) : null}
                      </ActionGroup>
                    </div>
                  ) : null}
                </td>
                <td className={clsx(adminTableCellClass, "text-xs text-slate-200")}>
                  <span
                    className={clsx(
                      "inline-flex rounded-full border px-3 py-1 text-[11px] font-semibold",
                      kickoffLabel === "Locked"
                        ? "border-slate-800 bg-slate-950/50 text-slate-300"
                        : kickoffLabel === "Unlocked"
                          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-100"
                          : "border-slate-800 bg-slate-950/50 text-slate-200",
                    )}
                  >
                    {kickoffLabel === "Unlocked"
                      ? "Unlocked"
                      : kickoffLabel === "Locked"
                        ? "Locked"
                        : kickoffLabel}
                  </span>
                  {demoEnabled && kickoffLabel !== "Locked" && kickoffLabel !== "Unlocked" ? (
                    <p className="mt-2 text-xs text-slate-500">Completed / total tasks</p>
                  ) : null}
                </td>
                <td className={clsx(adminTableCellClass, "text-right")}>
                  <div className="flex flex-col items-end gap-2">
                    <Link
                      href={row.ctaHref}
                      className={clsx(
                        secondaryCtaClasses,
                        ctaSizeClasses.sm,
                        "inline-flex min-w-[11rem] justify-center",
                      )}
                    >
                      Open RFQ workspace
                    </Link>
                    <Link
                      href={row.bidsHref}
                      className="text-xs font-semibold text-emerald-200 hover:text-emerald-100"
                    >
                      View offers
                    </Link>
                  </div>
                </td>
              </tr>
            );
          })
        )
      }
    />
  );
}

function getEmptyStateCopy({
  totalCount,
  currentView,
  searchTerm,
}: {
  totalCount: number;
  currentView: AdminQuotesView;
  searchTerm?: string;
}) {
  if (totalCount === 0) {
    return {
      title: "No quotes yet.",
      description: "New RFQs will appear here as customers submit them.",
    };
  }

  if (searchTerm) {
    return {
      title: "No quotes match your search.",
      description: "Try another keyword or clear the search box.",
    };
  }

  if (currentView === "needs_attention") {
    return {
      title: "No items need a reply right now.",
      description:
        "New messages, uploads, and offer activity will show up here automatically.",
    };
  }

  if (currentView === "awarded") {
    return {
      title: "No awarded RFQs yet.",
      description: "Select a winning supplier to see those projects in this tab.",
    };
  }

  return {
    title: "No quotes match your filters.",
    description: "Try switching views or clearing filters to see more RFQs.",
  };
}
