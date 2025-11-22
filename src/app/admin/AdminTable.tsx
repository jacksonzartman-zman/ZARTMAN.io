// src/app/admin/AdminTable.tsx
import Link from "next/link";
import { formatDateTime } from "@/lib/formatDate";
import { UPLOAD_STATUS_LABELS, type UploadStatus } from "./constants";
import CreateQuoteButton from "./CreateQuoteButton";

export type InboxRow = {
  id: string;
  quoteId: string | null;
  createdAt: string | null;
  company: string | null;
  contactName: string;
  contactEmail: string | null;
  manufacturingProcess: string | null;
  quantity: string | null;
  status: UploadStatus;
};

type AdminTableProps = {
  rows: InboxRow[];
  hasActiveFilters: boolean;
};

const columnClasses = "px-4 py-3 align-top text-sm";

export default function AdminTable({
  rows,
  hasActiveFilters,
}: AdminTableProps) {
  const isEmpty = rows.length === 0;
  const statusPillClass =
    "inline-flex items-center rounded-full border border-transparent px-3 py-1 text-xs font-semibold";

  const emptyHeadline = hasActiveFilters
    ? "No RFQs match your filters yet."
    : "No RFQs yet.";
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-950/50 shadow-sm">
      <table className="min-w-full text-left text-sm">
        <thead className="border-b border-slate-800 bg-slate-900/60 text-xs font-semibold uppercase tracking-wide text-slate-400">
          <tr>
            <th className="px-4 py-3">Created</th>
            <th className="px-4 py-3">Company</th>
            <th className="px-4 py-3">Contact</th>
            <th className="px-4 py-3">Process</th>
            <th className="px-4 py-3">Quantity / volumes</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3 text-right">Details</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-900/70">
          {isEmpty ? (
            <tr>
              <td
                colSpan={7}
                className="px-6 py-12 text-center text-base text-slate-300"
              >
                <p className="font-medium text-slate-100">{emptyHeadline}</p>
                <p className="mt-2 text-sm text-slate-400">
                  Need to test the flow?{" "}
                  <Link
                    href="/quote"
                    className="font-semibold text-emerald-300 hover:text-emerald-200"
                  >
                    Submit a new RFQ
                  </Link>{" "}
                  from the public intake form.
                </p>
              </td>
            </tr>
          ) : (
            rows.map((row) => {
              const href = row.quoteId
                ? `/admin/quotes/${row.quoteId}`
                : `/admin/uploads/${row.id}`;

              return (
                <tr
                  key={row.id}
                  className="bg-slate-950/40 transition hover:bg-slate-900/40"
                >
                  <td className={`${columnClasses} text-slate-400`}>
                    {formatDateTime(row.createdAt, { includeTime: true }) ?? "—"}
                  </td>
                  <td className={`${columnClasses} text-slate-100`}>
                    {row.company || "—"}
                  </td>
                  <td className={`${columnClasses} text-slate-100`}>
                    <div className="flex flex-col">
                      <Link
                        href={href}
                        className="text-sm font-medium text-emerald-100 hover:text-emerald-300"
                      >
                        {row.contactName}
                      </Link>
                      {row.contactEmail && (
                        <a
                          href={`mailto:${row.contactEmail}`}
                          className="text-xs text-slate-400 hover:text-emerald-200"
                        >
                          {row.contactEmail}
                        </a>
                      )}
                    </div>
                  </td>
                  <td className={`${columnClasses} text-slate-200`}>
                    {row.manufacturingProcess || "—"}
                  </td>
                  <td className={`${columnClasses} text-slate-200`}>
                    {row.quantity || "—"}
                  </td>
                  <td className={`${columnClasses}`}>
                    <span className={`${statusPillClass} bg-emerald-500/10 text-emerald-200`}>
                      {UPLOAD_STATUS_LABELS[row.status]}
                    </span>
                  </td>
                    <td className={`${columnClasses} text-right`}>
                      {row.quoteId ? (
                        <Link
                          href={href}
                          className="text-sm font-semibold text-emerald-300 hover:text-emerald-200"
                        >
                          Open quote
                        </Link>
                      ) : (
                        <CreateQuoteButton
                          uploadId={row.id}
                          size="sm"
                          align="end"
                        />
                      )}
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
