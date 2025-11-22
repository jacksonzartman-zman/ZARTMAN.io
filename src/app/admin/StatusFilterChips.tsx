// src/app/admin/StatusFilterChips.tsx
"use client";

import { useRouter, useSearchParams } from "next/navigation";
import {
  UPLOAD_STATUS_LABELS,
  UPLOAD_STATUS_OPTIONS,
  type UploadStatus,
} from "./constants";

type Props = {
  currentStatus?: string;
  basePath: string; // e.g. "/admin/uploads" or "/admin/quotes"
  className?: string;
};

const STATUS_OPTIONS: { value: UploadStatus | "all"; label: string }[] = [
  { value: "all", label: "All" },
  ...UPLOAD_STATUS_OPTIONS.map((status) => ({
    value: status,
    label: UPLOAD_STATUS_LABELS[status],
  })),
];

export default function StatusFilterChips({
  currentStatus = "",
  basePath,
  className,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const resolvedStatus = currentStatus.trim().toLowerCase();

  const handleClick = (value: UploadStatus | "all") => {
    const params = new URLSearchParams(searchParams.toString());
    const isActive =
      (value === "all" && !resolvedStatus) || resolvedStatus === value;

    if (value === "all" || isActive) {
      params.delete("status");
    } else {
      params.set("status", value);
    }

    const query = params.toString();
    const target = `${basePath}${query ? `?${query}` : ""}`;
    router.push(target, { scroll: false });
  };

  const containerClasses =
    className ??
    "flex flex-wrap gap-2 text-xs font-medium text-slate-200";

  return (
    <div className={containerClasses}>
      {STATUS_OPTIONS.map((opt) => {
        const isActive =
          (opt.value === "all" && !resolvedStatus) ||
          (opt.value !== "all" && resolvedStatus === opt.value);

        const chipClasses = [
          "rounded-full border px-3 py-1 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400",
          isActive
            ? "border-emerald-400 bg-emerald-500/20 text-emerald-100"
            : "border-slate-800 bg-slate-900 text-slate-300 hover:border-emerald-400 hover:text-emerald-100",
        ].join(" ");

        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => handleClick(opt.value)}
            className={chipClasses}
            aria-pressed={isActive}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
