"use client";

import clsx from "clsx";
import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { ctaSizeClasses, secondaryCtaClasses } from "@/lib/ctas";

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;

export type TablePaginationControlsProps = {
  page: number;
  pageSize: number;
  hasMore: boolean;
  basePath: string;
  existingQueryParams?: Record<string, string | null | undefined>;
  totalCount?: number | null;
  rowsOnPage?: number;
  className?: string;
};

export default function TablePaginationControls({
  page,
  pageSize,
  hasMore,
  basePath,
  existingQueryParams,
  totalCount,
  rowsOnPage,
  className,
}: TablePaginationControlsProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const resolvedRowsOnPage =
    typeof rowsOnPage === "number" && Number.isFinite(rowsOnPage)
      ? Math.max(0, Math.floor(rowsOnPage))
      : 0;

  const showingStart = resolvedRowsOnPage > 0 ? (page - 1) * pageSize + 1 : 0;
  const showingEnd = resolvedRowsOnPage > 0 ? showingStart + resolvedRowsOnPage - 1 : 0;
  const showingEndClamped =
    typeof totalCount === "number" && Number.isFinite(totalCount)
      ? Math.min(showingEnd, totalCount)
      : showingEnd;

  const buildParams = () => {
    const params = new URLSearchParams(searchParams.toString());

    if (existingQueryParams) {
      for (const [key, value] of Object.entries(existingQueryParams)) {
        if (value === undefined || value === null || value === "") params.delete(key);
        else params.set(key, value);
      }
    }

    return params;
  };

  const navigate = (mutate: (params: URLSearchParams) => void) => {
    const params = buildParams();
    mutate(params);
    const query = params.toString();
    const nextUrl = query ? `${basePath}?${query}` : basePath;
    startTransition(() => {
      router.push(nextUrl, { scroll: false });
    });
  };

  const canGoPrev = page > 1;
  const canGoNext = hasMore;

  return (
    <div
      className={clsx(
        "mt-3 flex flex-col gap-3 rounded-2xl border border-slate-800 bg-slate-950/50 px-4 py-3 text-sm text-slate-200 sm:flex-row sm:items-center sm:justify-between",
        className,
      )}
    >
      <label className="flex items-center gap-2 text-xs font-semibold text-slate-300">
        Show
        <select
          value={PAGE_SIZE_OPTIONS.includes(pageSize as (typeof PAGE_SIZE_OPTIONS)[number]) ? pageSize : 25}
          onChange={(event) => {
            const nextSize = Number.parseInt(event.target.value, 10);
            const normalized = PAGE_SIZE_OPTIONS.includes(
              nextSize as (typeof PAGE_SIZE_OPTIONS)[number],
            )
              ? nextSize
              : 25;

            navigate((params) => {
              // Persist page size, but keep URLs tidy for the default.
              if (normalized === 25) params.delete("pageSize");
              else params.set("pageSize", String(normalized));
              // Changing page size resets paging.
              params.delete("page");
            });
          }}
          className="rounded-lg border border-slate-800 bg-slate-950/60 px-2 py-1 text-xs text-slate-100 outline-none transition focus:border-emerald-400"
          disabled={pending}
        >
          {PAGE_SIZE_OPTIONS.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
      </label>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
        <span className="font-semibold text-slate-200">Page {page}</span>
        {resolvedRowsOnPage > 0 ? (
          <span>
            Showing {showingStart}–{showingEndClamped}
            {typeof totalCount === "number" && Number.isFinite(totalCount) ? ` of ${totalCount}` : ""}
          </span>
        ) : (
          <span>Showing 0</span>
        )}
      </div>

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() =>
            navigate((params) => {
              const nextPage = Math.max(1, page - 1);
              if (nextPage === 1) params.delete("page");
              else params.set("page", String(nextPage));
            })
          }
          className={clsx(
            secondaryCtaClasses,
            ctaSizeClasses.sm,
            "min-w-[6.25rem] justify-center",
            (!canGoPrev || pending) && "cursor-not-allowed opacity-50",
          )}
          disabled={!canGoPrev || pending}
        >
          Prev
        </button>
        <button
          type="button"
          onClick={() =>
            navigate((params) => {
              const nextPage = page + 1;
              params.set("page", String(nextPage));
            })
          }
          className={clsx(
            secondaryCtaClasses,
            ctaSizeClasses.sm,
            "min-w-[6.25rem] justify-center",
            (!canGoNext || pending) && "cursor-not-allowed opacity-50",
          )}
          disabled={!canGoNext || pending}
        >
          Next
        </button>
      </div>
    </div>
  );
}

