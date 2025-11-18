import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ADMIN_COOKIE_NAME } from "../constants";
import { supabaseServer } from "@/lib/supabaseServer";

export const dynamic = "force-dynamic";

type QuoteRow = {
  id: string;
  status: string;
  price: number | null;
  currency: string | null;
  target_date: string | null;
  created_at: string;
  // Supabase returns uploads as an ARRAY via the relationship join
  uploads:
    | {
        file_name: string | null;
        contact_name: string | null;
        contact_email: string | null;
        company: string | null;
      }[]
    | null;
};

export default async function QuotesAdminPage() {
  // ---- simple auth gate (same logic as /admin) ----
  const cookieStore = await cookies();
  const isAuthed =
    cookieStore.get(ADMIN_COOKIE_NAME)?.value === "ok";

  if (!isAuthed) {
    // send them back to the main admin login page
    redirect("/admin");
  }

  // ---- load quotes + related upload info ----
  const { data, error } = await supabaseServer
    .from("quotes")
    .select(
      `
      id,
      status,
      price,
      currency,
      target_date,
      created_at,
      uploads:upload_id (
        file_name,
        contact_name,
        contact_email,
        company
      )
    `
    )
    .order("created_at", { ascending: false });

  const quotes = (data ?? []) as QuoteRow[];

  if (error) {
    console.error("Error loading quotes:", error);
  }

  return (
    <main className="min-h-screen bg-page text-ink px-4 py-10 md:px-10">
      <div className="mx-auto max-w-5xl">
        {/* Top bar */}
        <header className="mb-8 flex items-baseline justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold">
              Quotes dashboard
            </h1>
            <p className="text-xs text-neutral-400">
              Internal view of quotes created from customer uploads.
            </p>
          </div>
          <p className="text-[11px] text-neutral-500">
            Admin view only
          </p>
        </header>

        {/* Table shell */}
        <section className="overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-900/40">
          <div className="overflow-x-auto">
            <table className="min-w-full border-collapse text-xs">
              <thead>
                <tr className="border-b border-neutral-800 bg-neutral-900/80 text-neutral-300">
                  <th className="px-4 py-3 text-left font-medium">
                    Quote
                  </th>
                  <th className="px-4 py-3 text-left font-medium">
                    Contact
                  </th>
                  <th className="px-4 py-3 text-left font-medium">
                    Company
                  </th>
                  <th className="px-4 py-3 text-left font-medium">
                    Status
                  </th>
                  <th className="px-4 py-3 text-left font-medium">
                    Price
                  </th>
                  <th className="px-4 py-3 text-left font-medium">
                    Target date
                  </th>
                  <th className="px-4 py-3 text-left font-medium">
                    Created
                  </th>
                </tr>
              </thead>
              <tbody>
                {quotes.length === 0 && (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-4 py-6 text-center text-neutral-500"
                    >
                      No quotes yet. Create one from an upload in
                      the main admin page.
                    </td>
                  </tr>
                )}

                {quotes.map((q) => {
                  // take the first related upload (one-to-one in practice)
                  const upload = q.uploads?.[0] ?? null;

                  const created = new Date(
                    q.created_at
                  ).toLocaleString();
                  const target = q.target_date
                    ? new Date(q.target_date).toLocaleDateString()
                    : "—";

                  const priceDisplay =
                    q.price != null
                      ? `${q.currency ?? "USD"} ${q.price.toFixed(
                          2
                        )}`
                      : "—";

                  // simple status pill color
                  const statusColor =
                    q.status === "won"
                      ? "bg-emerald-900/60 text-emerald-300 border-emerald-700/70"
                      : q.status === "quoted"
                      ? "bg-neutral-900 text-neutral-200 border-neutral-700"
                      : q.status === "lost"
                      ? "bg-red-950/60 text-red-300 border-red-800/70"
                      : "bg-amber-950/40 text-amber-300 border-amber-700/70";

                  return (
                    <tr
                      key={q.id}
                      className="border-b border-neutral-800 last:border-b-0 hover:bg-neutral-900/60"
                    >
                      <td className="px-4 py-3 align-top">
                        <div className="font-medium text-neutral-100">
                          {upload?.file_name ?? "Unnamed file"}
                        </div>
                        <div className="text-[11px] text-neutral-500">
                          Quote ID:{" "}
                          <span className="font-mono">
                            {q.id.slice(0, 8)}…
                          </span>
                        </div>
                      </td>

                      <td className="px-4 py-3 align-top">
                        <div className="text-neutral-100">
                          {upload?.contact_name ?? "—"}
                        </div>
                        {upload?.contact_email && (
                          <a
                            href={`mailto:${upload.contact_email}`}
                            className="text-[11px] text-emerald-300 underline underline-offset-2"
                          >
                            {upload.contact_email}
                          </a>
                        )}
                      </td>

                      <td className="px-4 py-3 align-top">
                        {upload?.company ?? "—"}
                      </td>

                      <td className="px-4 py-3 align-top">
                        <span
                          className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] capitalize ${statusColor}`}
                        >
                          {q.status}
                        </span>
                      </td>

                      <td className="px-4 py-3 align-top">
                        {priceDisplay}
                      </td>

                      <td className="px-4 py-3 align-top">
                        {target}
                      </td>

                      <td className="px-4 py-3 align-top text-neutral-400">
                        <span className="whitespace-nowrap">
                          {created}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}