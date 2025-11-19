import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabaseServer";
import { ADMIN_COOKIE_NAME } from "../../constants";
import { updateQuote } from "../../actions";

export const dynamic = "force-dynamic";

export default async function QuoteDetailPage(props: any) {
  const id = props?.params?.id as string | undefined;

  if (!id) {
    notFound();
  }

  // Simple admin gate (same as /admin).
  const cookieStore = await cookies();
  const isAuthed = cookieStore.get(ADMIN_COOKIE_NAME)?.value === "ok";

  if (!isAuthed) {
    redirect("/admin");
  }

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
    console.error("Error loading quote", error);
    notFound();
  }

  if (!data) {
    notFound();
  }

  const quote = data as any;

  const createdAt = quote.created_at
    ? new Date(quote.created_at).toLocaleString("en-US", {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "";

  const targetDateValue = quote.target_date
    ? String(quote.target_date).slice(0, 10)
    : "";

  return (
    <main className="min-h-screen bg-page text-ink px-4 py-10">
      <div className="mx-auto max-w-4xl space-y-6">
        <p className="text-xs text-muted">
          <a href="/admin" className="hover:underline">
            ← Back to uploads
          </a>{" "}
          ·{" "}
          <a href="/admin/quotes" className="hover:underline">
            Quotes dashboard
          </a>
        </p>

        <header className="space-y-1">
          <h1 className="text-xl font-semibold">
            Quote for {quote.upload?.file_name ?? "uploaded file"}
          </h1>
          <p className="text-xs text-muted">
            Created {createdAt || "just now"}. First version of a pricing
            screen – later this becomes full portals, line items, and BOM/ZIP
            ingestion.
          </p>
        </header>

        <section className="grid gap-6 md:grid-cols-[2fr,3fr]">
          {/* Customer card */}
          <div className="rounded-2xl border border-border bg-surface p-4 space-y-2 text-xs">
            <h2 className="font-semibold text-sm mb-1">Customer</h2>
            <p>{quote.upload?.contact_name ?? "Unknown contact"}</p>
            <p className="break-all text-muted">
              {quote.upload?.contact_email ?? "No email"}
            </p>
            <p>{quote.upload?.company ?? "No company"}</p>
            {quote.upload?.notes && (
              <p className="mt-2 text-muted whitespace-pre-wrap">
                {quote.upload.notes}
              </p>
            )}
          </div>

          {/* Quote edit form */}
          <form
            action={updateQuote}
            className="rounded-2xl border border-border bg-surface p-4 space-y-4 text-xs"
          >
            <input type="hidden" name="quote_id" value={quote.id} />

            <div>
              <label className="block text-[11px] font-medium mb-1">
                Status
              </label>
              <select
                name="status"
                defaultValue={quote.status ?? "New"}
                className="w-full rounded-md border border-border bg-input px-3 py-2 text-xs"
              >
                <option value="New">New</option>
                <option value="In review">In review</option>
                <option value="Quoted">Quoted</option>
                <option value="On hold">On hold</option>
                <option value="Closed – won">Closed – won</option>
                <option value="Closed – lost">Closed – lost</option>
              </select>
            </div>

            <div className="grid grid-cols-[2fr,1fr] gap-3">
              <div>
                <label className="block text-[11px] font-medium mb-1">
                  Price
                </label>
                <input
                  type="number"
                  step="0.01"
                  name="price"
                  defaultValue={quote.price ?? ""}
                  className="w-full rounded-md border border-border bg-input px-3 py-2 text-xs"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium mb-1">
                  Currency
                </label>
                <input
                  type="text"
                  name="currency"
                  defaultValue={quote.currency ?? "USD"}
                  className="w-full rounded-md border border-border bg-input px-3 py-2 text-xs"
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-medium mb-1">
                Target date
              </label>
              <input
                type="date"
                name="target_date"
                defaultValue={targetDateValue}
                className="w-full rounded-md border border-border bg-input px-3 py-2 text-xs"
              />
            </div>

            <button
              type="submit"
              className="mt-2 inline-flex items-center justify-center rounded-full bg-accent px-5 py-2 text-xs font-medium text-ink hover:opacity-90"
            >
              Save quote
            </button>

            <p className="mt-2 text-[11px] text-muted">
              First version of a pricing screen. Eventually this is where
              suppliers plug in numbers, upload PDFs, and sync back to the
              customer portal.
            </p>
          </form>
        </section>
      </div>
    </main>
  );
}