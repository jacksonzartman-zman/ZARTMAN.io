// src/app/admin/quotes/page.tsx
import { supabaseServer } from "@/lib/supabaseServer";
import StatusFilterChips from "../StatusFilterChips";
import type { UploadStatus } from "../constants";

export const dynamic = "force-dynamic";

type QuoteStatus = UploadStatus;

type QuoteRow = {
  id: string;
  customerName: string;
  customerEmail: string;
  company: string;
  fileName: string;
  status: QuoteStatus;
  price: number | null;
  currency: string | null;
  targetDate: string | null;
  createdAt: string;
};

type StatusFilter = QuoteStatus | "all";

export default async function QuotesPage({ searchParams }: any) {
  const search = (searchParams?.search as string | undefined) ?? "";
  const statusFilter = (searchParams?.statusFilter as StatusFilter | undefined) ?? "all";

  const supabase = supabaseServer;

  const { data, error } = await supabase
    .from("quotes_with_uploads")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    console.error("Error loading quotes for admin:", error);
    return (
      <main className="mx-auto max-w-5xl px-4 py-10">
        <p className="text-sm text-red-400">
          Failed to load quotes dashboard: {error.message}
        </p>
      </main>
    );
  }

  const rows: QuoteRow[] =
    data?.map((row: any) => ({
      id: row.id,
      customerName: row.customer_name ?? "Unknown",
      customerEmail: row.customer_email ?? "",
      company: row.company_name ?? "",
      fileName: row.file_name ?? "",
      status: (row.status ?? "new") as QuoteStatus,
      price: row.price,
      currency: row.currency,
      targetDate: row.target_date,
      createdAt: row.created_at,
    })) ?? [];

  const normalizedSearch = search.trim().toLowerCase();

  let filteredRows = rows;

  if (normalizedSearch) {
    filteredRows = filteredRows.filter((row) => {
      const haystack = [
        row.customerName,
        row.customerEmail,
        row.company,
        row.fileName,
        row.status,
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(normalizedSearch);
    });
  }

  if (statusFilter !== "all") {
    filteredRows = filteredRows.filter((row) => row.status === statusFilter);
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-10 space-y-6">
      <header>
        <h1 className="mb-1 text-2xl font-semibold">Quotes</h1>
        <p className="text-sm text-slate-400">
          Recent quotes created from uploads.
        </p>
      </header>

      {/* Filters + search aligned like uploads dashboard */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <StatusFilterChips
          currentStatus={statusFilter}
          basePath="/admin/quotes"
        />

        <form className="w-full md:w-72" method="get">
          {/* Preserve status filter when searching */}
          {statusFilter !== "all" && (
            <input
              type="hidden"
              name="statusFilter"
              value={statusFilter}
            />
          )}
          <input
            type="search"
            name="search"
            defaultValue={search}
            placeholder="Search by customer, email, company, file, or status..."
            className="w-full rounded-md border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm outline-none focus:border-emerald-400"
          />
        </form>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-800 bg-slate-950/40">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-slate-800 bg-slate-950/60">
            <tr>
              <th className="px-4 py-3 font-medium text-slate-300">Customer</th>
              <th className="px-4 py-3 font-medium text-slate-300">Company</th>
              <th className="px-4 py-3 font-medium text-slate-300">File</th>
              <th className="px-4 py-3 font-medium text-slate-300">Status</th>
              <th className="px-4 py-3 font-medium text-slate-300">Price</th>
              <th className="px-4 py-3 font-medium text-slate-300">
                Target date
              </th>
              <th className="px-4 py-3 font-medium text-slate-300">Created</th>
              <th className="px-4 py-3 font-medium text-slate-300">Open</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((row) => (
              <tr
                key={row.id}
                className="border-t border-slate-900/80 hover:bg-slate-900/40"
              >
                <td className="px-4 py-3 align-top">
                  <div className="text-sm font-medium text-emerald-200">
                    {row.customerName}
                  </div>
                  {row.customerEmail && (
                    <div className="text-xs text-emerald-400">
                      {row.customerEmail}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 align-top text-slate-200">
                  {row.company}
                </td>
                <td className="px-4 py-3 align-top text-slate-200">
                  <div className="max-w-xs truncate">{row.fileName}</div>
                </td>
                <td className="px-4 py-3 align-top">
                  <span className="inline-flex rounded-full bg-slate-900 px-2 py-1 text-xs font-medium capitalize text-emerald-300">
                    {row.status.replace("_", " ")}
                  </span>
                </td>
                <td className="px-4 py-3 align-top text-slate-200">
                  {row.price != null && row.currency ? (
                    <>
                      {row.currency} {row.price.toFixed(2)}
                    </>
                  ) : (
                    <span className="text-slate-500">—</span>
                  )}
                </td>
                <td className="px-4 py-3 align-top text-slate-200">
                  {row.targetDate ? (
                    new Date(row.targetDate).toLocaleDateString()
                  ) : (
                    <span className="text-slate-500">—</span>
                  )}
                </td>
                <td className="px-4 py-3 align-top text-slate-200">
                  {new Date(row.createdAt).toLocaleDateString()}
                </td>
                <td className="px-4 py-3 align-top">
                  <a
                    href={`/admin/quotes/${row.id}`}
                    className="text-xs font-medium text-emerald-400 hover:underline"
                  >
                    View quote
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}