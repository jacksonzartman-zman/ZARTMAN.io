// src/app/admin/quotes/page.tsx

import { supabaseServer } from "@/lib/supabaseServer";

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

export default async function QuotesPage() {
  const supabase = supabaseServer;

  // 1) Pull recent quotes
  const { data: quotes, error: quotesError } = await supabase
    .from("quotes")
    .select("id, upload_id, status, price, currency, target_date, created_at")
    .order("created_at", { ascending: false })
    .limit(100);

  if (quotesError) {
    console.error("Error loading quotes", quotesError);

    return (
      <main className="mx-auto max-w-5xl px-4 py-10">
        <p className="text-sm text-red-400">
          Failed to load quotes: {quotesError.message}
        </p>
      </main>
    );
  }

  if (!quotes || quotes.length === 0) {
    return (
      <main className="mx-auto max-w-5xl px-4 py-10 space-y-4">
        <header>
          <h1 className="mb-1 text-2xl font-semibold">Quotes</h1>
          <p className="text-sm text-slate-400">
            No quotes recorded yet. Once you save a quote from an upload, it
            will show up here.
          </p>
        </header>
      </main>
    );
  }

  // 2) Load the related uploads so we can show customer + file info
  const uploadIds = Array.from(new Set(quotes.map((q) => q.upload_id)));

  const { data: uploads, error: uploadsError } = await supabase
    .from("uploads")
    .select("id, name, email, company, file_name")
    .in("id", uploadIds);

  if (uploadsError) {
    console.error("Error loading uploads for quotes", uploadsError);
  }

  const uploadById = new Map<
    string,
    {
      name: string | null;
      email: string | null;
      company: string | null;
      file_name: string | null;
    }
  >();

  (uploads ?? []).forEach((u) => {
    uploadById.set(u.id, {
      name: u.name ?? null,
      email: u.email ?? null,
      company: u.company ?? null,
      file_name: u.file_name ?? null,
    });
  });

  const rows: QuoteRow[] = quotes.map((q) => {
    const upload = uploadById.get(q.upload_id) ?? {
      name: null,
      email: null,
      company: null,
      file_name: null,
    };

    return {
      id: q.id,
      uploadId: q.upload_id,
      status: q.status ?? "new",
      price: q.price,
      currency: q.currency,
      targetDate: q.target_date,
      createdAt: q.created_at,
      customerName: upload.name ?? "Unknown",
      customerEmail: upload.email ?? "",
      company: upload.company ?? "",
      fileName: upload.file_name ?? "",
    };
  });

  return (
    <main className="mx-auto max-w-5xl px-4 py-10 space-y-6">
      <header>
        <h1 className="mb-1 text-2xl font-semibold">Quotes</h1>
        <p className="text-sm text-slate-400">
          Recent quotes created from uploads.
        </p>
      </header>

      <div className="overflow-x-auto rounded-lg border border-slate-800 bg-slate-950/40">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-slate-800 bg-slate-950/60">
            <tr>
              <th className="px-4 py-3 font-medium text-slate-300">Customer</th>
              <th className="px-4 py-3 font-medium text-slate-300">Company</th>
              <th className="px-4 py-3 font-medium text-slate-300">File</th>
              <th className="px-4 py-3 font-medium text-slate-300">Status</th>
              <th className="px-4 py-3 font-medium text-slate-300">Price</th>
              <th className="px-4 py-3 font-medium text-slate-300">Target date</th>
              <th className="px-4 py-3 font-medium text-slate-300">Created</th>
              <th className="px-4 py-3 font-medium text-slate-300">Open</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.id}
                className="border-b border-slate-900/60 last:border-b-0 hover:bg-slate-900/40"
              >
                <td className="px-4 py-3 align-top">
                  <div className="flex flex-col">
                    <span className="font-medium text-slate-100">
                      {row.customerName}
                    </span>
                    {row.customerEmail && (
                      <a
                        href={`mailto:${row.customerEmail}`}
                        className="text-xs text-emerald-400 hover:underline"
                      >
                        {row.customerEmail}
                      </a>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3 align-top text-slate-200">
                  {row.company || "—"}
                </td>
                <td className="px-4 py-3 align-top text-slate-200">
                  <div className="max-w-xs truncate">{row.fileName || "—"}</div>
                </td>
                <td className="px-4 py-3 align-top">
                  <span className="inline-flex rounded-full bg-emerald-900/40 px-2 py-0.5 text-xs capitalize text-emerald-300">
                    {row.status}
                  </span>
                </td>
                <td className="px-4 py-3 align-top text-slate-200">
                  {row.price != null
                    ? `${row.currency ?? "USD"} ${row.price.toFixed(2)}`
                    : "—"}
                </td>
                <td className="px-4 py-3 align-top text-slate-200">
                  {row.targetDate ?? "—"}
                </td>
                <td className="px-4 py-3 align-top text-slate-400">
                  {new Date(row.createdAt).toLocaleDateString()}
                </td>
                <td className="px-4 py-3 align-top">
                  <a
                    href={`/admin/uploads/${row.uploadId}`}
                    className="text-xs font-medium text-emerald-400 hover:underline"
                  >
                    View upload
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