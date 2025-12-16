"use client";

import clsx from "clsx";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useTransition } from "react";

export type CustomerProjectsStatusFilter = "in_progress" | "complete" | "all";
export type CustomerProjectsSortKey = "updated" | "awarded" | "supplier";

type SupplierOption = { id: string; label: string };

function getParam(searchParams: URLSearchParams, key: string): string {
  const value = searchParams.get(key);
  return typeof value === "string" ? value : "";
}

function buildNextUrl({
  basePath,
  currentSearchParams,
  next,
}: {
  basePath: string;
  currentSearchParams: URLSearchParams;
  next: Record<string, string | null | undefined>;
}): string {
  const params = new URLSearchParams(currentSearchParams.toString());
  for (const [key, value] of Object.entries(next)) {
    const normalized = typeof value === "string" ? value.trim() : "";
    if (!normalized) {
      params.delete(key);
    } else {
      params.set(key, normalized);
    }
  }
  const query = params.toString();
  return query ? `${basePath}?${query}` : basePath;
}

export default function CustomerProjectsListControls({
  basePath,
  suppliers,
  className,
}: {
  basePath: string;
  suppliers: SupplierOption[];
  className?: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const resolvedParams = useMemo(
    () => new URLSearchParams(searchParams?.toString() ?? ""),
    [searchParams],
  );

  const status = (getParam(resolvedParams, "status") as CustomerProjectsStatusFilter) || "in_progress";
  const sort = (getParam(resolvedParams, "sort") as CustomerProjectsSortKey) || "updated";
  const supplier = getParam(resolvedParams, "supplier");

  const setQuery = (next: Record<string, string | null | undefined>) => {
    const nextUrl = buildNextUrl({
      basePath,
      currentSearchParams: resolvedParams,
      next,
    });
    startTransition(() => {
      router.push(nextUrl, { scroll: false });
    });
  };

  const statusOptions: Array<{ value: CustomerProjectsStatusFilter; label: string }> = [
    { value: "in_progress", label: "In progress" },
    { value: "complete", label: "Complete" },
    { value: "all", label: "All" },
  ];

  const sortOptions: Array<{ value: CustomerProjectsSortKey; label: string }> = [
    { value: "updated", label: "Last updated" },
    { value: "awarded", label: "Awarded date" },
    { value: "supplier", label: "Supplier" },
  ];

  const normalizedStatus = statusOptions.some((opt) => opt.value === status)
    ? status
    : "in_progress";
  const normalizedSort = sortOptions.some((opt) => opt.value === sort) ? sort : "updated";

  return (
    <div className={clsx("flex flex-wrap items-center justify-between gap-3", className)}>
      <div className="flex flex-wrap items-center gap-2">
        {statusOptions.map((opt) => {
          const active = opt.value === normalizedStatus;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => setQuery({ status: opt.value })}
              disabled={pending}
              className={clsx(
                "inline-flex items-center rounded-full px-3 py-1.5 text-xs font-semibold transition-colors",
                "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300",
                active ? "bg-slate-900 text-white" : "text-slate-300 hover:text-white",
              )}
            >
              {opt.label}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {suppliers.length > 0 ? (
          <label className="flex items-center gap-2 text-xs font-semibold text-slate-300">
            Supplier
            <select
              value={supplier}
              onChange={(event) => setQuery({ supplier: event.target.value || null })}
              className="max-w-[15rem] rounded-lg border border-slate-800 bg-slate-950/60 px-2 py-1 text-xs text-slate-100 outline-none transition focus:border-emerald-400"
              disabled={pending}
            >
              <option value="">All suppliers</option>
              {suppliers.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <label className="flex items-center gap-2 text-xs font-semibold text-slate-300">
          Sort
          <select
            value={normalizedSort}
            onChange={(event) => setQuery({ sort: event.target.value })}
            className="rounded-lg border border-slate-800 bg-slate-950/60 px-2 py-1 text-xs text-slate-100 outline-none transition focus:border-emerald-400"
            disabled={pending}
          >
            {sortOptions.map((opt) => (
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

