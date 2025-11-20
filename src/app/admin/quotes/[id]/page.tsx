// src/app/admin/quotes/[id]/page.tsx

import { notFound } from "next/navigation";
import { supabaseServer } from "@/lib/supabaseServer";
import { updateQuote } from "../../actions";

export const dynamic = "force-dynamic";

export default async function QuoteDetailPage(props: any) {
  const { params } = props;
  
  const id = params?.id;

  if (!id) {
    // If somehow we hit this page without an id, treat it as not found
    notFound();
  }
  const supabase = supabaseServer;

  const { data: quote, error } = await supabase
    .from("quotes")
    .select("*")
    .eq("id", id)
    .single();

  if (!quote || error) {
    console.error("Quote load error", error);
    notFound();
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-10 space-y-10">
      <header>
        <h1 className="text-2xl font-semibold">Quote Detail</h1>
        <p className="text-sm text-slate-400">
          ID: <span className="font-mono">{quote.id}</span>
        </p>
      </header>

      <form action={updateQuote} className="space-y-8">
        <input type="hidden" name="id" value={quote.id} />

        <section className="rounded-lg border border-slate-800 bg-slate-950/50 p-6 space-y-6">
          <div>
            <label className="block text-sm text-slate-300 mb-1">Status</label>
            <select
              name="status"
              defaultValue={quote.status ?? "new"}
              className="w-full rounded-md border border-slate-700 bg-black px-3 py-2 text-sm"
            >
              <option value="new">New</option>
              <option value="in_review">In review</option>
              <option value="quoted">Quoted</option>
              <option value="on_hold">On hold</option>
              <option value="closed_lost">Closed lost</option>
              <option value="closed_won">Closed won</option>
            </select>
          </div>

          <div>
            <label className="block text-sm text-slate-300 mb-1">Price</label>
            <input
              type="number"
              step="0.01"
              name="price"
              defaultValue={quote.price ?? ""}
              className="w-full rounded-md border border-slate-700 bg-black px-3 py-2 text-sm"
              placeholder="0.00"
            />
          </div>

          <div>
            <label className="block text-sm text-slate-300 mb-1">Currency</label>
            <input
              name="currency"
              defaultValue={quote.currency ?? "USD"}
              className="w-full rounded-md border border-slate-700 bg-black px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label className="block text-sm text-slate-300 mb-1">
              Target date
            </label>
            <input
              type="date"
              name="target_date"
              defaultValue={quote.target_date ?? ""}
              className="w-full rounded-md border border-slate-700 bg-black px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label className="block text-sm text-slate-300 mb-1">
              Internal notes
            </label>
            <textarea
              name="internal_notes"
              defaultValue={quote.internal_notes ?? ""}
              rows={5}
              className="w-full rounded-md border border-slate-700 bg-black px-3 py-2 text-sm"
            />
          </div>

          <button
            type="submit"
            className="inline-flex items-center rounded-full bg-emerald-400 px-4 py-2 text-sm font-medium text-black hover:bg-emerald-300"
          >
            Save quote
          </button>
        </section>
      </form>
    </main>
  );
}