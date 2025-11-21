"use client";
import { useRef, useState } from "react";
import {
  CAD_ACCEPT_STRING,
  CAD_FILE_TYPE_DESCRIPTION,
  MAX_UPLOAD_SIZE_BYTES,
  bytesToMegabytes,
  isAllowedCadFileName,
} from "@/lib/cadFileTypes";

const MAX_UPLOAD_SIZE_LABEL = `${bytesToMegabytes(MAX_UPLOAD_SIZE_BYTES)} MB`;

const formatReadableBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 MB";
  }
  return `${bytesToMegabytes(bytes)} MB`;
};

const validateCadFile = (file: File): string | null => {
  if (!isAllowedCadFileName(file.name)) {
    return `Unsupported file type. Please upload ${CAD_FILE_TYPE_DESCRIPTION}.`;
  }

  if (file.size > MAX_UPLOAD_SIZE_BYTES) {
    return `File is ${formatReadableBytes(file.size)}. Limit is ${MAX_UPLOAD_SIZE_LABEL}.`;
  }

  if (file.size === 0) {
    return "File is empty. Please choose a different CAD file.";
  }

  return null;
};

type UploadSuccessResponse = {
  success: true;
  message?: string;
  uploadId?: string;
  quoteId?: string | null;
  file?: {
    bucket: string;
    storageKey: string;
    storagePath: string;
    sizeBytes: number;
    mimeType: string;
    originalFileName: string;
    sanitizedFileName: string;
    extension?: string | null;
  };
  metadataRecorded?: boolean;
  step?: string;
};

type UploadErrorResponse = {
  success: false;
  message?: string;
  step?: string;
};

type UploadApiResponse = UploadSuccessResponse | UploadErrorResponse;

export default function CadUpload() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [log, setLog] = useState<string>(
    `Select a CAD file to begin.\nSupported: ${CAD_FILE_TYPE_DESCRIPTION}. Max ${MAX_UPLOAD_SIZE_LABEL}.`,
  );

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;

    const validationError = validateCadFile(f);
    if (validationError) {
      setLog(
        [
          `❌ ${validationError}`,
          `Supported: ${CAD_FILE_TYPE_DESCRIPTION}. Max ${MAX_UPLOAD_SIZE_LABEL}.`,
        ].join("\n"),
      );
      return;
    }

    setLog(
      [
        `Picked: ${f.name} (${f.type || "unknown"}) • ${f.size.toLocaleString()} bytes`,
        "📤 Uploading…",
      ].join("\n"),
    );

    const fd = new FormData();
    fd.append("file", f);

    try {
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const text = await res.text();
      let json: UploadSuccessResponse | UploadErrorResponse | null = null;
      try {
        json = text ? (JSON.parse(text) as UploadApiResponse) : null;
      } catch {
        json = null;
      }

      if (!json || json.success !== true) {
        const step =
          json && "step" in json && json.step ? json.step : "unknown";
        const errMsg =
          (json && "message" in json && json.message) ||
          `Request failed with ${res.status} ${res.statusText}`;
        const diagnostic = json
          ? `Diagnostics: ${JSON.stringify(json, null, 2)}`
          : undefined;
        setLog(
          [
            `❌ Upload failed at step "${step}".`,
            `Reason: ${errMsg}`,
            diagnostic,
          ]
            .filter(Boolean)
            .join("\n"),
        );
        return;
      }

      const metadataLines: string[] = [];
      if (json.file?.storagePath) {
        metadataLines.push(`Storage path: ${json.file.storagePath}`);
      } else if (json.file?.storageKey) {
        metadataLines.push(`Storage key: ${json.file.storageKey}`);
      }

      if (json.metadataRecorded === false) {
        metadataLines.push("⚠️ Metadata logging failed — check server logs.");
      }

      const successLines = [
        `✅ Upload complete: ${f.name}`,
        `Size: ${formatReadableBytes(f.size)} (limit ${MAX_UPLOAD_SIZE_LABEL})`,
        ...metadataLines,
      ];
      setLog(successLines.join("\n"));
    } catch (err: any) {
      setLog(`❌ Network error: ${err?.message ?? String(err)}`);
    }
  }

  return (
    <div style={{ display: "grid", gap: 10, maxWidth: 520 }}>
      <input
        ref={inputRef}
        type="file"
        // Same literal accept list keeps STL/STEP/etc. selectable in iOS Safari pickers.
        accept={CAD_ACCEPT_STRING}
        onChange={onPick}
        style={{ position: "absolute", opacity: 0, width: 1, height: 1 }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        style={{
          padding: "10px 16px",
          borderRadius: 999,
          background: "#1db954",
          fontWeight: 600,
        }}
        aria-label="Upload your CAD"
      >
        Upload your CAD
      </button>
      <pre
        aria-live="polite"
        style={{
          whiteSpace: "pre-wrap",
          fontSize: 12,
          background: "#0f1115",
          padding: 10,
          borderRadius: 8,
        }}
      >
        {log}
      </pre>
    </div>
  );
}
