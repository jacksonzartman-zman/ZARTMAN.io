// src/app/admin/AdminTable.tsx
"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

export type UploadRow = {
  id: string;
  customerName: string;
  customerEmail: string;
  company: string;
  fileName: string;
  status: string;
  createdAt: string;
};

export type AdminTableProps = {
  uploads: UploadRow[];
};

export default function AdminTable({ uploads }: AdminTableProps) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return uploads;

    return uploads.filter((u) =>
      (u.customerName ?? "").toLowerCase().includes(q) ||
      (u.customerEmail ?? "").toLowerCase().includes(q) ||
      (u.company ?? "").toLowerCase().includes(q) ||
      (u.fileName ?? "").toLowerCase().includes(q) ||
      (u.status ?? "").toLowerCase().includes(q)
    );
  }, [uploads, query]);

  return (
    <div className="space-y-4">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search by customer, email, company, file, or status..."
        className="w-full rounded-md border border-slate-700 bg-black px-3 py-2 text-sm text-slate-100 outline-none focus:border-emerald-400"
      />

      <div className="overflow-hidden rounded-xl border border-slate-800 bg-[#05070b]">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-slate-800 bg-slate-950/60 text-xs uppercase tracking-wide text-slate-400">
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
            {filtered.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-6 text-center text-sm text-slate-500"
                >
                  No quotes match your search.
                </td>
              </tr>
            ) : (
              filtered.map((upload) => (
                <tr
                  key={upload.id}
                  className="border-t border-slate-900/60 hover:bg-slate-900/40"
                >
                  <td className="px-4 py-3 align-top">
                    <div className="flex flex-col">
                      <span className="text-sm font-medium text-slate-50">
                        {upload.customerName}
                      </span>
                      {upload.customerEmail && (
                        <a
                          href={`mailto:${upload.customerEmail}`}
                          className="text-xs text-emerald-400 hover:underline"
                        >
                          {upload.customerEmail}
                        </a>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 align-top text-sm text-slate-200">
                    {upload.company || "—"}
                  </td>
                  <td className="px-4 py-3 align-top text-xs text-slate-300">
                    {upload.fileName || "—"}
                  </td>
                  <td className="px-4 py-3 align-top">
                    <span className="inline-flex rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-300">
                      {upload.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 align-top text-xs text-slate-400">
                    {new Date(upload.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 align-top text-right text-xs">
                    <Link
                      href={`/admin/uploads/${upload.id}`}
                      className="font-medium text-emerald-300 hover:text-emerald-200 hover:underline"
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