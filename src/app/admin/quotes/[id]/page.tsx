import { notFound, redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabaseServer";

export const dynamic = "force-dynamic";

type UploadRecord = {
  id: string;
  file_name: string;
  contact_name: string | null;
  contact_email: string | null;
  company: string | null;
  notes: string | null;
  created_at: string;
};

type QuoteRecord = {
  id: string;
  upload_id: string;
  status: string | null;
  price: number | null;
  currency: string | null;
  target_date: string | null;
  internal_notes: string | null;
  created_at: string;
  updated_at: string | null;
};

type FullQuote = {
  quote: QuoteRecord;
  upload: UploadRecord;
};

async function getQuoteWithUpload(id: string): Promise<FullQuote | null> {
  const supabase = supabaseServer;

  // 1) Grab the quote by id
  const { data: quote, error: quoteError } = await supabase
    .from("quotes")
    .select("*")
    .eq("id", id)
    .single<QuoteRecord>();

  if (quoteError || !quote) {
    console.error("Failed to fetch quote", quoteError?.message);
    return null;
  }

  // 2) Grab the related upload
  const { data: upload, error: uploadError } = await supabase
    .from("uploads")
    .select("*")
    .eq("id", quote.upload_id)
    .single<UploadRecord>();

  if (uploadError || !upload) {
    console.error("Failed to fetch upload for quote", uploadError?.message);
    return null;
  }

  return { quote, upload };
}

export default async function QuoteDetailPage(props: any) {
  const { params, searchParams } = props;

  const full = await getQuoteWithUpload(params.id);

  if (!full) {
    notFound();
  }

  const saved = searchParams?.saved === "1";

  const { quote, upload } = full!;

  async function saveQuote(formData: FormData) {
    "use server";

    const id = formData.get("id") as string;
    const status = (formData.get("status") as string) || null;
    const priceRaw = (formData.get("price") as string) || "";
    const currency = (formData.get("currency") as string) || null;
    const targetDate = (formData.get("target_date") as string) || null;
    const internalNotes = (formData.get("internal_notes") as string) || null;

    const price =
      priceRaw.trim().length > 0 ? parseFloat(priceRaw.trim()) : null;

    const supabase = supabaseServer;

    const { error } = await supabase
      .from("quotes")
      .update({
        status,
        price,
        currency,
        target_date: targetDate || null,
        internal_notes: internalNotes,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);

    if (error) {
      console.error("Failed to save quote", error.message);
      throw new Error("Failed to save quote");
    }

    redirect(`/admin/quotes/${id}?saved=1`);
  }

  const savedRecently = searchParams?.saved === "1";

  return (
    <main className="min-h-screen bg-page px-4 py-8 text-ink">
      <div className="mx-auto flex max-w-5xl flex-col gap-8">
        <header className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
              Quote
            </h1>
            <p className="mt-1 text-sm text-muted-ink">
              Pricing workspace for a single upload. This is internal-only for
              now.
            </p>
          </div>
          <div className="text-right text-xs text-muted-ink">
            <div>Quote ID: {quote.id}</div>
            <div className="mt-1">
              Uploaded:{" "}
              {new Date(upload.created_at).toLocaleString(undefined, {
                dateStyle: "medium",
                timeStyle: "short",
              })}
            </div>
          </div>
        </header>

        {savedRecently && (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            Quote saved ✅
          </div>
        )}

        {/* Top cards: customer + file context */}
        <section className="grid gap-4 md:grid-cols-2">
          <div className="rounded-lg border border-border/60 bg-surface px-4 py-3 text-sm">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-ink">
              Customer
            </div>
            <div className="space-y-1">
              <div className="font-medium">
                {upload.contact_name || "Unknown contact"}
              </div>
              <div className="text-xs text-muted-ink">
                {upload.company || "No company specified"}
              </div>
              {upload.contact_email && (
                <a
                  href={`mailto:${upload.contact_email}`}
                  className="mt-1 inline-flex text-xs text-primary hover:underline"
                >
                  {upload.contact_email}
                </a>
              )}
            </div>
          </div>

          <div className="rounded-lg border border-border/60 bg-surface px-4 py-3 text-sm">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-ink">
              File
            </div>
            <div className="space-y-1">
              <div className="font-mono text-xs">
                {upload.file_name || "Unnamed file"}
              </div>
              <div className="text-xs text-muted-ink">
                Initial notes:{" "}
                {upload.notes ? upload.notes : "No intake notes provided."}
              </div>
            </div>
          </div>
        </section>

        {/* Main quote form */}
        <section className="rounded-lg border border-border/60 bg-surface px-4 py-5 text-sm">
          <form action={saveQuote} className="space-y-4">
            {/* Hidden ID field so the server action knows what to update */}
            <input type="hidden" name="id" value={quote.id} />

            <div className="grid gap-4 md:grid-cols-3">
              {/* Status */}
              <div className="space-y-1">
                <label
                  htmlFor="status"
                  className="text-xs font-medium text-muted-ink"
                >
                  Status
                </label>
                <select
                  id="status"
                  name="status"
                  defaultValue={quote.status || "new"}
                  className="w-full rounded-md border border-border/70 bg-page px-3 py-2 text-sm outline-none ring-0 transition focus:border-primary focus:ring-1 focus:ring-primary/40"
                >
                  <option value="new">New</option>
                  <option value="in_review">In review</option>
                  <option value="priced">Priced</option>
                  <option value="sent">Sent to customer</option>
                  <option value="won">Won</option>
                  <option value="lost">Lost</option>
                </select>
              </div>

              {/* Price */}
              <div className="space-y-1">
                <label
                  htmlFor="price"
                  className="text-xs font-medium text-muted-ink"
                >
                  Price
                </label>
                <input
                  id="price"
                  name="price"
                  type="number"
                  step="0.01"
                  defaultValue={
                    typeof quote.price === "number" ? quote.price : ""
                  }
                  className="w-full rounded-md border border-border/70 bg-page px-3 py-2 text-sm outline-none ring-0 transition focus:border-primary focus:ring-1 focus:ring-primary/40"
                  placeholder="e.g. 1250.00"
                />
              </div>

              {/* Currency */}
              <div className="space-y-1">
                <label
                  htmlFor="currency"
                  className="text-xs font-medium text-muted-ink"
                >
                  Currency
                </label>
                <select
                  id="currency"
                  name="currency"
                  defaultValue={quote.currency || "USD"}
                  className="w-full rounded-md border border-border/70 bg-page px-3 py-2 text-sm outline-none ring-0 transition focus:border-primary focus:ring-1 focus:ring-primary/40"
                >
                  <option value="USD">USD</option>
                  <option value="EUR">EUR</option>
                  <option value="GBP">GBP</option>
                </select>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              {/* Target date */}
              <div className="space-y-1">
                <label
                  htmlFor="target_date"
                  className="text-xs font-medium text-muted-ink"
                >
                  Target ship date
                </label>
                <input
                  id="target_date"
                  name="target_date"
                  type="date"
                  defaultValue={
                    quote.target_date
                      ? quote.target_date.slice(0, 10) // YYYY-MM-DD
                      : ""
                  }
                  className="w-full rounded-md border border-border/70 bg-page px-3 py-2 text-sm outline-none ring-0 transition focus:border-primary focus:ring-1 focus:ring-primary/40"
                />
                <p className="text-xs text-muted-ink">
                  Optional, but helpful for tradeoffs.
                </p>
              </div>
            </div>

            {/* Internal notes */}
            <div className="space-y-1">
              <label
                htmlFor="internal_notes"
                className="text-xs font-medium text-muted-ink"
              >
                Internal notes / assumptions
              </label>
              <textarea
                id="internal_notes"
                name="internal_notes"
                defaultValue={quote.internal_notes || ""}
                rows={4}
                className="w-full rounded-md border border-border/70 bg-page px-3 py-2 text-sm outline-none ring-0 transition focus:border-primary focus:ring-1 focus:ring-primary/40"
                placeholder="Ex: Assumes 6061-T6, ±0.005&quot; on critical faces, MJF PA12 alt at qty 100 = $X, etc."
              />
              <p className="text-xs text-muted-ink">
                Only you see this. Later, we can split internal vs
                customer-facing notes.
              </p>
            </div>

                  {/* Footer: tracker hint + save button */}
            <div className="mt-6 flex items-center justify-between gap-4 border-t border-border/40 pt-4">
              <p className="text-xs text-muted-ink">
                Future: this will drive a Domino’s-style tracker for the customer.
              </p>

              <button
                type="submit"
                className="inline-flex items-center justify-center rounded-full bg-accent px-5 py-2 text-sm font-medium text-black shadow-sm hover:bg-accent/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-60"
              >
                Save quote
              </button>
            </div>
          </form>
        </section>
      </div>
    </main>
  );
}