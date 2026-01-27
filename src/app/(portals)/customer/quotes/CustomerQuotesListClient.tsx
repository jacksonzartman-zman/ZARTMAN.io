"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { formatCurrency } from "@/lib/formatCurrency";
import { formatRelativeTimeCompactFromTimestamp, toTimestamp } from "@/lib/relativeTime";

type PillTone = "slate" | "blue" | "amber" | "emerald" | "red" | "purple" | "muted";

type InboxStatusKey = "draft" | "in_review" | "awarded";

type InboxStatus = {
  key: InboxStatusKey;
  label: string;
  tone: PillTone;
  actionLabel: string;
  actionHrefSuffix: string;
};

type CustomerQuoteListRow = {
  quote: {
    id: string;
    rfqLabel: string;
    primaryFileName: string | null;
    bidsCount: number;
    hasWinner: boolean;
    award:
      | {
          providerName: string;
          totalPrice: number | string | null;
          currency: string | null;
          leadTimeDaysMin: number | null;
          leadTimeDaysMax: number | null;
          awardedAt: string;
        }
      | null;
    kickoffStatus: "not_started" | "in_progress" | "complete" | "n/a";
    unreadMessagesCount: number | null;
    selectedPriceAmount: number | null;
    selectedPriceCurrency: string | null;
    bestPriceAmount: number | null;
    bestPriceCurrency: string | null;
    selectedLeadTimeDays: number | null;
    bestLeadTimeDays: number | null;
    updatedAt: string | null;
    createdAt: string | null;
  };
  inboxStatus: InboxStatus;
};

function clsx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function Pill({
  children,
  tone = "slate",
  className,
}: {
  children: React.ReactNode;
  tone?: PillTone;
  className?: string;
}) {
  const toneClasses =
    tone === "blue"
      ? "border-blue-500/30 bg-blue-500/10 text-blue-100"
      : tone === "amber"
        ? "border-amber-500/30 bg-amber-500/10 text-amber-100"
        : tone === "emerald"
          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-100"
          : tone === "red"
            ? "border-red-500/30 bg-red-500/10 text-red-100"
            : tone === "purple"
              ? "border-purple-500/30 bg-purple-500/10 text-purple-100"
              : tone === "muted"
                ? "border-slate-900/70 bg-slate-950/20 text-slate-400"
                : "border-slate-800 bg-slate-950/40 text-slate-200";

  return (
    <span
      className={clsx(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        toneClasses,
        className,
      )}
    >
      {children}
    </span>
  );
}

function formatUpdatedMicroline(value: string | null): string | null {
  const label = formatRelativeTimeCompactFromTimestamp(toTimestamp(value));
  return label ? `Updated ${label}` : null;
}

function formatKickoffPill(status: "not_started" | "in_progress" | "complete" | "n/a") {
  if (status === "n/a") {
    return { label: "—", tone: "slate" as const, className: "text-slate-500" };
  }
  if (status === "complete") {
    return { label: "Kickoff complete", tone: "emerald" as const };
  }
  if (status === "in_progress") {
    return { label: "Kickoff in progress", tone: "blue" as const };
  }
  return { label: "Kickoff not started", tone: "slate" as const };
}

function formatLeadTime(days: number | null): string {
  if (typeof days !== "number" || !Number.isFinite(days)) return "Pending";
  if (days <= 0) return "Pending";
  return `${days} day${days === 1 ? "" : "s"}`;
}

function formatLeadTimeRange(minDays: number | null, maxDays: number | null): string | null {
  const minOk = typeof minDays === "number" && Number.isFinite(minDays) && minDays > 0;
  const maxOk = typeof maxDays === "number" && Number.isFinite(maxDays) && maxDays > 0;
  if (minOk && maxOk && minDays !== maxDays) {
    return `${minDays}–${maxDays} days`;
  }
  if (minOk) return formatLeadTime(minDays);
  if (maxOk) return formatLeadTime(maxDays);
  return null;
}

function formatMoneyFlexible(value: number | string | null, currency: string | null): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return formatCurrency(value, currency ?? undefined);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : "Pending";
  }
  return "Pending";
}

function formatMoney(amount: number | null, currency: string | null): string {
  if (typeof amount !== "number" || !Number.isFinite(amount)) return "Pending";
  return formatCurrency(amount, currency ?? undefined);
}

function normalizeForSearch(value: string): string {
  return value.toLowerCase().trim();
}

