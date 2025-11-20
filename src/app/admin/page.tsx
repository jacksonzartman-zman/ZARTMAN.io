// src/app/admin/page.tsx
import AdminTable, { UploadRow } from "./AdminTable";
import { supabaseServer } from "@/lib/supabaseServer";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const supabase = supabaseServer;

  const { data, error } = await supabase
    .from("uploads")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    console.error("Error loading uploads for admin", error);
    return (
      <main className="mx-auto max-w-3xl px-4 py-10">
        <p className="text-sm text-red-400">
          Failed to load uploads dashboard: {error.message}
        </p>
      </main>
    );
  }

  const uploads: UploadRow[] = (data ?? []).map((row: any) => ({
    id: row.id,
    customerName: row.name ?? "Unknown",
    customerEmail: row.email ?? "",
    company: row.company ?? "",
    fileName: row.file_name ?? "",
    status: row.status ?? "New",
    createdAt: row.created_at,
  }));

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <h1 className="mb-1 text-2xl font-semibold">Uploads dashboard</h1>
      <p className="mb-6 text-sm text-slate-400">
        Latest CAD uploads hitting Supabase.
      </p>

      <AdminTable uploads={uploads} />
    </main>
  );
}