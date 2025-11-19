"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

export type UploadRow = {
  id: string;
  customerName: string;
  customerEmail: string;
  company: string;
  fileName: string;
  status: string;
  createdAt: string | null;
};

type AdminTableProps = {
  uploads: UploadRow[];
};

export default function AdminTable({ uploads }: AdminTableProps) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return uploads;

    return uploads.filter((u) => {
      const name = u.customerName?.toLowerCase() ?? "";
      const email = u.customerEmail?.toLowerCase() ?? "";
      const company = u.company?.toLowerCase() ?? "";
      const fileName = u.fileName?.toLowerCase() ?? "";
      const status = u.status?.toLowerCase() ?? "";

      return (
        name.includes(q) ||
        email.includes(q) ||
        company.includes(q) ||
        fileName.includes(q) ||
        status.includes(q)
      );
    });
  }, [uploads, query]);

  return (
    <div className="space-y-4">
      {/* Search box */}
      <div>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by customer, email, company, file, or status..."
          className="w-full rounded-md border border-emerald-700/40 bg-zinc-900/60 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
        />
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-950/40">
        <table className="min-w-full divide-y divide-zinc-800 text-sm">
          <thead className="bg-zinc-950/70">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-zinc-400">
                Customer
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-zinc-400">
                Company
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-zinc-400">
                File
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-zinc-400">
                Status
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-zinc-400">
                Created
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wide text-zinc-400">
                Open
              </th>
            </tr>
          </thead>

          <tbody className="divide-y divide-zinc-800">
            {filtered.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-6 text-center text-sm text-zinc-500"
                >
                  No uploads match your search.
                </td>
              </tr>
            ) : (
              filtered.map((upload) => (
                <tr key={upload.id} className="hover:bg-zinc-900/40">
                  <td className="px-4 py-3 align-middle text-sm text-zinc-200">
                    <div className="flex flex-col">
                      <span className="font-medium">
                        {upload.customerName}
                      </span>
                      {upload.customerEmail && (
                        <span className="text-xs text-zinc-400">
                          {upload.customerEmail}
                        </span>
                      )}
                    </div>
                  </td>

                  <td className="px-4 py-3 align-middle text-sm text-zinc-200">
                    {upload.company || "—"}
                  </td>

                  <td className="px-4 py-3 align-middle text-sm text-zinc-200">
                    {upload.fileName}
                  </td>

                  <td className="px-4 py-3 align-middle text-sm">
                    <span className="inline-flex rounded-full bg-emerald-900/40 px-2 py-0.5 text-xs text-emerald-300">
                      {upload.status}
                    </span>
                  </td>

                  <td className="px-4 py-3 align-middle text-sm text-zinc-400">
                    {upload.createdAt
                      ? new Date(upload.createdAt).toLocaleDateString()
                      : "Unknown"}
                  </td>

                  <td className="px-4 py-3 align-middle text-right text-sm">
                    <Link
                      href={`/admin/uploads/${upload.id}`}
                      className="text-xs font-medium text-emerald-400 hover:text-emerald-300"
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