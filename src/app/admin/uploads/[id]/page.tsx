// @ts-nocheck

import { notFound } from "next/navigation";
import { supabaseServer } from "@/lib/supabaseServer";
import { updateUpload } from "./actions";

export default async function UploadDetailPage(props: any) {
  const supabase = supabaseServer();

  // Next may pass params as a Promise; awaiting works for both Promise and plain values
  const params = (await props?.params) || {};
  const id = params.id;

  if (!id) {
    notFound();
  }

  // Fetch upload by id
  const { data: upload, error } = await supabase
    .from("uploads")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !upload) {
    console.error("Error loading upload detail", error);
    notFound();
  }

  const created = upload.created_at
    ? new Date(upload.created_at).toLocaleString()
    : "Unknown";

  return (
    <main className="max-w-5xl mx-auto px-4 py-10 space-y-10">
      {/* Header */}
      <section className="space-y-2">
        <p className="text-sm text-emerald-300/80">
          Customer upload and context for this request.
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">Upload detail</h1>
      </section>

      {/* Top card: customer + file */}
      <section className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-6 shadow-sm">
        <div className="grid gap-8 md:grid-cols-2">
          {/* Customer block */}
          <div className="space-y-3">
            <h2 className="text-lg font-medium">Customer</h2>
            <div className="space-y-1 text-sm">
              <p className="font-medium">
                {upload.customer_name || "Unknown customer"}
              </p>
              {upload.customer_email && (
                <p>
                  <a
                    href={`mailto:${upload.customer_email}`}
                    className="text-emerald-400 underline"
                  >
                    {upload.customer_email}
                  </a>
                </p>
              )}
              {upload.customer_company && (
                <p className="text-zinc-300">{upload.customer_company}</p>
              )}
            </div>

            <div className="mt-4 space-y-1 text-sm">
              <p className="font-medium">Initial request notes</p>
              <p className="whitespace-pre-line text-zinc-300">
                {upload.initial_request_notes || "—"}
              </p>
            </div>

            <div className="mt-4 space-y-1 text-xs text-zinc-400">
              <p>
                <span className="font-medium">Upload ID:</span> {upload.id}
              </p>
              <p>
                <span className="font-medium">Created:</span> {created}
              </p>
            </div>
          </div>

          {/* File block */}
          <div className="space-y-3">
            <h2 className="text-lg font-medium">File</h2>
            <div className="space-y-1 text-sm">
              <p className="font-medium break-all">
                {upload.file_name || "Unknown file"}
              </p>
              {upload.file_path && (
                <p className="break-all text-zinc-300">{upload.file_path}</p>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Admin controls */}
      <section className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-6 shadow-sm">
        <h2 className="text-lg font-medium mb-4">Admin controls</h2>

        <form action={updateUpload} className="space-y-6">
          {/* Important: hidden id so the server action knows what to update */}
          <input type="hidden" name="id" value={upload.id} />

          <div className="space-y-2">
            <label
              htmlFor="status"
              className="block text-sm font-medium text-zinc-100"
            >
              Status
            </label>
            <select
              id="status"
              name="status"
              defaultValue={upload.status || "New"}
              className="w-full rounded-md border border-zinc-700 bg-black px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
            >
              <option value="New">New</option>
              <option value="Reviewing">Reviewing</option>
              <option value="Quoted">Quoted</option>
              <option value="Won">Won</option>
              <option value="Lost">Lost</option>
            </select>
          </div>

          <div className="space-y-2">
            <label
              htmlFor="admin_notes"
              className="block text-sm font-medium text-zinc-100"
            >
              Admin notes
            </label>
            <textarea
              id="admin_notes"
              name="admin_notes"
              rows={5}
              defaultValue={upload.admin_notes || ""}
              className="w-full rounded-md border border-zinc-700 bg-black px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
              placeholder="Private notes for you/your team — customers never see these."
            />
            <p className="text-xs text-zinc-500">
              Private notes for you/your team — customers never see these.
            </p>
          </div>

          <button
            type="submit"
            className="inline-flex items-center rounded-full bg-emerald-500 px-4 py-2 text-sm font-medium text-black hover:bg-emerald-400 transition-colors"
          >
            Save changes
          </button>
        </form>
      </section>
    </main>
  );
}