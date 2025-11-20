// src/app/admin/uploads/[id]/page.tsx

import { notFound } from "next/navigation";
import { supabaseServer } from "@/lib/supabaseServer";
import { updateUpload } from "./actions";
import { SuccessBanner } from "./SuccessBanner";

type UploadRow = {
  id: string;
  name: string | null;
  email: string | null;
  company: string | null;
  file_name: string | null;
  file_path: string | null;
  initial_request_notes: string | null;
  status: string | null;
  admin_notes: string | null;
  created_at: string | null;
};

export default async function UploadDetailPage(props: any) {
  const { params, searchParams } = props as {
    params: { id: string };
    searchParams?: { updated?: string };
  };

  const supabase = supabaseServer;

  // Fetch upload by ID
  const { data, error } = await supabase
    .from("uploads")
    .select("*")
    .eq("id", params.id)
    .maybeSingle<UploadRow>();

  if (error) {
    console.error("Error fetching upload", error);
    notFound();
  }

  if (!data) {
    notFound();
  }

  const upload = data;

  const created =
    upload.created_at &&
    new Date(upload.created_at).toLocaleString("en-US", {
      month: "short",
      day: "2-digit",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });

  const wasUpdated = searchParams?.updated === "1";

  return (
    <main className="mx-auto max-w-4xl px-4 py-10 space-y-8">
      {wasUpdated && (
        <SuccessBanner message="Changes saved and quote recorded." />
      )}

      {/* Top card – customer + file details */}
      <section className="rounded-xl border border-slate-800 bg-slate-950/60 p-6 shadow-sm">
        <h1 className="text-xl font-semibold text-slate-50">Upload detail</h1>
        <p className="mt-1 text-sm text-slate-400">
          Customer upload and context for this request.
        </p>

        <div className="mt-6 grid gap-8 md:grid-cols-2">
          {/* Customer block */}
          <div className="space-y-3">
            <h2 className="text-sm font-medium text-slate-300">Customer</h2>
            <p className="text-base font-medium text-slate-50">
              {upload.name || "Unknown customer"}
            </p>
            {upload.email && (
              <p>
                <a
                  href={`mailto:${upload.email}`}
                  className="text-sm text-emerald-400 hover:underline"
                >
                  {upload.email}
                </a>
              </p>
            )}
            {upload.company && (
              <p className="text-sm text-slate-300">{upload.company}</p>
            )}

            <div className="mt-4">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                Initial request notes
              </p>
              <p className="mt-1 whitespace-pre-line text-sm text-slate-200">
                {upload.initial_request_notes || "—"}
              </p>
            </div>

            <p className="mt-4 text-xs text-slate-500">
              Upload ID:{" "}
              <span className="font-mono break-all">{upload.id}</span>
              <br />
              Created: {created || "Unknown"}
            </p>
          </div>

          {/* File block */}
          <div className="space-y-3">
            <h2 className="text-sm font-medium text-slate-300">File</h2>
            <p className="text-sm text-slate-200">
              {upload.file_name || "Unknown file"}
            </p>
            {upload.file_path && (
              <p className="text-xs text-slate-400 break-all">
                {upload.file_path}
              </p>
            )}
          </div>
        </div>
      </section>

      {/* Admin controls */}
      <section className="rounded-xl border border-slate-800 bg-slate-950/60 p-6 shadow-sm">
        <h2 className="text-base font-semibold text-slate-50">
          Admin controls
        </h2>
        <p className="mt-1 text-xs text-slate-400">
          Private notes for you/your team — customers never see these.
        </p>

        <form
          className="mt-4 space-y-5"
          action={async (formData: FormData) => {
            "use server";
            await updateUpload(formData);
          }}
        >
          <input type="hidden" name="id" value={upload.id} />

          <div className="space-y-1.5">
            <label
              htmlFor="status"
              className="block text-sm font-medium text-slate-200"
            >
              Status
            </label>
            <select
              id="status"
              name="status"
              defaultValue={upload.status || "new"}
              className="w-full rounded-md border border-slate-700 bg-black/40 px-3 py-2 text-sm text-slate-100 outline-none focus:border-emerald-400"
            >
              <option value="new">New</option>
              <option value="in_review">In review</option>
              <option value="quoted">Quoted</option>
              <option value="on_hold">On hold</option>
              <option value="closed_lost">Closed lost</option>
            </select>
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="admin_notes"
              className="block text-sm font-medium text-slate-200"
            >
              Admin notes
            </label>
            <textarea
              id="admin_notes"
              name="admin_notes"
              defaultValue={upload.admin_notes || ""}
              rows={5}
              className="w-full rounded-md border border-slate-700 bg-black/40 px-3 py-2 text-sm text-slate-100 outline-none focus:border-emerald-400"
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