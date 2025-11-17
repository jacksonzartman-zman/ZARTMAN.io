"use client";

import { useState, ChangeEvent } from "react";

const ACCEPTED_TYPES =
  ".step,.stp,.iges,.igs,.sldprt,.x_t,.x_b,.stl,.zip";

export default function UploadBox() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    setSelectedFile(file);
  };

  return (
    <div className="flex flex-col gap-6 rounded-2xl border border-gray-200 bg-gradient-to-b from-white to-gray-50 p-8 shadow-lg">
      <div>
        <p className="text-sm font-semibold uppercase tracking-[0.25em] text-gray-500">
          Upload
        </p>
        <h3 className="mt-2 text-2xl font-semibold text-gray-900">
          Upload your file
        </h3>
        <p className="mt-2 text-gray-600">
          Drop in a STEP, IGES, SolidWorks, STL, or a zipped assembly. We&apos;ll
          review manufacturability and reply with a clear next step.
        </p>
      </div>

      <label className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-gray-300 bg-white px-6 py-10 text-center text-gray-600 transition hover:border-gray-400">
        <input
          type="file"
          accept={ACCEPTED_TYPES}
          className="hidden"
          onChange={handleFileChange}
        />
        <span className="text-lg font-medium text-gray-900">
          Choose a file
        </span>
        <span className="text-sm text-gray-500">
          {selectedFile ? selectedFile.name : "STEP, IGES, SLDPRT, STL, ZIP"}
        </span>
      </label>

      <button
        disabled
        className="inline-flex w-full items-center justify-center rounded-full bg-gray-900/30 px-4 py-3 text-sm font-semibold text-white cursor-not-allowed"
      >
        Submit
      </button>
    </div>
  );
}
