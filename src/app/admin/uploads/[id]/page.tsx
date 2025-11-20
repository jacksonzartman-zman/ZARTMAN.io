// src/app/admin/uploads/[id]/page.tsx

import { notFound } from "next/navigation";
import { supabaseServer } from "@/lib/supabaseServer";
import { updateUpload } from "./actions";

export default async function UploadDetailPage({ params }: any) {
  // Extra safety: if params or id is missing, bail out
  if (!params || !params.id) {
    console.error("UploadDetailPage: missing params.id");
    notFound();
  }

  const supabase = supabaseServer;

  // --- Fetch upload row by id ---
  const { data: upload, error: uploadError } = await supabase
    .from("uploads")
    .select("*")
    .eq("id", params.id)
    .single();

  if (uploadError || !upload) {
    console.error("Error loading upload", uploadError);
    notFound();
  }

  // --- Optionally fetch customer (if customer_id is set) ---
  let customer: {
    name: string | null;
    email: string | null;
    company: string | null;
  } | null = null;

  if (upload.customer_id) {
    const { data: customerRow, error: customerError } = await supabase
      .from("customers")
      .select("name,email,company")
      .eq("id", upload.customer_id)
      .single();

    if (customerError) {
      console.error("Error loading customer", customerError);
    } else {
      customer = customerRow;
    }
  }

  const createdText = upload.created_at
    ? new Date(upload.created_at).toLocaleString()
    : "";

  const fileName: string = upload.file_name ?? "";
  const filePath: string = upload.file_path ?? "";

  const statusValue: string = upload.status ?? "New";
  const adminNotesValue: string = upload.admin_notes ?? "";
  const initialNotes: string = upload.initial_request_notes ?? "";

  return (
    <main className="mx-auto max-w-4xl px-4 py-10 space-y-8">
      {/* Top card: customer + file info */}
      <section className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-6">
        <h1 className="text-2xl font-semibold mb-1">Upload detail</h1>
        <p className="text-sm text-zinc-400 mb-6">
          Customer upload and context for this request.
        </p>

        <div className="grid gap-6 md:grid-cols-2">
          {/* Customer block */}
          <div className="space-y-2">
            <h2 className="text-sm font-medium text-zinc-300">Customer</h2>
            <p className="text-sm font-semibold">
              {customer?.name ?? "Unknown"}
            </p>
            <p className="text-sm text-emerald-400">
              {customer?.email ?? "—"}
            </p>
            <p className="text-sm text-zinc-400">
              {customer?.company ?? "—"}
            </p>

            <p className="mt-4 text-sm font-medium text-zinc-300">
              Initial request notes
            </p>
            <p className="text-sm whitespace-pre-line text-zinc-200">
              {initialNotes || "—"}
            </p>

            <p className="mt-4 text-xs text-zinc-500">
              Upload ID: <span className="font-mono">{upload.id}</span>
              <br />
              Created: {createdText || "Unknown"}
            </p>
          </div>

          {/* File block */}
          <div className="space-y-2">
            <h2 className="text-sm font-medium text-zinc-300">File</h2>
            <p className="text-sm font-semibold break-all">{fileName || "—"}</p>
            {filePath && (
              <p className="text-xs text-zinc-400 break-all">
                {filePath}
              </p>
            )}
          </div>
        </div>
      </section>

      {/* Admin controls */}
      <section className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-6">
        <h2 className="text-lg font-semibold mb-1">Admin controls</h2>
        <p className="text-sm text-zinc-400 mb-4">
          Private notes for you/your team — customers never see these.
        </p>

        <form
          action={updateUpload}
          className="space-y-4"
        >
          {/* Hidden id so the action knows which row to update */}
          <input type="hidden" name="id" value={upload.id} />

          <div className="space-y-2">
            <label
              htmlFor="status"
              className="block text-sm font-medium text-zinc-200"
            >
              Status
            </label>
            <select
              id="status"
              name="status"
              defaultValue={statusValue}
              className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-50"
            >
              <option value="New">New</option>
              <option value="In review">In review</option>
              <option value="Quoted">Quoted</option>
              <option value="On hold">On hold</option>
              <option value="Closed">Closed</option>
            </select>
          </div>

          <div className="space-y-2">
            <label
              htmlFor="admin_notes"
              className="block text-sm font-medium text-zinc-200"
            >
              Admin notes
            </label>
            <textarea
              id="admin_notes"
              name="admin_notes"
              defaultValue={adminNotesValue}
              rows={4}
              className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-50"
            />
          </div>

          <button
            type="submit"
            className="inline-flex items-center rounded-full bg-emerald-400 px-4 py-2 text-sm font-medium text-black hover:bg-emerald-300"
          >
            Save changes
          </button>
        </form>
      </section>
    </main>
  );
}