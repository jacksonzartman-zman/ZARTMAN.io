import Link from "next/link";

import { requireUser } from "@/server/auth";
import { getCustomerByUserId } from "@/server/customers";
import {
  loadCustomerQuotesList,
  type CustomerQuotesListFilters,
} from "@/server/customer/quotesList";
import { formatCurrency } from "@/lib/formatCurrency";
import { formatRelativeTimeCompactFromTimestamp, toTimestamp } from "@/lib/relativeTime";
import { normalizeSearchParams } from "@/lib/route/normalizeSearchParams";
import PortalCard from "../../PortalCard";
import { PortalShell } from "../../components/PortalShell";

export const dynamic = "force-dynamic";

function formatLastActivity(value: string | null): string {
  return formatRelativeTimeCompactFromTimestamp(toTimestamp(value)) ?? "—";
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function formatKickoffPill(status: "not_started" | "in_progress" | "complete" | "n/a") {
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

type InboxStatus = "draft" | "in_review" | "awarded";

function deriveInboxStatus(args: {
  hasWinner: boolean;
  bidsCount: number;
}): {
  key: InboxStatus;
  label: string;
  pillClassName: string;
  actionLabel: string;
  actionHrefSuffix: string;
} {
  if (args.hasWinner) {
    return {
      key: "awarded",
      label: "Awarded",
      pillClassName: "border-emerald-500/40 bg-emerald-500/10 text-emerald-100",
      actionLabel: "Proceed to order",
      actionHrefSuffix: "#checkout",
    };
  }
  if (args.bidsCount > 0) {
    return {
      key: "in_review",
      label: "In review",
      pillClassName: "border-blue-500/40 bg-blue-500/10 text-blue-100",
      actionLabel: "Review bids",
      actionHrefSuffix: "#decision",
    };
  }
  return {
    key: "draft",
    label: "Draft",
    pillClassName: "border-slate-800 bg-slate-950/50 text-slate-300",
    actionLabel: "Complete request",
    actionHrefSuffix: "#uploads",
  };
}

function formatLeadTime(days: number | null): string {
  if (typeof days !== "number" || !Number.isFinite(days)) return "Pending";
  if (days <= 0) return "Pending";
  return `${days} day${days === 1 ? "" : "s"}`;
}

function formatMoney(amount: number | null, currency: string | null): string {
  if (typeof amount !== "number" || !Number.isFinite(amount)) return "Pending";
  return formatCurrency(amount, currency ?? undefined);
}

type CustomerQuotesPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function CustomerQuotesPage({
  searchParams,
}: CustomerQuotesPageProps) {
  const user = await requireUser({ redirectTo: "/customer" });
  const customer = await getCustomerByUserId(user.id);

  if (!customer) {
    return (
      <PortalShell
        workspace="customer"
        title="Quotes"
        subtitle="All RFQs you’ve submitted, from draft to award."
        actions={
          <Link
            href="/quote"
            className="inline-flex items-center rounded-full border border-emerald-400/40 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-emerald-100 transition hover:border-emerald-300 hover:text-white"
          >
            Start a new RFQ
          </Link>
        }
      >
        <section className="space-y-3 rounded-2xl border border-slate-900 bg-slate-950/60 p-6">
          <p className="text-sm text-slate-300">
            We couldn&apos;t find a customer workspace linked to {user.email}. Complete your customer
            profile to start tracking RFQs, supplier bids, and messages in one place.
          </p>
          <Link
            href="/customer"
            className="inline-flex items-center rounded-full bg-emerald-500 px-4 py-2 text-sm font-semibold text-black transition hover:bg-emerald-400"
          >
            Back to dashboard
          </Link>
        </section>
      </PortalShell>
    );
  }

  const usp = normalizeSearchParams(searchParams ? await searchParams : undefined);
  const status = normalizeText(usp.get("status"));
  const kickoff = normalizeText(usp.get("kickoff"));
  const hasWinner = normalizeText(usp.get("hasWinner"));

  const filters: CustomerQuotesListFilters = {
    status: status || undefined,
    kickoff: (kickoff || undefined) as CustomerQuotesListFilters["kickoff"],
    hasWinner: (hasWinner || undefined) as CustomerQuotesListFilters["hasWinner"],
  };

  const quotes = await loadCustomerQuotesList(
    { userId: user.id, email: user.email ?? null },
    filters,
  );

  return (
    <PortalShell
      workspace="customer"
      title="Quotes"
      subtitle="All RFQs you’ve submitted, from draft to award."
      actions={
        <Link
          href="/quote"
          className="inline-flex items-center rounded-full border border-emerald-400/40 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-emerald-100 transition hover:border-emerald-300 hover:text-white"
        >
          Start a new RFQ
        </Link>
      }
    >
      <PortalCard
        title="Quotes"
        description="Track submitted RFQs, award progress, kickoff status, and messages at a glance."
      >
        <form method="get" className="mb-4 flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs font-semibold text-slate-300">
            Status
            <select
              name="status"
              defaultValue={status}
              className="rounded-lg border border-slate-800 bg-slate-950/60 px-2 py-2 text-xs text-slate-100 outline-none transition focus:border-emerald-400"
            >
              <option value="">All</option>
              <option value="open">Open</option>
              <option value="awarded">Awarded</option>
              <option value="closed">Closed</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-slate-300">
            Kickoff
            <select
              name="kickoff"
              defaultValue={kickoff}
              className="rounded-lg border border-slate-800 bg-slate-950/60 px-2 py-2 text-xs text-slate-100 outline-none transition focus:border-emerald-400"
            >
              <option value="">All</option>
              <option value="not_started">Not started</option>
              <option value="in_progress">In progress</option>
              <option value="complete">Complete</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-slate-300">
            Winner
            <select
              name="hasWinner"
              defaultValue={hasWinner}
              className="rounded-lg border border-slate-800 bg-slate-950/60 px-2 py-2 text-xs text-slate-100 outline-none transition focus:border-emerald-400"
            >
              <option value="">All</option>
              <option value="yes">Selected</option>
              <option value="no">Not selected</option>
            </select>
          </label>
          <button
            type="submit"
            className="inline-flex items-center rounded-lg bg-emerald-500 px-4 py-2 text-xs font-semibold text-black transition hover:bg-emerald-400"
          >
            Apply
          </button>
          <Link
            href="/customer/quotes"
            className="text-xs font-semibold text-slate-300 underline-offset-4 hover:underline"
          >
            Clear
          </Link>
        </form>

        {quotes.length === 0 ? (
          <div className="rounded-2xl border border-slate-900/70 bg-black/40 p-6">
            {status || kickoff || hasWinner ? (
              <>
                <p className="text-sm font-semibold text-slate-100">
                  No RFQs match these filters
                </p>
                <p className="mt-2 text-sm text-slate-400">
                  Clear filters to see your full list of RFQs.
                </p>
                <div className="mt-4">
                  <Link
                    href="/customer/quotes"
                    className="inline-flex items-center rounded-full bg-emerald-500 px-4 py-2 text-sm font-semibold text-black transition hover:bg-emerald-400"
                  >
                    Clear filters
                  </Link>
                </div>
              </>
            ) : (
              <>
                <p className="text-sm font-semibold text-slate-100">No RFQs yet</p>
                <p className="mt-2 text-sm text-slate-400">
                  When you submit an RFQ, we’ll route it to matching suppliers and you’ll see bids and updates here as they come in.
                </p>
                <div className="mt-4">
                  <Link
                    href="/quote"
                    className="inline-flex items-center rounded-full bg-emerald-500 px-4 py-2 text-sm font-semibold text-black transition hover:bg-emerald-400"
                  >
                    Start an RFQ
                  </Link>
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-slate-900/70 bg-black/40">
            <ul className="divide-y divide-slate-900/70">
              {quotes.map((quote) => {
                const kickoff = formatKickoffPill(quote.kickoffStatus);
                const unread = Math.max(0, Math.floor(quote.unreadMessagesCount ?? 0));
                const inboxStatus = deriveInboxStatus({
                  hasWinner: quote.hasWinner,
                  bidsCount: quote.bidsCount,
                });

                const fileLabel = quote.primaryFileName ?? "No files yet";
                const bestPriceLabel =
                  formatMoney(
                    quote.selectedPriceAmount ?? quote.bestPriceAmount,
                    quote.selectedPriceCurrency ?? quote.bestPriceCurrency,
                  );
                const bestLeadLabel =
                  formatLeadTime(quote.selectedLeadTimeDays ?? quote.bestLeadTimeDays);
                const actionHref = `/customer/quotes/${quote.id}${inboxStatus.actionHrefSuffix}`;

                return (
                  <li key={quote.id} className="hover:bg-slate-900/40">
                    <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link
                            href={`/customer/quotes/${quote.id}`}
                            className="min-w-0 truncate text-base font-semibold text-slate-100 underline-offset-4 transition hover:underline"
                          >
                            {quote.rfqLabel}
                          </Link>
                          <span
                            className={`inline-flex items-center rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-wide ${inboxStatus.pillClassName}`}
                          >
                            {inboxStatus.label}
                          </span>
                          {unread > 0 ? (
                            <span className="inline-flex items-center rounded-full border border-red-500/30 bg-red-500/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-red-100">
                              {unread > 99 ? "99+" : unread} new
                            </span>
                          ) : null}
                          {quote.hasWinner ? (
                            <span className={`inline-flex items-center rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-wide ${kickoff.className}`}>
                              {kickoff.label}
                            </span>
                          ) : null}
                        </div>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
                          <span className="truncate">
                            <span className="text-slate-500">File:</span> {fileLabel}
                          </span>
                          <span className="text-slate-600">•</span>
                          <span>
                            <span className="text-slate-500">
                              {quote.hasWinner ? "Selected" : "Best"} price:
                            </span>{" "}
                            <span className="font-semibold text-slate-200">{bestPriceLabel}</span>
                          </span>
                          <span className="text-slate-600">•</span>
                          <span>
                            <span className="text-slate-500">
                              {quote.hasWinner ? "Selected" : "Best"} lead:
                            </span>{" "}
                            <span className="font-semibold text-slate-200">{bestLeadLabel}</span>
                          </span>
                          <span className="text-slate-600">•</span>
                          <span>
                            <span className="text-slate-500">Updated:</span>{" "}
                            {formatLastActivity(quote.lastActivityAt)}
                          </span>
                        </div>
                      </div>

                      <div className="flex shrink-0 items-center justify-end gap-2">
                        <Link
                          href={actionHref}
                          className="inline-flex items-center justify-center rounded-full bg-emerald-500 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-black transition hover:bg-emerald-400"
                        >
                          {inboxStatus.actionLabel}
                        </Link>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </PortalCard>
    </PortalShell>
  );
}
