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
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="rounded-xl bg-neutral-900 px-4 py-4 text-sm text-neutral-50">
        <label className="flex flex-col gap-2">
          <span className="text-xs font-medium text-neutral-300">
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

        <button
          type="submit"
          disabled={status === "uploading" || !file}
          className="mt-3 inline-flex items-center justify-center rounded-full bg-emerald-500 px-4 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-emerald-600 disabled:opacity-60"
        >
          {status === "uploading" ? "Uploading…" : "Upload file"}
        </button>

        {status === "success" && (
          <p className="mt-2 text-xs text-emerald-400">
            Upload complete. Thanks for sending a part.
          </p>
        )}

        {status === "error" && error && (
          <p className="mt-2 text-xs text-red-400">Error: {error}</p>
        )}
      </div>
    </form>
  );
}