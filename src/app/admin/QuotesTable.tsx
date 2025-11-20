"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

export type QuoteRow = {
  id: string;
  customerName: string;
  customerEmail: string;
  company: string;
  fileName: string;
  status: string | null;
  price: number | null;
  currency: string | null;
  targetDate: string | null;
  createdAt: string;
};

type QuotesTableProps = {
  quotes: QuoteRow[];
};

const STATUS_LABEL: Record<string, string> = {
  all: "All",
  new: "New",
  in_review: "In review",
  quoted: "Quoted",
  on_hold: "On hold",
  closed_lost: "Closed lost",
};

const STATUS_ORDER = [
  "all",
  "new",
  "in_review",
  "quoted",
  "on_hold",
  "closed_lost",
];

function formatMoney(amount: number | null, currency: string | null) {
  if (amount == null) return "—";
  const value = Number(amount);
  if (Number.isNaN(value)) return "—";
  const cur = currency || "USD";
  return `${cur} ${value.toFixed(2)}`;
}

export default function QuotesTable({ quotes }: QuotesTableProps) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();

    return quotes.filter((row) => {
      const matchesQuery =
        !q ||
        row.customerName.toLowerCase().includes(q) ||
        row.customerEmail.toLowerCase().includes(q) ||
        (row.company ?? "").toLowerCase().includes(q) ||
        (row.fileName ?? "").toLowerCase().includes(q) ||
        (row.status ?? "").toLowerCase().includes(q);

      const effectiveStatus = (row.status ?? "new").toLowerCase();
      const matchesStatus =
        statusFilter === "all" ? true : effectiveStatus === statusFilter;

      return matchesQuery && matchesStatus;
    });
  }, [quotes, query, statusFilter]);

  return (
    <>
      {/* Search + status chips */}
      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by customer, email, company, file, or status..."
          className="w-full max-w-xl rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-emerald-400 focus:outline-none focus:ring-1 focus:ring-emerald-500"
        />

        <div className="flex flex-wrap gap-2">
          {STATUS_ORDER.map((status) => {
            const active = statusFilter === status;
            return (
              <button
                key={status}
                type="button"
                onClick={() => setStatusFilter(status)}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                  active
                    ? "border-emerald-400 bg-emerald-500/10 text-emerald-300"
                    : "border-slate-700 bg-slate-900 text-slate-400 hover:border-emerald-400 hover:text-emerald-200"
                }`}
              >
                {STATUS_LABEL[status]}
              </button>
            );
          })}
        </div>
      </div>

      {/* Table */}
      <div className="mt-4 overflow-x-auto rounded-lg border border-slate-800 bg-slate-950/60">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-slate-800 bg-slate-900/60 text-xs uppercase text-slate-400">
            <tr>
              <th className="px-4 py-3">Customer</th>
              <th className="px-4 py-3">Company</th>
              <th className="px-4 py-3">File</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Price</th>
              <th className="px-4 py-3">Target date</th>
              <th className="px-4 py-3">Created</th>
              <th className="px-4 py-3 text-right">Open</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-900">
            {filtered.map((row) => (
              <tr key={row.id} className="hover:bg-slate-900/60">
                <td className="px-4 py-3 align-top">
                  <div className="flex flex-col">
                    <span className="text-sm text-slate-100">
                      {row.customerName}
                    </span>
                    {row.customerEmail && (
                      <a
                        href={`mailto:${row.customerEmail}`}
                        className="text-xs text-emerald-400 hover:underline"
                      >
                        {row.customerEmail}
                      </a>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3 align-top text-sm text-slate-200">
                  {row.company || "—"}
                </td>
                <td className="px-4 py-3 align-top text-xs text-slate-300">
                  {row.fileName}
                </td>
                <td className="px-4 py-3 align-top">
                  <span className="inline-flex rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-300">
                    {(row.status ?? "new").replace("_", " ")}
                  </span>
                </td>
                <td className="px-4 py-3 align-top text-xs text-slate-200">
                  {formatMoney(row.price, row.currency)}
                </td>
                <td className="px-4 py-3 align-top text-xs text-slate-400">
                  {row.targetDate ?? "—"}
                </td>
                <td className="px-4 py-3 align-top text-xs text-slate-400">
                  {row.createdAt}
                </td>
                <td className="px-4 py-3 align-top text-right text-xs">
                  <Link
                    href={`/admin/quotes/${row.id}`}
                    className="text-emerald-400 hover:underline"
                  >
                    View quote
                  </Link>
                </td>
              </tr>
            ))}

            {filtered.length === 0 && (
              <tr>
                <td
                  colSpan={8}
                  className="px-4 py-8 text-center text-sm text-slate-500"
                >
                  No quotes match your filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}