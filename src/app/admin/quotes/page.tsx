import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ADMIN_COOKIE_NAME } from "../constants";
import { supabaseServer } from "@/lib/supabaseServer";

export const dynamic = "force-dynamic";

type QuoteRow = {
  id: string;
  status: string | null;
  price: number | null;
  currency: string | null;
  target_date: string | null;
  created_at: string;
  uploads: {
    file_name: string | null;
    contact_name: string | null;
    contact_email: string | null;
    company: string | null;
  } | null;
};

export default async function QuotesAdminPage() {
  const cookieStore = await cookies();
  const isAuthed = cookieStore.get(ADMIN_COOKIE_NAME)?.value === "ok";

  if (!isAuthed) {
    // bounce back to main admin login
    redirect("/admin");
  }

  const supabase = supabaseServer();
  const { data, error } = await supabase
    .from("quotes")
    .select(
      "id, status, price, currency, target_date, created_at, uploads ( file_name, contact_name, contact_email, company )"
    )
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Error loading quotes:", error);
  }

  const quotes = (data ?? []) as QuoteRow[];

  return (
    <main className="min-h-screen bg-page text-ink">
      <div className="mx-auto max-w-5xl px-4 py-10">
        <header className="mb-6 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold">Quotes dashboard</h1>
            <p className="text-xs text-muted-foreground">
              Internal view of quotes created from customer uploads.
            </p>
          </div>
          <p className="text-[11px] text-muted-foreground">Admin view only</p>
        </header>

        <section className="mb-4 flex items-center justify-between gap-3">
          <a
            href="/admin"
            className="text-xs font-medium text-emerald-400 underline underline-offset-4"
          >
            ← Back to uploads
          </a>
        </section>

        <div className="overflow-x-auto rounded-2xl border border-border bg-surface">
          <table className="min-w-full text-left text-xs">
            <thead className="border-b border-border bg-surface/70">
              <tr>
                <th className="px-4 py-3 font-medium">Quote</th>
                <th className="px-4 py-3 font-medium">Contact</th>
                <th className="px-4 py-3 font-medium">Company</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Price</th>
                <th className="px-4 py-3 font-medium">Target date</th>
                <th className="px-4 py-3 font-medium">Created</th>
              </tr>
            </thead>
            <tbody>
              {quotes.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-4 py-6 text-center text-xs text-muted-foreground"
                  >
                    No quotes yet. Create one from an upload in the main admin
                    page.
                  </td>
                </tr>
              ) : (
                quotes.map((q) => {
                  const created = new Date(q.created_at);
                  const createdDisplay = created.toLocaleString();
                  const upload = q.uploads;

                  const targetDate =
                    q.target_date && q.target_date.length >= 10
                      ? q.target_date.slice(0, 10)
                      : "";

                  const priceDisplay =
                    q.price != null
                      ? `${q.currency ?? "USD"} ${q.price.toFixed(2)}`
                      : "—";

                  return (
                    <tr key={q.id} className="border-t border-border/60">
                      <td className="px-4 py-3 align-top">
                        <div className="font-medium">
                          <a
                            href={`/admin/quotes/${q.id}`}
                            className="text-emerald-400 underline"
                          >
                            {upload?.file_name ?? "Quote"}
                          </a>
                        </div>
                      </td>

                      <td className="px-4 py-3 align-top">
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
                      </td>

                      <td className="px-4 py-3 align-top">
                        {upload?.company ?? "—"}
                      </td>

                      <td className="px-4 py-3 align-top">
                        <span className="rounded-full border border-border px-2 py-1 text-[11px]">
                          {q.status ?? "new"}
                        </span>
                      </td>

                      <td className="px-4 py-3 align-top">{priceDisplay}</td>

                      <td className="px-4 py-3 align-top text-[11px]">
                        {targetDate || "—"}
                      </td>

                      <td className="px-4 py-3 align-top text-[11px] text-muted-foreground">
                        {createdDisplay}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}