"use client";

import { useState, ChangeEvent, FormEvent } from "react";

type UploadState = "idle" | "uploading" | "success" | "error";

export default function UploadBox() {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<UploadState>("idle");
  const [uploadedUrl, setUploadedUrl] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0] ?? null;
    setFile(selected);
    setStatus("idle");
    setUploadedUrl(null);
    setErrorMessage(null);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!file || status === "uploading") return;

    const formData = new FormData();
    formData.append("file", file);

    setStatus("uploading");
    setUploadedUrl(null);
    setErrorMessage(null);

    try {
      const response = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      const payload = (await response.json()) as { url?: string; error?: string };

      if (!response.ok || !payload.url) {
        setStatus("error");
        setErrorMessage(payload.error ?? "Upload failed. Please try again.");
        return;
      }

      setUploadedUrl(payload.url);
      setStatus("success");
    } catch (error) {
      setStatus("error");
      setErrorMessage(
        error instanceof Error ? error.message : "Unexpected error during upload."
      );
    }
  }

  const statusCopy: Record<UploadState, string> = {
    idle: "",
    uploading: "Uploading…",
    success: "Upload complete",
    error: "Upload failed",
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="w-full max-w-xl space-y-4 rounded-xl border border-neutral-200 bg-neutral-900 p-4 text-neutral-50 sm:p-5"
    >
      <div>
        <h3 className="text-sm font-semibold sm:text-base">Upload your CAD file</h3>
        <p className="mt-1 text-xs text-neutral-300 sm:text-sm">
          STEP, IGES, STL, SolidWorks, zipped assemblies — max 25MB for now.
        </p>
      </div>

      <label className="flex cursor-pointer items-center justify-between rounded-lg bg-neutral-800 px-4 py-3 text-xs sm:text-sm hover:bg-neutral-700">
        <span>{file ? file.name : "Select a CAD file to begin."}</span>
        <span className="rounded-full bg-emerald-500 px-3 py-1 text-xs font-semibold text-white">
          Choose file
        </span>
        <input
          type="file"
          accept=".step,.stp,.iges,.igs,.sldprt,.x_t,.x_b,.stl,.zip"
          className="hidden"
          onChange={handleChange}
        />
      </label>

      <button
        type="submit"
        disabled={!file || status === "uploading"}
        className="inline-flex items-center justify-center rounded-full bg-emerald-500 px-5 py-2 text-xs font-semibold text-white transition hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-50 sm:text-sm"
      >
        {status === "uploading"
          ? "Uploading…"
          : file
          ? "Upload file"
          : "Select a file to submit"}
      </button>

      <p className="text-xs text-neutral-400 sm:text-sm">
        {statusCopy[status]}
        {status === "success" && uploadedUrl ? (
          <>
            {" "}
            —{" "}
            <a
              href={uploadedUrl}
              target="_blank"
              rel="noreferrer"
              className="text-emerald-300 underline"
            >
              View file
            </a>
          </>
        ) : null}
        {status === "error" && errorMessage ? (
          <> — {errorMessage}</>
        ) : null}
      </p>
    </form>
  );
}
