// src/app/admin/StatusFilterChips.tsx
"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { UploadStatus } from "./constants";

type Props = {
  currentStatus: string;
  basePath: string; // e.g. "/admin/uploads" or "/admin/quotes"
};

const STATUS_OPTIONS: { value: UploadStatus | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "new", label: "New" },
  { value: "in_review", label: "In review" },
  { value: "quoted", label: "Quoted" },
  { value: "on_hold", label: "On hold" },
  { value: "closed_lost", label: "Closed lost" },
];

export default function StatusFilterChips({ currentStatus, basePath }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();

  const handleClick = (value: string) => {
    const params = new URLSearchParams(searchParams.toString());

    if (value === "all") {
      params.delete("status");
    } else {
      params.set("status", value);
    }

    const query = params.toString();
    const target = `${basePath}${query ? `?${query}` : ""}`;
    router.push(target);
  };

  return (
    <div className="flex flex-wrap gap-2">
      {STATUS_OPTIONS.map((opt) => {
        const isActive =
          (opt.value === "all" && !currentStatus) ||
          (opt.value !== "all" && currentStatus === opt.value);

        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => handleClick(opt.value)}
            className={[
              "rounded-full px-3 py-1 text-xs font-medium transition",
              isActive
                ? "bg-emerald-500 text-slate-950"
                : "bg-slate-900 text-slate-200 border border-slate-700 hover:border-emerald-500",
            ].join(" ")}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}