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

const MAX_FILE_SIZE_MB = 25;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

// Match the copy on the page
const ALLOWED_EXTENSIONS = [
  ".step",
  ".stp",
  ".iges",
  ".igs",
  ".stl",
  ".sldprt",
  ".zip",
];

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
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const resetMessages = () => {
    setError(null);
    setSuccess(null);
  };

  // ------- Helpers -------

  const hasAllowedExtension = (file: File) => {
    const name = file.name.toLowerCase();
    return ALLOWED_EXTENSIONS.some((ext) => name.endsWith(ext));
  };

  const validateFile = (file: File | null): boolean => {
    if (!file) {
      setError("Please select a CAD file to upload.");
      return false;
    }

    if (!hasAllowedExtension(file)) {
      setError(
        "Unsupported file type. Use STEP, IGES, STL, SolidWorks, or a ZIP archive.",
      );
      return false;
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      setError(`File is too large. Max size is ~${MAX_FILE_SIZE_MB} MB.`);
      return false;
    }

    return true;
  };

  const handleFileSelectInternal = (file: File | null) => {
    resetMessages();

    if (!file) {
      setState((prev) => ({
        ...prev,
        file: null,
        fileName: "",
      }));
      return;
    }

    if (!validateFile(file)) {
      // Reset file state if invalid
      setState((prev) => ({
        ...prev,
        file: null,
        fileName: "",
      }));
      return;
    }

    setState((prev) => ({
      ...prev,
      file,
      fileName: file.name,
    }));
  };

  // ------- Event handlers -------

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    handleFileSelectInternal(file);
  };

  const handleDragEnter = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
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

    const file = e.dataTransfer.files?.[0] ?? null;
    handleFileSelectInternal(file);
  };

  const handleTextChange = (
    e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    resetMessages();
    const { name, value } = e.target;

    setState((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    resetMessages();

    if (!state.file) {
      setError("Please select a CAD file to upload.");
      return;
    }

    if (!state.name.trim() || !state.email.trim()) {
      setError("Name and email are required.");
      return;
    }

    if (!validateFile(state.file)) {
      return;
    }

    try {
      setIsSubmitting(true);

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
        throw new Error(data?.message || "Upload failed");
      }

      // Success – keep contact info, reset file + notes
      setState((prev) => ({
        ...prev,
        file: null,
        fileName: "",
        notes: "",
      }));

      setSuccess("Thanks — your CAD file is in the queue. I’ll take a look.");
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Something went wrong while uploading.");
    } finally {
      setIsSubmitting(false);
    }
  };

  // ------- Render -------

  return (
    <section aria-label="Upload CAD file" className="w-full">
      <form
        onSubmit={handleSubmit}
        className="flex flex-col gap-4 text-sm text-ink"
      >
        {/* Drag & drop / file input */}
        <div
          className={clsx(
            "flex flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-8 text-center text-xs sm:text-sm transition",
            isDragging
              ? "border-accent/80 bg-accent/5"
              : "border-border/80 bg-surface-muted",
          )}
          onDragEnter={handleDragEnter}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <p className="mb-2 font-medium">
            STEP, IGES, STL, SolidWorks, or zipped assemblies. Max ~25 MB.
          </p>

          <label
            htmlFor="file"
            className="mt-2 inline-flex items-center justify-center rounded-full border border-border bg-surface px-4 py-2 text-xs font-medium hover:bg-surface/80 cursor-pointer"
          >
            Browse from device
          </label>

          <input
            id="file"
            name="file"
            type="file"
            className="hidden"
            onChange={handleFileChange}
            accept={ALLOWED_EXTENSIONS.join(",")}
          />

          <p className="mt-2 text-[11px] text-muted">
            …or drag &amp; drop into this box
          </p>

          <p className="mt-3 text-[11px] text-muted">
            Selected:{" "}
            {state.fileName ? (
              <span className="font-medium text-ink">{state.fileName}</span>
            ) : (
              "No file selected yet"
            )}
          </p>
        </div>

        {/* Text fields */}
        <div className="mt-4 grid grid-cols-1 gap-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-[11px] font-medium">
                Your name<span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                name="name"
                required
                value={state.name}
                onChange={handleTextChange}
                className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
              />
            </div>

            <div>
              <label className="mb-1 block text-[11px] font-medium">
                Email<span className="text-red-400">*</span>
              </label>
              <input
                type="email"
                name="email"
                required
                value={state.email}
                onChange={handleTextChange}
                className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-medium">
              Company
            </label>
            <input
              type="text"
              name="company"
              value={state.company}
              onChange={handleTextChange}
              className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
            />
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-medium">
              Process / quantity / timing
            </label>
            <textarea
              name="notes"
              rows={3}
              value={state.notes}
              onChange={handleTextChange}
              placeholder="CNC, qty 50, target ship date, special material or tolerances…"
              className="w-full resize-none rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
            />
          </div>
        </div>

        {/* Submit + messages */}
        <div className="mt-2 flex flex-col gap-2">
          <button
            type="submit"
            disabled={isSubmitting}
            className="inline-flex w-full items-center justify-center rounded-full bg-accent px-4 py-2 text-sm font-semibold text-ink shadow-sm hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? "Uploading…" : "Upload file"}
          </button>

          {error && (
            <p className="text-xs text-red-400" role="alert">
              Error: {error}
            </p>
          )}

          {success && (
            <p className="text-xs text-emerald-400" role="status">
              {success}
            </p>
          )}
        </div>
      </form>
    </section>
  );
}