function buildSearchText(row: CustomerQuoteListRow): string {
  return normalizeForSearch(
    [row.quote.rfqLabel, row.quote.primaryFileName, row.inboxStatus.label].filter(Boolean).join(" "),
  );
}

const STATUS_CHIPS: Array<{
  key: "all" | InboxStatusKey;
  label: string;
}> = [
  { key: "all", label: "All" },
  { key: "draft", label: "Draft" },
  { key: "in_review", label: "In review" },
  { key: "awarded", label: "Selection confirmed" },
];

export function CustomerQuotesListClient({
  needsAction,
  completed,
}: {
  needsAction: CustomerQuoteListRow[];
  completed: CustomerQuoteListRow[];
}) {
  const [query, setQuery] = useState("");
  const [statusChip, setStatusChip] = useState<(typeof STATUS_CHIPS)[number]["key"]>("all");

  const { filteredNeedsAction, filteredCompleted, filteredCount, totalCount } = useMemo(() => {
    const normalizedQuery = normalizeForSearch(query);
    const matchesQuery = (row: CustomerQuoteListRow) =>
      normalizedQuery.length === 0 || buildSearchText(row).includes(normalizedQuery);
    const matchesStatus = (row: CustomerQuoteListRow) =>
      statusChip === "all" || row.inboxStatus.key === statusChip;

    const apply = (rows: CustomerQuoteListRow[]) =>
      rows.filter((row) => matchesStatus(row) && matchesQuery(row));

    const nextNeedsAction = apply(needsAction);
    const nextCompleted = apply(completed);
    return {
      filteredNeedsAction: nextNeedsAction,
      filteredCompleted: nextCompleted,
      filteredCount: nextNeedsAction.length + nextCompleted.length,
      totalCount: needsAction.length + completed.length,
    };
  }, [completed, needsAction, query, statusChip]);

  const hasClientFilters = query.trim().length > 0 || statusChip !== "all";

  return (
    <div>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <label className="flex w-full flex-col gap-1 text-xs font-semibold text-slate-300 sm:max-w-md">
          Search
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search requests, files, status…"
            className="w-full rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 text-xs text-slate-100 outline-none transition focus:border-emerald-400"
          />
        </label>

        <div className="flex flex-wrap items-center gap-2">
          {STATUS_CHIPS.map((chip) => {
            const selected = chip.key === statusChip;
            return (
              <button
                key={chip.key}
                type="button"
                onClick={() => setStatusChip(chip.key)}
                aria-pressed={selected}
                className={clsx(
                  "inline-flex items-center rounded-full border px-3 py-2 text-[10px] font-semibold uppercase tracking-wide transition",
                  selected
                    ? "border-emerald-400/60 bg-emerald-500 text-black"
                    : "border-slate-800 bg-slate-950/40 text-slate-200 hover:border-slate-700 hover:text-white",
                )}
              >
                {chip.label}
              </button>
            );
          })}

          {hasClientFilters ? (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setStatusChip("all");
              }}
              className="text-xs font-semibold text-slate-300 underline-offset-4 hover:underline"
            >
              Clear
            </button>
          ) : null}
        </div>
      </div>

      {filteredCount === 0 ? (
        <div className="rounded-2xl border border-slate-900/70 bg-black/40 p-6">
          <p className="text-sm font-semibold text-slate-100">No search requests match your filters</p>
          <p className="mt-2 text-sm text-slate-400">
            Try a different query or clear filters to see all {totalCount} search requests.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-900/70 bg-black/40">
          <div className="divide-y divide-slate-900/70">
            {(
              [
                {
                  key: "needs_action" as const,
                  title: "Needs action",
                  items: filteredNeedsAction,
                },
                { key: "completed" as const, title: "Completed", items: filteredCompleted },
              ] as const
            )
              .filter((section) => section.items.length > 0)
              .map((section, sectionIdx) => (
                <section key={section.key}>
                  <div
                    className={clsx(
                      "flex items-center justify-between px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-400",
                      sectionIdx !== 0 && "border-t border-slate-900/70",
                    )}
                  >
                    <span>{section.title}</span>
                    <span className="text-slate-500">
                      {section.items.length}{" "}
                      {section.items.length === 1 ? "search request" : "search requests"}
                    </span>
                  </div>
                  <ul className="divide-y divide-slate-900/70">
                    {section.items.map(({ quote, inboxStatus }) => {
                      const kickoff = formatKickoffPill(quote.kickoffStatus);
                      const unread = Math.max(0, Math.floor(quote.unreadMessagesCount ?? 0));

                      const fileLabel = quote.primaryFileName ?? "No files yet";
                      const award = quote.award ?? null;
                      const bestPriceLabel = award
                        ? formatMoneyFlexible(award.totalPrice, award.currency)
                        : formatMoney(
                            quote.selectedPriceAmount ?? quote.bestPriceAmount,
                            quote.selectedPriceCurrency ?? quote.bestPriceCurrency,
                          );
                      const bestLeadLabel = award
                        ? formatLeadTimeRange(award.leadTimeDaysMin, award.leadTimeDaysMax) ??
                          "Pending"
                        : formatLeadTime(quote.selectedLeadTimeDays ?? quote.bestLeadTimeDays);
                      const actionHref = `/customer/quotes/${quote.id}${inboxStatus.actionHrefSuffix}`;
                      const shouldShowOpenMessages =
                        quote.bidsCount === 0 && Boolean(quote.primaryFileName);
                      const messagesHref = `/customer/quotes/${quote.id}?tab=messages#messages`;
                      const updatedMicroline = formatUpdatedMicroline(
                        quote.updatedAt ?? quote.createdAt,
                      );

                      return (
                        <li key={quote.id} className="hover:bg-slate-900/40">
                          <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                            <div className="min-w-0 space-y-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <Link
                                  href={`/customer/quotes/${quote.id}`}
                                  className="min-w-0 truncate text-base font-semibold text-slate-100 underline-offset-4 transition hover:underline"
                                  title={quote.rfqLabel}
                                >
                                  {quote.rfqLabel}
                                </Link>
                                <Pill tone={inboxStatus.tone}>{inboxStatus.label}</Pill>
                                {award ? (
                                  <Pill tone="emerald" className="tracking-[0.2em]">
                                    AWARDED
                                  </Pill>
                                ) : null}
                                {unread > 0 ? (
                                  <Pill tone="red">{unread > 99 ? "99+" : unread} new</Pill>
                                ) : null}
                                {quote.hasWinner ? (
                                  <Pill tone={kickoff.tone} className={kickoff.className}>
                                    {kickoff.label}
                                  </Pill>
                                ) : null}
                              </div>
                              {updatedMicroline ? (
                                <p className="text-xs leading-tight text-slate-400">
                                  {updatedMicroline}
                                </p>
                              ) : null}
                              <div className="min-w-0 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
                                <span className="min-w-0 max-w-full truncate" title={fileLabel}>
                                  <span className="text-slate-500">File:</span> {fileLabel}
                                </span>
                                <span className="hidden text-slate-600 sm:inline">•</span>
                                <span>
                                  <span className="text-slate-500">
                                    {award ? "Awarded" : quote.hasWinner ? "Awarded" : "Best"} price:
                                  </span>{" "}
                                  <span className="font-semibold text-slate-200">
                                    {bestPriceLabel}
                                  </span>
                                </span>
                                <span className="hidden text-slate-600 sm:inline">•</span>
                                <span>
                                  <span className="text-slate-500">
                                    {award ? "Awarded" : quote.hasWinner ? "Awarded" : "Best"} lead time:
                                  </span>{" "}
                                  <span className="font-semibold text-slate-200">{bestLeadLabel}</span>
                                </span>
                                {award ? (
                                  <>
                                    <span className="hidden text-slate-600 sm:inline">•</span>
                                    <span className="min-w-0 max-w-full truncate">
                                      <span className="text-slate-500">Winner:</span>{" "}
                                      <span className="font-semibold text-slate-200">
                                        {award.providerName}
                                      </span>
                                    </span>
                                  </>
                                ) : null}
                              </div>
                            </div>

                            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center sm:justify-end">
                              <Link
                                href={actionHref}
                                className="inline-flex w-full items-center justify-center rounded-full bg-emerald-500 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-black transition hover:bg-emerald-400 sm:w-auto"
                              >
                                {inboxStatus.actionLabel}
                              </Link>
                              {shouldShowOpenMessages ? (
                                <Link
                                  href={messagesHref}
                                  className="inline-flex w-full items-center justify-center rounded-full border border-slate-800 bg-slate-950/40 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-200 transition hover:border-slate-700 hover:text-white sm:w-auto"
                                >
                                  Open messages
                                </Link>
                              ) : null}
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

