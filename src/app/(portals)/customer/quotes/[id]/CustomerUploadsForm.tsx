"use client";

import clsx from "clsx";
import { useFormState, useFormStatus } from "react-dom";
import {
  customerUploadQuoteFilesAction,
  type CustomerUploadsFormState,
} from "./actions";
import { ctaSizeClasses, primaryCtaClasses } from "@/lib/ctas";

const initialState: CustomerUploadsFormState = { status: "idle" };

const UPLOAD_ACCEPT = ".pdf,.dwg,.dxf,.step,.stp,.igs,.iges,.sldprt,.prt,.stl,.zip";

export function CustomerUploadsForm({ quoteId }: { quoteId: string }) {
  const [state, formAction] = useFormState<CustomerUploadsFormState, FormData>(
    (prevState, formData) =>
      customerUploadQuoteFilesAction(quoteId, prevState, formData),
    initialState,
  );

  return (
    <section className="rounded-2xl border border-slate-900 bg-slate-950/40 px-6 py-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Add files
          </p>
          <p className="mt-1 text-sm text-slate-300">
            Upload additional CAD, drawings, PDFs, or ZIPs to this quote.
          </p>
        </div>
      </div>

      <form action={formAction} className="mt-4 space-y-3" encType="multipart/form-data">
        <input
          type="file"
          name="files"
          multiple
          accept={UPLOAD_ACCEPT}
          className="block w-full text-sm text-slate-200 file:mr-4 file:rounded-lg file:border-0 file:bg-slate-800 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-slate-100 hover:file:bg-slate-700"
        />

        {state.status === "error" ? (
          <p className="text-sm text-red-200" role="alert">
            {state.message ?? "Could not upload files."}
          </p>
        ) : null}

        {state.status === "success" ? (
          <p className="text-sm text-emerald-200" role="status">
            {state.message ?? "Files uploaded."}
          </p>
        ) : null}

        <SubmitButton />
      </form>
    </section>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className={clsx(primaryCtaClasses, ctaSizeClasses.sm, "inline-flex")}
    >
      {pending ? "Uploading…" : "Upload"}
    </button>
  );
}
