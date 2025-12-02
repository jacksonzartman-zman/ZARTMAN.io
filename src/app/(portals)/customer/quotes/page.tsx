import Link from "next/link";
import { formatDistanceToNowStrict } from "date-fns";

import { requireUser } from "@/server/auth";
import { getCustomerByUserId } from "@/server/customers";
import { loadCustomerQuotesTable } from "@/server/customers/activity";

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
      <div className="space-y-4">
        <h1 className="text-lg font-semibold text-slate-50">Quotes</h1>
        <p className="text-sm text-slate-400">
          We couldn&apos;t find a customer workspace linked to {user.email}. Go back to
          your dashboard and complete your profile to start tracking RFQs.
        </p>
        <Link
          href="/customer"
          className="inline-flex items-center rounded-lg bg-emerald-500 px-3 py-1.5 text-sm font-medium text-black transition hover:bg-emerald-400"
        >
          Back to dashboard
        </Link>
      </div>
    );
  }

  const quotes = await loadCustomerQuotesTable(customer.id);

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-lg font-semibold text-slate-50">Quotes</h1>
        <p className="text-sm text-slate-400">
          Track RFQs you&apos;ve submitted, follow status changes, and jump into details.
        </p>
      </header>

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
              className="inline-flex items-center rounded-lg bg-emerald-500 px-3 py-1.5 text-sm font-medium text-black transition hover:bg-emerald-400"
            >
              Start a new RFQ
            </Link>
          </div>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-800 bg-black/40">
          <table className="min-w-full divide-y divide-slate-800 text-sm">
            <thead className="bg-slate-900/60">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">
                  RFQ
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Status
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Last update
                </th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-400">
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

                const statusLabel = quote.status
                  ? quote.status.replace(/_/g, " ")
                  : "Unknown";

                const lastUpdated =
                  quote.updated_at ?? quote.created_at ?? null;

                return (
                  <tr key={quote.id} className="hover:bg-slate-900/50">
                    <td className="px-4 py-3 align-middle">
                      <div className="flex flex-col">
                        <span className="font-medium text-slate-100">
                          {primaryLabel}
                        </span>
                        <span className="text-xs text-slate-500">
                          Submitted {formatRelativeDate(quote.created_at ?? null)}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 align-middle">
                      <span className="inline-flex rounded-full bg-slate-800 px-2 py-0.5 text-xs text-slate-100">
                        {statusLabel}
                      </span>
                    </td>
                    <td className="px-4 py-3 align-middle text-slate-300">
                      {formatRelativeDate(lastUpdated)}
                    </td>
                    <td className="px-4 py-3 align-middle text-right">
                      <Link
                        href={`/customer/quotes/${quote.id}`}
                        className="inline-flex items-center rounded-lg border border-slate-700 px-2.5 py-1 text-xs font-medium text-slate-100 hover:border-emerald-400 hover:text-emerald-300"
                      >
                        View quote
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
