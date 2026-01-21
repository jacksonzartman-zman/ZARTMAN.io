"use client";

import clsx from "clsx";
import { useRef, useState, type ChangeEvent } from "react";
import {
  getUploadTargetsForCustomerQuote,
  registerUploadedFilesForCustomerQuote,
  type CustomerUploadTarget,
  type CustomerUploadsFormState,
} from "./actions";
import { ctaSizeClasses, primaryCtaClasses } from "@/lib/ctas";
import { formatMaxUploadSize, isFileTooLarge } from "@/lib/uploads/uploadLimits";
import { supabaseBrowser } from "@/lib/supabase.client";

const initialState: CustomerUploadsFormState = { status: "idle" };

const UPLOAD_ACCEPT = ".pdf,.dwg,.dxf,.step,.stp,.igs,.iges,.sldprt,.prt,.stl,.zip";

export function CustomerUploadsForm({ quoteId }: { quoteId: string }) {
  const [state, setState] = useState<CustomerUploadsFormState>(initialState);
  const [pending, setPending] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const maxLabel = formatMaxUploadSize();

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    const tooLarge = files.filter((f) => isFileTooLarge(f));
    if (tooLarge.length > 0) {
      setLocalError(
        `One or more files are over the ${maxLabel} limit. Please upload smaller files or split large ZIPs into multiple uploads.`,
      );
    } else {
      setLocalError(null);
    }
  }

  return (
    <section className="rounded-2xl border border-slate-900 bg-slate-950/40 px-6 py-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Add files
          </p>
          <p className="mt-1 text-sm text-slate-300">
            Upload CAD, drawings, PDFs, or ZIPs to this search request. After upload, files will
            appear below and can be linked to parts.
          </p>
        </div>
      </div>

      <form
        className="mt-4 space-y-3"
        onSubmit={async (e) => {
          const files = Array.from(inputRef.current?.files ?? []);
          const tooLarge = files.filter((f) => isFileTooLarge(f));
          if (tooLarge.length > 0) {
            e.preventDefault();
            setLocalError(
              `One or more files are over the ${maxLabel} limit. Please upload smaller files or split large ZIPs into multiple uploads.`,
            );
            return;
          }
          e.preventDefault();
          setLocalError(null);
          setState({ status: "idle" });

          if (files.length === 0) {
            setState({
              status: "error",
              message: "Choose one or more files to upload.",
            });
            return;
          }

          setPending(true);
          try {
            const filesMeta = files.map((file) => ({
              fileName: file.name,
              sizeBytes: file.size,
              mimeType: file.type || null,
            }));

            const prepareData = new FormData();
            prepareData.set("filesMeta", JSON.stringify(filesMeta));

            const prepare = await getUploadTargetsForCustomerQuote(
              quoteId,
              { status: "idle" },
              prepareData,
            );

            if (!("targets" in prepare)) {
              setState(prepare);
              return;
            }

            const targets = prepare.targets;
            if (targets.length !== files.length) {
              setState({
                status: "error",
                message: "We couldn’t prepare your upload. Please try again.",
              });
              return;
            }

            const sb = supabaseBrowser();
            for (let i = 0; i < targets.length; i += 1) {
              const target = targets[i] as CustomerUploadTarget;
              const file = files[i]!;

              const { error: storageError } = await sb.storage
                .from(target.bucketId)
                .upload(target.storagePath, file, {
                  cacheControl: "3600",
                  upsert: false,
                  contentType: target.mimeType || file.type || "application/octet-stream",
                });

              if (storageError) {
                console.error("[customer uploads] storage upload failed", storageError);
                setState({
                  status: "error",
                  message:
                    "We couldn’t upload one or more files. Nothing was changed—please try again.",
                });
                return;
              }
            }

            const registerData = new FormData();
            registerData.set("targets", JSON.stringify(targets));

            const registered = await registerUploadedFilesForCustomerQuote(
              quoteId,
              { status: "idle" },
              registerData,
            );
            setState(registered);

            if (registered.status === "success" && inputRef.current) {
              inputRef.current.value = "";
            }
          } finally {
            setPending(false);
          }
        }}
      >
        <input
          type="file"
          name="files"
          multiple
          accept={UPLOAD_ACCEPT}
          ref={inputRef}
          onChange={handleFileChange}
          className="block w-full text-sm text-slate-200 file:mr-4 file:rounded-lg file:border-0 file:bg-slate-800 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-slate-100 hover:file:bg-slate-700"
        />

        {localError ? (
          <p className="text-sm text-red-200" role="alert">
            {localError}
          </p>
        ) : null}

        {state.status === "error" ? (
          <p className="text-sm text-red-200" role="alert">
            {state.message ?? "We couldn’t upload your files. Please try again."}
          </p>
        ) : null}

        {state.status === "success" ? (
          <p className="text-sm text-emerald-200" role="status">
            {state.message ?? "Files uploaded. They’ll appear below shortly."}
          </p>
        ) : null}

        <p className="text-[11px] text-slate-500">
          Max {maxLabel} per file. For larger packages, upload multiple ZIPs.
        </p>

        <SubmitButton pending={pending} />
      </form>
    </section>
  );
}

function SubmitButton({ pending }: { pending: boolean }) {
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
