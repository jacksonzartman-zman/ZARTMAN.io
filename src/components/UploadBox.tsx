"use client";

import React, { useState, DragEvent, ChangeEvent, FormEvent } from "react";
import clsx from "clsx";

type UploadState = {
  file: File | null;
  name: string;
  email: string;
  company: string;
  notes: string;
};

export default function UploadBox() {
  const [state, setState] = useState<UploadState>({
    file: null,
    name: "",
    email: "",
    company: "",
    notes: "",
  });

  const [isDragging, setDragging] = useState(false);
  const [isSubmitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  /** -------------------------------
   * Drag + Drop handlers
   --------------------------------*/
  const handleDragEnter = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(true);
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(true);
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);

    const file = e.dataTransfer.files?.[0];
    if (file) {
      setState((prev) => ({ ...prev, file }));
    }
  };

  const handleFileSelect = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setState((prev) => ({ ...prev, file }));
    }
  };

  /** -------------------------------
   * Submit handler → calls /api/upload
   --------------------------------*/
  const handleSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setSuccess(false);

    try {
      if (!state.file) {
        setError("Please select a file first.");
        setSubmitting(false);
        return;
      }

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
        throw new Error("Upload failed.");
      }

      setSuccess(true);
      setState({
        file: null,
        name: "",
        email: "",
        company: "",
        notes: "",
      });
    } catch (err: any) {
      setError(err.message || "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="w-full max-w-md border border-border/40 rounded-2xl p-6">
      {/* Drop zone */}
      <div
        className={clsx(
          "border-2 border-dashed rounded-xl p-8 text-center transition",
          isDragging ? "border-accent bg-accent/10" : "border-border/60"
        )}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <p className="text-sm text-muted-foreground">
          STEP, IGES, STL, SolidWorks, or zipped assemblies. Max ~25 MB.
        </p>

        <button
          type="button"
          onClick={() => document.getElementById("file-input")?.click()}
          className="mt-4 px-4 py-2 rounded-full border text-sm"
        >
          Browse from device
        </button>

        <input
          id="file-input"
          type="file"
          className="hidden"
          onChange={handleFileSelect}
        />

        <p className="text-xs mt-3">
          {state.file ? (
            <>Selected: {state.file.name}</>
          ) : (
            <>…or drag & drop into this box</>
          )}
        </p>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} className="space-y-4 mt-6">
        <div className="flex gap-3">
          <div className="flex-1">
            <label className="text-xs">Your name*</label>
            <input
              required
              type="text"
              value={state.name}
              onChange={(e) =>
                setState((s) => ({ ...s, name: e.target.value }))
              }
              className="w-full mt-1 px-3 py-2 border rounded-md bg-background"
            />
          </div>

          <div className="flex-1">
            <label className="text-xs">Email*</label>
            <input
              required
              type="email"
              value={state.email}
              onChange={(e) =>
                setState((s) => ({ ...s, email: e.target.value }))
              }
              className="w-full mt-1 px-3 py-2 border rounded-md bg-background"
            />
          </div>
        </div>

        <div>
          <label className="text-xs">Company</label>
          <input
            type="text"
            value={state.company}
            onChange={(e) =>
              setState((s) => ({ ...s, company: e.target.value }))
            }
            className="w-full mt-1 px-3 py-2 border rounded-md bg-background"
          />
        </div>

        <div>
          <label className="text-xs">Process / quantity / timing</label>
          <textarea
            value={state.notes}
            onChange={(e) =>
              setState((s) => ({ ...s, notes: e.target.value }))
            }
            className="w-full mt-1 px-3 py-2 border rounded-md bg-background"
            placeholder="CNC, qty 50, target ship date, special material or tolerances…"
          />
        </div>

        {/* Upload button + messages */}
        <div className="space-y-2 pt-2 border-t border-border/40 mt-2">
          <button
            type="submit"
            disabled={isSubmitting}
            className={clsx(
              "w-full inline-flex items-center justify-center rounded-full px-4 py-2.5 text-sm font-medium transition",
              "disabled:opacity-60 disabled:cursor-not-allowed"
            )}
            style={{
              backgroundColor: "#22c55e", // bright green
              color: "#000",
              border: "1px solid rgba(34,197,94,0.9)",
            }}
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