"use client";

import { useState, ChangeEvent, FormEvent } from "react";

type UploadState = "idle" | "uploading" | "success" | "error";

export default function UploadBox() {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<UploadState>("idle");
  const [uploadedUrl, setUploadedUrl] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0] ?? null;
    setFile(selected);
    setStatus("idle");
    setUploadedUrl(null);
    setErrorMessage(null);
    setUploadedFileName(null);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!file || status === "uploading") return;

    const formData = new FormData();
    formData.append("file", file);

    setStatus("uploading");
    setUploadedUrl(null);
    setUploadedFileName(null);
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
      setUploadedFileName(file.name);
      setStatus("success");
    } catch (error) {
      setStatus("error");
      setErrorMessage(
        error instanceof Error ? error.message : "Unexpected error during upload."
      );
    }
  }

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

      <div className="space-y-1 text-xs sm:text-sm">
        {status === "idle" && (
          <p className="text-neutral-400">Ready when you are.</p>
        )}
        {status === "uploading" && (
          <p className="text-neutral-300">Uploading… hang tight.</p>
        )}
        {status === "success" && (
          <>
            <p className="font-medium text-emerald-300">
              Upload received – we’ll review and follow up.
              {uploadedUrl ? (
                <>
                  {" "}
                  <a
                    href={uploadedUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="underline"
                  >
                    View file
                  </a>
                </>
              ) : null}
            </p>
            {uploadedFileName && (
              <p className="text-[0.7rem] uppercase tracking-wide text-neutral-400">
                Uploaded: {uploadedFileName}
              </p>
            )}
          </>
        )}
        {status === "error" && errorMessage && (
          <p className="text-red-400">Error: {errorMessage}</p>
        )}
      </div>
    </form>
  );
}
