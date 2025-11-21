// src/app/admin/quotes/page.tsx

import { supabaseServer } from "@/lib/supabaseServer";
import type { UploadStatus } from "../constants";
import QuotesTable, { type QuoteRow } from "../QuotesTable";
import StatusFilterChips from "../StatusFilterChips";

export const dynamic = "force-dynamic";

type QuotesPageSearchParams = {
  status?: string | string[];
  search?: string | string[];
};

type QuotesPageProps = {
  searchParams?: QuotesPageSearchParams;
};

const VALID_STATUS_VALUES: UploadStatus[] = [
  "new",
  "in_review",
  "quoted",
  "on_hold",
  "closed_lost",
];

const getFirstParamValue = (value?: string | string[]) => {
  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
};

export default async function QuotesPage({
  searchParams = {},
}: QuotesPageProps) {
  const rawStatus = getFirstParamValue(searchParams.status);
  const rawSearch = getFirstParamValue(searchParams.search);

  const normalizedStatus =
    typeof rawStatus === "string" ? rawStatus.trim().toLowerCase() : "";
  const statusFilter: UploadStatus | "all" = VALID_STATUS_VALUES.includes(
    normalizedStatus as UploadStatus,
  )
    ? (normalizedStatus as UploadStatus)
    : "all";

  const searchTerm = typeof rawSearch === "string" ? rawSearch : "";
  const normalizedSearch = searchTerm.trim().toLowerCase();

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

  const rows: QuoteRow[] =
    data?.map((row: any) => ({
      id: row.id,
      customerName: row.customer_name ?? "Unknown",
      customerEmail: row.customer_email ?? "",
      company: row.company ?? "",
      fileName: row.file_name ?? "",
      status: row.status ?? "new",
      price: row.price,
      currency: row.currency,
      targetDate: row.target_date,
      createdAt: row.created_at,
    })) ?? [];

  const rowsToShow = rows.filter((row) => {
    const rowStatus = (row.status ?? "new").toLowerCase();
    const matchesStatus =
      statusFilter === "all" ? true : rowStatus === statusFilter;

    if (!normalizedSearch) {
      return matchesStatus;
    }

    const haystack = `${row.customerName} ${row.customerEmail} ${row.company ?? ""} ${row.fileName ?? ""} ${
      row.status ?? ""
    }`
      .toLowerCase()
      .replace(/\s+/g, " ");

    return matchesStatus && haystack.includes(normalizedSearch);
  });

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
          currentStatus={statusFilter === "all" ? "" : statusFilter}
          basePath="/admin/quotes"
        />
        <form className="w-full md:w-80" method="get">
          {statusFilter !== "all" && (
            <input type="hidden" name="status" value={statusFilter} />
          )}
          <input
            type="search"
            name="search"
            defaultValue={searchTerm}
            placeholder="Search by customer, email, company, file, or status..."
            className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:border-emerald-400"
          />
        </form>
      </div>

      <QuotesTable quotes={rowsToShow} />
    </main>
  );
}