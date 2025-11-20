// src/app/admin/quotes/page.tsx
// @ts-nocheck

import { supabaseServer } from "@/lib/supabaseServer";
import QuotesTable from "../QuotesTable";
import { UploadStatus } from "../constants";
import StatusFilterChips from "../StatusFilterChips";

export const dynamic = "force-dynamic";

export default async function QuotesPage({ searchParams }: any) {
  // 1) Read filters from URL
  const statusFilter = (searchParams?.status as string | undefined) ?? "all";
  const searchTerm = (searchParams?.search as string | undefined) ?? "";

  // 2) Load quotes (joined to uploads) from the Supabase view
  const { data, error } = await supabaseServer
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

  const rows =
    data?.map((row: any) => ({
      id: row.id,
      customerName: row.customer_name ?? "Unknown",
      customerEmail: row.customer_email ?? "",
      company: row.company ?? "",
      fileName: row.file_name ?? "",
      status: (row.status ?? "new") as UploadStatus,
      price: row.price,
      currency: row.currency,
      targetDate: row.target_date,
      createdAt: row.created_at,
    })) ?? [];

  // 3) Apply filters in memory
  let filtered = rows;

  if (statusFilter !== "all") {
    const statusLower = statusFilter.toLowerCase();
    filtered = filtered.filter(
      (row: any) => String(row.status).toLowerCase() === statusLower
    );
  }

  if (searchTerm.trim() !== "") {
    const q = searchTerm.trim().toLowerCase();
    const fields = [
      "customerName",
      "customerEmail",
      "company",
      "fileName",
      "status",
    ];
    filtered = filtered.filter((row: any) =>
      fields.some((field) =>
        String(row[field] ?? "").toLowerCase().includes(q)
      )
    );
  }

  const rowsToShow = filtered;

  // 4) Render header + chips + search + table (single set of controls)
  return (
    <main className="mx-auto max-w-5xl px-4 py-10 space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">Quotes</h1>
        <p className="text-sm text-slate-400">
          Recent quotes created from uploads.
        </p>
      </header>

      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <StatusFilterChips
          currentStatus={statusFilter}
          basePath="/admin/quotes"
        />
        <form>
          <input
            type="text"
            name="search"
            defaultValue={searchTerm}
            placeholder="Search by customer, email, company, file, or status..."
            className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm outline-none focus:border-emerald-400"
          />
        </form>
      </div>

      <QuotesTable quotes={rowsToShow} />
    </main>
  );
}