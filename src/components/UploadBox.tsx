"use client";

import React, {
  useState,
  useRef,
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

const initialState: UploadState = {
  file: null,
  name: "",
  email: "",
  company: "",
  notes: "",
};

export default function UploadBox() {
  const [state, setState] = useState<UploadState>(initialState);
  const [isDragging, setIsDragging] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // ---- Drag & drop handlers ----

  const handleDragEnter = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(true);
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    // keep isDragging true while the file is over the box
    setIsDragging(true);
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

    const file = event.dataTransfer.files?.[0];
    if (file) {
      setState((prev) => ({ ...prev, file }));
      setError(null);
      setSuccess(false);
    }
  };

  // ---- Input handlers ----

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    setState((prev) => ({ ...prev, file }));
    setError(null);
    setSuccess(false);
  };

  const handleTextChange = (
    event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = event.target;
    setState((prev) => ({ ...prev, [name]: value }));
    setError(null);
    setSuccess(false);
  };

  // ---- Submit handler ----

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    // Front-end validation for required fields
    if (!state.file) {
      setError("Add a CAD file before uploading.");
      setSuccess(false);
      return;
    }
    if (!state.name.trim() || !state.email.trim()) {
      setError("Name and email are required so I know who to reply to.");
      setSuccess(false);
      return;
    }

    setIsSubmitting(true);
    setError(null);
    setSuccess(false);

    try {
      const formData = new FormData();
      formData.append("file", state.file);
      formData.append("name", state.name.trim());
      formData.append("email", state.email.trim());
      formData.append("company", state.company.trim());
      formData.append("notes", state.notes.trim());

      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        throw new Error(`Upload failed with status ${res.status}`);
      }

      // Keep name/email/company so you can upload multiple files quickly,
      // but clear the file + notes and show success.
      setState((prev) => ({
        ...prev,
        file: null,
        notes: "",
      }));
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }

      setSuccess(true);
    } catch (err: any) {
      console.error("Upload error:", err);
      setError("Something went wrong while uploading. Try again in a moment.");
      setSuccess(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  // ---- UI ----

  const selectedFileLabel = state.file
    ? state.file.name
    : "No file selected yet";

  return (
    <section
      className="
        w-full 
        max-w-sm 
        sm:max-w-md 
        lg:max-w-sm 
        rounded-2xl 
        border 
        border-border 
        bg-surface/90 
        p-4 
        sm:p-5 
        text-sm 
        text-ink
        shadow-lg
      "
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Drag & drop / file input */}
        <div
          className={clsx(
            "flex flex-col items-center justify-center rounded-2xl border-2 border-dashed px-4 py-6 text-center text-xs sm:text-sm transition-colors",
            isDragging
              ? "border-accent bg-accent/5"
              : "border-border/80 bg-surface/60"
          )}
          onDragEnter={handleDragEnter}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <p className="font-medium mb-1">CAD file</p>
          <p className="text-[11px] text-muted mb-3">
            STEP, IGES, STL, SolidWorks, or zipped assemblies. Max ~25&nbsp;MB.
          </p>

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="
              inline-flex items-center justify-center
              rounded-full border border-border 
              px-4 py-2 text-xs font-medium
              hover:border-accent hover:text-accent 
              transition-colors
              mb-2
            "
          >
            {state.file ? "Change file" : "Browse from device"}
          </button>

          <p className="text-[11px] text-muted">
            …or drag & drop into this box
          </p>

          <p className="mt-3 text-[11px] text-neutral-400 line-clamp-2">
            Selected: <span className="font-medium">{selectedFileLabel}</span>
          </p>

          <input
            ref={fileInputRef}
            type="file"
            name="file"
            accept=".step,.stp,.iges,.igs,.stl,.sldprt,.sldasm,.zip"
            onChange={handleFileChange}
            className="hidden"
          />
        </div>

        {/* Contact fields */}
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="name"
                className="block text-xs font-medium text-muted mb-1"
              >
                Your name<span className="text-red-400">*</span>
              </label>
              <input
                id="name"
                name="name"
                required
                autoComplete="name"
                value={state.name}
                onChange={handleTextChange}
                className="
                  w-full rounded-md border border-border bg-surface/80 px-3 py-2 
                  text-sm outline-none
                  focus:border-accent focus:ring-1 focus:ring-accent
                "
              />
            </div>
            <div>
              <label
                htmlFor="email"
                className="block text-xs font-medium text-muted mb-1"
              >
                Email<span className="text-red-400">*</span>
              </label>
              <input
                id="email"
                name="email"
                type="email"
                required
                autoComplete="email"
                value={state.email}
                onChange={handleTextChange}
                className="
                  w-full rounded-md border border-border bg-surface/80 px-3 py-2 
                  text-sm outline-none
                  focus:border-accent focus:ring-1 focus:ring-accent
                "
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="company"
              className="block text-xs font-medium text-muted mb-1"
            >
              Company
            </label>
            <input
              id="company"
              name="company"
              value={state.company}
              onChange={handleTextChange}
              className="
                w-full rounded-md border border-border bg-surface/80 px-3 py-2 
                text-sm outline-none
                focus:border-accent focus:ring-1 focus:ring-accent
              "
            />
          </div>

          <div>
            <label
              htmlFor="notes"
              className="block text-xs font-medium text-muted mb-1"
            >
              Process / quantity / timing
            </label>
            <textarea
              id="notes"
              name="notes"
              rows={3}
              placeholder="CNC, qty 50, target ship date, special material or tolerances…"
              value={state.notes}
              onChange={handleTextChange}
              className="
                w-full rounded-md border border-border bg-surface/80 px-3 py-2 
                text-sm outline-none resize-none
                focus:border-accent focus:ring-1 focus:ring-accent
              "
            />
          </div>
        </div>

        {/* Button + messages */}
        <div className="space-y-2">
          <button
            type="submit"
            disabled={isSubmitting}
            className={clsx(
              "w-full inline-flex items-center justify-center rounded-full px-4 py-2.5 text-sm font-medium transition-colors",
              "bg-accent text-black hover:bg-accent/90",
              "disabled:opacity-60 disabled:cursor-not-allowed"
            )}
          >
            {isSubmitting ? "Uploading…" : "Upload file"}
          </button>

          {error && (
            <p className="text-[11px] text-red-400" role="alert">
              Error: {error}
            </p>
          )}

          {success && !error && (
            <p className="text-[11px] text-emerald-400" role="status">
              Thanks — your CAD file is in the queue. I’ll take a look.
            </p>
          )}
        </div>
      </form>
    </section>
  );
}