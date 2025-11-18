"use client";

import { useMemo, useState } from "react";

type UploadRow = {
  id: string;
  file_name: string | null;
  file_path: string | null;
  file_type: string | null;
  contact_name: string | null;
  contact_email: string | null;
  company: string | null;
  notes: string | null;
  created_at: string | null;
};

type AdminTableProps = {
  uploads: UploadRow[];
};

export default function AdminTable({ uploads }: AdminTableProps) {
  const [query, setQuery] = useState("");

  const filteredUploads = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return uploads;

    return uploads.filter((row) => {
      const fields = [
        row.file_name,
        row.file_type,
        row.contact_name,
        row.contact_email,
        row.company,
        row.notes,
      ];

      return fields.some((value) =>
        value ? value.toLowerCase().includes(q) : false
      );
    });
  }, [query, uploads]);

  const total = uploads.length;
  const shown = filteredUploads.length;

  return (
    <section className="mx-auto w-full max-w-5xl">
      <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold">Uploads dashboard</h1>
          <p className="text-xs text-muted">
            Latest CAD uploads hitting Supabase.
          </p>
        </div>

        <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:gap-3">
          <div className="text-[11px] text-muted text-right sm:text-left">
            <span className="block">Admin view only</span>
            <span className="block">
              Showing {shown} of {total}
            </span>
          </div>

          <input
            type="text"
            placeholder="Search file, contact, company…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full rounded-full border border-border bg-input px-3 py-2 text-xs text-ink outline-none focus:border-accent focus:ring-1 focus:ring-accent sm:w-56"
          />
        </div>
      </header>

      <div className="overflow-x-auto rounded-3xl border border-border bg-surface/60">
        <table className="min-w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-border bg-surface/80">
              <th className="px-4 py-3 text-[11px] font-medium">File</th>
              <th className="px-4 py-3 text-[11px] font-medium">Contact</th>
              <th className="px-4 py-3 text-[11px] font-medium">Company</th>
              <th className="px-4 py-3 text-[11px] font-medium">Notes</th>
              <th className="px-4 py-3 text-[11px] font-medium">
                Uploaded at
              </th>
            </tr>
          </thead>
          <tbody>
            {filteredUploads.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  className="px-4 py-8 text-center text-xs text-muted"
                >
                  No uploads match this search.
                </td>
              </tr>
            ) : (
              filteredUploads.map((row) => {
                const publicUrl =
                  row.file_path && process.env.NEXT_PUBLIC_SUPABASE_URL
                    ? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${row.file_path}`
                    : null;

                return (
                  <tr
                    key={row.id}
                    className="border-t border-border/60 hover:bg-surface/40"
                  >
                    {/* File column */}
                    <td className="px-4 py-3 align-top">
                      <div className="flex flex-col gap-0.5">
                        {publicUrl ? (
                          <a
                            href={publicUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="font-medium text-[11px] underline-offset-2 hover:underline"
                          >
                            {row.file_name ?? "—"}
                          </a>
                        ) : (
                          <span className="font-medium text-[11px]">
                            {row.file_name ?? "—"}
                          </span>
                        )}
                        <span className="text-[10px] text-muted">
                          {row.file_type ?? "unknown type"}
                        </span>
                      </div>
                    </td>

                    {/* Contact column */}
                    <td className="px-4 py-3 align-top">
                      <div className="flex flex-col gap-0.5">
                        <span className="text-[11px]">
                          {row.contact_name ?? "—"}
                        </span>
                        {row.contact_email ? (
                          <a
                            href={`mailto:${row.contact_email}`}
                            className="text-[10px] text-muted underline-offset-2 hover:underline"
                          >
                            {row.contact_email}
                          </a>
                        ) : (
                          <span className="text-[10px] text-muted"></span>
                        )}
                      </div>
                    </td>

                    {/* Company column */}
                    <td className="px-4 py-3 align-top text-[11px]">
                      {row.company ?? "—"}
                    </td>

                    {/* Notes column */}
                    <td className="px-4 py-3 align-top text-[11px] max-w-xs">
                      <span className="text-muted">
                        {row.notes ?? "—"}
                      </span>
                    </td>

                    {/* Timestamp column */}
                    <td className="px-4 py-3 align-top text-[10px] text-muted whitespace-nowrap">
                      {row.created_at
                        ? new Date(row.created_at).toLocaleString()
                        : "—"}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}