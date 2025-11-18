"use client";

import { useState, FormEvent } from "react";

const MAX_SIZE_MB = 25;

export default function UploadBox() {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<"idle" | "uploading" | "success" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();

    if (!file) {
      setError("Choose a file first.");
      setStatus("error");
      return;
    }

    if (file.size > MAX_SIZE_MB * 1024 * 1024) {
      setError(`Max size is ${MAX_SIZE_MB}MB.`);
      setStatus("error");
      return;
    }

    setStatus("uploading");
    setError(null);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      let data: any = null;
      try {
        data = await res.json();
      } catch {
        // ignore JSON error – we'll fall back to res.ok
      }

      if (!res.ok || data?.success === false) {
        throw new Error(data?.error || "Upload failed");
      }

      setStatus("success");
      setError(null);
      setFile(null);
    } catch (err: any) {
      setStatus("error");
      setError(err?.message || "Upload failed");
    }
  }

  return (
  <div className="mx-auto w-full max-w-xl rounded-xl border border-neutral-800 bg-neutral-950 p-6 shadow-xl">
    <h2 className="mb-2 text-lg font-semibold text-neutral-100">
      Upload your CAD
    </h2>
    <p className="mb-4 text-sm text-neutral-400">
      STEP, IGES, STL, SolidWorks, zipped assemblies — max 25MB for now.
    </p>

    <form
      onSubmit={handleSubmit}
      encType="multipart/form-data"
      className="space-y-5"
    >
      {/* Contact name */}
      <div>
        <label className="block text-sm font-medium text-neutral-300">
          Your name
        </label>
        <input
          type="text"
          name="contact_name"
          placeholder="Jane Doe"
          className="mt-1 w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100"
        />
      </div>

      {/* Contact email */}
      <div>
        <label className="block text-sm font-medium text-neutral-300">
          Work email
        </label>
        <input
          type="email"
          name="contact_email"
          placeholder="jane@allstarautoparts.com"
          className="mt-1 w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100"
        />
      </div>

      {/* Company */}
      <div>
        <label className="block text-sm font-medium text-neutral-300">
          Company
        </label>
        <input
          type="text"
          name="company"
          placeholder="All Star Auto Parts"
          className="mt-1 w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100"
        />
      </div>

      {/* Notes */}
      <div>
        <label className="block text-sm font-medium text-neutral-300">
          Anything we should know?
        </label>
        <textarea
          name="notes"
          rows={3}
          placeholder="EX: Need PP material, 10-day lead time, using existing tool..."
          className="mt-1 w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100"
        />
      </div>

      {/* File */}
      <div>
        <label className="block text-sm font-medium text-neutral-300">
          CAD file
        </label>
        <input
          type="file"
          name="file"
          required
          className="mt-2 w-full text-neutral-300 file:mr-4 file:rounded-md file:border-0 file:bg-neutral-800 file:px-4 file:py-2 file:text-sm file:text-neutral-200 hover:file:bg-neutral-700"
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null;
            setFile(f);
            setStatus("idle");
            setError(null);
          }}
        />
      </div>

      <button
        type="submit"
        disabled={status === "uploading" || !file}
        className="w-full rounded-md bg-emerald-600 px-4 py-2 text-center text-sm font-semibold text-white hover:bg-emerald-500"
      >
        {status === "uploading" ? "Uploading…" : "Upload file"}
      </button>
    </form>
  </div>
);
}