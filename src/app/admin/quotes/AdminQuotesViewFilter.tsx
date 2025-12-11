"use client";

import clsx from "clsx";
import { useRouter, useSearchParams } from "next/navigation";
import type { AdminQuotesView } from "@/types/adminQuotes";
import { getAdminQuoteViewOptions } from "./viewFilters";

type AdminQuotesViewFilterProps = {
  currentView: AdminQuotesView;
  basePath: string;
  className?: string;
};

export default function AdminQuotesViewFilter({
  currentView,
  basePath,
  className,
}: AdminQuotesViewFilterProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const options = getAdminQuoteViewOptions();

  const handleSelect = (value: AdminQuotesView) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("view", value);
    const query = params.toString();
    router.push(`${basePath}${query ? `?${query}` : ""}`, { scroll: false });
  };

  return (
    <div
      className={clsx(
        "flex flex-wrap items-center gap-2 text-xs font-semibold",
        className,
      )}
    >
      {options.map((option) => {
        const isActive = option.value === currentView;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => handleSelect(option.value)}
            className={clsx(
              "rounded-full border px-3 py-1 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400",
              isActive
                ? "border-emerald-400 bg-emerald-500/20 text-emerald-100"
                : "border-slate-800 bg-slate-900 text-slate-300 hover:border-emerald-400 hover:text-emerald-100",
            )}
            aria-pressed={isActive}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
