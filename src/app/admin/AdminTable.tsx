"use client";

import Link from "next/link";

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

export default function AdminTable({ uploads }: { uploads: UploadRow[] }) {
  return (
    <div className="mt-10 w-full overflow-x-auto">
      <table className="w-full border border-border rounded-lg overflow-hidden">
        <thead className="bg-surface border-b border-border text-left text-neutral-400 text-xs uppercase tracking-wider">
          <tr>
            <th className="px-4 py-3">File</th>
            <th className="px-4 py-3">Contact</th>
            <th className="px-4 py-3">Company</th>
            <th className="px-4 py-3">Notes</th>
            <th className="px-4 py-3">Uploaded</th>
            <th className="px-4 py-3">Quote</th>
          </tr>
        </thead>

        <tbody className="divide-y divide-border bg-card">
          {uploads.length === 0 ? (
            <tr>
              <td
                colSpan={6}
                className="px-4 py-8 text-center text-neutral-500 text-sm"
              >
                No uploads found.
              </td>
            </tr>
          ) : (
            uploads.map((row) => (
              <tr key={row.id} className="hover:bg-surface/40 transition">
                <td className="px-4 py-3 whitespace-nowrap">
                  <div className="font-medium text-neutral-200">
                    {row.file_name}
                  </div>
                  <div className="text-xs text-neutral-500">
                    {row.file_type}
                  </div>
                </td>

                <td className="px-4 py-3 whitespace-nowrap text-sm">
                  <div className="text-neutral-200">{row.contact_name}</div>
                  <a
                    href={`mailto:${row.contact_email}`}
                    className="text-xs text-accent hover:underline"
                  >
                    {row.contact_email}
                  </a>
                </td>

                <td className="px-4 py-3 text-sm text-neutral-300">
                  {row.company}
                </td>

                <td className="px-4 py-3 text-sm text-neutral-300">
                  {row.notes}
                </td>

                <td className="px-4 py-3 whitespace-nowrap text-sm text-neutral-400">
                  {row.created_at
                    ? new Date(row.created_at).toLocaleString()
                    : "—"}
                </td>

                {/* CREATE QUOTE BUTTON */}
                <td className="px-4 py-3 text-sm">
                  <Link
                    href={`/admin/quotes/${row.id}`}
                    className="inline-flex items-center justify-center px-3 py-1 rounded-full 
                               bg-accent text-black font-medium text-xs hover:bg-accent/80 transition"
                  >
                    Create quote
                  </Link>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}