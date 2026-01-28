"use client";

import { useRouter, useSearchParams } from "next/navigation";
import StatusFilterChips from "../StatusFilterChips";
import { useTransition } from "react";
import clsx from "clsx";
import {
  parseListState,
  setFilter,
  setSort,
} from "@/app/(portals)/lib/listState";
import {
  ADMIN_QUOTES_LIST_STATE_CONFIG,
  type AdminQuotesSortKey,
  type AdminQuotesStatusFilter,
} from "./listState";

const SORT_OPTIONS: Array<{ value: AdminQuotesSortKey; label: string }> = [
  { value: "inbox", label: "Inbox" },
  { value: "newest_rfq", label: "Newest RFQ" },
  { value: "latest_bid_activity", label: "Latest offer activity" },
  { value: "awarded_recently", label: "Awarded recently" },
  { value: "most_bids", label: "Most offers" },
];

const STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "submitted", label: "Open" },
  { value: "in_review", label: "In review" },
  { value: "won", label: "Won" },
  { value: "lost", label: "Lost" },
];

export default function AdminQuotesInboxControls({
  basePath = "/admin/quotes",
  className,
}: {
  basePath?: string;
  className?: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const listState = parseListState(searchParams, ADMIN_QUOTES_LIST_STATE_CONFIG);
  const currentSort = listState.sort ?? ADMIN_QUOTES_LIST_STATE_CONFIG.defaultSort ?? "newest_rfq";
  const hasBids = Boolean(listState.hasBids);
  const awarded = Boolean(listState.awarded);
  const status = listState.status ?? "";

  const messageFilter = (() => {
    const raw = (searchParams.get("msg") ?? "").trim().toLowerCase();
    switch (raw) {
      case "needs_reply":
      case "overdue":
        return raw;
      default:
        return "all";
    }
  })();

  const partsCoverage = (() => {
    const raw = (searchParams.get("partsCoverage") ?? "").trim().toLowerCase();
    switch (raw) {
      case "good":
      case "needs_attention":
      case "none":
        return raw;
      default:
        return "all";
    }
  })();

  const navigate = (query: string) => {
    const nextUrl = query ? `${basePath}?${query}` : basePath;
    startTransition(() => {
      router.push(nextUrl, { scroll: false });
    });
  };

  const navigateRawParams = (nextParams: URLSearchParams) => {
    nextParams.delete("page"); // reset paging when changing filters
    const nextUrl = nextParams.size > 0 ? `${basePath}?${nextParams.toString()}` : basePath;
    startTransition(() => {
      router.push(nextUrl, { scroll: false });
    });
  };

  return (
    <div className={clsx("flex flex-col gap-3", className)}>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-slate-300">Messages</span>
          <div className="flex overflow-hidden rounded-full border border-slate-800 bg-slate-950/60">
            {[
              { value: "all", label: "All" },
              { value: "needs_reply", label: "Needs reply" },
              { value: "overdue", label: "Overdue" },
            ].map((opt) => {
              const active = messageFilter === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    const nextParams = new URLSearchParams(searchParams.toString());
                    if (opt.value === "all") {
                      nextParams.delete("msg");
                    } else {
                      nextParams.set("msg", opt.value);
                    }
                    navigateRawParams(nextParams);
                  }}
                  className={clsx(
                    "px-3 py-1 text-[11px] font-semibold uppercase tracking-wide transition",
                    active
                      ? opt.value === "overdue"
                        ? "bg-red-500/15 text-red-100"
                        : "bg-amber-500/15 text-amber-100"
                      : "text-slate-300 hover:bg-slate-900/50 hover:text-slate-100",
                  )}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>

        <label className="flex items-center gap-2 text-xs font-semibold text-slate-300">
          Sort
          <select
            value={SORT_OPTIONS.some((opt) => opt.value === currentSort) ? currentSort : "newest_rfq"}
            onChange={(event) =>
              navigate(
                setSort(
                  listState,
                  event.target.value as AdminQuotesSortKey,
                  ADMIN_QUOTES_LIST_STATE_CONFIG,
                ),
              )
            }
            className="rounded-lg border border-slate-800 bg-slate-950/60 px-2 py-1 text-xs text-slate-100 outline-none transition focus:border-emerald-400"
            disabled={pending}
          >
            {SORT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-2 text-xs font-semibold text-slate-300">
          <input
            type="checkbox"
            checked={hasBids}
            onChange={() =>
              navigate(
                setFilter(
                  listState,
                  { hasBids: !hasBids },
                  ADMIN_QUOTES_LIST_STATE_CONFIG,
                ),
              )
            }
            disabled={pending}
            className="h-4 w-4 rounded border-slate-700 bg-slate-950/60 text-emerald-500"
          />
          Has offers
        </label>

        <label className="flex items-center gap-2 text-xs font-semibold text-slate-300">
          <input
            type="checkbox"
            checked={awarded}
            onChange={() =>
              navigate(
                setFilter(
                  listState,
                  { awarded: !awarded },
                  ADMIN_QUOTES_LIST_STATE_CONFIG,
                ),
              )
            }
            disabled={pending}
            className="h-4 w-4 rounded border-slate-700 bg-slate-950/60 text-emerald-500"
          />
          Awarded
        </label>

        <label className="flex items-center gap-2 text-xs font-semibold text-slate-300">
          Parts
          <select
            value={partsCoverage}
            onChange={(event) => {
              const next = (event.target.value ?? "").trim().toLowerCase();
              const nextParams = new URLSearchParams(searchParams.toString());
              if (!next || next === "all") {
                nextParams.delete("partsCoverage");
              } else {
                nextParams.set("partsCoverage", next);
              }
              navigateRawParams(nextParams);
            }}
            className="rounded-lg border border-slate-800 bg-slate-950/60 px-2 py-1 text-xs text-slate-100 outline-none transition focus:border-emerald-400"
            disabled={pending}
          >
            <option value="all">All</option>
            <option value="needs_attention">Needs attention</option>
            <option value="good">Good</option>
            <option value="none">No parts</option>
          </select>
        </label>
      </div>

      <StatusFilterChips
        currentStatus={status}
        basePath={basePath}
        options={STATUS_OPTIONS}
        className="flex-wrap"
        onSelect={(value) => {
          const resolvedCurrent = (status ?? "").trim().toLowerCase();
          const resolvedNext = value.trim().toLowerCase();
          const isActive =
            (resolvedNext === "all" && !resolvedCurrent) ||
            (resolvedNext !== "all" && resolvedCurrent === resolvedNext);

          const nextStatus =
            resolvedNext === "all" || isActive
              ? undefined
              : (resolvedNext as AdminQuotesStatusFilter);

          navigate(
            setFilter(
              listState,
              { status: nextStatus },
              ADMIN_QUOTES_LIST_STATE_CONFIG,
            ),
          );
        }}
      />
    </div>
  );
}

