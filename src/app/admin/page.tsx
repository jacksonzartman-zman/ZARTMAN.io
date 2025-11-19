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
  const cookieStore = await cookies();
  const isAuthed = cookieStore.get(ADMIN_COOKIE_NAME)?.value === "ok";

  // Not authenticated → show password form
  if (!isAuthed) {
    return (
      <main className="min-h-screen bg-page text-ink flex items-center justify-center px-4">
        <div className="w-full max-w-md rounded-2xl border border-border bg-surface px-6 py-8">
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
                placeholder="********"
                className="w-full rounded-md border border-border bg-input px-3 py-2 text-xs"
              />
            </div>

            <button
              type="submit"
              className="inline-flex w-full items-center justify-center rounded-full bg-accent px-4 py-2 text-xs font-medium text-ink hover:opacity-90"
            >
              Enter
            </button>
          </form>
        </div>
      </main>
    );
  }

  // Authenticated → load uploads from Supabase
  const supabase = supabaseServer as any;

  const { data, error } = await supabase
    .from("uploads")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Error loading uploads", error);
  }

  const uploads: UploadRow[] = (data as UploadRow[]) ?? [];

  return (
    <main className="min-h-screen bg-page text-ink px-4 py-10">
      <div className="mx-auto max-w-5xl">
        <header className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold">Uploads dashboard</h1>
            <p className="text-xs text-muted">
              Latest CAD uploads hitting Supabase.
            </p>
          </div>
          <p className="text-[11px] text-muted">Admin view only</p>
        </header>

        <AdminTable uploads={uploads} />
      </div>
    </main>
  );
}