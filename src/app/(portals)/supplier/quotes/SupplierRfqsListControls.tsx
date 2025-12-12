"use client";

import clsx from "clsx";
import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import {
  parseListState,
  setFilter,
  setSort,
  type ListStateConfig,
} from "@/app/(portals)/lib/listState";
import type { SupplierRfqsSortKey, SupplierRfqsStatusFilter } from "./listState";

const SORT_OPTIONS: Array<{ value: SupplierRfqsSortKey; label: string }> = [
  { value: "recently_updated", label: "Recently updated" },
  { value: "newest", label: "Newest" },
];

type FilterOption = { label: string; value: "all" | SupplierRfqsStatusFilter; count: number };

export default function SupplierRfqsListControls({
  basePath,
  filterOptions,
  listStateConfig,
  className,
}: {
  basePath: string;
  filterOptions: FilterOption[];
  listStateConfig: ListStateConfig<SupplierRfqsSortKey, SupplierRfqsStatusFilter>;
  className?: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const listState = parseListState(searchParams, listStateConfig);
  const currentSort =
    (listState.sort as SupplierRfqsSortKey | undefined) ??
    listStateConfig.defaultSort ??
    "recently_updated";
  const currentStatus = (listState.status as SupplierRfqsStatusFilter | undefined) ?? undefined;

  const navigate = (query: string) => {
    const nextUrl = query ? `${basePath}?${query}` : basePath;
    startTransition(() => {
      router.push(nextUrl, { scroll: false });
    });
  };

  return (
    <div className={clsx("flex flex-col gap-4", className)}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {filterOptions.map((option) => {
            const isActive =
              (option.value === "all" && !currentStatus) ||
              (option.value !== "all" && currentStatus === option.value);

            return (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  const nextStatus =
                    option.value === "all" || isActive ? undefined : option.value;
                  navigate(
                    setFilter(
                      listState,
                      { status: nextStatus as SupplierRfqsStatusFilter | undefined },
                      listStateConfig,
                    ),
                  );
                }}
                className={clsx(
                  "inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.25em] transition",
                  isActive
                    ? "border-white bg-white/10 text-white"
                    : "border-slate-800 text-slate-400 hover:text-white",
                )}
                aria-pressed={isActive}
                disabled={pending}
              >
                {option.label}
                <span
                  className={clsx(
                    "rounded-full px-2 py-0.5 text-[10px]",
                    isActive ? "bg-white/20 text-white" : "bg-slate-800 text-slate-400",
                  )}
                >
                  {option.count}
                </span>
              </button>
            );
          })}
        </div>

        <label className="flex items-center gap-2 text-xs font-semibold text-slate-300">
          Sort
          <select
            value={
              SORT_OPTIONS.some((opt) => opt.value === currentSort)
                ? currentSort
                : "recently_updated"
            }
            onChange={(event) =>
              navigate(
                setSort(
                  listState,
                  event.target.value as SupplierRfqsSortKey,
                  listStateConfig,
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
      </div>
    </div>
  );
}

