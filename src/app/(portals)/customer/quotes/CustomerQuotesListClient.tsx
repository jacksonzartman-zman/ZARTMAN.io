"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type RfqStatusTone = "slate" | "blue" | "emerald" | "amber" | "muted";

type CustomerQuoteRow = {
  id: string;
  href: string;
  primaryFileName: string;
  secondaryFileName?: string;
  fallbackLabel: string;
  status: string;
  statusTone: RfqStatusTone;
  updatedLabel: string;
  updatedTitle: string;
};

function clsx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
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
      ? "border-blue-500/30 bg-blue-500/10 text-blue-100"
      : tone === "emerald"
        ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-100"
        : tone === "amber"
          ? "border-amber-500/30 bg-amber-500/10 text-amber-100"
          : tone === "muted"
            ? "border-slate-900/70 bg-slate-950/20 text-slate-400"
            : "border-slate-800 bg-slate-950/40 text-slate-200";

  return (
    <span
      className={clsx(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        toneClasses,
      )}
    >
      {children}
    </span>
  );
}

function NewOffersBadge() {
  return (
    <span className="inline-flex items-center rounded-full border border-emerald-400/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-100">
      New offers
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
  const router = useRouter();

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
    <div className="overflow-hidden rounded-2xl border border-slate-900/70 bg-black/40">
      <div className="grid grid-cols-12 gap-3 border-b border-slate-900/70 px-5 py-3 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
        <div className="col-span-12 sm:col-span-7">RFQ files</div>
        <div className="col-span-6 sm:col-span-3">Status</div>
        <div className="col-span-6 text-right sm:col-span-2">Updated</div>
      </div>
      <ul className="divide-y divide-slate-900/70">
        {rows.map((row) => {
          const hasNewOffers = row.status === "Offers ready" && !seenIds.has(row.id);
          return (
            <li
              key={row.id}
              className={clsx(
                "transition",
                hasNewOffers
                  ? "bg-emerald-500/5 hover:bg-emerald-500/10"
                  : "hover:bg-slate-900/40",
              )}
            >
              <Link
                href={row.href}
                onClick={() => {
                  if (row.status === "Offers ready") markSeen(row.id);
                }}
                className={clsx(
                  "grid grid-cols-12 gap-3 px-5 py-4 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-400",
                  hasNewOffers && "outline outline-1 outline-emerald-500/10",
                )}
              >
                <div className="col-span-12 min-w-0 sm:col-span-7">
                  <p
                    className="min-w-0 truncate text-sm font-semibold text-slate-100"
                    title={row.primaryFileName}
                  >
                    {row.primaryFileName}
                  </p>
                  {row.secondaryFileName ? (
                    <p className="mt-1 min-w-0 truncate text-xs text-slate-400" title={row.secondaryFileName}>
                      {row.secondaryFileName}
                    </p>
                  ) : (
                    <p className="mt-1 min-w-0 truncate text-xs text-slate-500" title={row.fallbackLabel}>
                      {row.fallbackLabel}
                    </p>
                  )}
                </div>

                <div className="col-span-6 flex items-center gap-2 sm:col-span-3">
                  <StatusPill tone={row.statusTone}>{row.status}</StatusPill>
                  {row.status === "Delivered" ? (
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-xs font-medium text-slate-400">Completed successfully</span>
                      <span className="text-xs text-slate-700" aria-hidden>
                        ·
                      </span>
                      <span
                        role="link"
                        tabIndex={0}
                        className={clsx(
                          "text-xs font-semibold text-slate-500 underline decoration-slate-700/70 underline-offset-4 transition",
                          "hover:text-slate-200 hover:decoration-slate-300/60",
                          "focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-400",
                        )}
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          router.push("/");
                        }}
                        onKeyDown={(event) => {
                          if (event.key !== "Enter" && event.key !== " ") return;
                          event.preventDefault();
                          event.stopPropagation();
                          router.push("/");
                        }}
                        aria-label="Upload another part"
                      >
                        Upload another part
                      </span>
                    </div>
                  ) : null}
                  {hasNewOffers ? <NewOffersBadge /> : null}
                </div>

                <div className="col-span-6 flex items-center justify-end text-right sm:col-span-2">
                  <span className="text-xs font-semibold text-slate-200" title={row.updatedTitle}>
                    {row.updatedLabel}
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
