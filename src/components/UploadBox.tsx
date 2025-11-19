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
  fileName: string;
  name: string;
  email: string;
  company: string;
  notes: string;
};

export default function UploadBox() {
  const [state, setState] = useState<UploadState>({
    file: null,
    fileName: "",
    name: "",
    email: "",
    company: "",
    notes: "",
  });

  const [isDragging, setIsDragging] = useState(false);
  const [isSubmitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // ---------- helpers ----------

  function handleFileSelected(file: File | null) {
    if (!file) return;

    setState((prev) => ({
      ...prev,
      file,
      fileName: file.name,
    }));
    setError(null);
    setSuccess(null);
  }

  // ---------- drag & drop ----------

  function handleDragEnter(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }

  function handleDragOver(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }

  function handleDragLeave(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const file = e.dataTransfer?.files?.[0];
    if (!file) return;

    handleFileSelected(file);
  }

  // ---------- inputs ----------

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    handleFileSelected(file);
  }

  function handleFieldChange(
    e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) {
    const { name, value } = e.target;

    setState((prev) => ({
      ...prev,
      [name]: value,
    }));
  }

  // ---------- submit ----------

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    // basic client validation
    if (!state.file) {
      setError("Please select a CAD file to upload.");
      setSuccess(null);
      return;
    }

    if (!state.name || !state.email) {
      setError("Name and email are required.");
      setSuccess(null);
      return;
    }

    setSubmitting(true);
    setError(null);
    setSuccess(null);

    try {
      const formData = new FormData();
      formData.append("file", state.file);
      formData.append("name", state.name);
      formData.append("email", state.email);
      formData.append("company", state.company);
      formData.append("notes", state.notes);

      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.message ?? "Upload failed");
      }

      // Success – keep contact info, reset file + notes
      setState((prev) => ({
        ...prev,
        file: null,
        fileName: "",
        notes: "",
      }));

      setSuccess("Thanks — your CAD file is in the queue. I’ll take a look.");
      setError(null);
    } catch (err: any) {
      console.error(err);
      setError(
        err?.message ?? "Upload failed. Please try again or email the file."
      );
      setSuccess(null);
    } finally {
      setSubmitting(false);
    }
  }

  // ---------- UI ----------

  return (
    <section
      aria-label="CAD upload"
      className="rounded-3xl border border-border bg-surface px-6 py-6 sm:px-8 sm:py-8"
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {/* Drop zone */}
        <div
          className={clsx(
            "rounded-3xl border-2 border-dashed px-6 py-6 text-center text-xs sm:text-sm",
            isDragging
              ? "border-accent/70 bg-accent/5"
              : "border-border/80 bg-surface"
          )}
          onDragEnter={handleDragEnter}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <p className="font-medium text-muted">
            STEP, IGES, STL, SolidWorks, or zipped assemblies. Max ~25 MB.
          </p>
          <div className="mt-4 flex items-center justify-center">
            <label
              htmlFor="file"
              className="inline-flex cursor-pointer items-center justify-center rounded-full border border-border bg-surface px-4 py-2 text-xs font-medium text-foreground transition hover:bg-border/20"
            >
              Browse from device
            </label>
            <input
              id="file"
              name="file"
              type="file"
              className="hidden"
              onChange={handleFileChange}
            />
          </div>
          <p className="mt-2 text-[11px] text-muted">
            …or drag &amp; drop into this box
          </p>
          <p className="mt-1 text-[11px] text-muted">
            Selected:{" "}
            {state.fileName ? state.fileName : "No file selected yet"}
          </p>
        </div>

        {/* Name / email */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <label
              htmlFor="name"
              className="text-[11px] font-medium text-muted"
            >
              Your name*
            </label>
            <input
              id="name"
              name="name"
              required
              value={state.name}
              onChange={handleFieldChange}
              className="h-9 rounded-md border border-border bg-surface px-3 text-sm text-foreground outline-none focus:border-accent focus:ring-0"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label
              htmlFor="email"
              className="text-[11px] font-medium text-muted"
            >
              Email*
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              value={state.email}
              onChange={handleFieldChange}
              className="h-9 rounded-md border border-border bg-surface px-3 text-sm text-foreground outline-none focus:border-accent focus:ring-0"
            />
          </div>
        </div>

        {/* Company */}
        <div className="flex flex-col gap-1">
          <label
            htmlFor="company"
            className="text-[11px] font-medium text-muted"
          >
            Company
          </label>
          <input
            id="company"
            name="company"
            value={state.company}
            onChange={handleFieldChange}
            className="h-9 rounded-md border border-border bg-surface px-3 text-sm text-foreground outline-none focus:border-accent focus:ring-0"
          />
        </div>

        {/* Notes */}
        <div className="flex flex-col gap-1">
          <label
            htmlFor="notes"
            className="text-[11px] font-medium text-muted"
          >
            Process / quantity / timing
          </label>
          <textarea
            id="notes"
            name="notes"
            rows={3}
            value={state.notes}
            onChange={handleFieldChange}
            placeholder="CNC, qty 50, target ship date, special material or tolerances..."
            className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-0"
          />
        </div>

        {/* Submit */}
        <button
          type="submit"
          disabled={isSubmitting}
          className="mt-2 w-full rounded-full bg-emerald-500 px-6 py-3 text-sm font-medium text-black shadow-sm transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {isSubmitting ? "Uploading..." : "Upload file"}
        </button>

        {/* Messages */}
        {error && (
          <p className="mt-1 text-xs text-red-400" role="alert">
            Error: {error}
          </p>
        )}
        {success && (
          <p className="mt-1 text-xs text-emerald-400" role="status">
            {success}
          </p>
        )}
      </form>
    </section>
  );
}