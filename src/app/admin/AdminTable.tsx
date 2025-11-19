import { createQuoteFromUpload } from "./actions";

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

interface AdminTableProps {
  uploads: UploadRow[];
}

export default function AdminTable({ uploads }: AdminTableProps) {
  return (
    <div className="mt-10 overflow-x-auto rounded-2xl border border-border bg-surface text-xs">
      <table className="min-w-full border-collapse">
        <thead>
          <tr className="border-b border-border text-[11px] uppercase tracking-wide text-muted">
            <th className="px-4 py-3 text-left font-medium">File</th>
            <th className="px-4 py-3 text-left font-medium">Contact</th>
            <th className="px-4 py-3 text-left font-medium">Company</th>
            <th className="px-4 py-3 text-left font-medium">Notes</th>
            <th className="px-4 py-3 text-left font-medium">Uploaded</th>
            <th className="px-4 py-3 text-right font-medium">Quote</th>
          </tr>
        </thead>
        <tbody>
          {uploads.length === 0 ? (
            <tr>
              <td
                colSpan={6}
                className="px-4 py-6 text-center text-[11px] text-muted"
              >
                No uploads yet. Send yourself a test file from the homepage.
              </td>
            </tr>
          ) : (
            uploads.map((row) => {
              const created = row.created_at
                ? new Date(row.created_at).toLocaleString("en-US", {
                    dateStyle: "short",
                    timeStyle: "short",
                  })
                : "";

              return (
                <tr
                  key={row.id}
                  className="border-t border-border align-top hover:bg-neutral-900/40"
                >
                  <td className="px-4 py-3">
                    <div className="font-medium text-[11px]">
                      {row.file_name ?? "Unknown file"}
                    </div>
                    <div className="text-[10px] text-muted">
                      {row.file_type ?? "application/octet-stream"}
                    </div>
                  </td>

                  <td className="px-4 py-3">
                    <div className="text-[11px]">
                      {row.contact_name ?? "—"}
                    </div>
                    <div className="text-[10px] text-muted break-all">
                      {row.contact_email ?? "—"}
                    </div>
                  </td>

                  <td className="px-4 py-3 text-[11px]">
                    {row.company ?? "—"}
                  </td>

                  <td className="px-4 py-3 text-[11px] whitespace-pre-wrap">
                    {row.notes ?? "—"}
                  </td>

                  <td className="px-4 py-3 text-[11px] whitespace-nowrap">
                    {created || "—"}
                  </td>

                  <td className="px-4 py-3 text-right">
                    <form action={createQuoteFromUpload}>
                      <input type="hidden" name="upload_id" value={row.id} />
                      <button
                        type="submit"
                        className="inline-flex items-center rounded-full border border-accent px-3 py-1 text-[11px] font-medium text-accent hover:bg-accent/10"
                      >
                        Create quote
                      </button>
                    </form>
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}