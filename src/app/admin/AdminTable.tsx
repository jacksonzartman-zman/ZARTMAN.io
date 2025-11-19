// src/app/admin/AdminTable.tsx
"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

export type UploadRow = {
  id: string;
  file_name: string | null;
  name: string | null;
  email: string | null;
  company: string | null;
  created_at: string | null;
};

interface AdminTableProps {
  uploads: UploadRow[];
}

export default function AdminTable({ uploads }: AdminTableProps) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return uploads;

    return uploads.filter((u) => {
      const statusLabel = "New"; // for now, everything is "New"

      return (
        (u.name ?? "").toLowerCase().includes(q) ||
        (u.email ?? "").toLowerCase().includes(q) ||
        (u.company ?? "").toLowerCase().includes(q) ||
        (u.file_name ?? "").toLowerCase().includes(q) ||
        statusLabel.toLowerCase().includes(q)
      );
    });
  }, [uploads, query]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by customer, email, company, file, or status..."
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            className="text-xs text-muted-foreground underline"
          >
            Clear
          </button>
        )}
      </div>

      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="min-w-full text-sm">
          <thead className="border-b border-border bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-3 text-left">Customer</th>
              <th className="px-4 py-3 text-left">Company</th>
              <th className="px-4 py-3 text-left">File</th>
              <th className="px-4 py-3 text-left">Status</th>
              <th className="px-4 py-3 text-left">Created</th>
              <th className="px-4 py-3 text-right">Open</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-6 text-center text-sm text-muted-foreground"
                >
                  No uploads match your search.
                </td>
              </tr>
            ) : (
              filtered.map((upload) => {
                const statusLabel = "New";
                const created =
                  upload.created_at &&
                  new Date(upload.created_at).toLocaleDateString();

                return (
                  <tr
                    key={upload.id}
                    className="border-b border-border/70 last:border-b-0 hover:bg-muted/40"
                  >
                    <td className="px-4 py-3 align-top">
                      <div className="flex flex-col">
                        <span className="font-medium">
                          {upload.name || "Unknown"}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {upload.email}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 align-top">
                      {upload.company || "—"}
                    </td>
                    <td className="px-4 py-3 align-top">
                      <span className="truncate max-w-[220px] inline-block">
                        {upload.file_name || "Unknown file"}
                      </span>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <span className="inline-flex items-center rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-400">
                        {statusLabel}
                      </span>
                    </td>
                    <td className="px-4 py-3 align-top">
                      {created || "—"}
                    </td>
                    <td className="px-4 py-3 align-top text-right">
                      <Link
                        href={`/admin/uploads/${upload.id}`}
                        className="text-xs font-medium text-emerald-400 hover:text-emerald-300 underline"
                      >
                        View
                      </Link>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}