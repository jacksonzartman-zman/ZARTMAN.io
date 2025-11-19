// src/app/admin/page.tsx
import AdminTable, { type UploadRow } from "./AdminTable";
import { supabaseServer } from "@/lib/supabaseServer";

export default async function AdminPage() {
  const supabase = supabaseServer;

  // Pull latest uploads (no joins yet – keep it simple)
  const { data, error } = await supabase
    .from("uploads")
    .select(
      `
        id,
        file_name,
        status,
        created_at,
        name,
        email,
        company
      `
    )
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    console.error("Error loading uploads for admin", error);
    return (
      <main className="max-w-5xl mx-auto px-4 py-10">
        <p className="text-sm text-red-400">
          Failed to load uploads dashboard: {error.message}
        </p>
      </main>
    );
  }

  // Make TS happy: map from raw rows into the shape the table expects
  const uploads: UploadRow[] = (data ?? []).map((row: any) => ({
    id: row.id,
    customerName: row.name ?? row.email ?? "Unknown",
    customerEmail: row.email ?? "",
    company: row.company ?? "",
    fileName: row.file_name ?? "(no file name)",
    status: row.status ?? "New",
    createdAt: row.created_at ?? null,
  }));

  return (
    <main className="max-w-5xl mx-auto px-4 py-10">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-white">
          Uploads dashboard
        </h1>
        <p className="mt-1 text-sm text-zinc-400">
          Latest CAD uploads hitting Supabase.
        </p>
      </header>

      <AdminTable uploads={uploads} />
    </main>
  );
}