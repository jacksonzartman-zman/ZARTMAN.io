"use client";

import React, { useState, DragEvent, ChangeEvent, FormEvent } from "react";

type UploadState = {
  file: File | null;
  name: string;
  email: string;
  company: string;
  notes: string;
};

export default function UploadBox() {
  const [form, setForm] = useState<UploadState>({
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

  // ---------- helpers ----------

  function handleInputChange(
    e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
    setError(null);
    setSuccess(null);
  }

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setForm((prev) => ({ ...prev, file }));
    setError(null);
    setSuccess(null);
  }

  function handleDragOver(e: DragEvent<HTMLLabelElement>) {
    e.preventDefault();
    setIsDragging(true);
  }

  function handleDragLeave(e: DragEvent<HTMLLabelElement>) {
    e.preventDefault();
    setIsDragging(false);
  }

  function handleDrop(e: DragEvent<HTMLLabelElement>) {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0] ?? null;
    if (file) {
      setForm((prev) => ({ ...prev, file }));
    }
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!form.file) {
      setError("Please upload a CAD file before submitting.");
      return;
    }

    if (!form.name.trim() || !form.email.trim()) {
      setError("Name and email are required.");
      return;
    }

    try {
      setIsSubmitting(true);

      const body = new FormData();
      body.append("file", form.file);
      body.append("name", form.name);
      body.append("email", form.email);
      body.append("company", form.company);
      body.append("notes", form.notes);

      const res = await fetch("/api/upload", {
        method: "POST",
        body,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "Upload failed");
      }

      setSuccess("Thanks – your CAD file is in the queue. I’ll take a look.");
      // Optional: clear the form except name/email/company
      setForm((prev) => ({
        ...prev,
        file: null,
        notes: "",
      }));
    } catch (err: any) {
      setError(err.message ?? "Something went wrong during upload.");
    } finally {
      setIsSubmitting(false);
    }
  }

  // ---------- UI ----------

  return (
    <section className="max-w-3xl mx-auto py-10">
      <h1 className="text-2xl font-semibold text-ink mb-2">
        Upload your CAD
      </h1>
      <p className="text-sm text-muted mb-6">
        Start with one file. This tunes the flow and gets us talking – no
        spammy sales cadences, just real project help.
      </p>

      <form
        onSubmit={handleSubmit}
        className="space-y-8 rounded-2xl border border-border bg-surface p-6 md:p-8 shadow-sm"
      >
        {/* Files */}
        <div className="space-y-3">
          <h2 className="text-sm font-medium text-ink">CAD file</h2>
          <p className="text-xs text-muted">
            STEP, IGES, STL, SolidWorks, or zipped assemblies. Max ~25&nbsp;MB.
          </p>

          <label
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={[
              "mt-2 flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 py-8 cursor-pointer transition",
              isDragging
                ? "border-accent/80 bg-accent/10"
                : "border-border hover:border-accent/80 hover:bg-muted/10",
            ].join(" ")}
          >
            <input
              type="file"
              name="file"
              id="file"
              className="hidden"
              onChange={handleFileChange}
            />
            <span className="text-sm font-medium text-ink">
              {form.file ? form.file.name : "Drag & drop your CAD file here"}
            </span>
            <span className="mt-1 text-xs text-muted">
              or <span className="underline">browse from your device</span>
            </span>
          </label>
        </div>

        {/* Project details */}
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <label
              htmlFor="name"
              className="block text-xs font-medium text-muted"
            >
              Your name<span className="text-red-500 ml-0.5">*</span>
            </label>
            <input
              id="name"
              name="name"
              value={form.name}
              onChange={handleInputChange}
              className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-ink outline-none focus:border-accent focus:ring-1 focus:ring-accent"
              placeholder="Jackson Zartman"
              required
            />
          </div>

          <div className="space-y-2">
            <label
              htmlFor="email"
              className="block text-xs font-medium text-muted"
            >
              Email<span className="text-red-500 ml-0.5">*</span>
            </label>
            <input
              id="email"
              name="email"
              type="email"
              value={form.email}
              onChange={handleInputChange}
              className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-ink outline-none focus:border-accent focus:ring-1 focus:ring-accent"
              placeholder="you@company.com"
              required
            />
          </div>

          <div className="space-y-2">
            <label
              htmlFor="company"
              className="block text-xs font-medium text-muted"
            >
              Company
            </label>
            <input
              id="company"
              name="company"
              value={form.company}
              onChange={handleInputChange}
              className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-ink outline-none focus:border-accent focus:ring-1 focus:ring-accent"
              placeholder="Zart Consulting, All Star Auto, etc."
            />
          </div>

          <div className="space-y-2">
            <label
              htmlFor="notes"
              className="block text-xs font-medium text-muted"
            >
              Process / quantity / timing
            </label>
            <input
              id="notes"
              name="notes"
              value={form.notes}
              onChange={handleInputChange}
              className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-ink outline-none focus:border-accent focus:ring-1 focus:ring-accent"
              placeholder="CNC, qty 50, target ship Dec 10"
            />
          </div>
        </div>

        {/* Submit */}
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <p className="text-xs text-muted md:max-w-md">
            Hit upload and I’ll review manufacturability, pricing options, and
            where this fits best in the network. You’ll hear from a human,
            not a bot.
          </p>

          <button
            type="submit"
            disabled={isSubmitting}
            className="inline-flex items-center justify-center rounded-full bg-accent px-6 py-2 text-sm font-medium text-black disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {isSubmitting ? "Uploading…" : "Upload file"}
          </button>
        </div>

        {/* Messages */}
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
      </form>
    </section>
  );
}