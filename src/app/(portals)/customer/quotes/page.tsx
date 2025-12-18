import Link from "next/link";
import type { ReadonlyURLSearchParams } from "next/navigation";

import { requireUser } from "@/server/auth";
import { getCustomerByUserId } from "@/server/customers";
import {
  loadCustomerQuotesList,
  type CustomerQuotesListFilters,
} from "@/server/customer/quotesList";
import {
  getCustomerQuoteStatusMeta,
  type CustomerQuoteListStatus,
} from "@/server/quotes/customerSummary";
import { formatRelativeTimeCompactFromTimestamp, toTimestamp } from "@/lib/relativeTime";
import PortalCard from "../../PortalCard";
import { PortalShell } from "../../components/PortalShell";

export const dynamic = "force-dynamic";

function formatLastActivity(value: string | null): string {
  return formatRelativeTimeCompactFromTimestamp(toTimestamp(value)) ?? "—";
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function resolveStatusMeta(label: string) {
  const normalized = normalizeText(label).toLowerCase();
  const key: CustomerQuoteListStatus =
    normalized === "bids received"
      ? "bids_received"
      : normalized === "awarded"
        ? "awarded"
        : normalized === "closed"
          ? "closed"
          : "submitted";
  return getCustomerQuoteStatusMeta(key);
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

type CustomerQuotesPageProps = {
  searchParams?: Promise<ReadonlyURLSearchParams>;
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
            We couldn&apos;t find a customer workspace linked to {user.email}. Go back to your dashboard
            and complete your profile to start tracking RFQs.
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

  const resolvedSearchParams = await searchParams;
  const sp = resolvedSearchParams;
  const get = (key: string) => sp?.get(key) ?? "";
  const status = normalizeText(get("status"));
  const kickoff = normalizeText(get("kickoff"));
  const hasWinner = normalizeText(get("hasWinner"));

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
                  No quotes match these filters
                </p>
                <p className="mt-2 text-sm text-slate-400">
                  Try clearing filters to see all RFQs.
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
                  Start by creating a new RFQ to get quotes from suppliers.
                </p>
                <div className="mt-4">
                  <Link
                    href="/quote"
                    className="inline-flex items-center rounded-full bg-emerald-500 px-4 py-2 text-sm font-semibold text-black transition hover:bg-emerald-400"
                  >
                    Start a new RFQ
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
                    Bids
                  </th>
                  <th className="px-5 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">
                    Award / Kickoff
                  </th>
                  <th className="px-5 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">
                    Messages
                  </th>
                  <th className="px-5 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">
                    Last activity
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-900/70">
                {quotes.map((quote) => {
                  const statusMeta = resolveStatusMeta(quote.status);
                  const kickoff = formatKickoffPill(quote.kickoffStatus);
                  const unread = Math.max(0, Math.floor(quote.unreadMessagesCount ?? 0));

                  return (
                    <tr key={quote.id} className="hover:bg-slate-900/50">
                      <td className="px-5 py-4 align-middle">
                        <div className="flex flex-col">
                          <Link
                            href={`/customer/quotes/${quote.id}`}
                            className="font-medium text-slate-100 underline-offset-4 transition hover:underline"
                          >
                            {quote.rfqLabel}
                          </Link>
                          <span className="text-xs text-slate-500">
                            Quote {quote.id.startsWith("Q-") ? quote.id : `#${quote.id.slice(0, 6)}`}
                          </span>
                        </div>
                      </td>
                      <td className="px-5 py-4 align-middle">
                        <span className={`pill pill-table ${statusMeta.pillClass}`}>
                          {quote.status}
                        </span>
                      </td>
                      <td className="px-5 py-4 align-middle text-slate-200">
                        <span className="font-semibold text-slate-100">
                          {quote.bidsCount}
                        </span>
                      </td>
                      <td className="px-5 py-4 align-middle">
                        {quote.hasWinner ? (
                          <div className="flex flex-col gap-2">
                            <span className={`inline-flex w-fit items-center rounded-full border px-3 py-1 text-[11px] font-semibold ${kickoff.className}`}>
                              {kickoff.label}
                            </span>
                            <Link
                              href={`/customer/quotes/${quote.id}#kickoff`}
                              className="text-xs font-semibold text-emerald-200 hover:underline"
                            >
                              View project
                            </Link>
                          </div>
                        ) : (
                          <div className="flex flex-col gap-2">
                            <span className="text-sm text-slate-400">No winner yet</span>
                            <Link
                              href={`/customer/quotes/${quote.id}#decision`}
                              className="text-xs font-semibold text-emerald-200 hover:underline"
                            >
                              Review &amp; award
                            </Link>
                          </div>
                        )}
                      </td>
                      <td className="px-5 py-4 align-middle">
                        <Link
                          href={`/customer/quotes/${quote.id}?tab=messages`}
                          className="inline-flex items-center gap-2 text-xs font-semibold text-slate-200 hover:text-white"
                        >
                          <span>Messages</span>
                          {unread > 0 ? (
                            <span className="inline-flex min-w-[1.75rem] items-center justify-center rounded-full bg-red-500/20 px-2 py-0.5 text-[11px] font-semibold text-red-100">
                              {unread > 99 ? "99+" : unread}
                            </span>
                          ) : null}
                        </Link>
                      </td>
                      <td className="px-5 py-4 align-middle text-slate-300">
                        {formatLastActivity(quote.lastActivityAt)}
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
