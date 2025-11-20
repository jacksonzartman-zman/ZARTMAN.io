// src/app/admin/quotes/page.tsx

import { supabaseServer } from "@/lib/supabaseServer";
import QuotesTable from "../QuotesTable";
import type { UploadStatus } from "../constants";

export const dynamic = "force-dynamic";

type QuoteRow = {
  id: string;
  uploadId: string;
  status: string;
  price: number | null;
  currency: string | null;
  targetDate: string | null;
  createdAt: string;
  customerName: string;
  customerEmail: string;
  company: string;
  fileName: string;
};

const STATUS_OPTIONS: { value: UploadStatus | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "new", label: "New" },
  { value: "in_review", label: "In review" },
  { value: "quoted", label: "Quoted" },
  { value: "on_hold", label: "On hold" },
  { value: "closed_lost", label: "Closed lost" },
];

export default async function QuotesPage({ searchParams }: any) {
  const supabase = supabaseServer;

  // Determine the active status filter from the URL (?status=...)
  const statusParam = searchParams?.status;
  const statusFilter: UploadStatus | "all" =
    statusParam && statusParam !== "all"
      ? (statusParam as UploadStatus)
      : "all";

  // 1) Fetch recent quotes
  const { data: quotes, error: quotesError } = await supabase
    .from("quotes")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100);

  if (quotesError) {
    console.error("Error loading quotes for admin", quotesError);
    return (
      <main className="mx-auto max-w-5xl px-4 py-10">
        <p className="text-sm text-red-400">
          Failed to load quotes dashboard: {quotesError.message}
        </p>
      </main>
    );
  }

  if (!quotes || quotes.length === 0) {
    return (
      <main className="mx-auto max-w-5xl px-4 py-10 space-y-6">
        <header>
          <h1 className="mb-1 text-2xl font-semibold">Quotes</h1>
          <p className="text-sm text-slate-400">
            Recent quotes created from uploads.
          </p>
        </header>
        <p className="text-sm text-slate-400">No quotes yet.</p>
      </main>
    );
  }

  // 2) Fetch related uploads so we can show customer + file info
  const uploadIds = Array.from(
    new Set(quotes.map((q) => q.upload_id).filter((id): id is string => !!id))
  );

  const { data: uploads, error: uploadsError } = await supabase
    .from("uploads")
    .select("*")
    .in("id", uploadIds);

  if (uploadsError) {
    console.error("Error loading uploads for quotes", uploadsError);
  }

  const uploadsMap = new Map<string, any>(
    (uploads ?? []).map((u: any) => [u.id, u])
  );

  const rows: QuoteRow[] = quotes
    .map((quote: any) => {
      const upload = uploadsMap.get(quote.upload_id);

      return {
        id: quote.id,
        uploadId: quote.upload_id,
        status: quote.status,
        price: quote.price,
        currency: quote.currency,
        targetDate: quote.target_date,
        createdAt: quote.created_at,
        customerName: upload?.name ?? "Unknown",
        customerEmail: upload?.email ?? "",
        company: upload?.company ?? "",
        fileName: upload?.file_name ?? "",
      };
    })
    .filter((row) =>
      statusFilter === "all" ? true : row.status === statusFilter
    );

  return (
    <main className="mx-auto max-w-5xl px-4 py-10 space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="mb-1 text-2xl font-semibold">Quotes</h1>
          <p className="text-sm text-slate-400">
            Recent quotes created from uploads.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {STATUS_OPTIONS.map((option) => {
            const isActive = statusFilter === option.value;
            const href =
              option.value === "all"
                ? "/admin/quotes"
                : `/admin/quotes?status=${option.value}`;

            return (
              <a
                key={option.value}
                href={href}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                  isActive
                    ? "bg-emerald-500/10 text-emerald-300 border-emerald-500"
                    : "bg-slate-900 text-slate-300 border-slate-700 hover:border-emerald-500/50"
                }`}
              >
                {option.label}
              </a>
            );
          })}
        </div>
      </header>

      <QuotesTable quotes={rows} />
    </main>
  );
}