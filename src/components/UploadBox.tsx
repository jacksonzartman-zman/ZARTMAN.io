"use client";

import React, { useState, DragEvent, ChangeEvent, FormEvent } from "react";
import clsx from "clsx";

type UploadState = {
  file: File | null;
  fileName: string | null;
  name: string;
  email: string;
  company: string;
  notes: string;
};

const initialState: UploadState = {
  file: null,
  fileName: null,
  name: "",
  email: "",
  company: "",
  notes: "",
};

const ALLOWED_EXTENSIONS = [
  "step",
  "stp",
  "iges",
  "igs",
  "stl",
  "sldprt",
  "sldasm",
  "zip",
  "prt",
  "sat",
  "x_t",
  "x_b",
  "ipt",
];

function isAllowedFile(file: File): boolean {
  const parts = file.name.toLowerCase().split(".");
  const ext = parts.length > 1 ? parts.pop()! : "";
  return ALLOWED_EXTENSIONS.includes(ext);
}

export default function UploadBox() {
  const [state, setState] = useState<UploadState>(initialState);
  const [isDragging, setIsDragging] = useState(false);
  const [isSubmitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const canSubmit = !!(state.file && state.name && state.email);

  const handleDragEnter = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const file = e.dataTransfer.files?.[0];
    if (!file) return;

    if (!isAllowedFile(file)) {
      setError(
        "Unsupported file type. Please upload STEP, IGES, STL, SolidWorks, or zipped CAD files."
      );
      setSuccess(false);
      setState((prev) => ({ ...prev, file: null, fileName: null }));
      return;
    }

    setError(null);
    setSuccess(false);
    setState((prev) => ({ ...prev, file, fileName: file.name }));
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    if (!file) return;

    if (!isAllowedFile(file)) {
      setError(
        "Unsupported file type. Please upload STEP, IGES, STL, SolidWorks, or zipped CAD files."
      );
      setSuccess(false);
      setState((prev) => ({ ...prev, file: null, fileName: null }));
      // Clear so they can re-choose
      e.target.value = "";
      return;
    }

    setError(null);
    setSuccess(false);
    setState((prev) => ({ ...prev, file, fileName: file.name }));
  };

  const handleChange =
    (field: keyof UploadState) =>
    (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const value = e.target.value;
      setState((prev) => ({ ...prev, [field]: value }));
    };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    if (!state.file) {
      setError("Please select a CAD file to upload.");
      return;
    }

    if (!isAllowedFile(state.file)) {
      setError(
        "Unsupported file type. Please upload STEP, IGES, STL, SolidWorks, or zipped CAD files."
      );
      return;
    }

    if (!state.name || !state.email) {
      setError("Please add at least your name and email.");
      return;
    }

    setSubmitting(true);

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
        const data = (await res.json().catch(() => null)) as
          | { message?: string }
          | null;
        throw new Error(data?.message ?? "Upload failed");
      }

      // Success → keep contact info, reset file + notes
      setState((prev) => ({
        ...prev,
        file: null,
        fileName: null,
        notes: "",
      }));
      setSuccess(true);
      setError(null);
    } catch (err: any) {
      console.error(err);
      setError(err?.message ?? "Upload failed. Please try again.");
      setSuccess(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section
      aria-label="Upload CAD file"
      className="relative flex flex-col rounded-3xl border border-border bg-surface p-6 sm:p-8"
    >
      {/* Drag & drop / file box */}
      <div
        className={clsx(
          "flex flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-10 text-center text-sm sm:px-8 sm:py-12",
          isDragging ? "border-accent/80 bg-accent/5" : "border-border/60"
        )}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <p className="text-xs text-muted">
          STEP, IGES, STL, SolidWorks, or zipped assemblies. Max ~25 MB.
        </p>
        <div className="mt-4 flex flex-col items-center gap-2">
          <label
            htmlFor="file"
            className="inline-flex cursor-pointer items-center justify-center rounded-full border border-border px-4 py-2 text-xs font-medium text-foreground transition hover:border-accent hover:text-accent"
          >
            Browse from device
          </label>
          <p className="text-[11px] text-muted">
            …or drag &amp; drop into this box
          </p>
          <p className="mt-1 text-[11px] text-muted">
            Selected:{" "}
            {state.fileName ? (
              <span className="text-foreground">{state.fileName}</span>
            ) : (
              "No file selected yet"
            )}
          </p>
        </div>
        <input
          id="file"
          name="file"
          type="file"
          className="hidden"
          onChange={handleFileChange}
          accept=".step,.stp,.iges,.igs,.stl,.sldprt,.sldasm,.zip,.prt,.sat,.x_t,.x_b,.ipt"
        />
      </div>

      {/* Form fields */}
      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label
              htmlFor="name"
              className="text-xs font-medium text-muted tracking-wide"
            >
              Your name<span className="text-red-500">*</span>
            </label>
            <input
              id="name"
              type="text"
              required
              value={state.name}
              onChange={handleChange("name")}
              className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm text-foreground outline-none ring-0 transition focus:border-accent"
            />
          </div>
          <div className="space-y-1">
            <label
              htmlFor="email"
              className="text-xs font-medium text-muted tracking-wide"
            >
              Email<span className="text-red-500">*</span>
            </label>
            <input
              id="email"
              type="email"
              required
              value={state.email}
              onChange={handleChange("email")}
              className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm text-foreground outline-none ring-0 transition focus:border-accent"
            />
          </div>
        </div>

        <div className="space-y-1">
          <label
            htmlFor="company"
            className="text-xs font-medium text-muted tracking-wide"
          >
            Company
          </label>
          <input
            id="company"
            type="text"
            value={state.company}
            onChange={handleChange("company")}
            className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm text-foreground outline-none ring-0 transition focus:border-accent"
          />
        </div>

        <div className="space-y-1">
          <label
            htmlFor="notes"
            className="text-xs font-medium text-muted tracking-wide"
          >
            Process / quantity / timing
          </label>
          <textarea
            id="notes"
            rows={3}
            value={state.notes}
            onChange={handleChange("notes")}
            placeholder="CNC, qty 50, target ship date, special material or tolerances..."
            className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm text-foreground outline-none ring-0 transition focus:border-accent"
          />
        </div>

        {/* Upload CTA */}
        <div className="pt-1">
          <button
            type="submit"
            disabled={isSubmitting || !canSubmit}
            className={clsx(
              "mt-2 w-full rounded-full px-6 py-3 text-sm font-medium text-black shadow-sm transition disabled:cursor-not-allowed disabled:opacity-70",
              canSubmit && !isSubmitting
                ? "bg-emerald-500 hover:bg-emerald-400"
                : "bg-emerald-500/40"
            )}
          >
            {isSubmitting ? "Uploading..." : "Upload file"}
          </button>
        </div>

        {/* Messages */}
        <div className="min-h-[1.25rem] pt-1">
          {error && (
            <p className="text-xs text-red-400" role="alert">
              Error: {error}
            </p>
          )}
          {!error && success && (
            <p className="text-xs text-emerald-400" role="status">
              Thanks — your CAD file is in the queue. I’ll take a look.
            </p>
          )}
        </div>
      </form>
    </section>
  );
}