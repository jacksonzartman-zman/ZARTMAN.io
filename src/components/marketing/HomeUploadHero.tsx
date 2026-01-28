"use client";

import { useCallback, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import Link from "next/link";
import clsx from "clsx";
import {
  CAD_ACCEPT_STRING,
  CAD_FILE_TYPE_DESCRIPTION,
  isAllowedCadFileName,
} from "@/lib/cadFileTypes";
import { formatMaxUploadSize, isFileTooLarge } from "@/lib/uploads/uploadLimits";

type UploadStep = "idle" | "uploading" | "processing" | "offers";

type UploadResult =
  | { ok: true; quoteId: string; uploadId: string; intakeKey: string }
  | { ok: false; error: string };

const MAX_FILES_PER_RFQ = 20;
const MAX_UPLOAD_SIZE_LABEL = formatMaxUploadSize();

export function HomeUploadHero() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [step, setStep] = useState<UploadStep>("idle");
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<Extract<UploadResult, { ok: true }> | null>(null);

  const statusLabel = useMemo(() => {
    if (step === "uploading") return "Uploading…";
    if (step === "processing") return "Processing…";
    if (step === "offers") return "Offers coming…";
    return null;
  }, [step]);

  const trackingHref = useMemo(() => {
    if (!lastResult) return null;
    const params = new URLSearchParams();
    params.set("quote", lastResult.quoteId);
    params.set("key", lastResult.intakeKey);
    return `/rfq?${params.toString()}`;
  }, [lastResult]);

  const validateFiles = useCallback((files: File[]): string | null => {
    if (files.length === 0) return "Add at least one CAD or ZIP file.";
    if (files.length > MAX_FILES_PER_RFQ) return `Upload up to ${MAX_FILES_PER_RFQ} files at once.`;
    for (const file of files) {
      if (!isAllowedCadFileName(file.name)) {
        return `Unsupported file type. Please upload ${CAD_FILE_TYPE_DESCRIPTION}.`;
      }
      if (isFileTooLarge(file)) {
        return `Each file must be smaller than ${MAX_UPLOAD_SIZE_LABEL}.`;
      }
      if (file.size === 0) {
        return `“${file.name}” is empty. Please choose another file.`;
      }
    }
    return null;
  }, []);

  const startUpload = useCallback(
    async (files: File[]) => {
      if (step !== "idle") return;
      setError(null);
      setLastResult(null);

      const validationError = validateFiles(files);
      if (validationError) {
        setError(validationError);
        return;
      }

      setStep("uploading");
      try {
        const form = new FormData();
        files.forEach((file) => form.append("files", file));
        form.set("source", "home");

        const res = await fetch("/api/intake", { method: "POST", body: form });
        const payload = (await res.json().catch(() => null)) as UploadResult | null;
        if (!payload || payload.ok !== true) {
          const message =
            payload && payload.ok === false && typeof payload.error === "string"
              ? payload.error
              : "We couldn’t start your RFQ. Please try again.";
          setError(message);
          setStep("idle");
          return;
        }

        setLastResult(payload);
        setStep("processing");

        // UI-only: give the backend a moment to enqueue analysis.
        window.setTimeout(() => setStep("offers"), 1600);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Upload failed. Please try again.");
        setStep("idle");
      }
    },
    [step, validateFiles],
  );

  const onDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setIsDragging(false);
      if (step !== "idle") return;
      const files = Array.from(event.dataTransfer.files ?? []);
      void startUpload(files);
    },
    [startUpload, step],
  );

  const onPick = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const files = event.target.files ? Array.from(event.target.files) : [];
      event.target.value = "";
      if (step !== "idle") return;
      void startUpload(files);
    },
    [startUpload, step],
  );

  return (
    <div className="mx-auto max-w-4xl">
      <div className="flex flex-col items-center text-center gap-4">
        <h1 className="text-4xl sm:text-5xl font-semibold text-ink heading-tight">
          RFQs without the chaos
        </h1>
        <p className="mx-auto max-w-2xl text-base sm:text-lg text-ink-muted heading-snug">
          Upload your CAD files and get instant manufacturing offers — no forms, no friction.
        </p>
      </div>

      <div className="mt-8 sm:mt-10">
        <div
          className={clsx(
            "group relative overflow-hidden rounded-[28px] border-2 border-dashed px-6 py-10 sm:px-10 sm:py-12 transition",
            "bg-slate-950/55 shadow-[0_40px_110px_rgba(2,6,23,0.38)]",
            isDragging
              ? "border-emerald-300/70 bg-emerald-500/10"
              : "border-slate-900/60 hover:border-slate-700/80",
            step !== "idle" && "pointer-events-none opacity-95",
          )}
          onDragEnter={(event) => {
            event.preventDefault();
            setIsDragging(true);
          }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={() => setIsDragging(false)}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          role="button"
          tabIndex={0}
          aria-label="Upload CAD or ZIP files"
        >
          <div
            aria-hidden
            className={clsx(
              "pointer-events-none absolute inset-0 opacity-0 transition duration-300",
              isDragging && "opacity-100",
              "bg-[radial-gradient(55%_55%_at_50%_35%,rgba(16,185,129,0.25),transparent_70%)]",
            )}
          />

          <div className="relative flex flex-col items-center justify-center gap-3 text-center">
            <p className="text-sm font-semibold text-ink">
              Drag & drop CAD files or a zipped folder
            </p>
            <p className="text-xs text-ink-soft">
              Or click to choose files · {CAD_FILE_TYPE_DESCRIPTION} · Max {MAX_UPLOAD_SIZE_LABEL} per file · Up to{" "}
              {MAX_FILES_PER_RFQ} files
            </p>

            {statusLabel ? (
              <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-500/10 px-4 py-2 text-sm font-semibold text-emerald-100">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-300 animate-pulse" aria-hidden />
                <span aria-live="polite">{statusLabel}</span>
              </div>
            ) : (
              <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-slate-800/70 bg-slate-950/40 px-4 py-2 text-sm font-semibold text-ink-soft transition group-hover:border-slate-700">
                <span className="text-ink">Upload CAD/ZIP</span>
                <span className="text-ink-muted">→</span>
              </div>
            )}

            <input
              ref={inputRef}
              type="file"
              multiple
              accept={CAD_ACCEPT_STRING}
              className="sr-only"
              onChange={onPick}
            />
          </div>
        </div>

        {error ? (
          <div className="mt-4 rounded-2xl border border-red-500/35 bg-red-500/10 px-4 py-3 text-sm text-red-100">
            {error}
          </div>
        ) : null}

        {trackingHref && step !== "idle" ? (
          <div className="mt-4 flex flex-wrap items-center justify-center gap-3 text-sm text-ink-soft">
            <span className="text-ink-soft">Want to check back later?</span>
            <Link
              href={trackingHref}
              className="rounded-full border border-slate-800 bg-slate-950/40 px-4 py-2 text-xs font-semibold text-ink transition hover:border-slate-700"
            >
              Open your RFQ status
            </Link>
          </div>
        ) : null}
      </div>
    </div>
  );
}

