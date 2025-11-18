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
        // ignore JSON parse error and fall back to res.ok
      }

      if (!res.ok || json?.success === false) {
        throw new Error(json?.error || "Upload failed");
      }

      // ✅ success
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
    <div className="rounded-2xl border border-neutral-800 bg-neutral-950/60 p-4 sm:p-6">
      <form onSubmit={handleSubmit} className="space-y-3 text-sm text-neutral-100">
        {/* FILE INPUT */}
        <div className="space-y-1">
          <label className="text-xs font-medium text-neutral-300">
            Upload your CAD file
          </label>
          <p className="text-[11px] text-neutral-500">
            STEP, IGES, STL, SolidWorks, or zipped assemblies. Max 25&nbsp;MB.
          </p>
          <input
            type="file"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              setFile(f);
              setStatus("idle");
              setError(null);
            }}
            className="mt-1 block w-full cursor-pointer rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-xs text-neutral-100 file:mr-3 file:rounded-md file:border-0 file:bg-emerald-500 file:px-3 file:py-1 file:text-xs file:font-medium file:text-neutral-900 hover:border-neutral-600"
          />
        </div>

        {/* CONTACT NAME */}
        <div className="space-y-1">
          <label className="text-xs text-neutral-400">Your name</label>
          <input
            name="contact_name"
            placeholder="e.g. Jackson Zartman"
            className="w-full rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2 text-xs text-neutral-100 placeholder:text-neutral-500 focus:border-emerald-500 focus:outline-none"
          />
        </div>

        {/* CONTACT EMAIL */}
        <div className="space-y-1">
          <label className="text-xs text-neutral-400">Email</label>
          <input
            name="contact_email"
            type="email"
            placeholder="you@company.com"
            className="w-full rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2 text-xs text-neutral-100 placeholder:text-neutral-500 focus:border-emerald-500 focus:outline-none"
          />
        </div>

        {/* COMPANY */}
        <div className="space-y-1">
          <label className="text-xs text-neutral-400">Company</label>
          <input
            name="company"
            placeholder="Company or project"
            className="w-full rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2 text-xs text-neutral-100 placeholder:text-neutral-500 focus:border-emerald-500 focus:outline-none"
          />
        </div>

        {/* NOTES */}
        <div className="space-y-1">
          <label className="text-xs text-neutral-400">What do you need help with?</label>
          <textarea
            name="notes"
            placeholder="Short context: material, quantity, timing, blockers…"
            className="w-full rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2 text-xs text-neutral-100 placeholder:text-neutral-500 focus:border-emerald-500 focus:outline-none"
            rows={3}
          />
        </div>

        <button
          type="submit"
          disabled={status === "uploading" || !file}
          className="mt-2 inline-flex w-full items-center justify-center rounded-full bg-emerald-500 px-4 py-2 text-sm font-medium text-neutral-900 hover:bg-emerald-400 disabled:opacity-50"
        >
          {status === "uploading" ? "Uploading…" : "Upload file"}
        </button>

        {/* SUCCESS MESSAGE */}
        {status === "success" && (
          <p className="mt-2 text-[11px] text-emerald-400">
            Upload complete. Thanks for sending this in — I’ll review it and follow up.
          </p>
        )}

        {/* ERROR MESSAGE */}
        {status === "error" && error && (
          <p className="mt-2 text-[11px] text-red-400">Error: {error}</p>
        )}
      </form>
    </div>
  );
}