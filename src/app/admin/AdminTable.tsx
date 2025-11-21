// src/app/admin/AdminTable.tsx
"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { formatDateTime } from "@/lib/formatDate";
import {
  UPLOAD_STATUS_LABELS,
  UPLOAD_STATUS_OPTIONS,
  type UploadStatus,
} from "./constants";

export type UploadRow = {
  id: string;
  customerName: string;
  customerEmail: string;
  company: string;
  fileName: string;
  status: UploadStatus;
  createdAt: string;
};

type AdminTableProps = {
  uploads: UploadRow[];
};

const STATUS_FILTERS: (UploadStatus | "all")[] = [
  "all",
  ...UPLOAD_STATUS_OPTIONS,
];

export default function AdminTable({ uploads }: AdminTableProps) {
  const [filterStatus, setFilterStatus] = useState<UploadStatus | "all">("all");
  const [search, setSearch] = useState("");

  const filteredUploads = useMemo(() => {
    const query = search.trim().toLowerCase();

    return uploads.filter((row) => {
      const matchesStatus =
        filterStatus === "all" ? true : row.status === filterStatus;

      if (!query) return matchesStatus;

      const haystack =
        `${row.customerName} ${row.customerEmail} ${row.company} ${row.fileName} ${row.status}`
          .toLowerCase()
          .replace(/\s+/g, " ");

      return matchesStatus && haystack.includes(query);
    });
  }, [uploads, filterStatus, search]);
  const emptyStateMessage =
    uploads.length === 0
      ? "No uploads yet. Once customers upload files, they’ll appear here."
      : "No uploads match your filters. Try clearing search or choosing a different status.";

  return (
    <div className="space-y-4">
      {/* Filters + search */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2">
          {STATUS_FILTERS.map((status) => {
            const isActive = filterStatus === status;
            const label =
              status === "all" ? "All" : UPLOAD_STATUS_LABELS[status];

            return (
              <button
                key={status}
                type="button"
                onClick={() =>
                  setFilterStatus(status === "all" ? "all" : status)
                }
                className={[
                  "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                  isActive
                    ? "border-emerald-400 bg-emerald-500/10 text-emerald-200"
                    : "border-slate-700 text-slate-300 hover:border-emerald-400 hover:text-emerald-200",
                ].join(" ")}
              >
                {label}
              </button>
            );
          })}
        </div>

        <div className="w-full sm:w-80">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by customer, email, company, file, or status..."
            className="w-full rounded-md border border-slate-700 bg-black px-3 py-2 text-sm outline-none focus:border-emerald-400"
          />
        </div>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-950/40">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-slate-900/60 text-xs uppercase tracking-wide text-slate-400">
            <tr>
              <th className="px-4 py-3">Customer</th>
              <th className="px-4 py-3">Company</th>
              <th className="px-4 py-3">File</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Created</th>
              <th className="px-4 py-3 text-right">Open</th>
            </tr>
          </thead>
          <tbody>
            {filteredUploads.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-6 text-center text-sm text-slate-500"
                >
                  {emptyStateMessage}
                </td>
              </tr>
            ) : (
              filteredUploads.map((row) => (
                <tr
                  key={row.id}
                  className="border-t border-slate-900/60 odd:bg-slate-950/40 even:bg-slate-950/20"
                >
                  <td className="px-4 py-3 align-top">
                    <div className="flex flex-col">
                      <Link
                        href={`/admin/uploads/${row.id}`}
                        className="font-medium text-slate-50 hover:text-emerald-300"
                      >
                        {row.customerName}
                      </Link>
                      <span className="text-xs text-emerald-400">
                        {row.customerEmail}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 align-top text-slate-200">
                    {row.company || "—"}
                  </td>
                  <td className="px-4 py-3 align-top text-slate-300">
                    {row.fileName}
                  </td>
                  <td className="px-4 py-3 align-top">
                    <span className="inline-flex rounded-full bg-slate-900 px-2 py-1 text-xs font-medium text-emerald-300">
                      {UPLOAD_STATUS_LABELS[row.status]}
                    </span>
                  </td>
                  <td className="px-4 py-3 align-top text-slate-300">
                    {formatDateTime(row.createdAt, { includeTime: true })}
                  </td>
                  <td className="px-4 py-3 align-top text-right">
                    <Link
                      href={`/admin/uploads/${row.id}`}
                      className="text-sm font-medium text-emerald-300 hover:text-emerald-200"
                    >
                      View
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
