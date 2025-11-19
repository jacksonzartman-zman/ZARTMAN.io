// src/app/admin/uploads/[id]/page.tsx
import { notFound } from "next/navigation";
import { supabaseServer } from "@/lib/supabaseServer";
import { updateUpload } from "./actions";

type UploadDetailPageProps = {
  params: Promise<{ id: string }>;
};

type UploadDetailRow = {
  id: string;
  file_name: string;
  file_path: string;
  notes: string | null;        // customer’s initial notes
  admin_notes: string | null;  // your internal notes
  status: string | null;
  created_at: string;
  customers: {
    name: string | null;
    email: string | null;
    company: string | null;
  } | null;
};

async function getUploadWithCustomer(id: string): Promise<UploadDetailRow> {
  const supabase = supabaseServer;

  const { data, error } = await supabase
    .from("uploads")
    .select(
      `
        id,
        file_name,
        file_path,
        notes,
        admin_notes,
        status,
        created_at,
        customers (
          name,
          email,
          company
        )
      `
    )
    .eq("id", id)
    .single<UploadDetailRow>();

  if (error) {
    console.error("Error loading upload detail", error);
    throw error;
  }

  if (!data) {
    notFound();
  }

  return data;
}

export default async function UploadDetailPage({
  params,
}: UploadDetailPageProps) {
  const { id } = await params;
  const upload = await getUploadWithCustomer(id);

  const customerName = upload.customers?.name ?? "Unknown";
  const customerEmail = upload.customers?.email ?? "";
  const customerCompany = upload.customers?.company ?? "";
  const status = upload.status ?? "New";

  return (
    <main className="max-w-4xl mx-auto px-4 py-10 space-y-8">
      {/* Read-only snapshot of the request */}
      <section className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-6">
        <h1 className="text-2xl font-semibold mb-2">Upload detail</h1>
        <p className="text-sm text-neutral-400 mb-6">
          Customer upload and context for this request.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-sm">
          <div className="space-y-1">
            <h2 className="font-medium text-neutral-200">Customer</h2>
            <div>{customerName}</div>

            {customerEmail && (
              <a
                href={`mailto:${customerEmail}`}
                className="text-emerald-400 underline underline-offset-2"
              >
                {customerEmail}
              </a>
            )}

            {customerCompany && <div>{customerCompany}</div>}

            <div className="mt-4">
              <h3 className="font-medium text-neutral-200">
                Initial request notes
              </h3>
              <p className="mt-1 whitespace-pre-wrap text-neutral-300">
                {upload.notes || "—"}
              </p>
            </div>
          </div>

          <div className="space-y-1">
            <h2 className="font-medium text-neutral-200">File</h2>
            <div>{upload.file_name}</div>
            <div className="text-xs text-neutral-500 break-all">
              {upload.file_path}
            </div>

            <div className="mt-4 text-xs text-neutral-500 space-y-1">
              <div>Upload ID: {upload.id}</div>
              <div>
                Created:{" "}
                {new Date(upload.created_at).toLocaleString("en-US", {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Editable admin controls */}
      <section className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-6">
        <h2 className="text-lg font-semibold mb-4">Admin controls</h2>

        <form action={updateUpload} className="space-y-4">
          <input type="hidden" name="id" value={upload.id} />

          <div className="flex flex-col gap-2 max-w-xs">
            <label className="text-sm text-neutral-300">Status</label>
            <select
              name="status"
              defaultValue={status}
              className="rounded-lg border border-neutral-700 bg-black px-3 py-2 text-sm outline-none focus:border-emerald-500"
            >
              <option value="New">New</option>
              <option value="In review">In review</option>
              <option value="Quoted">Quoted</option>
              <option value="PO in">PO in</option>
              <option value="Shipped">Shipped</option>
              <option value="Lost">Lost</option>
            </select>
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-sm text-neutral-300">Admin notes</label>
            <textarea
              name="admin_notes"
              defaultValue={upload.admin_notes || ""}
              rows={4}
              className="w-full rounded-lg border border-neutral-700 bg-black px-3 py-2 text-sm outline-none focus:border-emerald-500"
            />
            <p className="text-xs text-neutral-500">
              Private notes for you/your team — customers never see these.
            </p>
          </div>

          <button
            type="submit"
            className="inline-flex items-center justify-center rounded-full px-4 py-2 text-sm font-medium bg-emerald-500 text-black hover:bg-emerald-400 transition"
          >
            Save changes
          </button>
        </form>
      </section>
    </main>
  );
}