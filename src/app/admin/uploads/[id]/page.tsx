// src/app/admin/uploads/[id]/page.tsx
import { notFound } from "next/navigation";
import { supabaseServer } from "@/lib/supabaseServer";

type UploadDetail = {
  id: string;
  file_name: string | null;
  file_path: string | null;
  name: string | null;
  email: string | null;
  company: string | null;
  notes: string | null;
  created_at: string | null;
  customers: {
    id: string;
    name: string | null;
    email: string | null;
    company: string | null;
  } | null;
};

async function getUploadWithCustomer(id: string): Promise<UploadDetail | null> {
  const supabase = supabaseServer;

  const { data, error } = await supabase
    .from("uploads")
    .select(
      `
      id,
      file_name,
      file_path,
      name,
      email,
      company,
      notes,
      created_at,
      customers:customer_id (
        id,
        name,
        email,
        company
      )
    `
    )
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error("Error loading upload detail", error);
    return null;
  }

  return data as UploadDetail | null;
}

export default async function UploadDetailPage({ params }: any) {
  const upload = await getUploadWithCustomer(params.id);

  if (!upload) {
    notFound();
  }

  const created =
    upload.created_at && new Date(upload.created_at).toLocaleString();

  return (
    <main className="max-w-4xl mx-auto px-4 py-10 space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Upload detail</h1>
        <p className="text-sm text-muted-foreground">
          Customer upload and context for this request.
        </p>
      </header>

      <section className="space-y-4 rounded-lg border border-border bg-card p-4">
        <div className="grid gap-4 md:grid-cols-2">
          {/* Customer block */}
          <div className="space-y-1">
            <h2 className="text-sm font-semibold text-muted-foreground">
              Customer
            </h2>
            <p className="font-medium">
              {upload.customers?.name || upload.name || "Unknown"}
            </p>
            <p className="text-sm text-muted-foreground">
              {upload.customers?.email || upload.email}
            </p>
            <p className="text-sm text-muted-foreground">
              {upload.customers?.company || upload.company}
            </p>
          </div>

          {/* File block */}
          <div className="space-y-1">
            <h2 className="text-sm font-semibold text-muted-foreground">
              File
            </h2>
            <p className="text-sm">{upload.file_name || "Unknown file"}</p>
            <p className="text-xs text-muted-foreground break-all">
              {upload.file_path}
            </p>
          </div>
        </div>

        {/* Notes */}
        <div className="space-y-1">
          <h2 className="text-sm font-semibold text-muted-foreground">
            Initial request notes
          </h2>
          <p className="text-sm whitespace-pre-wrap">
            {upload.notes || "No notes provided."}
          </p>
        </div>

        {/* Meta */}
        <div className="space-y-1 text-xs text-muted-foreground">
          <p>
            Upload ID: <span className="font-mono">{upload.id}</span>
          </p>
          <p>Created: {created || "Unknown"}</p>
        </div>
      </section>
    </main>
  );
}