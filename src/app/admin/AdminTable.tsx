"use client";

import { useMemo, useState } from "react";

export type UploadRow = {
  id: string;
  file_name: string | null;
  status: string | null;
  created_at: string;
  email: string | null;
  name: string | null;
  company: string | null;
};

interface AdminTableProps {
  uploads: UploadRow[];
}

export default function AdminTable({ uploads }: AdminTableProps) {
  const [search, setSearch] = useState("");

  const normalizedSearch = search.trim().toLowerCase();

  const filteredUploads = useMemo(
    () =>
      uploads.filter((upload) => {
        if (!normalizedSearch) return true;

        const fields = [
          upload.name,
          upload.email,
          upload.company,
          upload.file_name,
          upload.status,
        ];

        return fields.some((field) =>
          field?.toString().toLowerCase().includes(normalizedSearch)
        );
      }),
    [uploads, normalizedSearch]
  );

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4 px-4 pb-16 pt-10">
      <header className="flex flex-col gap-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-emerald-400">
          Uploads dashboard
        </p>
        <p className="text-xs text-muted-foreground">
          Latest CAD uploads hitting Supabase.
        </p>
      </header>

      {/* Search bar */}
      <div className="flex items-center justify-between gap-4">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by customer, email, company, file, or status..."
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none ring-emerald-500 focus:ring-1"
        />
        {search && (
          <button
            type="button"
            onClick={() => setSearch("")}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Clear
          </button>
        )}
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="min-w-full text-left text-xs">
          <thead className="border-b border-border bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Customer</th>
              <th className="px-4 py-3">Company</th>
              <th className="px-4 py-3">File</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Created</th>
              <th className="px-4 py-3 text-right">Open</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filteredUploads.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-6 text-center text-xs text-muted-foreground"
                >
                  No uploads match your search.
                </td>
              </tr>
            ) : (
              filteredUploads.map((upload) => (
                <tr key={upload.id} className="text-sm">
                  {/* Customer */}
                  <td className="px-4 py-3">
                    <div className="flex flex-col">
                      <span className="font-medium">
                        {upload.name || "—"}
                      </span>
                      {upload.email && (
                        <span className="text-xs text-muted-foreground">
                          {upload.email}
                        </span>
                      )}
                    </div>
                  </td>

                  {/* Company */}
                  <td className="px-4 py-3 text-sm">
                    {upload.company || "—"}
                  </td>

                  {/* File */}
                  <td className="px-4 py-3 text-xs">
                    {upload.file_name || "—"}
                  </td>

                  {/* Status */}
                  <td className="px-4 py-3">
                    <span className="inline-flex rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-400">
                      {upload.status || "New"}
                    </span>
                  </td>

                  {/* Created */}
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {new Date(upload.created_at).toLocaleDateString("en-US", {
                      month: "2-digit",
                      day: "2-digit",
                      year: "numeric",
                    })}
                  </td>

                  {/* View link */}
                  <td className="px-4 py-3 text-right">
                    <a
                      href={`/admin/uploads/${upload.id}`}
                      className="text-xs font-medium text-emerald-400 hover:text-emerald-300"
                    >
                      View
                    </a>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <p className="mt-2 text-right text-[10px] uppercase tracking-wide text-muted-foreground">
        Admin view only
      </p>
    </div>
  );
}