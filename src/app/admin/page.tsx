import AdminTable, { UploadRow } from "./AdminTable";
import { supabaseServer } from "@/lib/supabaseServer";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const supabase = supabaseServer;

  const { data, error } = await supabase
    .from("uploads")
    .select(
      `
        id,
        file_name,
        status,
        created_at,
        email,
        name,
        company
      `
    )
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    console.error("Error loading uploads for admin", error);
    return (
      <main className="mx-auto max-w-3xl px-4 py-10">
        <p className="text-sm text-red-400">
          Failed to load uploads dashboard.
        </p>
      </main>
    );
  }

  return (
    <main>
      <AdminTable uploads={(data ?? []) as UploadRow[]} />
    </main>
  );
}