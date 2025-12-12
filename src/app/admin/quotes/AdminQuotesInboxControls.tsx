"use client";

import { useRouter, useSearchParams } from "next/navigation";
import StatusFilterChips from "../StatusFilterChips";
import { useTransition } from "react";
import clsx from "clsx";

type SortKey = "newest_rfq" | "latest_bid_activity" | "awarded_recently" | "most_bids";

const SORT_OPTIONS: Array<{ value: SortKey; label: string }> = [
  { value: "newest_rfq", label: "Newest RFQ" },
  { value: "latest_bid_activity", label: "Latest bid activity" },
  { value: "awarded_recently", label: "Awarded recently" },
  { value: "most_bids", label: "Most bids" },
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

  const currentSort = ((searchParams.get("sort") ?? "newest_rfq")
    .trim()
    .toLowerCase() || "newest_rfq") as SortKey;
  const hasBids = (searchParams.get("hasBids") ?? "").trim() === "1";
  const awarded = (searchParams.get("awarded") ?? "").trim() === "1";
  const status = (searchParams.get("status") ?? "").trim();

  const navigate = (mutate: (params: URLSearchParams) => void) => {
    const params = new URLSearchParams(searchParams.toString());
    mutate(params);
    const query = params.toString();
    const nextUrl = query ? `${basePath}?${query}` : basePath;
    startTransition(() => {
      router.push(nextUrl, { scroll: false });
    });
  };

  return (
    <div className={clsx("flex flex-col gap-3", className)}>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-xs font-semibold text-slate-300">
          Sort
          <select
            value={SORT_OPTIONS.some((opt) => opt.value === currentSort) ? currentSort : "newest_rfq"}
            onChange={(event) =>
              navigate((params) => {
                params.set("sort", event.target.value);
              })
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
              navigate((params) => {
                const next = !hasBids;
                if (next) params.set("hasBids", "1");
                else params.delete("hasBids");
              })
            }
            disabled={pending}
            className="h-4 w-4 rounded border-slate-700 bg-slate-950/60 text-emerald-500"
          />
          Has bids
        </label>

        <label className="flex items-center gap-2 text-xs font-semibold text-slate-300">
          <input
            type="checkbox"
            checked={awarded}
            onChange={() =>
              navigate((params) => {
                const next = !awarded;
                if (next) params.set("awarded", "1");
                else params.delete("awarded");
              })
            }
            disabled={pending}
            className="h-4 w-4 rounded border-slate-700 bg-slate-950/60 text-emerald-500"
          />
          Awarded
        </label>
      </div>

      <StatusFilterChips
        currentStatus={status}
        basePath={basePath}
        options={STATUS_OPTIONS}
        className="flex-wrap"
      />
    </div>
  );
}

