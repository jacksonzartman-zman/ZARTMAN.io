 "use client";

import Link from "next/link";
import clsx from "clsx";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AdminTableShell, { adminTableCellClass } from "@/app/admin/AdminTableShell";
import { ctaSizeClasses, primaryCtaClasses } from "@/lib/ctas";
import { formatDateTime } from "@/lib/formatDate";
import { formatRelativeTimeFromTimestamp, toTimestamp } from "@/lib/relativeTime";
import type { SupplierInboxRow } from "./SupplierInboxTable";

type NewRfqsTableProps = {
  rows: SupplierInboxRow[];
};

export default function NewRfqsTable({ rows }: NewRfqsTableProps) {
  const router = useRouter();
  const [items, setItems] = useState<SupplierInboxRow[]>(() => rows);
  const [pendingIds, setPendingIds] = useState<Set<string>>(() => new Set());
  const [errorById, setErrorById] = useState<Record<string, string>>({});

  useEffect(() => {
    setItems(rows);
  }, [rows]);

  if (items.length === 0) {
    return null;
  }

  return (
    <AdminTableShell
      head={
        <tr>
          <th className="px-5 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">
            Files
          </th>
          <th className="px-5 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">
            Process
          </th>
          <th className="px-5 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">
            Qty
          </th>
          <th className="px-5 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">
            Need-by
          </th>
          <th className="px-5 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">
            Received
          </th>
          <th className="px-5 py-4 text-right text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">
            Action
          </th>
        </tr>
      }
      body={items.map((row) => {
        const href = `/supplier/quotes/${row.quoteId}`;
        const fileCount = Math.max(0, row.fileCount ?? 0);
        const fileNames = Array.isArray(row.fileNames) ? row.fileNames : [];
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
        const receivedLabel =
          formatRelativeTimeFromTimestamp(toTimestamp(row.createdAt)) ?? "—";
        const pending = pendingIds.has(row.id);
        const error = errorById[row.id];

        return (
          <tr key={row.id} className="bg-slate-950/40 transition hover:bg-slate-900/40">
            <td className={clsx(adminTableCellClass, "px-5 py-4")}>
              <Link
                href={href}
                className="block font-semibold text-white underline-offset-4 hover:underline"
                title={filesTitle}
              >
                {filesLabel}
              </Link>
              <p className="mt-1 text-xs text-slate-400">
                {fileCount > 0 ? `${fileCount} file${fileCount === 1 ? "" : "s"}` : "Files pending"}
              </p>
            </td>
            <td className={clsx(adminTableCellClass, "px-5 py-4 text-slate-200")}>{processLabel}</td>
            <td className={clsx(adminTableCellClass, "px-5 py-4 text-slate-200")}>{quantityLabel}</td>
            <td className={clsx(adminTableCellClass, "px-5 py-4 text-slate-200")}>{needByLabel}</td>
            <td className={clsx(adminTableCellClass, "px-5 py-4 text-slate-400")}>{receivedLabel}</td>
            <td className={clsx(adminTableCellClass, "px-5 py-4 text-right")}>
              <div className="flex flex-col items-end gap-2">
                <Link
                  href={href}
                  className={clsx(
                    primaryCtaClasses,
                    ctaSizeClasses.sm,
                    "inline-flex min-w-[9rem] justify-center",
                    pending ? "pointer-events-none opacity-60" : "",
                  )}
                >
                  Submit offer
                </Link>
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
                      const res = await fetch(`/api/supplier/rfqs/${row.quoteId}/decline`, {
                        method: "POST",
                      });
                      const payload = (await res.json().catch(() => null)) as any;
                      if (!res.ok || !payload?.ok) {
                        const errorCode =
                          typeof payload?.error === "string" && payload.error
                            ? payload.error
                            : "unknown";
                        throw new Error(errorCode);
                      }

                      // Optimistically remove from the current list.
                      setItems((prev) => prev.filter((candidate) => candidate.id !== row.id));
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
                    "rounded-full border border-slate-800 bg-slate-950/60 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-200 transition hover:border-slate-600 hover:text-white",
                    pending ? "opacity-60" : "",
                  )}
                >
                  {pending ? "Declining..." : "Not a fit"}
                </button>
                {error ? (
                  <p className="max-w-[12rem] text-right text-xs text-red-300" role="alert">
                    {error}
                  </p>
                ) : null}
              </div>
            </td>
          </tr>
        );
      })}
    />
  );
}

