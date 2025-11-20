// src/app/admin/quotes/page.tsx

import Link from "next/link";
import { supabaseServer } from "@/lib/supabaseServer";

type QuoteRow = {
  id: string;
  upload_id: string;
  status?: string | null;
  price?: number | null;
  currency?: string | null;
  target_date?: string | null;
  created_at?: string | null;
};

export default async function QuotesPage() {
  const supabase = supabaseServer;

  const { data, error } = await supabase
    .from("quotes")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Error loading quotes for admin", error);

    return (
      <main className="max-w-4xl mx-auto px-4 py-10">
        <p className="text-sm text-red-400">
          Failed to load quotes dashboard: {error.message}
        </p>
      </main>
    );
  }

  const quotes = (data ?? []) as QuoteRow[];

  return (
    <main className="max-w-5xl mx-auto px-4 py-10 space-y-8">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Quotes dashboard</h1>
          <p className="text-sm text-slate-400">
            Latest quotes created from customer uploads.
          </p>
        </div>

        <Link
          href="/admin"
          className="text-xs font-medium text-emerald-300 hover:text-emerald-200"
        >
          ← Back to uploads
        </Link>
      </header>

      {quotes.length === 0 ? (
        <p className="text-sm text-slate-400">No quotes recorded yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-800 bg-slate-950/40">
          <table className="min-w-full text-sm">
            <thead className="border-b border-slate-800 bg-slate-900/60">
              <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
                <th className="px-4 py-3">Upload</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Price</th>
                <th className="px-4 py-3">Target date</th>
                <th className="px-4 py-3">Created</th>
                <th className="px-4 py-3 text-right">Open</th>
              </tr>
            </thead>
            <tbody>
              {quotes.map((quote) => {
                const created =
                  quote.created_at &&
                  new Date(quote.created_at).toLocaleDateString();

                const displayPrice =
                  quote.price != null
                    ? `${quote.price.toFixed(2)} ${quote.currency ?? "USD"}`
                    : "—";

                return (
                  <tr
                    key={quote.id}
                    className="border-t border-slate-900 hover:bg-slate-900/40"
                  >
                    <td className="px-4 py-3 align-middle">
                      <div className="flex flex-col">
                        <span className="font-medium text-slate-200">
                          {quote.upload_id.slice(0, 8)}…
                        </span>
                        <span className="text-[11px] text-slate-500">
                          Quote ID: {quote.id.slice(0, 8)}…
                        </span>
                      </div>
                    </td>

                    <td className="px-4 py-3 align-middle">
                      <span className="inline-flex rounded-full bg-emerald-900/40 px-2 py-0.5 text-[11px] font-medium text-emerald-300">
                        {quote.status ?? "new"}
                      </span>
                    </td>

                    <td className="px-4 py-3 align-middle text-slate-100">
                      {displayPrice}
                    </td>

                    <td className="px-4 py-3 align-middle text-slate-200">
                      {quote.target_date
                        ? new Date(quote.target_date).toLocaleDateString()
                        : "—"}
                    </td>

                    <td className="px-4 py-3 align-middle text-slate-400">
                      {created ?? "—"}
                    </td>

                    <td className="px-4 py-3 align-middle text-right">
                      <Link
                        href={`/admin/uploads/${quote.upload_id}`}
                        className="text-xs font-medium text-emerald-300 hover:text-emerald-200"
                      >
                        View upload
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}