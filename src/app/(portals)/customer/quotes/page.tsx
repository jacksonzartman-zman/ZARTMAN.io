import Link from "next/link";

import { requireCustomerSessionOrRedirect } from "@/app/(portals)/customer/requireCustomerSessionOrRedirect";
import { getCustomerByUserId } from "@/server/customers";
import {
  loadCustomerQuotesList,
  type CustomerQuotesListFilters,
} from "@/server/customer/quotesList";
import { normalizeSearchParams } from "@/lib/route/normalizeSearchParams";
import PortalCard from "../../PortalCard";
import { PortalShell } from "../../components/PortalShell";
import { CustomerQuotesListClient } from "./CustomerQuotesListClient";
import { SHOW_LEGACY_QUOTE_ENTRYPOINTS } from "@/lib/ui/deprecation";

export const dynamic = "force-dynamic";

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

type InboxStatus = "draft" | "in_review" | "awarded";
type InboxStatusTone = "slate" | "blue" | "emerald";

function deriveInboxStatus(args: {
  hasWinner: boolean;
  bidsCount: number;
}): {
  key: InboxStatus;
  label: string;
  tone: InboxStatusTone;
  actionLabel: string;
  actionHrefSuffix: string;
} {
  if (args.hasWinner) {
    return {
      key: "awarded",
      label: "Selection confirmed",
      tone: "emerald",
      actionLabel: "Proceed to order",
      actionHrefSuffix: "#checkout",
    };
  }
  if (args.bidsCount > 0) {
    return {
      key: "in_review",
      label: "In review",
      tone: "blue",
      actionLabel: "Review offers",
      actionHrefSuffix: "#decision",
    };
  }
  return {
    key: "draft",
    label: "Draft",
    tone: "slate",
    actionLabel: "Complete request",
    actionHrefSuffix: "#uploads",
  };
}

type CustomerQuotesPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function CustomerQuotesPage({
  searchParams,
}: CustomerQuotesPageProps) {
  const user = await requireCustomerSessionOrRedirect("/customer/quotes");
  const customer = await getCustomerByUserId(user.id);

  if (!customer) {
    return (
      <PortalShell
        workspace="customer"
        title="Quotes"
        subtitle="All search requests you’ve submitted, from draft to award."
        actions={
          SHOW_LEGACY_QUOTE_ENTRYPOINTS ? (
            <Link
              href="/quote"
              className="inline-flex items-center rounded-full border border-emerald-400/40 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-emerald-100 transition hover:border-emerald-300 hover:text-white"
            >
              Start a new search
            </Link>
          ) : null
        }
      >
        <section className="space-y-3 rounded-2xl border border-slate-900 bg-slate-950/60 p-6">
          <p className="text-sm text-slate-300">
            We couldn&apos;t find a customer workspace linked to{" "}
            <span className="break-anywhere font-medium text-slate-100">
              {user.email}
            </span>
            . Complete your customer profile to start tracking search requests, supplier offers, and
            messages in one place.
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

  const quotesWithInboxStatus = quotes.map((quote) => ({
    quote,
    inboxStatus: deriveInboxStatus({
      hasWinner: quote.hasWinner,
      bidsCount: quote.bidsCount,
    }),
  }));

  const needsAction = quotesWithInboxStatus.filter(
    (row) => row.inboxStatus.key === "draft" || row.inboxStatus.key === "in_review",
  );
  const completed = quotesWithInboxStatus.filter((row) => row.inboxStatus.key === "awarded");

  return (
    <PortalShell
      workspace="customer"
      title="Quotes"
      subtitle="All search requests you’ve submitted, from draft to award."
      actions={
        SHOW_LEGACY_QUOTE_ENTRYPOINTS ? (
          <Link
            href="/quote"
            className="inline-flex items-center rounded-full border border-emerald-400/40 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-emerald-100 transition hover:border-emerald-300 hover:text-white"
          >
            Start a new search
          </Link>
        ) : null
      }
    >
      <PortalCard
        title="Quotes"
        description="Track submitted search requests, award progress, kickoff status, and messages at a glance."
      >
        <form method="get" className="mb-4 flex flex-wrap items-end gap-3">
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
              <option value="yes">Selection confirmed</option>
              <option value="no">Not selected</option>
            </select>
          </label>
          <button
            type="submit"
            className="inline-flex w-full items-center justify-center rounded-lg bg-emerald-500 px-4 py-2 text-xs font-semibold text-black transition hover:bg-emerald-400 sm:w-auto"
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
                  No search requests match these filters
                </p>
                <p className="mt-2 text-sm text-slate-400">
                  Clear filters to see your full list of search requests.
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
                <p className="text-sm font-semibold text-slate-100">No search requests yet</p>
                <p className="mt-2 text-sm text-slate-400">
                  When you submit a search request, we’ll route it to matching suppliers and you’ll
                  see offers and updates here as they come in.
                </p>
                <div className="mt-4">
                  {SHOW_LEGACY_QUOTE_ENTRYPOINTS ? (
                    <Link
                      href="/quote"
                      className="inline-flex items-center rounded-full bg-emerald-500 px-4 py-2 text-sm font-semibold text-black transition hover:bg-emerald-400"
                    >
                      Start a search
                    </Link>
                  ) : null}
                </div>
              </>
            )}
          </div>
        ) : (
          <CustomerQuotesListClient needsAction={needsAction} completed={completed} />
        )}
      </PortalCard>
    </PortalShell>
  );
}
