import { cookies } from "next/headers";
import { authenticate } from "./actions";
import { ADMIN_COOKIE_NAME } from "./constants";
import { supabaseServer } from "@/lib/supabaseServer";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  // Check auth cookie
  const cookieStore = await cookies();
  const isAuthed = cookieStore.get(ADMIN_COOKIE_NAME)?.value === "ok";

  // If not authenticated, show password form
  if (!isAuthed) {
    return (
      <main className="min-h-screen bg-page text-ink flex items-center justify-center px-4">
        <section className="w-full max-w-md rounded-2xl border border-border bg-panel p-6 shadow-sm">
          <h1 className="text-lg font-semibold">Admin – Zartman.io</h1>
          <p className="mt-1 text-xs text-muted">
            Private area. Enter the admin password to view uploads.
          </p>

          <form action={authenticate} className="mt-4 space-y-3">
            <input
              type="password"
              name="password"
              placeholder="Admin password"
              className="w-full rounded-md bg-surface border border-border px-3 py-2 text-sm"
            />
            <button
              type="submit"
              className="w-full rounded-full bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90"
            >
              Enter
            </button>
          </form>
        </section>
      </main>
    );
  }

  // If authenticated, fetch uploads from Supabase
  const { data, error } = await supabaseServer
    .from("uploads")
    .select("*")
    .order("created_at", { ascending: false });

  const uploads = data ?? [];

  return (
    <main className="min-h-screen bg-page text-ink px-4 py-8">
      <section className="mx-auto w-full max-w-5xl space-y-4">
        <header className="flex items-baseline justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold">Uploads dashboard</h1>
            <p className="text-xs text-muted">
              Latest CAD uploads hitting Supabase.
            </p>
          </div>
          <p className="text-[11px] text-muted">Admin view only</p>
        </header>

        {error && (
          <p className="text-xs text-red-500">
            Error loading uploads: {error.message}
          </p>
        )}

        <div className="overflow-x-auto rounded-2xl border border-border bg-panel">
          <table className="min-w-full text-left text-xs">
            <thead className="bg-surface/60">
              <tr>
                <th className="px-4 py-3 font-medium">File</th>
                <th className="px-4 py-3 font-medium">Contact</th>
                <th className="px-4 py-3 font-medium">Company</th>
                <th className="px-4 py-3 font-medium">Notes</th>
                <th className="px-4 py-3 font-medium whitespace-nowrap">
                  Uploaded at
                </th>
              </tr>
            </thead>
            <tbody>
              {uploads.length === 0 && (
                <tr>
                  <td
                    colSpan={5}
                    className="px-4 py-6 text-center text-muted text-xs"
                  >
                    No uploads yet.
                  </td>
                </tr>
              )}

              {uploads.map((row: any) => (
                <tr key={row.id} className="border-t border-border/60">
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-0.5">
                      <span className="font-medium text-[11px]">
                        {row.file_name ?? "—"}
                      </span>
                      <span className="text-[10px] text-muted">
                        {row.file_type ?? "unknown type"}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[11px]">
                        {row.contact_name ?? "—"}
                      </span>
                      <span className="text-[10px] text-muted">
                        {row.contact_email ?? ""}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-[11px]">
                    {row.company ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-[11px] max-w-xs">
                    <span className="line-clamp-2 text-muted">
                      {row.notes ?? "—"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[10px] text-muted whitespace-nowrap">
                    {row.created_at
                      ? new Date(row.created_at).toLocaleString()
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}