// src/app/admin/uploads/[id]/page.tsx

import { notFound } from "next/navigation";
import { supabaseServer } from "@/lib/supabaseServer";
import { updateUpload } from "./actions";

export default async function UploadDetailPage(props: any) {
  // Narrow props to the shape we expect
  const { params } = props as { params: { id: string } };

  const supabase = supabaseServer;

  // Fetch upload by id
  const { data: upload, error } = await supabase
    .from("uploads")
    .select("*")
    .eq("id", params.id)
    .single();

  if (error) {
    console.error("Error fetching upload", error);
    notFound();
  }

  if (!upload) {
    notFound();
  }

  const created = upload.created_at
    ? new Date(upload.created_at).toLocaleString()
    : "Unknown";

  return (
    <main className="mx-auto max-w-4xl px-4 py-10 space-y-8">
      {/* Top card – customer + file */}
      <section className="rounded-xl border border-slate-800 bg-[#05070b] p-6">
        <h1 className="mb-1 text-2xl font-semibold">Upload detail</h1>
        <p className="mb-6 text-sm text-slate-400">
          Customer upload and context for this request.
        </p>

        <div className="grid gap-8 md:grid-cols-2">
          {/* Customer side */}
          <div className="space-y-3">
            <h2 className="text-lg font-medium">Customer</h2>
            <p className="text-sm text-slate-50">{upload.name ?? "Unknown"}</p>
            {upload.email && (
              <a
                href={`mailto:${upload.email}`}
                className="text-sm text-emerald-400 hover:underline"
              >
                {upload.email}
              </a>
            )}
            <p className="text-sm text-slate-200">
              {upload.company ?? "No company provided"}
            </p>
            <p className="mt-3 text-xs font-medium text-slate-400">
              Initial request notes
            </p>
            <p className="whitespace-pre-line text-sm text-slate-200">
              {upload.initial_request_notes || "—"}
            </p>

            <p className="mt-4 text-xs text-slate-500">
              Upload ID: {upload.id}
              <br />
              Created: {created}
            </p>
          </div>

          {/* File side */}
          <div className="space-y-3">
            <h2 className="text-lg font-medium">File</h2>
            <p className="text-sm text-slate-50">
              {upload.file_name ?? "Unknown file"}
            </p>
            {upload.file_url && (
              <a
                href={upload.file_url}
                className="break-all text-sm text-emerald-400 hover:underline"
              >
                {upload.file_url}
              </a>
            )}
          </div>
        </div>
      </section>

      {/* Admin controls */}
      <section className="rounded-xl border border-slate-800 bg-[#05070b] p-6">
        <h2 className="mb-4 text-lg font-semibold">Admin controls</h2>
        <p className="mb-4 text-xs text-slate-400">
          Private notes for you/your team — customers never see these.
        </p>

        <form action={updateUpload} className="space-y-4">
          {/* hidden id to tell the action which row to update */}
          <input type="hidden" name="id" value={upload.id} />

          <div className="space-y-1">
            <label className="block text-sm font-medium text-slate-200">
              Status
            </label>
            <select
              name="status"
              defaultValue={upload.status ?? "New"}
              className="w-full rounded-md border border-slate-700 bg-black px-3 py-2 text-sm text-slate-100 outline-none focus:border-emerald-400"
            >
              <option value="New">New</option>
              <option value="In review">In review</option>
              <option value="Quoted">Quoted</option>
              <option value="On hold">On hold</option>
              <option value="Done">Done</option>
            </select>
          </div>

          <div className="space-y-1">
            <label className="block text-sm font-medium text-slate-200">
              Admin notes
            </label>
            <textarea
              name="admin_notes"
              defaultValue={upload.admin_notes ?? ""}
              rows={5}
              className="w-full rounded-md border border-slate-700 bg-black px-3 py-2 text-sm text-slate-100 outline-none focus:border-emerald-400"
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