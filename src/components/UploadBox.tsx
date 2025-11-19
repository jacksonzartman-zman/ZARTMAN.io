"use client";

import React, {
  useState,
  DragEvent,
  ChangeEvent,
  FormEvent,
} from "react";
import clsx from "clsx";

type UploadState = {
  file: File | null;
  name: string;
  email: string;
  company: string;
  notes: string;
};

export default function UploadBox() {
  const [uploadState, setUploadState] = useState<UploadState>({
    file: null,
    name: "",
    email: "",
    company: "",
    notes: "",
  });

  const [isDragging, setIsDragging] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // --- drag & drop handlers -------------------------------------------------

  const handleDragEnter = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(true);
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (!isDragging) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(false);

    const file = event.dataTransfer?.files?.[0];
    if (!file) return;

    setUploadState((prev) => ({
      ...prev,
      file,
    }));
  };

  // --- input handlers -------------------------------------------------------

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    setUploadState((prev) => ({
      ...prev,
      file,
    }));
  };

  const handleTextChange =
    (field: keyof UploadState) =>
    (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const value = event.target.value;
      setUploadState((prev) => ({
        ...prev,
        [field]: value,
      }));
    };

  // --- submit handler -------------------------------------------------------

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    if (!uploadState.file) {
      setError("Please add a CAD file before uploading.");
      return;
    }

    if (!uploadState.name || !uploadState.email) {
      setError("Name and email are required.");
      return;
    }

    try {
      setIsSubmitting(true);

      const formData = new FormData();
      formData.append("file", uploadState.file);
      formData.append("name", uploadState.name);
      formData.append("email", uploadState.email);
      formData.append("company", uploadState.company);
      formData.append("notes", uploadState.notes);

      // This assumes you already have /api/upload wired up.
      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        const message =
          body?.error || `Upload failed with status ${res.status}`;
        throw new Error(message);
      }

      setSuccess("Thanks — your CAD file is in the queue. I’ll take a look.");
      setUploadState({
        file: null,
        name: "",
        email: "",
        company: "",
        notes: "",
      });
    } catch (err: any) {
      setError(err?.message ?? "Something went wrong while uploading.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const isSubmitDisabled =
    isSubmitting ||
    !uploadState.file ||
    !uploadState.name.trim() ||
    !uploadState.email.trim();

  // --- JSX ------------------------------------------------------------------

  return (
    <section className="mx-auto flex max-w-5xl flex-col gap-6 sm:flex-row sm:items-start sm:gap-10">
      {/* Left side: marketing copy (you can tweak text however you like) */}
      <div className="sm:w-1/2 space-y-4">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Upload a CAD file
        </h1>
        <p className="text-sm text-muted">
          STEP, IGES, STL, SolidWorks & zipped assemblies. No spam, no nurture
          sequence — just manufacturability feedback and a realistic path to
          parts-in-hand.
        </p>

        <div className="grid gap-3 text-sm sm:grid-cols-3">
          <div className="rounded-xl border border-border/40 bg-surface-muted/40 p-3">
            <p className="font-medium">For real work</p>
            <p className="mt-1 text-xs text-muted">
              Production, service parts, and weird one-offs that don&apos;t fit
              in a dropdown.
            </p>
          </div>
          <div className="rounded-xl border border-border/40 bg-surface-muted/40 p-3">
            <p className="font-medium">Built from war stories</p>
            <p className="mt-1 text-xs text-muted">
              Lessons from thousands of jobs at Protolabs, Hubs, and
              friends-of-the-industry.
            </p>
          </div>
          <div className="rounded-xl border border-border/40 bg-surface-muted/40 p-3">
            <p className="font-medium">Not another portal</p>
            <p className="mt-1 text-xs text-muted">
              One front door for context, not another login you&apos;ll forget.
            </p>
          </div>
        </div>
      </div>

      {/* Right side: intake + drag/drop upload */}
      <form
        onSubmit={handleSubmit}
        className="sm:w-1/2 rounded-2xl border border-border bg-surface p-5 sm:p-6"
      >
        {/* Drag & drop / file input */}
        <div
          className={clsx(
            "flex flex-col items-center justify-center rounded-2xl border-2 border-dashed px-4 py-8 text-center text-sm transition",
            isDragging
              ? "border-accent/60 bg-accent/5"
              : "border-border/80 bg-surface-muted/30"
          )}
          onDragEnter={handleDragEnter}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <p className="font-medium">CAD file</p>
          <p className="mt-1 text-xs text-muted">
            STEP, IGES, STL, SolidWorks, or zipped assemblies. Max ~25 MB.
          </p>

          <div className="mt-4 flex flex-col items-center gap-2">
            <label className="inline-flex cursor-pointer items-center rounded-full border border-border bg-surface px-4 py-1.5 text-xs font-medium">
              <span>{uploadState.file ? "Change file" : "Browse files"}</span>
              <input
                type="file"
                name="file"
                accept=".step,.stp,.iges,.igs,.stl,.sldprt,.zip"
                className="hidden"
                onChange={handleFileChange}
              />
            </label>
            <p className="text-[11px] text-muted">
              or drag &amp; drop into this box
            </p>
          </div>

          {uploadState.file && (
            <p className="mt-3 text-xs text-muted">
              Selected:{" "}
              <span className="font-medium">{uploadState.file.name}</span>
            </p>
          )}
        </div>

        {/* Text fields */}
        <div className="mt-6 grid grid-cols-1 gap-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <label className="text-xs font-medium">
                Your name<span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent focus:ring-1 focus:ring-accent"
                value={uploadState.name}
                onChange={handleTextChange("name")}
                placeholder="Jackson"
                required
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium">
                Email<span className="text-red-400">*</span>
              </label>
              <input
                type="email"
                className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent focus:ring-1 focus:ring-accent"
                value={uploadState.email}
                onChange={handleTextChange("email")}
                placeholder="engineer@company.com"
                required
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium">Company</label>
            <input
              type="text"
              className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent focus:ring-1 focus:ring-accent"
              value={uploadState.company}
              onChange={handleTextChange("company")}
              placeholder="Zart LLC"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium">
              Process / quantity / timing
            </label>
            <textarea
              className="min-h-[80px] w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent focus:ring-1 focus:ring-accent"
              value={uploadState.notes}
              onChange={handleTextChange("notes")}
              placeholder="CNC, qty 50, target ship date, special material or tolerances…"
            />
          </div>
        </div>

        {/* Submit + messages */}
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[11px] text-muted">
            Hit upload and I&apos;ll review manufacturability, pricing options,
            and where this fits best in the network. You&apos;ll hear from a
            human, not a bot.
          </p>

          <button
            type="submit"
            disabled={isSubmitDisabled}
            className={clsx(
              "inline-flex items-center justify-center rounded-full px-5 py-2 text-sm font-medium transition",
              isSubmitDisabled
                ? "cursor-not-allowed bg-border/60 text-muted"
                : "bg-accent text-ink hover:bg-accent/90"
            )}
          >
            {isSubmitting ? "Uploading…" : "Upload file"}
          </button>
        </div>

        {error && (
          <p className="mt-3 text-xs text-red-400" role="alert">
            Error: {error}
          </p>
        )}

        {success && (
          <p className="mt-3 text-xs text-emerald-400" role="status">
            {success}
          </p>
        )}
      </form>
    </section>
  );
}