import { cookies } from "next/headers";
import { authenticate } from "./actions";
import { ADMIN_COOKIE_NAME } from "./constants";
import { supabaseServer } from "@/lib/supabaseServer";

export const dynamic = "force-dynamic";

type UploadRow = {
  id: string;
  file_name: string | null;
  file_path: string | null;
  file_type: string | null;
  contact_name: string | null;
  contact_email: string | null;
  company: string | null;
  notes: string | null;
  created_at: string | null;
};

export default async function AdminPage() {
  // NOTE: cookies() is async in your setup, so we await it
  const cookieStore = await cookies();
  const isAuthed = cookieStore.get(ADMIN_COOKIE_NAME)?.value === "ok";

  // Not authenticated ➜ show password form
  if (!isAuthed) {
    return (
      <main className="min-h-screen bg-page text-ink flex items-center justify-center px-4">
        <div className="w-full max-w-md rounded-2xl border border-border bg-surface px-6 py-8 shadow-lg">
          <h1 className="text-lg font-semibold">Admin – Zartman.io</h1>
          <p className="mt-2 text-xs text-muted">
            Private area. Enter the admin password to view uploads.
          </p>

          <form action={authenticate} className="mt-6 space-y-4">
            <div className="space-y-2">
              <label
                htmlFor="password"
                className="block text-[11px] font-medium text-muted"
              >
                Admin password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                className="w-full rounded-md border border-border bg-input px-3 py-2 text-xs text-ink outline-none focus:border-accent focus:ring-1 focus:ring-accent"
                placeholder="••••••••"
              />
            </div>

            <button
              type="submit"
              className="inline-flex w-full items-center justify-center rounded-full bg-accent px-4 py-2 text-xs font-medium text-black hover:opacity-90 transition"
            >
              Enter
            </button>
          </form>
        </div>
      </main>
    );
  }

  // Authenticated ➜ load uploads from Supabase
  const { data, error } = await supabaseServer
    .from("uploads")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Error loading uploads:", error);
  }

  const uploads: UploadRow[] = (data as UploadRow[]) ?? [];

  return (
    <main className="min-h-screen bg-page text-ink px-4 py-10">
      <section className="mx-auto w-full max-w-5xl">
        <header className="mb-6 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold">Uploads dashboard</h1>
            <p className="text-xs text-muted">
              Latest CAD uploads hitting Supabase.
            </p>
          </div>
          <p className="text-[11px] text-muted">Admin view only</p>
        </header>

        <div className="overflow-x-auto rounded-3xl border border-border bg-surface/60">
          <table className="min-w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-border bg-surface/80">
                <th className="px-4 py-3 text-[11px] font-medium">File</th>
                <th className="px-4 py-3 text-[11px] font-medium">Contact</th>
                <th className="px-4 py-3 text-[11px] font-medium">Company</th>
                <th className="px-4 py-3 text-[11px] font-medium">Notes</th>
                <th className="px-4 py-3 text-[11px] font-medium">
                  Uploaded at
                </th>
              </tr>
            </thead>
            <tbody>
              {uploads.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-4 py-8 text-center text-xs text-muted"
                  >
                    No uploads yet.
                  </td>
                </tr>
              ) : (
                uploads.map((row) => {
                  const publicUrl =
                    row.file_path && process.env.NEXT_PUBLIC_SUPABASE_URL
                      ? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${row.file_path}`
                      : null;

                  return (
                    <tr
                      key={row.id}
                      className="border-t border-border/60 hover:bg-surface/40"
                    >
                      {/* File column */}
                      <td className="px-4 py-3 align-top">
                        <div className="flex flex-col gap-0.5">
                          {publicUrl ? (
                            <a
                              href={publicUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="font-medium text-[11px] underline-offset-2 hover:underline"
                            >
                              {row.file_name ?? "—"}
                            </a>
                          ) : (
                            <span className="font-medium text-[11px]">
                              {row.file_name ?? "—"}
                            </span>
                          )}
                          <span className="text-[10px] text-muted">
                            {row.file_type ?? "unknown type"}
                          </span>
                        </div>
                      </td>

                      {/* Contact column */}
                      <td className="px-4 py-3 align-top">
                        <div className="flex flex-col gap-0.5">
                          <span className="text-[11px]">
                            {row.contact_name ?? "—"}
                          </span>
                          {row.contact_email ? (
                            <a
                              href={`mailto:${row.contact_email}`}
                              className="text-[10px] text-muted underline-offset-2 hover:underline"
                            >
                              {row.contact_email}
                            </a>
                          ) : (
                            <span className="text-[10px] text-muted"></span>
                          )}
                        </div>
                      </td>

                      {/* Company column */}
                      <td className="px-4 py-3 align-top text-[11px]">
                        {row.company ?? "—"}
                      </td>

                      {/* Notes column */}
                      <td className="px-4 py-3 align-top text-[11px] max-w-xs">
                        <span className="text-muted">
                          {row.notes ?? "—"}
                        </span>
                      </td>

                      {/* Timestamp column */}
                      <td className="px-4 py-3 align-top text-[10px] text-muted whitespace-nowrap">
                        {row.created_at
                          ? new Date(row.created_at).toLocaleString()
                          : "—"}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}