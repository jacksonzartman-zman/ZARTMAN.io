"use client";

import React from "react";

export default function UploadBox() {
  const [file, setFile] = React.useState<File | null>(null);
  const [status, setStatus] = React.useState<"idle" | "uploading" | "success" | "error">("idle");
  const [error, setError] = React.useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus("uploading");
    setError(null);

    const form = e.currentTarget;
    const formData = new FormData(form);

    if (file) {
      formData.append("file", file);
    }

    try {
      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      let json: any = null;
      try {
        json = await res.json();
      } catch {
        // ignore JSON error and rely on res.ok
      }

      if (!res.ok || json?.success === false) {
        throw new Error(json?.error || "Upload failed");
      }

      // ✅ SUCCESS
      setStatus("success");
      setFile(null);
      form.reset();
      setError(null);
    } catch (err: any) {
      console.error(err);
      setStatus("error");
      setError(err.message || "Upload failed. Please try again.");
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">

      {/* FILE INPUT */}
      <div className="rounded-xl bg-neutral-900 px-4 py-4 text-sm text-neutral-50">
        <label className="flex flex-col gap-2">
          <span className="font-medium text-neutral-300 text-xs">
            Upload your CAD file
          </span>

          <input
            type="file"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              setFile(f);
              setStatus("idle");
              setError(null);
            }}
            className="text-xs text-neutral-200"
          />
        </label>
      </div>

      {/* CONTACT NAME */}
      <input
        name="contact_name"
        placeholder="Your name"
        className="w-full rounded-md bg-neutral-800 px-3 py-2 text-sm text-neutral-200"
      />

      {/* CONTACT EMAIL */}
      <input
        name="contact_email"
        type="email"
        placeholder="Your email"
        className="w-full rounded-md bg-neutral-800 px-3 py-2 text-sm text-neutral-200"
      />

      {/* COMPANY */}
      <input
        name="company"
        placeholder="Company"
        className="w-full rounded-md bg-neutral-800 px-3 py-2 text-sm text-neutral-200"
      />

      {/* NOTES */}
      <textarea
        name="notes"
        placeholder="Notes (optional)"
        className="w-full rounded-md bg-neutral-800 px-3 py-2 text-sm text-neutral-200"
        rows={3}
      />

      <button
        type="submit"
        disabled={status === "uploading" || !file}
        className="mt-3 inline-flex items-center justify-center rounded-full bg-emerald-500 px-4 py-2 text-sm font-medium text-neutral-900 hover:bg-emerald-400 disabled:opacity-50"
      >
        {status === "uploading" ? "Uploading…" : "Upload file"}
      </button>

      {/* SUCCESS MESSAGE */}
      {status === "success" && (
        <p className="mt-2 text-xs text-emerald-400">
          Upload complete. Thanks for sending this in.
        </p>
      )}

      {/* ERROR MESSAGE */}
      {status === "error" && error && (
        <p className="mt-2 text-xs text-red-400">Error: {error}</p>
      )}
    </form>
  );
}