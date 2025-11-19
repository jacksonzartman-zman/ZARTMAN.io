// src/app/admin/quotes/AdminTable.tsx
"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

type AdminTableProps = {
  // We keep this loose so it works with whatever shape
  // your /api/quotes endpoint is returning right now.
  quotes: any[];
};

export default function AdminTable({ quotes }: AdminTableProps) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return quotes;

    return quotes.filter((row) => {
      const customerName =
        row.customer_name ??
        row.customer?.name ??
        row.name ??
        "";
      const customerEmail =
        row.customer_email ??
        row.customer?.email ??
        row.email ??
        "";
      const company =
        row.company ??
        row.customer?.company ??
        row.company_name ??
        "";
      const fileName =
        row.file_name ??
        row.upload?.file_name ??
        row.file?.name ??
        "";
      const status =
        row.status ?? row.quote_status ?? "";

      const haystack = [
        customerName,
        customerEmail,
        company,
        fileName,
        status,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return haystack.includes(q);
    });
  }, [quotes, search]);

  return (
    <div className="space-y-4">
      {/* Search bar */}
      <div className="flex items-center justify-between gap-4">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by customer, email, company, file, or status…"
          className="w-full max-w-md rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
        />
        {search ? (
          <button
            type="button"
            onClick={() => setSearch("")}
            className="text-xs text-zinc-400 hover:text-zinc-200"
          >
            Clear
          </button>
        ) : null}
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-950">
        <table className="min-w-full text-sm">
          <thead className="border-b border-zinc-800 bg-zinc-900/60">
            <tr className="text-xs uppercase tracking-wide text-zinc-400">
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
                  className="px-4 py-8 text-center text-sm text-zinc-500"
                >
                  {search
                    ? "No quotes match your search."
                    : "No quotes yet. Upload a CAD file to create the first one."}
                </td>
              </tr>
            ) : (
              filtered.map((row) => {
                const id = row.id;

                const customerName =
                  row.customer_name ??
                  row.customer?.name ??
                  row.name ??
                  "—";
                const customerEmail =
                  row.customer_email ??
                  row.customer?.email ??
                  row.email ??
                  "";
                const company =
                  row.company ??
                  row.customer?.company ??
                  row.company_name ??
                  "—";
                const fileName =
                  row.file_name ??
                  row.upload?.file_name ??
                  row.file?.name ??
                  "—";
                const status =
                  row.status ?? row.quote_status ?? "New";
                const createdAtRaw =
                  row.created_at ??
                  row.upload?.created_at ??
                  row.quote_created_at ??
                  null;

                const createdAt =
                  createdAtRaw
                    ? new Date(createdAtRaw).toLocaleDateString()
                    : "—";

                return (
                  <tr
                    key={id}
                    className="border-b border-zinc-800/80 hover:bg-zinc-900/60"
                  >
                    <td className="px-4 py-3 align-top text-zinc-100">
                      <div className="flex flex-col">
                        <span className="font-medium">
                          {customerName}
                        </span>
                        {customerEmail && (
                          <span className="text-xs text-zinc-400">
                            {customerEmail}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 align-top text-zinc-200">
                      {company}
                    </td>
                    <td className="px-4 py-3 align-top text-zinc-200">
                      <span className="line-clamp-2 break-all text-xs">
                        {fileName}
                      </span>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <span className="inline-flex rounded-full bg-zinc-800 px-2 py-1 text-xs capitalize text-zinc-100">
                        {status.toLowerCase()}
                      </span>
                    </td>
                    <td className="px-4 py-3 align-top text-zinc-300">
                      {createdAt}
                    </td>
                    <td className="px-4 py-3 align-top text-right">
                      <Link
                        href={`/admin/quotes/${id}`}
                        className="text-xs font-medium text-emerald-400 hover:text-emerald-300"
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