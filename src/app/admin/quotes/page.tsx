// src/app/admin/quotes/page.tsx
import { supabaseServer } from "@/lib/supabaseServer";
import QuotesTable from "../QuotesTable";
import { UploadStatus } from "../constants";
import StatusFilterChips from "../StatusFilterChips";

export const dynamic = "force-dynamic";

export default async function QuotesPage({ searchParams }: any) {
  const supabase = supabaseServer;

  // Read filters from the URL
  const statusFilter = (searchParams?.status as string | undefined) ?? "all";
  const search = (searchParams?.search as string | undefined) ?? "";

  // 1) Load all quotes joined with upload/customer info
  const { data, error } = await supabase
    .from("quotes_with_uploads")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Error loading quotes_with_uploads", error);
    return (
      <main className="mx-auto max-w-5xl px-4 py-10">
        <p className="text-sm text-red-400">
          Failed to load quotes dashboard: {error.message}
        </p>
      </main>
    );
  }

  // 2) Shape into the rows that <QuotesTable /> expects
  const rows =
    (data ?? []).map((row: any) => ({
      id: row.id,
      customerName: row.customer_name ?? "Unknown",
      customerEmail: row.customer_email ?? "",
      company: row.company ?? "",
      fileName: row.file_name ?? "",
      status: row.status as UploadStatus,
      price: row.price,
      currency: row.currency,
      targetDate: row.target_date,
      createdAt: row.created_at,
      uploadId: row.upload_id,
    })) ?? [];

  // 3) Apply status + search filters in memory
  let filtered = rows;

  if (statusFilter !== "all") {
    const target = statusFilter.toLowerCase();
    filtered = filtered.filter(
      (row) => row.status && row.status.toLowerCase() === target
    );
  }

  if (search.trim() !== "") {
    const q = search.trim().toLowerCase();
    filtered = filtered.filter((row) => {
      const fields = [
        row.customerName,
        row.customerEmail,
        row.company,
        row.fileName,
        row.status,
      ];
      return fields.some((value) =>
        (value ?? "").toString().toLowerCase().includes(q)
      );
    });
  }

  // 4) Render header + chips + search + table
  return (
  <main className="mx-auto max-w-6xl px-4 py-10 space-y-8">
    <header>
      <h1 className="text-2xl font-semibold">Quotes</h1>
      <p className="mt-1 text-sm text-slate-400">
        Recent quotes created from uploads.
      </p>
    </header>

    {/* Filters + search aligned like uploads dashboard */}
    <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
      <StatusFilterChips
        currentStatus={statusFilter}
        basePath="/admin/quotes"
      />

      <form method="get" className="w-full md:w-80">
        {/* preserve the current status filter when searching */}
        {statusFilter && (
          <input type="hidden" name="status" value={statusFilter} />
        )}
        <input
          type="text"
          name="search"
          defaultValue={search}
          placeholder="Search by customer, email, company, file..."
          className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm outline-none focus:border-emerald-400"
        />
      </form>
    </div>

    <QuotesTable quotes={rows} />
  </main>
);
}