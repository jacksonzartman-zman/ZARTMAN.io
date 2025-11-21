// src/app/admin/uploads/[id]/page.tsx

import { notFound } from "next/navigation";
import { supabaseServer } from "@/lib/supabaseServer";
import { updateUpload } from "./actions";
import { SuccessBanner } from "./SuccessBanner";
import {
  DEFAULT_UPLOAD_STATUS,
  UPLOAD_STATUS_LABELS,
  UPLOAD_STATUS_OPTIONS,
  normalizeUploadStatus,
} from "../../constants";

type UploadRow = {
  id: string;
  name: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  company: string | null;
  phone: string | null;
  manufacturing_process: string | null;
  quantity: string | null;
  shipping_postal_code: string | null;
  export_restriction: string | null;
  rfq_reason: string | null;
  itar_acknowledged: boolean | null;
  terms_accepted: boolean | null;
  file_name: string | null;
  file_path: string | null;
  notes: string | null;
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
  const resolvedStatus = normalizeUploadStatus(
    upload.status,
    DEFAULT_UPLOAD_STATUS,
  );

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
  const contactName =
    [upload.first_name, upload.last_name]
      .filter((value) => typeof value === "string" && value.trim().length > 0)
      .map((value) => (value ?? "").trim())
      .join(" ")
      .trim() || upload.name || "Unknown customer";
  const contactEmail =
    typeof upload.email === "string" && upload.email.includes("@")
      ? upload.email
      : null;
  const contactPhone =
    typeof upload.phone === "string" && upload.phone.trim().length > 0
      ? upload.phone.trim()
      : null;
  const companyName =
    typeof upload.company === "string" && upload.company.trim().length > 0
      ? upload.company
      : null;
  const metadataItems: { label: string; value: string }[] = [
    {
      label: "Manufacturing process",
      value: upload.manufacturing_process || "—",
    },
    {
      label: "Quantity / volumes",
      value: upload.quantity || "—",
    },
    {
      label: "Export restriction",
      value: upload.export_restriction || "—",
    },
    {
      label: "Shipping ZIP / Postal code",
      value: upload.shipping_postal_code || "—",
    },
    {
      label: "RFQ reason",
      value: upload.rfq_reason || "—",
    },
    {
      label: "ITAR acknowledgement",
      value: upload.itar_acknowledged ? "Acknowledged" : "Not confirmed",
    },
    {
      label: "Terms acceptance",
      value: upload.terms_accepted ? "Accepted" : "Not accepted",
    },
  ];
  if (companyName) {
    metadataItems.unshift({ label: "Company", value: companyName });
  }

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

        <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <div className="space-y-6">
            <div className="space-y-3">
              <h2 className="text-sm font-medium text-slate-300">Contact</h2>
              <p className="text-base font-medium text-slate-50">
                {contactName}
              </p>
              {contactEmail && (
                <p>
                  <a
                    href={`mailto:${contactEmail}`}
                    className="text-sm text-emerald-400 hover:underline"
                  >
                    {contactEmail}
                  </a>
                </p>
              )}
              {contactPhone && (
                <p>
                  <a
                    href={`tel:${contactPhone}`}
                    className="text-sm text-slate-300 hover:text-emerald-300"
                  >
                    {contactPhone}
                  </a>
                </p>
              )}
              {companyName && (
                <p className="text-sm text-slate-300">{companyName}</p>
              )}
            </div>

            <div className="rounded-lg border border-slate-900/80 bg-slate-950/60 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                RFQ summary
              </p>
              <dl className="mt-3 grid gap-3 text-sm text-slate-200 sm:grid-cols-2">
                {metadataItems.map((item) => (
                  <div key={item.label}>
                    <dt className="text-slate-500">{item.label}</dt>
                    <dd className="font-medium text-slate-100">
                      {item.value}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>

            <div className="rounded-lg border border-slate-900/80 bg-slate-950/60 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Project details / notes
              </p>
              <p className="mt-2 whitespace-pre-line text-sm text-slate-200">
                {upload.notes || "—"}
              </p>
            </div>

            <p className="text-xs text-slate-500">
              Upload ID:{" "}
              <span className="font-mono break-all">{upload.id}</span>
              <br />
              Created: {created || "Unknown"}
            </p>
          </div>

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
              defaultValue={resolvedStatus}
              className="w-full rounded-md border border-slate-700 bg-black/40 px-3 py-2 text-sm text-slate-100 outline-none focus:border-emerald-400"
            >
              {UPLOAD_STATUS_OPTIONS.map((status) => (
                <option key={status} value={status}>
                  {UPLOAD_STATUS_LABELS[status]}
                </option>
              ))}
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
