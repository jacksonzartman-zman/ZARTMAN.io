import Link from "next/link";

import { requireCustomerSessionOrRedirect } from "@/app/(portals)/customer/requireCustomerSessionOrRedirect";
import { getCustomerByUserId } from "@/server/customers";
import { loadCustomerQuotesList } from "@/server/customer/quotesList";
import PortalCard from "../../PortalCard";
import { PortalShell } from "../../components/PortalShell";
import { SHOW_LEGACY_QUOTE_ENTRYPOINTS } from "@/lib/ui/deprecation";
import { formatRelativeTimeCompactFromTimestamp, toTimestamp } from "@/lib/relativeTime";

export const dynamic = "force-dynamic";

type RfqStatusTone = "slate" | "blue" | "emerald" | "amber" | "muted";

function clsx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function StatusPill({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: RfqStatusTone;
}) {
  const toneClasses =
    tone === "blue"
      ? "border-blue-500/30 bg-blue-500/10 text-blue-100"
      : tone === "emerald"
        ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-100"
        : tone === "amber"
          ? "border-amber-500/30 bg-amber-500/10 text-amber-100"
          : tone === "muted"
            ? "border-slate-900/70 bg-slate-950/20 text-slate-400"
            : "border-slate-800 bg-slate-950/40 text-slate-200";

  return (
    <span
      className={clsx(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        toneClasses,
      )}
    >
      {children}
    </span>
  );
}

function getStatusTone(status: string): RfqStatusTone {
  if (status === "Delivered") return "emerald";
  if (status === "In production") return "amber";
  if (status === "Awarded") return "emerald";
  if (status === "Offers ready") return "blue";
  if (status === "Waiting on offers") return "slate";
  return "muted";
}

function formatFileNames(fileNames: string[]): {
  primary: string;
  secondary?: string;
} {
  const names = Array.isArray(fileNames) ? fileNames.filter(Boolean) : [];
  if (names.length === 0) {
    return { primary: "No files yet" };
  }
  if (names.length === 1) {
    return { primary: names[0]! };
  }
  const rest = names.slice(1, 4);
  const suffix = names.length > 4 ? ` +${names.length - 4} more` : "";
  return {
    primary: names[0]!,
    secondary: `${rest.join(", ")}${suffix}`,
  };
}

function formatUpdatedAt(value: string | null): string {
  const label = formatRelativeTimeCompactFromTimestamp(toTimestamp(value));
  return label ?? "—";
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
        title="RFQ history"
        subtitle="Track every request you’ve submitted, newest first."
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

  // No filters yet — just a newest-first history list.
  const quotes = await loadCustomerQuotesList({ userId: user.id, email: user.email ?? null }, {});
  const sortedQuotes = [...quotes].sort((a, b) => {
    const aKey = Date.parse(a.updatedAt ?? a.createdAt);
    const bKey = Date.parse(b.updatedAt ?? b.createdAt);
    if (Number.isFinite(aKey) && Number.isFinite(bKey) && aKey !== bKey) return bKey - aKey;
    return (b.updatedAt ?? b.createdAt).localeCompare(a.updatedAt ?? a.createdAt);
  });

  return (
    <PortalShell
      workspace="customer"
      title="RFQ history"
      subtitle="A simple list of your submitted RFQs, newest first."
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
        title="RFQs"
        description="File names, current status, and latest update."
      >
        {sortedQuotes.length === 0 ? (
          <div className="rounded-2xl border border-slate-900/70 bg-black/40 p-6">
            <p className="text-sm font-semibold text-slate-100">No RFQs yet</p>
            <p className="mt-2 text-sm text-slate-400">
              When you submit an RFQ, it’ll show up here with status updates as offers come in.
            </p>
            {SHOW_LEGACY_QUOTE_ENTRYPOINTS ? (
              <div className="mt-4">
                <Link
                  href="/quote"
                  className="inline-flex items-center rounded-full bg-emerald-500 px-4 py-2 text-sm font-semibold text-black transition hover:bg-emerald-400"
                >
                  Start a new RFQ
                </Link>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-slate-900/70 bg-black/40">
            <div className="grid grid-cols-12 gap-3 border-b border-slate-900/70 px-5 py-3 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              <div className="col-span-12 sm:col-span-7">RFQ files</div>
              <div className="col-span-6 sm:col-span-3">Status</div>
              <div className="col-span-6 text-right sm:col-span-2">Updated</div>
            </div>
            <ul className="divide-y divide-slate-900/70">
              {sortedQuotes.map((quote) => {
                const files = formatFileNames(quote.fileNames);
                const status = quote.rfqHistoryStatus;
                const updatedAt = quote.updatedAt ?? quote.createdAt;
                return (
                  <li key={quote.id} className="hover:bg-slate-900/40">
                    <Link
                      href={`/customer/quotes/${quote.id}`}
                      className="grid grid-cols-12 gap-3 px-5 py-4 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-400"
                    >
                      <div className="col-span-12 min-w-0 sm:col-span-7">
                        <p
                          className="min-w-0 truncate text-sm font-semibold text-slate-100"
                          title={files.primary}
                        >
                          {files.primary}
                        </p>
                        {files.secondary ? (
                          <p className="mt-1 min-w-0 truncate text-xs text-slate-400" title={files.secondary}>
                            {files.secondary}
                          </p>
                        ) : (
                          <p className="mt-1 min-w-0 truncate text-xs text-slate-500" title={quote.rfqLabel}>
                            {quote.rfqLabel}
                          </p>
                        )}
                      </div>

                      <div className="col-span-6 flex items-center sm:col-span-3">
                        <StatusPill tone={getStatusTone(status)}>{status}</StatusPill>
                      </div>

                      <div className="col-span-6 flex items-center justify-end text-right sm:col-span-2">
                        <span className="text-xs font-semibold text-slate-200" title={updatedAt}>
                          {formatUpdatedAt(updatedAt)}
                        </span>
                      </div>
                    </Link>
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
