import clsx from "clsx";
import Link from "next/link";
import { formatDistanceToNowStrict } from "date-fns";
import type { ReadonlyURLSearchParams } from "next/navigation";

import { requireUser } from "@/server/auth";
import { getCustomerByUserId } from "@/server/customers";
import { loadCustomerQuotesTablePage } from "@/server/customers/activity";
import { buildQuoteFilesFromRow } from "@/server/quotes/files";
import {
  deriveQuotePrimaryLabel,
  formatQuoteFileCountLabel,
  resolveQuoteFileCount,
} from "@/server/quotes/fileSummary";
import { loadQuoteBidAggregates } from "@/server/quotes/bidAggregates";
import {
  deriveCustomerQuoteListStatus,
  formatCustomerBidHint,
  getCustomerQuoteStatusMeta,
} from "@/server/quotes/customerSummary";
import { loadSupplierNameMapByIds } from "@/server/suppliers/profile";
import PortalCard from "../../PortalCard";
import { PortalShell } from "../../components/PortalShell";
import { parseListState } from "@/app/(portals)/lib/listState";
import PortalSearchInput from "@/app/(portals)/components/PortalSearchInput";
import PortalTablePaginationControls from "@/app/(portals)/components/PortalTablePaginationControls";
import CustomerQuotesListControls from "./CustomerQuotesListControls";
import {
  CUSTOMER_QUOTES_LIST_STATE_CONFIG,
  type CustomerQuotesSortKey,
} from "./listState";

export const dynamic = "force-dynamic";

