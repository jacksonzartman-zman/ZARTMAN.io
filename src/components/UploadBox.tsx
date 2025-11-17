"use client";

import { useState, ChangeEvent, FormEvent } from "react";

export default function UploadBox() {
  const [file, setFile] = useState<File | null>(null);

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0] ?? null;
    setFile(selected);
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    // TODO: wire this up to Supabase / API later
    // For now, it's just a visual placeholder.
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
        disabled={!file}
        className="inline-flex items-center justify-center rounded-full bg-emerald-500 px-5 py-2 text-xs font-semibold text-white transition hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-50 sm:text-sm"
      >
        {file ? "Submit (mock for now)" : "Select a file to submit"}
      </button>
    </form>
  );
}
