// src/app/admin/page.tsx
import AdminTable, { type UploadRow } from "./AdminTable";
import { supabaseServer } from "@/lib/supabaseServer";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const supabase = supabaseServer;

  // Fetch latest uploads (keep it simple & explicit)
  const { data, error } = await supabase
    .from("uploads")
    .select("id, name, email, company, file_name, status, created_at")
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    console.error("Error loading uploads for admin", error);

    return (
      <main className="mx-auto max-w-5xl px-4 py-10">
        <p className="text-sm text-red-400">
          Failed to load uploads dashboard: {error.message}
        </p>
      </main>
    );
  }

  const uploads: UploadRow[] = (data ?? []).map((row) => ({
    id: row.id,
    customerName: row.name ?? "Unknown",
    customerEmail: row.email ?? "",
    company: row.company ?? "",
    fileName: row.file_name ?? "",
    status: row.status ?? "New",
    createdAt: row.created_at,
  }));

  return (
    <main className="mx-auto max-w-5xl px-4 py-10 space-y-6">
      <header>
        <h1 className="mb-1 text-2xl font-semibold">Uploads dashboard</h1>
        <p className="text-sm text-slate-400">
          Latest CAD uploads hitting Supabase.
        </p>
      </header>

      {uploads.length === 0 ? (
        <p className="text-sm text-slate-400">
          No uploads yet. Share your Zartman.io upload link and this table will
          start to fill up.
        </p>
      ) : (
        <AdminTable uploads={uploads} />
      )}
    </main>
  );
}