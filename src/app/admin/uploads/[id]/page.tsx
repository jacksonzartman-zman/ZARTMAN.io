// src/app/admin/uploads/[id]/page.tsx

import { notFound } from "next/navigation";
import { supabaseServer } from "@/lib/supabaseServer";

export const dynamic = "force-dynamic";

// --- Data loader -------------------------------------------------------------

async function getUploadWithCustomer(id: string) {
  const supabase = supabaseServer;

  const { data, error } = await supabase
    .from("uploads")
    .select(
      `
        id,
        file_name,
        file_path,
        mime_type,
        name,
        email,
        company,
        notes,
        created_at,
        customer_id
      `
    )
    .eq("id", id)
    .single();

  if (error) {
    console.error("Error fetching upload for admin detail view:", error);
    return null;
  }

  return data;
}

// --- Page component ----------------------------------------------------------
// NOTE: we accept props as `any` so TS stops trying to enforce `PageProps`.

export default async function UploadDetailPage(props: any) {
  const id = props?.params?.id as string | undefined;

  if (!id) {
    notFound();
  }

  const upload = await getUploadWithCustomer(id);

  if (!upload) {
    notFound();
  }

  return (
    <main className="max-w-4xl mx-auto px-4 py-10">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold">Upload details</h1>
        <p className="text-sm text-muted-foreground">
          CAD file and intake context from the public front door.
        </p>
      </header>

      <section className="space-y-6 rounded-lg border border-border bg-card p-6">
        {/* Customer block */}
        <div>
          <h2 className="text-sm font-medium text-muted-foreground">
            Customer
          </h2>
          <p className="mt-1 text-base font-medium">
            {upload.name || "Unknown"}
          </p>
          <p className="text-sm text-muted-foreground">
            {upload.company || "—"}
          </p>
          <p className="text-sm text-muted-foreground">
            {upload.email || "—"}
          </p>
        </div>

        {/* File block */}
        <div className="border-t border-border pt-4">
          <h2 className="text-sm font-medium text-muted-foreground">File</h2>
          <p className="mt-1 text-base font-medium">
            {upload.file_name ?? "Unknown file"}
          </p>
          <p className="text-xs text-muted-foreground">
            {upload.mime_type || ""}{" "}
            {upload.created_at
              ? `· ${new Date(upload.created_at).toLocaleString()}`
              : ""}
          </p>
        </div>

        {/* Notes block */}
        <div className="border-t border-border pt-4">
          <h2 className="text-sm font-medium text-muted-foreground">
            Intake notes
          </h2>
          <p className="mt-1 whitespace-pre-wrap text-sm">
            {upload.notes || "No intake notes provided."}
          </p>
        </div>
      </section>
    </main>
  );
}