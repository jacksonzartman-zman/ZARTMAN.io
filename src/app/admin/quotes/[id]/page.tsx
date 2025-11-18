import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ADMIN_COOKIE_NAME } from "../../constants";
import { supabaseServer } from "@/lib/supabaseServer";
import { updateQuote } from "../../actions";

export const dynamic = "force-dynamic";

type QuoteDetailPageProps = {
  params: { id: string };
};

export default async function QuoteDetailPage({
  params,
}: QuoteDetailPageProps) {
  const { id } = params;

  const cookieStore = await cookies();
  const isAuthed = cookieStore.get(ADMIN_COOKIE_NAME)?.value === "ok";

  if (!isAuthed) {
    redirect("/admin");
  }

  const supabase = supabaseServer();
  const { data, error } = await supabase
    .from("quotes")
    .select(
      "id, status, price, currency, target_date, created_at, uploads ( file_name, contact_name, contact_email, company, notes )"
    )
    .eq("id", id)
    .single();

  if (error || !data) {
    console.error("Error loading quote:", error);
    return (
      <main className="min-h-screen bg-page text-ink">
        <div className="mx-auto max-w-3xl px-4 py-10">
          <p className="text-sm text-muted-foreground">
            Quote not found.{" "}
            <a href="/admin/quotes" className="underline text-emerald-400">
              Back to quotes
            </a>
          </p>
        </div>
      </main>
    );
  }

  const quote = data as any;
  const upload = (quote.uploads ?? null) as any | null;

  const created = new Date(quote.created_at);
  const createdDisplay = created.toLocaleString();

  const targetDateValue =
    quote.target_date && quote.target_date.length >= 10
      ? quote.target_date.slice(0, 10)
      : "";

  return (
    <main className="min-h-screen bg-page text-ink">
      <div className="mx-auto max-w-3xl px-4 py-10 space-y-6">
        <header className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold">
              Quote detail – {upload?.file_name ?? quote.id}
            </h1>
            <p className="text-xs text-muted-foreground">
              Created from a customer upload. Use this page to set pricing and
              target dates.
            </p>
          </div>
          <a
            href="/admin/quotes"
            className="text-xs font-medium text-emerald-400 underline underline-offset-4"
          >
            ← Back to quotes
          </a>
        </header>

        {/* Upload / customer context */}
        <section className="rounded-2xl border border-border bg-surface px-4 py-4 text-xs">
          <h2 className="text-[13px] font-semibold mb-2">Customer context</h2>
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <div className="text-muted-foreground">File</div>
              <div className="font-medium">{upload?.file_name ?? "—"}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Company</div>
              <div className="font-medium">{upload?.company ?? "—"}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Contact</div>
              <div className="font-medium">
                {upload?.contact_name ?? "—"}
              </div>
              {upload?.contact_email && (
                <a
                  href={`mailto:${upload.contact_email}`}
                  className="text-[11px] text-emerald-400 underline"
                >
                  {upload.contact_email}
                </a>
              )}
            </div>
            <div>
              <div className="text-muted-foreground">Created</div>
              <div className="font-medium">{createdDisplay}</div>
            </div>
          </div>

          {upload?.notes && (
            <div className="mt-3">
              <div className="text-muted-foreground mb-1">Customer notes</div>
              <p className="whitespace-pre-wrap text-[11px] text-muted-foreground">
                {upload.notes}
              </p>
            </div>
          )}
        </section>

        {/* Pricing / status form */}
        <section className="rounded-2xl border border-border bg-surface px-4 py-4 text-xs">
          <h2 className="text-[13px] font-semibold mb-2">Quote settings</h2>
          <form action={updateQuote} className="space-y-3 max-w-sm">
            <input type="hidden" name="quote_id" value={quote.id} />

            <label className="block text-[11px] font-medium text-muted-foreground">
              Status
              <select
                name="status"
                defaultValue={quote.status ?? "new"}
                className="mt-1 w-full rounded-md border border-border bg-input px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-emerald-500/70"
              >
                <option value="new">New</option>
                <option value="in_review">In review</option>
                <option value="quoted">Quoted</option>
                <option value="won">Won</option>
                <option value="lost">Lost</option>
              </select>
            </label>

            <label className="block text-[11px] font-medium text-muted-foreground">
              Price
              <input
                type="number"
                step="0.01"
                name="price"
                defaultValue={
                  quote.price != null ? String(quote.price) : ""
                }
                placeholder="e.g. 1500"
                className="mt-1 w-full rounded-md border border-border bg-input px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-emerald-500/70"
              />
            </label>

            <label className="block text-[11px] font-medium text-muted-foreground">
              Currency
              <input
                type="text"
                name="currency"
                defaultValue={quote.currency ?? "USD"}
                className="mt-1 w-full rounded-md border border-border bg-input px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-emerald-500/70"
              />
            </label>

            <label className="block text-[11px] font-medium text-muted-foreground">
              Target date
              <input
                type="date"
                name="target_date"
                defaultValue={targetDateValue}
                className="mt-1 w-full rounded-md border border-border bg-input px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-emerald-500/70"
              />
            </label>

            <button
              type="submit"
              className="mt-3 inline-flex items-center justify-center rounded-full bg-emerald-500 px-4 py-2 text-xs font-medium text-black hover:bg-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/70"
            >
              Save quote
            </button>

            <p className="mt-2 text-[11px] text-muted-foreground">
              This is your first version of a pricing screen. Later we can
              split this into customer vs. supplier views, add line items, and
              plug in AI to pre-fill pricing suggestions from BOMs and ZIP
              uploads.
            </p>
          </form>
        </section>
      </div>
    </main>
  );
}