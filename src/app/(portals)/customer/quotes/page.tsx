import Link from "next/link";
import clsx from "clsx";
import { formatDistanceToNowStrict } from "date-fns";

import { requireUser } from "@/server/auth";
import { getCustomerByUserId } from "@/server/customers";
import { loadCustomerQuotesTable } from "@/server/customers/activity";
import {
  getQuoteStatusLabel,
  normalizeQuoteStatus,
} from "@/server/quotes/status";
import PortalCard from "../../PortalCard";
import { PortalShell } from "../../components/PortalShell";

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

export default async function CustomerQuotesPage() {
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

  const quotes = await loadCustomerQuotesTable(customer.id);
  const shouldShowFirstTimeCard = quotes.length <= 1;

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
        description="Every RFQ you’ve uploaded, sorted by the most recent update."
      >
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
        {quotes.length === 0 ? (
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
          <div className="overflow-hidden rounded-2xl border border-slate-900/70 bg-black/40">
            <table className="min-w-full divide-y divide-slate-900/70 text-sm">
              <thead className="bg-slate-900/60">
                <tr>
                  <th className="px-5 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">
                    RFQ
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
                  const primaryLabel =
                    quote.project_label ||
                    quote.upload_name ||
                    quote.file_name ||
                    "Untitled RFQ";
                  const normalizedStatus = normalizeQuoteStatus(quote.status ?? undefined);
                  const statusLabel = getQuoteStatusLabel(quote.status);
                  const statusVariant =
                    normalizedStatus === "won" || normalizedStatus === "approved"
                      ? "pill-success"
                      : normalizedStatus === "lost"
                        ? "pill-warning"
                        : normalizedStatus === "cancelled"
                          ? "pill-muted"
                          : "pill-info";
                  const showWinnerHelper = normalizedStatus === "won";

                  const lastUpdated =
                    quote.updated_at ?? quote.created_at ?? null;

                  return (
                    <tr key={quote.id} className="hover:bg-slate-900/50">
                      <td className="px-5 py-4 align-middle">
                        <div className="flex flex-col">
                          <span className="font-medium text-slate-100">
                            {primaryLabel}
                          </span>
                          <span className="text-xs text-slate-500">
                            Submitted {formatRelativeDate(quote.created_at ?? null)}
                          </span>
                        </div>
                      </td>
                      <td className="px-5 py-4 align-middle">
                        <div className="flex flex-col">
                          <span className={clsx("pill pill-table", statusVariant)}>
                            {statusLabel}
                          </span>
                          {showWinnerHelper ? (
                            <span className="mt-1 text-[11px] text-slate-400">
                              Winner selected — you can still message the team if plans change.
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-5 py-4 align-middle text-slate-300">
                        {formatRelativeDate(lastUpdated)}
                      </td>
                      <td className="px-5 py-4 align-middle text-right">
                        <Link
                          href={`/customer/quotes/${quote.id}`}
                          className="inline-flex items-center rounded-lg border border-slate-700 px-2.5 py-1 text-xs font-medium text-slate-100 hover:border-emerald-400 hover:text-emerald-300"
                        >
                          Open quote
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
