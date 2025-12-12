"use client";

import clsx from "clsx";
import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import {
  parseListState,
  setSort,
  type ListStateConfig,
} from "@/app/(portals)/lib/listState";
import type { CustomerQuotesSortKey } from "./listState";

const SORT_OPTIONS: Array<{ value: CustomerQuotesSortKey; label: string }> = [
  { value: "recently_updated", label: "Recently updated" },
  { value: "newest", label: "Newest" },
];

export default function CustomerQuotesListControls({
  basePath,
  listStateConfig,
  className,
}: {
  basePath: string;
  listStateConfig: ListStateConfig<CustomerQuotesSortKey, never>;
  className?: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const listState = parseListState(searchParams, listStateConfig);
  const currentSort =
    (listState.sort as CustomerQuotesSortKey | undefined) ??
    listStateConfig.defaultSort ??
    "recently_updated";

  const navigate = (query: string) => {
    const nextUrl = query ? `${basePath}?${query}` : basePath;
    startTransition(() => {
      router.push(nextUrl, { scroll: false });
    });
  };

  return (
    <div className={clsx("flex flex-wrap items-center justify-between gap-3", className)}>
      <label className="flex items-center gap-2 text-xs font-semibold text-slate-300">
        Sort
        <select
          value={SORT_OPTIONS.some((opt) => opt.value === currentSort) ? currentSort : "recently_updated"}
          onChange={(event) =>
            navigate(
              setSort(
                listState,
                event.target.value as CustomerQuotesSortKey,
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
  );
}

