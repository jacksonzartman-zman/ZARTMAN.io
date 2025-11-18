import Link from "next/link";
import { notFound } from "next/navigation";
import { supabaseServer } from "@/lib/supabaseServer";
import { updateQuote } from "../../actions";

export const dynamic = "force-dynamic";

export default async function QuoteDetailPage({ params }: any) {
  // Next may hand us params directly or as a Promise in newer typings
  const resolved = await Promise.resolve(params);
  const id = resolved.id as string;

  const supabase = supabaseServer as any;

  const { data, error } = await supabase
    .from("quotes")
    .select(
      `
      id,
      status,
      price,
      currency,
      target_date,
      created_at,
      upload:uploads (
        file_name,
        contact_name,
        contact_email,
        company,
        notes
      )
    `
    )
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error("Error loading quote detail:", error);
    throw new Error("Failed to load quote.");
  }

  if (!data) {
    notFound();
  }

  const quote = data;

  return (
    <main className="mx-auto max-w-5xl space-y-6 px-4 py-8">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Quote detail</h1>
          <p className="text-xs text-neutral-400">
            First version of a pricing screen. Later we’ll add line items,
            supplier views, and AI helpers.
          </p>
        </div>
        <Link
          href="/admin/quotes"
          className="text-xs text-emerald-400 hover:underline"
        >
          ← Back to quotes
        </Link>
      </header>

      <section className="grid gap-6 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        {/* Left column: upload + contact */}
        <div className="space-y-4 rounded-xl border border-neutral-800 bg-neutral-900 p-6">
          <h2 className="text-sm font-medium text-neutral-100">
            Upload & contact
          </h2>

          <div className="space-y-2 text-xs">
            <div>
              <div className="text-neutral-400">File</div>
              <div className="font-mono text-neutral-100">
                {quote.upload?.file_name ?? "—"}
              </div>
            </div>

            <div>
              <div className="text-neutral-400">Contact</div>
              <div>{quote.upload?.contact_name ?? "—"}</div>
              {quote.upload?.contact_email && (
                <a
                  href={`mailto:${quote.upload.contact_email}`}
                  className="text-emerald-400 hover:underline"
                >
                  {quote.upload.contact_email}
                </a>
              )}
            </div>

            <div>
              <div className="text-neutral-400">Company</div>
              <div>{quote.upload?.company ?? "—"}</div>
            </div>

            <div>
              <div className="text-neutral-400">Notes</div>
              <p className="whitespace-pre-wrap text-neutral-200">
                {quote.upload?.notes ?? "—"}
              </p>
            </div>
          </div>
        </div>

        {/* Right column: quote fields */}
        <div className="space-y-4 rounded-xl border border-neutral-800 bg-neutral-900 p-6">
          <h2 className="text-sm font-medium text-neutral-100">
            Quote overview
          </h2>

          <form
            action={updateQuote}
            className="space-y-3 text-xs text-neutral-200"
          >
            <input type="hidden" name="quote_id" value={quote.id} />

            <div className="space-y-1">
              <label className="block text-neutral-400">Status</label>
              <select
                name="status"
                defaultValue={quote.status ?? "new"}
                className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1"
              >
                <option value="new">New</option>
                <option value="estimating">Estimating</option>
                <option value="quoted">Quoted</option>
                <option value="won">Won</option>
                <option value="lost">Lost</option>
              </select>
            </div>

            <div className="grid grid-cols-[1.5fr_1fr] gap-2">
              <div className="space-y-1">
                <label className="block text-neutral-400">Price</label>
                <input
                  type="number"
                  step="0.01"
                  name="price"
                  defaultValue={quote.price ?? ""}
                  className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1"
                />
              </div>
              <div className="space-y-1">
                <label className="block text-neutral-400">Currency</label>
                <input
                  type="text"
                  name="currency"
                  defaultValue={quote.currency ?? "USD"}
                  className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="block text-neutral-400">Target date</label>
              <input
                type="date"
                name="target_date"
                defaultValue={
                  quote.target_date ? quote.target_date.slice(0, 10) : ""
                }
                className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1"
              />
            </div>

            <button
              type="submit"
              className="mt-3 inline-flex items-center justify-center rounded-full bg-emerald-500 px-4 py-1.5 text-xs font-medium text-neutral-950 hover:bg-emerald-400"
            >
              Save quote
            </button>

            <p className="mt-2 text-[11px] text-neutral-500">
              First version of a pricing screen. Later we’ll pull in supplier
              portals, line items, and full BOM/ZIP ingestion.
            </p>
          </form>
        </div>
      </section>
    </main>
  );
}