 "use client";

import Link from "next/link";
import clsx from "clsx";
import { Fragment, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import AdminTableShell, { adminTableCellClass } from "@/app/admin/AdminTableShell";
import { ctaSizeClasses, primaryInfoCtaClasses } from "@/lib/ctas";
import { formatDateTime } from "@/lib/formatDate";
import { formatRelativeTimeFromTimestamp, toTimestamp } from "@/lib/relativeTime";
import type { SupplierInboxRow } from "./SupplierInboxTable";

type NewRfqsTableProps = {
  rows: SupplierInboxRow[];
};

const SNOOZE_STORAGE_KEY = "supplier_rfq_snoozes_v1";
const URGENT_ONLY_STORAGE_KEY = "supplier_new_rfqs_urgent_only_v1";
const DAY_IN_MS = 24 * 60 * 60 * 1000;
const URGENT_WINDOW_DAYS = 3;

export default function NewRfqsTable({ rows }: NewRfqsTableProps) {
  const router = useRouter();
  const [items, setItems] = useState<SupplierInboxRow[]>(() =>
    sortNewRfqRows(filterSnoozedRows(rows)),
  );
  const [showUrgentOnly, setShowUrgentOnly] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.localStorage.getItem(URGENT_ONLY_STORAGE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [pendingIds, setPendingIds] = useState<Set<string>>(() => new Set());
  const [errorById, setErrorById] = useState<Record<string, string>>({});
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    setItems(sortNewRfqRows(filterSnoozedRows(rows)));
  }, [rows]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(
        URGENT_ONLY_STORAGE_KEY,
        showUrgentOnly ? "1" : "0",
      );
    } catch {
      // ignore
    }
  }, [showUrgentOnly]);

  const visibleItems = useMemo(() => {
    if (!showUrgentOnly) return items;
    return items.filter((row) => isUrgentNeedBy(row.targetDate));
  }, [items, showUrgentOnly]);

  if (items.length === 0) {
    return null;
  }

  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end">
        <label className="inline-flex cursor-pointer select-none items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.26em] text-slate-500">
          <input
            type="checkbox"
            checked={showUrgentOnly}
            onChange={(e) => setShowUrgentOnly(e.target.checked)}
            className="h-4 w-4 rounded border-slate-700 bg-slate-950/40 text-amber-400 focus:ring-2 focus:ring-amber-400/60"
          />
          <span>Show urgent only</span>
        </label>
      </div>
      <AdminTableShell
        className="border-slate-800/50 bg-slate-950/20 shadow-none"
        tableClassName="table-fixed"
        head={
          <tr>
            <th className="w-auto px-5 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
              Files
            </th>
            <th className="w-[12rem] px-5 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
              Process
            </th>
            <th className="w-[6.5rem] px-5 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
              Qty
            </th>
            <th className="w-[10.5rem] px-5 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
              Need-by
            </th>
            <th className="w-[9rem] px-5 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
              Received
            </th>
            <th className="w-[12.5rem] px-5 py-4 text-right text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
              Action
            </th>
          </tr>
        }
        body={
          visibleItems.length > 0 ? (
            visibleItems.map((row) => {
              const href = `/supplier/quotes/${row.quoteId}`;
              const fileCount = Math.max(0, row.fileCount ?? 0);
              const fileNames = Array.isArray(row.fileNames) ? row.fileNames : [];
              const expanded = expandedIds.has(row.id);
              const primary =
                fileNames[0] ??
                row.primaryFileName ??
                row.rfqLabel ??
                `RFQ ${row.quoteId.slice(0, 8)}`;
              const extraCount = Math.max(0, fileNames.length - 1);
              const filesLabel = extraCount > 0 ? `${primary} +${extraCount}` : primary;
              const filesTitle =
                fileNames.length > 1 ? fileNames.join("\n") : undefined;

              const processLabel = row.processHint ?? "—";
              const quantityLabel = row.quantityHint ?? "—";
              const needByLabel = row.targetDate
                ? formatDateTime(row.targetDate, { includeTime: false }) ?? "—"
                : "—";
              const urgent = isUrgentNeedBy(row.targetDate);
              const missingSpecs =
                !row.processHint?.trim() ||
                !row.quantityHint?.trim() ||
                !row.targetDate?.trim();
              const receivedLabel =
                formatRelativeTimeFromTimestamp(toTimestamp(row.createdAt)) ?? "—";
              const freshnessLabel = formatRfqFreshness(row.createdAt);
              const pending = pendingIds.has(row.id);
              const error = errorById[row.id];
              const previewFiles = fileNames.length > 0
                ? fileNames
                : row.primaryFileName
                  ? [row.primaryFileName]
                  : [];
              const previewId = `new-rfq-preview-${row.id}`;

              return (
                <Fragment key={row.id}>
                  <tr className="bg-transparent transition hover:bg-slate-900/20 motion-reduce:transition-none">
                    <td className={clsx(adminTableCellClass, "px-5 py-4")}>
                      <div className="flex items-start gap-3">
                        <button
                          type="button"
                          onClick={() => toggleExpanded(row.id)}
                          aria-label={expanded ? "Hide preview" : "Show preview"}
                          aria-expanded={expanded}
                          aria-controls={previewId}
                          className={clsx(
                            "mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-slate-800/70 bg-slate-950/25 text-slate-400 transition hover:border-slate-600/80 hover:text-white motion-reduce:transition-none",
                            expanded ? "text-white" : "",
                          )}
                        >
                          <ChevronIcon rotated={expanded} />
                        </button>
                        <div className="min-w-0 flex-1">
                          <div className="flex min-w-0 items-baseline gap-2">
                            <Link
                              href={href}
                              className="min-w-0 truncate font-semibold text-white underline-offset-4 hover:underline"
                              title={filesTitle ?? filesLabel}
                            >
                              {filesLabel}
                            </Link>
                            {freshnessLabel ? (
                              <span className="shrink-0 text-xs text-slate-500 tabular-nums">
                                {freshnessLabel}
                              </span>
                            ) : null}
                          </div>
                          <p className="mt-1 text-[11px] text-slate-400">
                            {fileCount > 0
                              ? `${fileCount} file${fileCount === 1 ? "" : "s"}`
                              : "Files pending"}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td
                      className={clsx(
                        adminTableCellClass,
                        "px-5 py-4 text-xs text-slate-400",
                      )}
                    >
                      <span
                        className="block truncate whitespace-nowrap"
                        title={processLabel}
                      >
                        {processLabel}
                      </span>
                    </td>
                    <td
                      className={clsx(
                        adminTableCellClass,
                        "px-5 py-4 text-xs text-slate-400",
                      )}
                    >
                      <span
                        className="block truncate whitespace-nowrap tabular-nums"
                        title={quantityLabel}
                      >
                        {quantityLabel}
                      </span>
                    </td>
                    <td
                      className={clsx(
                        adminTableCellClass,
                        "px-5 py-4 text-xs text-slate-400",
                      )}
                    >
                      {row.targetDate ? (
                        <div className="flex items-center gap-2 whitespace-nowrap">
                          <span className="tabular-nums">{needByLabel}</span>
                          {urgent ? <UrgentPill /> : null}
                        </div>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td
                      className={clsx(
                        adminTableCellClass,
                        "px-5 py-4 text-xs text-slate-500 tabular-nums whitespace-nowrap",
                      )}
                    >
                      {receivedLabel}
                    </td>
                    <td className={clsx(adminTableCellClass, "px-5 py-4 text-right")}>
                      <div className="flex flex-col items-end gap-2">
                        <Link
                          href={href}
                          className={clsx(
                            primaryInfoCtaClasses,
                            ctaSizeClasses.sm,
                            "inline-flex min-w-[10.5rem] justify-center px-5 py-2 text-sm shadow-[0_10px_22px_rgba(37,99,235,0.22)] hover:shadow-[0_12px_26px_rgba(37,99,235,0.28)] motion-reduce:transition-none",
                            pending ? "pointer-events-none opacity-60" : "",
                          )}
                        >
                          Submit offer
                        </Link>
                        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide">
                          <button
                            type="button"
                            disabled={pending}
                            onClick={async () => {
                              if (pending) return;
                              setErrorById((prev) => {
                                if (!prev[row.id]) return prev;
                                const next = { ...prev };
                                delete next[row.id];
                                return next;
                              });
                              setPendingIds((prev) => new Set(prev).add(row.id));

                              try {
                                const res = await fetch(
                                  `/api/supplier/rfqs/${row.quoteId}/snooze`,
                                  {
                                    method: "POST",
                                    headers: { "content-type": "application/json" },
                                    body: JSON.stringify({ hours: 24 }),
                                  },
                                );
                                const payload = (await res.json().catch(() => null)) as any;
                                if (!res.ok || !payload?.ok) {
                                  const errorCode =
                                    typeof payload?.error === "string" && payload.error
                                      ? payload.error
                                      : "unknown";
                                  throw new Error(errorCode);
                                }

                                if (
                                  typeof payload?.snoozeUntil === "string" &&
                                  payload.snoozeUntil
                                ) {
                                  persistSnooze(row.quoteId, payload.snoozeUntil);
                                }

                                // Optimistically remove from the current list.
                                setItems((prev) =>
                                  prev.filter((candidate) => candidate.id !== row.id),
                                );
                                // Refresh server-rendered pills/status (DB-backed snooze will keep it out).
                                router.refresh();
                              } catch (err) {
                                const message =
                                  err instanceof Error && err.message
                                    ? err.message
                                    : "Unable to snooze right now.";
                                setErrorById((prev) => ({ ...prev, [row.id]: message }));
                              } finally {
                                setPendingIds((prev) => {
                                  const next = new Set(prev);
                                  next.delete(row.id);
                                  return next;
                                });
                              }
                            }}
                            className={clsx(
                              ctaSizeClasses.sm,
                              "bg-transparent px-0 py-0 text-slate-400 underline-offset-4 transition hover:text-slate-100 hover:underline motion-reduce:transition-none",
                              pending ? "opacity-60" : "",
                            )}
                          >
                            {pending ? "Snoozing..." : "Snooze 24h"}
                          </button>
                          <span className="select-none text-slate-700">·</span>
                          <button
                            type="button"
                            disabled={pending}
                            onClick={async () => {
                              if (pending) return;
                              setErrorById((prev) => {
                                if (!prev[row.id]) return prev;
                                const next = { ...prev };
                                delete next[row.id];
                                return next;
                              });
                              setPendingIds((prev) => new Set(prev).add(row.id));

                              try {
                                const res = await fetch(
                                  `/api/supplier/rfqs/${row.quoteId}/decline`,
                                  {
                                    method: "POST",
                                  },
                                );
                                const payload = (await res.json().catch(() => null)) as any;
                                if (!res.ok || !payload?.ok) {
                                  const errorCode =
                                    typeof payload?.error === "string" && payload.error
                                      ? payload.error
                                      : "unknown";
                                  throw new Error(errorCode);
                                }

                                // Optimistically remove from the current list.
                                setItems((prev) =>
                                  prev.filter((candidate) => candidate.id !== row.id),
                                );
                                // Refresh server-rendered pills/status + ensure the RFQ stays out.
                                router.refresh();
                              } catch (err) {
                                const message =
                                  err instanceof Error && err.message
                                    ? err.message
                                    : "Unable to decline right now.";
                                setErrorById((prev) => ({ ...prev, [row.id]: message }));
                              } finally {
                                setPendingIds((prev) => {
                                  const next = new Set(prev);
                                  next.delete(row.id);
                                  return next;
                                });
                              }
                            }}
                            className={clsx(
                              ctaSizeClasses.sm,
                              "bg-transparent px-0 py-0 text-slate-400 underline-offset-4 transition hover:text-slate-100 hover:underline motion-reduce:transition-none",
                              pending ? "opacity-60" : "",
                            )}
                          >
                            {pending ? "Declining..." : "Not a fit"}
                          </button>
                        </div>
                        {error ? (
                          <p
                            className="max-w-[12rem] text-right text-xs text-red-300"
                            role="alert"
                          >
                            {error}
                          </p>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                  {expanded ? (
                    <tr className="bg-transparent">
                      <td
                        colSpan={6}
                        className={clsx(adminTableCellClass, "px-5 pb-5 pt-0")}
                      >
                        <NewRfqPreviewPanel
                          id={previewId}
                          fileNames={previewFiles}
                          processLabel={processLabel}
                          quantityLabel={quantityLabel}
                          needByLabel={needByLabel}
                          showQualityHint={missingSpecs}
                        />
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })
          ) : (
            <tr className="bg-slate-950/40">
              <td
                colSpan={6}
                className={clsx(adminTableCellClass, "px-5 py-10 text-center text-slate-500")}
              >
                No urgent RFQs right now.
              </td>
            </tr>
          )
        }
      />
    </div>
  );
}

function NewRfqPreviewPanel({
  id,
  fileNames,
  processLabel,
  quantityLabel,
  needByLabel,
  showQualityHint,
}: {
  id: string;
  fileNames: string[];
  processLabel: string;
  quantityLabel: string;
  needByLabel: string;
  showQualityHint: boolean;
}) {
  const fileList = useMemo(() => {
    const cleaned = fileNames
      .map((name) => (typeof name === "string" ? name.trim() : ""))
      .filter((name) => name.length > 0);
    return cleaned;
  }, [fileNames]);

  return (
    <div
      id={id}
      className="rounded-2xl border border-slate-800/60 bg-slate-950/25 px-5 py-4"
    >
      <div className="grid gap-x-8 gap-y-4 md:grid-cols-12">
        <div className="md:col-span-6">
          <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-400">
            Files
          </p>
          {fileList.length > 0 ? (
            <ul className="mt-1.5 space-y-0.5 text-sm text-slate-200">
              {fileList.map((name) => (
                <li key={name} className="min-w-0">
                  <span className="block truncate" title={name}>
                    {name}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-slate-200">—</p>
          )}
        </div>
        <div className="md:col-span-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-400">
            Process(es)
          </p>
          <p className="mt-1.5 text-sm text-slate-200">{processLabel || "—"}</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 md:col-span-3 md:grid-cols-1">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-400">
              Qty
            </p>
            <p className="mt-1.5 text-sm text-slate-200">{quantityLabel || "—"}</p>
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-400">
              Need-by
            </p>
            <p className="mt-1.5 text-sm text-slate-200">{needByLabel || "—"}</p>
          </div>
        </div>
      </div>
      {showQualityHint ? (
        <p className="mt-3 text-xs text-slate-500">
          More complete specs lead to faster awards.
        </p>
      ) : null}
    </div>
  );
}

function ChevronIcon({ rotated }: { rotated: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="currentColor"
      className={clsx(
        "h-4 w-4 transition-transform motion-reduce:transition-none",
        rotated ? "rotate-180" : "",
      )}
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.168l3.71-3.94a.75.75 0 1 1 1.08 1.04l-4.24 4.5a.75.75 0 0 1-1.08 0l-4.24-4.5a.75.75 0 0 1 .02-1.06Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function UrgentPill() {
  return (
    <span className="inline-flex items-center rounded-full border border-amber-400/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-100">
      Urgent
    </span>
  );
}

function isUrgentNeedBy(targetDate: string | null): boolean {
  const ms = toTimestamp(targetDate);
  if (typeof ms !== "number") return false;
  const now = Date.now();
  const windowMs = URGENT_WINDOW_DAYS * DAY_IN_MS;
  return ms - now <= windowMs;
}

function formatRfqFreshness(createdAt: string | null | undefined): string | null {
  const timestamp = toTimestamp(createdAt);
  if (typeof timestamp !== "number") return null;

  const now = Date.now();
  const delta = Math.max(0, now - timestamp);
  const MINUTE_IN_MS = 60 * 1000;
  const HOUR_IN_MS = 60 * MINUTE_IN_MS;

  if (delta < MINUTE_IN_MS) {
    return "Received just now";
  }
  if (delta < HOUR_IN_MS) {
    const minutes = Math.max(1, Math.round(delta / MINUTE_IN_MS));
    return `Received ${minutes} min ago`;
  }
  const hours = Math.max(1, Math.round(delta / HOUR_IN_MS));
  return `Received ${hours} ${hours === 1 ? "hr" : "hrs"} ago`;
}

function sortNewRfqRows(rows: SupplierInboxRow[]): SupplierInboxRow[] {
  return [...rows].sort((a, b) => {
    const aNeedBy = toTimestamp(a.targetDate);
    const bNeedBy = toTimestamp(b.targetDate);

    const aHasNeedBy = typeof aNeedBy === "number";
    const bHasNeedBy = typeof bNeedBy === "number";

    if (aHasNeedBy && bHasNeedBy) {
      if (aNeedBy !== bNeedBy) return aNeedBy - bNeedBy; // sooner first
    } else if (aHasNeedBy) {
      return -1;
    } else if (bHasNeedBy) {
      return 1;
    }

    const aReceived = toTimestamp(a.createdAt) ?? 0;
    const bReceived = toTimestamp(b.createdAt) ?? 0;
    if (aReceived !== bReceived) return bReceived - aReceived; // newest first

    // Keep ordering deterministic across identical timestamps.
    return a.id.localeCompare(b.id);
  });
}

function filterSnoozedRows(rows: SupplierInboxRow[]): SupplierInboxRow[] {
  if (typeof window === "undefined") {
    return rows;
  }
  const snoozes = readSnoozes();
  const now = Date.now();
  return rows.filter((row) => {
    const untilIso = snoozes[row.quoteId];
    if (!untilIso) return true;
    const ms = Date.parse(untilIso);
    if (Number.isNaN(ms) || ms <= now) return true;
    return false;
  });
}

function persistSnooze(quoteId: string, snoozeUntilIso: string) {
  if (typeof window === "undefined") return;
  const id = typeof quoteId === "string" ? quoteId.trim() : "";
  if (!id) return;
  const ms = Date.parse(snoozeUntilIso);
  if (Number.isNaN(ms)) return;

  const snoozes = readSnoozes();
  snoozes[id] = snoozeUntilIso;
  writeSnoozes(snoozes);
}

function readSnoozes(): Record<string, string> {
  try {
    const raw = window.localStorage.getItem(SNOOZE_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    const now = Date.now();
    const next: Record<string, string> = {};
    if (parsed && typeof parsed === "object") {
      for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
        const quoteId = typeof key === "string" ? key.trim() : "";
        const untilIso = typeof value === "string" ? value.trim() : "";
        if (!quoteId || !untilIso) continue;
        const ms = Date.parse(untilIso);
        if (Number.isNaN(ms) || ms <= now) continue;
        next[quoteId] = untilIso;
      }
    }
    // Prune expired entries.
    window.localStorage.setItem(SNOOZE_STORAGE_KEY, JSON.stringify(next));
    return next;
  } catch {
    return {};
  }
}

function writeSnoozes(next: Record<string, string>) {
  try {
    window.localStorage.setItem(SNOOZE_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
}

