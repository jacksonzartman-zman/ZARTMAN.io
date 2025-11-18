import { cookies } from "next/headers";
import { authenticate } from "./actions";
import { ADMIN_COOKIE_NAME } from "./constants";
import { supabaseServer } from "@/lib/supabaseServer";
import AdminTable from "./AdminTable";

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
  // cookies() is async in your setup
  const cookieStore = await cookies();
  const isAuthed = cookieStore.get(ADMIN_COOKIE_NAME)?.value === "ok";

  // Not authenticated → show password form
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

  // Authenticated → load uploads from Supabase
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
      <AdminTable uploads={uploads} />
    </main>
  );
}