function formatRelativeDate(value: string | null | undefined): string {
  if (!value) {
    return "—";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  return formatDistanceToNowStrict(date, { addSuffix: true });
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
        subtitle="Track RFQs you’ve submitted and jump into detailed workspaces."
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
  const listState = parseListState(
    resolvedSearchParams,
    CUSTOMER_QUOTES_LIST_STATE_CONFIG,
  );
  const page = listState.page;
  const pageSize = listState.pageSize;
  const sort = (listState.sort ??
    CUSTOMER_QUOTES_LIST_STATE_CONFIG.defaultSort ??
    "recently_updated") as CustomerQuotesSortKey;
  const searchTerm = listState.q;

  const inbox = await loadCustomerQuotesTablePage(customer.id, {
    page,
    pageSize,
    sort,
    q: searchTerm,
  });

  const quotes = inbox.rows;
  const totalCount =
    typeof inbox.count === "number" && Number.isFinite(inbox.count)
      ? inbox.count
      : quotes.length;
  const hasMore = Boolean(inbox.hasMore);

  const quoteIds = quotes.map((quote) => quote.id);
  const bidAggregates =
    quoteIds.length > 0 ? await loadQuoteBidAggregates(quoteIds) : {};
  const awardedSupplierIds = quotes
    .map((quote) =>
      typeof quote.awarded_supplier_id === "string"
        ? quote.awarded_supplier_id.trim()
        : "",
    )
    .filter(Boolean);
  const awardedSupplierNameMap =
    awardedSupplierIds.length > 0
      ? await loadSupplierNameMapByIds(awardedSupplierIds)
      : new Map<string, string>();
  const shouldShowFirstTimeCard = totalCount <= 1;

  return (
    <PortalShell
      workspace="customer"
      title="Quotes"
      subtitle="Track RFQs you’ve submitted, follow status changes, and jump into details."
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
        title="RFQ list"
        description={
          sort === "newest"
            ? "Every RFQ you’ve uploaded, sorted by newest first."
            : "Every RFQ you’ve uploaded, sorted by the most recent update."
        }
      >
        <div className="mb-4 space-y-3">
          <CustomerQuotesListControls
            basePath="/customer/quotes"
            listStateConfig={CUSTOMER_QUOTES_LIST_STATE_CONFIG}
          />
          <PortalSearchInput
            initialValue={searchTerm}
            basePath="/customer/quotes"
            placeholder="Search RFQs by file, company, or status..."
            listStateConfig={CUSTOMER_QUOTES_LIST_STATE_CONFIG}
          />
        </div>

        {shouldShowFirstTimeCard ? (
          <div className="mb-4 rounded-2xl border border-slate-800 bg-slate-950/50 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              New to Zartman.io?
            </p>
            <p className="mt-2 text-sm text-slate-300">
              Status shows where your RFQ is in the process, Bids tells you how many suppliers
              have responded, and Target date is when you&apos;d like parts in hand. Click a row or
              &apos;Open quote&apos; to review supplier bids and award a winner.
            </p>
          </div>
        ) : null}
        {totalCount === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-800 bg-black/40 px-4 py-6 text-sm text-slate-300">
            <p className="font-medium text-slate-100">No quotes yet.</p>
            <p className="mt-1 text-slate-400">
              Once you submit your first RFQ, it will appear here along with status updates
              and links to each quote.
            </p>
            <div className="mt-4">
              <Link
                href="/quote"
                className="inline-flex items-center rounded-full bg-emerald-500 px-4 py-2 text-sm font-semibold text-black transition hover:bg-emerald-400"
              >
                Start a new RFQ
              </Link>
            </div>
          </div>
        ) : (
          <>
            <div className="overflow-hidden rounded-2xl border border-slate-900/70 bg-black/40">
              <table className="min-w-full divide-y divide-slate-900/70 text-sm">
                <thead className="bg-slate-900/60">
                  <tr>
                    <th className="px-5 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">
                      RFQ
                    </th>
                    <th className="px-5 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">
                      Files
                    </th>
                    <th className="px-5 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">
                      Status
                    </th>
                    <th className="px-5 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">
                      Last update
                    </th>
                    <th className="px-5 py-4 text-right text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-900/70">
                  {quotes.map((quote) => {
                    const files = buildQuoteFilesFromRow(quote);
                    const primaryLabel = deriveQuotePrimaryLabel(quote, { files });

                    const lastUpdated = quote.updated_at ?? quote.created_at ?? null;
                    const aggregate = bidAggregates[quote.id];
                    const statusKey = deriveCustomerQuoteListStatus({
                      quoteStatus: quote.status,
                      aggregate,
                    });
                    const statusMeta = getCustomerQuoteStatusMeta(statusKey);
                    const bidHint = formatCustomerBidHint(aggregate);
                    const bidCount = aggregate?.bidCount ?? 0;
                    const fileCount = resolveQuoteFileCount(quote, files.length);
                    const fileCountLabel = formatQuoteFileCountLabel(fileCount);
                    const awardedSupplierId =
                      typeof quote.awarded_supplier_id === "string"
                        ? quote.awarded_supplier_id.trim()
                        : "";
                    const awardedSupplierName = awardedSupplierId
                      ? awardedSupplierNameMap.get(awardedSupplierId) ?? null
                      : null;
                    const quoteHasWinner =
                      Boolean(quote.awarded_at) ||
                      Boolean(quote.awarded_bid_id) ||
                      Boolean(quote.awarded_supplier_id) ||
                      (typeof quote.status === "string" &&
                        quote.status.trim().toLowerCase() === "won");
                    const winnerLabel =
                      awardedSupplierName ??
                      (awardedSupplierId ? awardedSupplierId : null);

                    return (
                      <tr key={quote.id} className="hover:bg-slate-900/50">
                        <td className="px-5 py-4 align-middle">
                          <div className="flex flex-col">
                            <Link
                              href={`/customer/quotes/${quote.id}`}
                              className="font-medium text-slate-100 underline-offset-4 transition hover:underline"
                            >
                              {primaryLabel}
                            </Link>
                            <span className="text-xs text-slate-500">
                              Submitted {formatRelativeDate(quote.created_at ?? null)}
                            </span>
                          </div>
                        </td>
                        <td className="px-5 py-4 align-middle">
                          <span className="inline-flex items-center rounded-full border border-slate-800 bg-slate-950/50 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-300">
                            {fileCountLabel}
                          </span>
                        </td>
                        <td className="px-5 py-4 align-middle">
                          <div className="space-y-1">
                            {quoteHasWinner ? (
                              <span className="pill pill-table border-emerald-500/40 bg-emerald-500/10 text-emerald-100">
                                Winner selected
                              </span>
                            ) : (
                              <span className={clsx("pill pill-table", statusMeta.pillClass)}>
                                {statusMeta.label}
                              </span>
                            )}
                            {quoteHasWinner ? (
                              <p className="text-xs text-emerald-200">
                                {winnerLabel ?? "Supplier selected"}
                              </p>
                            ) : (
                              <p className="text-xs text-slate-400">{bidHint}</p>
                            )}
                          </div>
                        </td>
                        <td className="px-5 py-4 align-middle text-slate-300">
                          {formatRelativeDate(lastUpdated)}
                        </td>
                        <td className="px-5 py-4 align-middle text-right">
                          <div className="flex flex-wrap justify-end gap-2">
                            {!quoteHasWinner && bidCount > 0 ? (
                              <>
                                <Link
                                  href={`/customer/quotes/${quote.id}`}
                                  className="inline-flex min-w-[7.5rem] items-center justify-center rounded-lg border border-slate-700 bg-slate-950/40 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:border-slate-500 hover:text-white"
                                >
                                  Open
                                </Link>
                                <Link
                                  href={`/customer/quotes/${quote.id}?focus=award`}
                                  className="inline-flex min-w-[9rem] items-center justify-center rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-black transition hover:bg-emerald-400"
                                >
                                  Review &amp; award
                                </Link>
                              </>
                            ) : (
                              <>
                                {!quoteHasWinner ? (
                                  <span className="inline-flex min-w-[9rem] items-center justify-center rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-1.5 text-xs font-semibold text-slate-300">
                                    Waiting for bids
                                  </span>
                                ) : null}
                                <Link
                                  href={`/customer/quotes/${quote.id}`}
                                  className="inline-flex min-w-[7.5rem] items-center justify-center rounded-lg border border-slate-700 bg-slate-950/40 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:border-slate-500 hover:text-white"
                                >
                                  Open
                                </Link>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <PortalTablePaginationControls
              basePath="/customer/quotes"
              page={page}
              pageSize={pageSize}
              hasMore={hasMore}
              totalCount={totalCount}
              rowsOnPage={quotes.length}
              listStateConfig={CUSTOMER_QUOTES_LIST_STATE_CONFIG}
            />
          </>
        )}
      </PortalCard>
    </PortalShell>
  );
}
