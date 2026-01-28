import Link from "next/link";
import clsx from "clsx";
import AdminDashboardShell from "@/app/admin/AdminDashboardShell";
import AdminTableShell, { adminTableCellClass } from "@/app/admin/AdminTableShell";
import { normalizeSearchParams } from "@/lib/route/normalizeSearchParams";
import { formatDateTime } from "@/lib/formatDate";
import { formatShortId } from "@/lib/awards";
import { ctaSizeClasses, secondaryCtaClasses } from "@/lib/ctas";
import {
  loadAdminSearchAlertsQueue,
  type AdminSearchAlertFilter,
  SEARCH_ALERTS_RECENT_WINDOW_DAYS,
} from "@/server/admin/searchAlerts";
import {
  loadRfqOffersForQuoteIds,
  summarizeRfqOffers,
} from "@/server/rfqs/offers";
import { markSearchAlertNotifiedAction } from "./actions";

export const dynamic = "force-dynamic";

const FILTER_OPTIONS: Array<{ key: AdminSearchAlertFilter; label: string }> = [
  { key: "recent", label: "Recent" },
  { key: "awaiting_offers", label: "Awaiting offers" },
  { key: "offers_received", label: "Offers received" },
];

export default async function AdminSearchAlertsPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const usp = normalizeSearchParams(searchParams ? await searchParams : undefined);
  const filter = normalizeFilter(usp.get("filter")) ?? "recent";

  const result = await loadAdminSearchAlertsQueue({ filter });
  const offerCountsByQuoteId = await loadOfferCountsByQuoteId(result);
  const displayRows = deriveDisplayRows({ result, filter, offerCountsByQuoteId });

  return (
    <AdminDashboardShell
      title="Search alerts"
      description="Saved searches with alerts enabled for ops follow-up."
    >
      <section className="rounded-2xl border border-slate-900/60 bg-slate-950/30 px-6 py-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Filter
            </p>
            {FILTER_OPTIONS.map((option) => (
              <PillLink
                key={option.key}
                active={option.key === filter}
                href={buildFilterHref(option.key)}
                label={option.label}
              />
            ))}
          </div>
          {result.ok && result.supported ? (
            <p className="text-sm text-slate-300">
              {formatCount(displayRows.length)} alert
              {displayRows.length === 1 ? "" : "s"}
            </p>
          ) : null}
        </div>
        {filter === "recent" ? (
          <p className="mt-2 text-xs text-slate-500">
            Showing alerts enabled in the last {SEARCH_ALERTS_RECENT_WINDOW_DAYS} days.
          </p>
        ) : null}
        {result.ok && result.supported && !result.opsEventsSupported ? (
          <p className="mt-2 text-xs text-slate-500">
            Notification tracking is unavailable on this schema.
          </p>
        ) : null}
      </section>

      {!result.ok ? (
        <p className="text-sm text-slate-400">Unable to load search alerts right now.</p>
      ) : !result.supported ? (
        <p className="text-sm text-slate-400">
          Search alerts queue is unavailable on this schema.
        </p>
      ) : displayRows.length === 0 ? (
        <div className="rounded-2xl border border-slate-900/60 bg-slate-950/30 px-6 py-8 text-center">
          <p className="text-base font-semibold text-slate-100">No alerts to review</p>
          <p className="mt-2 text-sm text-slate-400">
            Try another filter or check back later.
          </p>
        </div>
      ) : (
        <AdminTableShell
          className="overflow-hidden"
          head={
            <tr className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              <th className="px-5 py-4">Search</th>
              <th className="px-5 py-4">Customer</th>
              <th className="px-5 py-4">Offers</th>
              <th className="px-5 py-4">Alert enabled</th>
              <th className="px-5 py-4">Notified</th>
              <th className="px-5 py-4">Actions</th>
            </tr>
          }
          body={
            <>
              {displayRows.map((row) => {
                const quoteHref = `/admin/quotes/${row.quoteId}`;
                const searchSubtitle =
                  row.uploadName ?? row.fileName ?? `Quote ${formatShortId(row.quoteId)}`;
                const customerPrimary =
                  row.customerName ?? row.company ?? row.customerEmail ?? "Customer";
                const customerSecondary =
                  row.customerEmail && row.customerName
                    ? row.customerEmail
                    : row.company ?? row.customerEmail ?? "";
                const offersCount =
                  offerCountsByQuoteId.get(row.quoteId) ??
                  (typeof row.bidCount === "number" && Number.isFinite(row.bidCount)
                    ? row.bidCount
                    : null);
                const offerLabel = formatOfferLabel(offersCount);
                const offerStatusLabel =
                  typeof offersCount === "number"
                    ? offersCount === 0
                      ? "Awaiting offers"
                      : "Offer activity"
                    : "Offer data unavailable";
                const enabledLabel = formatDateTime(row.createdAt, { includeTime: true });
                const viewedLabel = row.lastViewedAt
                  ? formatDateTime(row.lastViewedAt, { includeTime: true })
                  : "Not viewed";
                const notifiedLabel = row.notifiedAt
                  ? formatDateTime(row.notifiedAt, { includeTime: true })
                  : "Not yet";
                const canMarkNotified = result.opsEventsSupported && !row.notifiedAt;

                return (
                  <tr
                    key={row.quoteId}
                    className="bg-slate-950/40 transition hover:bg-slate-900/40"
                  >
                    <td className={clsx(adminTableCellClass, "px-5 py-4")}>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-100">
                          {row.label}
                        </p>
                        <p className="mt-1 truncate text-xs text-slate-400">
                          {searchSubtitle} · {formatShortId(row.quoteId)}
                        </p>
                        {row.status ? (
                          <p className="mt-1 text-[11px] text-slate-500">
                            Status: {row.status}
                          </p>
                        ) : null}
                      </div>
                    </td>
                    <td className={clsx(adminTableCellClass, "px-5 py-4")}>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-100">
                          {customerPrimary}
                        </p>
                        {customerSecondary ? (
                          <p className="mt-1 truncate text-xs text-slate-400">
                            {customerSecondary}
                          </p>
                        ) : null}
                      </div>
                    </td>
                    <td className={clsx(adminTableCellClass, "px-5 py-4")}>
                      <div className="text-sm font-semibold text-slate-100">{offerLabel}</div>
                      <p className="mt-1 text-xs text-slate-400">{offerStatusLabel}</p>
                    </td>
                    <td className={clsx(adminTableCellClass, "px-5 py-4")}>
                      <p className="text-sm font-semibold text-slate-100">{enabledLabel}</p>
                      <p className="mt-1 text-xs text-slate-400">Last viewed: {viewedLabel}</p>
                    </td>
                    <td className={clsx(adminTableCellClass, "px-5 py-4")}>
                      {result.opsEventsSupported ? (
                        <p className="text-sm font-semibold text-slate-100">{notifiedLabel}</p>
                      ) : (
                        <p className="text-sm text-slate-500">Unavailable</p>
                      )}
                    </td>
                    <td className={clsx(adminTableCellClass, "px-5 py-4")}>
                      <div className="flex flex-col gap-2">
                        <Link
                          href={quoteHref}
                          className={clsx(secondaryCtaClasses, ctaSizeClasses.sm)}
                        >
                          Open quote
                        </Link>
                        {result.opsEventsSupported ? (
                          row.notifiedAt ? (
                            <span className="text-xs font-semibold text-emerald-200">
                              Notified
                            </span>
                          ) : (
                            <form action={markSearchAlertNotifiedAction}>
                              <input type="hidden" name="quoteId" value={row.quoteId} />
                              <input type="hidden" name="label" value={row.label} />
                              <button
                                type="submit"
                                className={clsx(
                                  "rounded-full border border-slate-700 px-3 py-1 text-xs font-semibold text-slate-200 transition hover:border-slate-500 hover:text-white",
                                )}
                              >
                                Mark notified
                              </button>
                            </form>
                          )
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </>
          }
        />
      )}
    </AdminDashboardShell>
  );
}

function formatCount(value: number): string {
  return value.toLocaleString("en-US");
}

function formatOfferLabel(value: number | null): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "Offers unavailable";
  }
  if (value === 0) return "0 offers";
  return `${value} offer${value === 1 ? "" : "s"}`;
}

async function loadOfferCountsByQuoteId(
  result: Awaited<ReturnType<typeof loadAdminSearchAlertsQueue>>,
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (!result.ok || !result.supported || result.rows.length === 0) {
    return map;
  }
  const quoteIds = result.rows.map((row) => row.quoteId).filter(Boolean);
  const offersResult = await loadRfqOffersForQuoteIds(quoteIds);
  if (!offersResult.ok) {
    return map;
  }
  const offersByQuoteId = new Map<string, typeof offersResult.offers>();
  for (const offer of offersResult.offers) {
    const quoteId = typeof offer.rfq_id === "string" ? offer.rfq_id.trim() : "";
    if (!quoteId) continue;
    if (!offersByQuoteId.has(quoteId)) {
      offersByQuoteId.set(quoteId, []);
    }
    offersByQuoteId.get(quoteId)!.push(offer);
  }
  for (const [quoteId, offers] of offersByQuoteId.entries()) {
    map.set(quoteId, summarizeRfqOffers(offers).nonWithdrawn);
  }
  // Ensure deterministic presence for 0 counts (so we still override "Awaiting offers").
  for (const quoteId of quoteIds) {
    if (!map.has(quoteId)) {
      map.set(quoteId, 0);
    }
  }
  return map;
}

function deriveDisplayRows(args: {
  result: Awaited<ReturnType<typeof loadAdminSearchAlertsQueue>>;
  filter: AdminSearchAlertFilter;
  offerCountsByQuoteId: Map<string, number>;
}) {
  if (!args.result.ok || !args.result.supported) {
    return [];
  }
  const rows = args.result.rows;
  // If we couldn't load offer counts, keep server-side filtering behavior.
  if (args.offerCountsByQuoteId.size === 0) {
    return rows;
  }
  if (args.filter === "awaiting_offers") {
    return rows.filter((row) => (args.offerCountsByQuoteId.get(row.quoteId) ?? 0) === 0);
  }
  if (args.filter === "offers_received") {
    return rows.filter((row) => (args.offerCountsByQuoteId.get(row.quoteId) ?? 0) > 0);
  }
  return rows;
}

function normalizeFilter(value: unknown): AdminSearchAlertFilter | null {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (raw === "recent") return "recent";
  if (raw === "awaiting_offers" || raw === "awaiting-offers" || raw === "awaiting") {
    return "awaiting_offers";
  }
  if (raw === "offers_received" || raw === "offers-received" || raw === "offers") {
    return "offers_received";
  }
  return null;
}

function buildFilterHref(filter: AdminSearchAlertFilter): string {
  const params = new URLSearchParams();
  if (filter !== "recent") {
    params.set("filter", filter);
  }
  const query = params.toString();
  return query ? `/admin/search-alerts?${query}` : "/admin/search-alerts";
}

function PillLink({
  active,
  href,
  label,
}: {
  active: boolean;
  href: string;
  label: string;
}) {
  return (
    <Link
      href={href}
      className={clsx(
        "rounded-full border px-3 py-1 text-xs font-semibold transition",
        active
          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-100"
          : "border-slate-800 bg-slate-950/40 text-slate-200 hover:border-slate-700 hover:text-white",
      )}
    >
      {label}
    </Link>
  );
}
