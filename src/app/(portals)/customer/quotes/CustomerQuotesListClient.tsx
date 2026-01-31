"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

type RfqStatusTone = "slate" | "blue" | "emerald" | "amber" | "muted";

type CustomerQuoteRow = {
  id: string;
  href: string;
  primaryFileName: string;
  secondaryFileName?: string;
  fallbackLabel: string;
  status: string;
  stageLabel?: string;
  statusTone: RfqStatusTone;
  updatedLabel: string;
  updatedTitle: string;
};

function clsx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function formatRfqId(id: string): string {
  const raw = (id ?? "").trim();
  if (!raw) return "—";
  if (raw.startsWith("Q-")) return raw;
  return `#${raw.slice(0, 6)}`;
}

function StatusPill({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: RfqStatusTone;
}) {
  const toneClasses =
    tone === "blue"
      ? "border-blue-400/20 bg-slate-950/20 text-slate-200"
      : tone === "emerald"
        ? "border-emerald-400/20 bg-slate-950/20 text-slate-200"
        : tone === "amber"
          ? "border-amber-400/20 bg-slate-950/20 text-slate-200"
          : tone === "muted"
            ? "border-slate-900/60 bg-slate-950/10 text-slate-400"
            : "border-slate-800/70 bg-slate-950/20 text-slate-200";

  return (
    <span
      className={clsx(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        toneClasses,
      )}
    >
      {children}
    </span>
  );
}

const SEEN_OFFERS_READY_KEY = "customer.rfqs.seenOffersReady.v1";

function readSeenMap(): Record<string, number> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(SEEN_OFFERS_READY_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as Record<string, number>;
  } catch {
    return {};
  }
}

function writeSeenMap(next: Record<string, number>) {
  try {
    window.localStorage.setItem(SEEN_OFFERS_READY_KEY, JSON.stringify(next));
  } catch {
    // Ignore quota/security errors; UX will just fall back to ephemeral state.
  }
}

export function CustomerQuotesListClient({ rows }: { rows: CustomerQuoteRow[] }) {
  const [seenMap, setSeenMap] = useState<Record<string, number>>({});

  useEffect(() => {
    setSeenMap(readSeenMap());
  }, []);

  const seenIds = useMemo(() => new Set(Object.keys(seenMap)), [seenMap]);

  const markSeen = useCallback((id: string) => {
    setSeenMap((prev) => {
      if (prev[id]) return prev;
      const next = { ...prev, [id]: Date.now() };
      writeSeenMap(next);
      return next;
    });
  }, []);

  return (
    <div className="overflow-hidden">
      <div className="border-b border-slate-800/50 px-6 py-3">
        <div className="grid grid-cols-1 gap-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500 md:grid-cols-[minmax(0,1fr)_10rem_7rem_7rem] md:items-center">
          <div>RFQ</div>
          <div className="hidden md:block">Status</div>
          <div className="hidden md:block text-right">Updated</div>
          <div className="hidden md:block text-right">Action</div>
        </div>
      </div>
      <ul className="divide-y divide-slate-800/40">
        {rows.map((row) => {
          const hasNewOffers = row.status === "Offers ready" && !seenIds.has(row.id);
          const title =
            row.primaryFileName?.trim() && row.primaryFileName !== "No files yet"
              ? row.primaryFileName
              : row.fallbackLabel;
          return (
            <li
              key={row.id}
              className={clsx(
                "relative transition-colors motion-reduce:transition-none",
                "hover:bg-slate-900/15",
              )}
            >
              <Link
                href={row.href}
                onClick={() => {
                  if (row.status === "Offers ready") markSeen(row.id);
                }}
                className={clsx(
                  "group relative grid grid-cols-1 gap-3 px-6 py-4 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-400 motion-reduce:transition-none md:grid-cols-[minmax(0,1fr)_10rem_7rem_7rem] md:items-center",
                )}
              >
                {hasNewOffers ? (
                  <span
                    className="absolute left-0 top-0 h-full w-0.5 bg-emerald-400/50"
                    aria-hidden
                  />
                ) : null}
                <div className="min-w-0">
                  <p
                    className="min-w-0 truncate text-[15px] font-semibold leading-snug text-slate-100"
                    title={title}
                  >
                    {title}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 md:hidden">
                    <span className="text-xs font-medium text-slate-300 whitespace-nowrap">
                      {row.status}
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-slate-500 whitespace-nowrap">
                    <span className="tabular-nums">RFQ {formatRfqId(row.id)}</span>
                    <span className="px-2 text-slate-700" aria-hidden>
                      ·
                    </span>
                    <span className="tabular-nums" title={row.updatedTitle}>
                      Updated {row.updatedLabel}
                    </span>
                  </p>
                  <div className="mt-3 flex justify-end md:hidden">
                    <span className="text-xs font-semibold text-slate-300 whitespace-nowrap">
                      View RFQ →
                    </span>
                  </div>
                </div>

                <div className="hidden min-w-0 md:flex md:items-center">
                  <div className="flex min-w-0 flex-col items-start gap-1">
                    <StatusPill tone={row.statusTone}>{row.status}</StatusPill>
                  </div>
                </div>

                <div className="hidden md:flex md:items-center md:justify-end md:text-right">
                  <div className="flex flex-col items-end gap-1 tabular-nums">
                    <span
                      className="text-xs font-medium text-slate-400 whitespace-nowrap"
                      title={row.updatedTitle}
                    >
                      {row.updatedLabel}
                    </span>
                  </div>
                </div>

                <div className="hidden md:flex md:items-center md:justify-end">
                  <span
                    className={clsx(
                      "text-xs font-semibold text-slate-300 whitespace-nowrap",
                      "transition-colors motion-reduce:transition-none",
                      "group-hover:text-white group-focus-visible:text-white",
                    )}
                  >
                    View RFQ →
                  </span>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
