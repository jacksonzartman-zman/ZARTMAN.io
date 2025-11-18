"use client";

import React from "react";

type UploadStatus = "idle" | "uploading" | "success" | "error";

export default function UploadBox() {
  const [file, setFile] = React.useState<File | null>(null);
  const [status, setStatus] = React.useState<UploadStatus>("idle");
  const [error, setError] = React.useState<string | null>(null);

  // new metadata fields
  const [contactName, setContactName] = React.useState("");
  const [contactEmail, setContactEmail] = React.useState("");
  const [company, setCompany] = React.useState("");
  const [notes, setNotes] = React.useState("");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    if (!file) {
      setError("Please choose a file before uploading.");
      return;
    }

    setStatus("uploading");

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("contact_name", contactName);
      formData.append("contact_email", contactEmail);
      formData.append("company", company);
      formData.append("notes", notes);

      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      let json: any = null;
      try {
        json = await res.json();
      } catch {
        // ignore JSON parse errors; fall back to res.ok
      }

      if (!res.ok || json?.success === false) {
        throw new Error(json?.error || "Upload failed");
      }

      // ✅ success
      setStatus("success");
      setFile(null);
      setContactName("");
      setContactEmail("");
      setCompany("");
      setNotes("");
      setError(null);
      (e.target as HTMLFormElement).reset();
    } catch (err: any) {
      console.error(err);
      setStatus("error");
      setError(
        err?.message || "Upload failed. Please try again or email your file."
      );
    }
  }

  const disabled = status === "uploading";

  return (
    <section aria-labelledby="upload-heading" className="mt-8">
      <h2
        id="upload-heading"
        className="text-lg font-semibold text-neutral-100 mb-2"
      >
        Upload your CAD
      </h2>
      <p className="text-sm text-neutral-400 mb-4 max-w-2xl">
        Start with one file. We’ll use this to tune the flow, not to spam you
        with sales outreach.
      </p>

      <form
        onSubmit={handleSubmit}
        className="rounded-2xl bg-neutral-900/80 border border-neutral-800 px-6 py-6 space-y-4 max-w-3xl shadow-xl"
      >
        {/* File picker */}
        <div className="space-y-2">
          <label className="block text-xs font-medium text-neutral-300">
            Upload your CAD file
          </label>
          <p className="text-[11px] text-neutral-500">
            STEP, IGES, STL, SolidWorks, or zipped assemblies. Max 25&nbsp;MB for now.
          </p>
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <label className="inline-flex items-center justify-center rounded-lg bg-[#7f1d1d] px-4 py-2 text-sm font-medium text-white cursor-pointer hover:bg-[#991b1b] transition-colors">
              Choose file
              <input
                type="file"
                className="sr-only"
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null;
                  setFile(f);
                  setStatus("idle");
                  setError(null);
                }}
              />
            </label>
            <div className="flex-1 min-h-[2.25rem] flex items-center rounded-lg bg-neutral-950/70 px-3 text-xs text-neutral-300 border border-dashed border-neutral-700">
              {file ? file.name : "No file selected"}
            </div>
          </div>
        </div>

        {/* Contact info */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-neutral-300 mb-1">
              Your name
            </label>
            <input
              type="text"
              className="w-full rounded-lg border border-neutral-700 bg-neutral-950/80 px-3 py-2 text-sm text-neutral-50 placeholder:text-neutral-500 focus:outline-none focus:ring-1 focus:ring-[#a11d33]"
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-neutral-300 mb-1">
              Email
            </label>
            <input
              type="email"
              className="w-full rounded-lg border border-neutral-700 bg-neutral-950/80 px-3 py-2 text-sm text-neutral-50 placeholder:text-neutral-500 focus:outline-none focus:ring-1 focus:ring-[#a11d33]"
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-neutral-300 mb-1">
              Company
            </label>
            <input
              type="text"
              className="w-full rounded-lg border border-neutral-700 bg-neutral-950/80 px-3 py-2 text-sm text-neutral-50 placeholder:text-neutral-500 focus:outline-none focus:ring-1 focus:ring-[#a11d33]"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-neutral-300 mb-1">
              What do you need help with?
            </label>
            <input
              type="text"
              className="w-full rounded-lg border border-neutral-700 bg-neutral-950/80 px-3 py-2 text-sm text-neutral-50 placeholder:text-neutral-500 focus:outline-none focus:ring-1 focus:ring-[#a11d33]"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>

        {/* Submit + messages */}
        <div className="pt-3 space-y-2">
          <button
            type="submit"
            disabled={disabled || !file}
            className={`w-full rounded-full py-2.5 text-sm font-semibold text-white transition-colors ${
              disabled || !file
                ? "bg-neutral-700 cursor-not-allowed"
                : "bg-[#7f1d1d] hover:bg-[#b91c1c] cursor-pointer"
            }`}
          >
            {status === "uploading" ? "Uploading…" : "Upload file"}
          </button>

          {status === "success" && (
            <p className="text-xs text-[#fca5a5]">
              Upload complete. Thanks for sending this in — I’ll follow up
              once I’ve had a look.
            </p>
          )}

          {status === "error" && error && (
            <p className="text-xs text-[#fecaca]">
              Error: {error}
            </p>
          )}
        </div>
      </form>
    </section>
  );
}